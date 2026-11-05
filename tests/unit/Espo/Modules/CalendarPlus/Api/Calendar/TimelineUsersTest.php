<?php

namespace tests\unit\Espo\Modules\CalendarPlus\Api\Calendar;

require_once dirname(__DIR__, 7) . '/bootstrap.php';

use Espo\Core\Acl;
use Espo\Core\Api\Request;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Exceptions\BadRequest;
use Espo\Entities\User;
use Espo\ORM\EntityCollection;
use Espo\ORM\EntityManager;
use Espo\ORM\Repository\RDBRepository;
use Espo\ORM\Repository\RDBSelectBuilder;
use Espo\Modules\CalendarPlus\Api\Calendar\TimelineUsers;

final class TimelineUsersTest extends \PHPUnit\Framework\TestCase
{
  private function user(string $id, string $name): User
  {
    $user = $this->createMock(User::class);
    $user->method('getId')->willReturn($id);
    $user->method('get')->with('name')->willReturn($name);
    return $user;
  }

  private function request(array $data): Request
  {
    $request = $this->createMock(Request::class);
    $request->method('getParsedBody')->willReturn((object) $data);
    return $request;
  }

  private function acl(string $level = 'all'): Acl
  {
    $acl = $this->createMock(Acl::class);
    $acl->method('check')->with('Calendar')->willReturn(true);
    $acl->method('getPermissionLevel')->with('userCalendar')->willReturn($level);
    return $acl;
  }

  public function testTeamAndPeopleAreCombinedDeduplicatedSortedAndPermissionFiltered(): void
  {
    $ann = $this->user('ann', 'Ann');
    $bob = $this->user('bob', 'Bob');
    $hidden = $this->user('hidden', 'Hidden');
    $builder = $this->createMock(RDBSelectBuilder::class);
    $builder->method('join')->willReturnSelf();
    $builder->method('where')->willReturnCallback(function ($where) use ($builder) {
      self::assertSame(['teams.id' => ['team1'], 'isActive' => true], $where);
      return $builder;
    });
    $builder->method('find')->willReturn(new EntityCollection([$bob, $ann, $hidden]));
    $explicit = $this->createMock(RDBSelectBuilder::class);
    $explicit->method('find')->willReturn(new EntityCollection([$bob]));
    $repo = $this->createMock(RDBRepository::class);
    $repo->method('distinct')->willReturn($builder);
    $repo->method('where')->with(['id' => ['bob'], 'isActive' => true])->willReturn($explicit);
    $manager = $this->createMock(EntityManager::class);
    $manager->method('getRDBRepositoryByClass')->with(User::class)->willReturn($repo);
    $acl = $this->acl();
    $acl->method('checkUserPermission')->willReturnCallback(fn($user, $permission) => $user !== $hidden && $permission === 'userCalendar');
    $action = new TimelineUsers($manager, $acl, $this->user('me', 'Me'));
    $response = $action->process($this->request(['userIdList' => ['bob'], 'teamIdList' => ['team1']]));
    self::assertSame(['users' => [['id' => 'ann', 'name' => 'Ann'], ['id' => 'bob', 'name' => 'Bob']]],
      json_decode((string) $response->getBody(), true));
  }

  public function testCalendarPermissionNoRejectsResolution(): void
  {
    $this->expectException(Forbidden::class);
    (new TimelineUsers($this->createMock(EntityManager::class), $this->acl('no'), $this->user('me', 'Me')))
      ->process($this->request(['userIdList' => ['other']]));
  }

  public function testTeamPermissionCannotResolveOtherTeams(): void
  {
    $user = $this->user('me', 'Me');
    $user->method('getLinkMultipleIdList')->with('teams')->willReturn(['my-team']);
    $this->expectException(Forbidden::class);
    (new TimelineUsers($this->createMock(EntityManager::class), $this->acl('team'), $user))
      ->process($this->request(['teamIdList' => ['other-team']]));
  }

  public function testEmptySelectionNeverFallsBackToEveryone(): void
  {
    $manager = $this->createMock(EntityManager::class);
    $manager->expects(self::never())->method('getRDBRepositoryByClass');
    $response = (new TimelineUsers($manager, $this->acl(), $this->user('me', 'Me')))
      ->process($this->request([]));
    self::assertSame(['users' => []], json_decode((string) $response->getBody(), true));
  }

  public function testMalformedSelectionIsRejectedBeforeQuerying(): void
  {
    $this->expectException(BadRequest::class);
    (new TimelineUsers($this->createMock(EntityManager::class), $this->acl(), $this->user('me', 'Me')))
      ->process($this->request(['teamIdList' => 'not-an-array']));
  }

  public function testInactiveMembersCanBeResolvedWithoutBypassingCalendarPermissions(): void
  {
    $ann = $this->user('ann', 'Ann');
    $former = $this->user('former', 'Former member');
    $denied = $this->user('denied', 'Denied');
    $teamBuilder = $this->createMock(RDBSelectBuilder::class);
    $teamBuilder->method('join')->willReturnSelf();
    $teamBuilder->method('where')->with(['teams.id' => ['team1']])->willReturnSelf();
    $teamBuilder->method('find')->willReturn(new EntityCollection([$ann, $former, $denied]));
    $explicitBuilder = $this->createMock(RDBSelectBuilder::class);
    $explicitBuilder->method('find')->willReturn(new EntityCollection([$former]));
    $repo = $this->createMock(RDBRepository::class);
    $repo->method('distinct')->willReturn($teamBuilder);
    $repo->method('where')->with(['id' => ['former']])->willReturn($explicitBuilder);
    $manager = $this->createMock(EntityManager::class);
    $manager->method('getRDBRepositoryByClass')->willReturn($repo);
    $acl = $this->acl();
    $acl->method('checkUserPermission')->willReturnCallback(fn($user) => $user !== $denied);
    $response = (new TimelineUsers($manager, $acl, $this->user('me', 'Me')))->process($this->request([
      'teamIdList' => ['team1'], 'userIdList' => ['former'], 'includeInactiveUsers' => true,
    ]));
    self::assertSame(['users' => [['id' => 'ann', 'name' => 'Ann'], ['id' => 'former', 'name' => 'Former member']]],
      json_decode((string) $response->getBody(), true));
  }

  public function testMalformedInactiveOptionIsRejectedBeforeQuerying(): void
  {
    $manager = $this->createMock(EntityManager::class);
    $manager->expects(self::never())->method('getRDBRepositoryByClass');
    $this->expectException(BadRequest::class);
    (new TimelineUsers($manager, $this->acl(), $this->user('me', 'Me')))->process($this->request([
      'userIdList' => ['former'], 'includeInactiveUsers' => 'true',
    ]));
  }

  public function testIncludingInactiveUsersDoesNotGrantAccessToOtherTeams(): void
  {
    $user = $this->user('me', 'Me');
    $user->method('getLinkMultipleIdList')->willReturn(['my-team']);
    $this->expectException(Forbidden::class);
    (new TimelineUsers($this->createMock(EntityManager::class), $this->acl('team'), $user))
      ->process($this->request(['teamIdList' => ['other-team'], 'includeInactiveUsers' => true]));
  }
}
