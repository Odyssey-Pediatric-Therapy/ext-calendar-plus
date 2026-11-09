<?php

namespace tests\unit\Espo\Modules\CalendarPlus\Api\Calendar;

require_once dirname(__DIR__, 7) . '/bootstrap.php';

use Espo\Core\Acl;
use Espo\Core\Api\Request;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Entities\User;
use Espo\Modules\CalendarPlus\Api\Calendar\TimelineUsers;
use Espo\Modules\CalendarPlus\Tools\Calendar\UserResolver;
use Espo\ORM\EntityCollection;
use Espo\ORM\EntityManager;
use Espo\ORM\Executor\QueryExecutor;
use Espo\ORM\QueryBuilder;
use PDOStatement;
use Espo\ORM\Repository\RDBRepository;
use Espo\ORM\Repository\RDBSelectBuilder;
use PHPUnit\Framework\TestCase;

final class MembershipStatement extends PDOStatement
{
  private int $index = 0;

  public function __construct(private array $rows)
  {
  }

  public function fetch(int $mode = \PDO::FETCH_DEFAULT, int $cursorOrientation = \PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed
  {
    return $this->rows[$this->index++] ?? false;
  }
}

final class TimelineUsersTest extends TestCase
{
  private function user(string $id, string $name, ?string $team = null, string $type = 'regular'): User
  {
    $user = $this->createMock(User::class);
    $user->method('getId')->willReturn($id);
    $user->method('getType')->willReturn($type);
    $user->method('get')->willReturnCallback(static fn ($field) => match ($field) {
      'name' => $name,
      'calendarPlusTeamId' => $team,
      default => null,
    });

    return $user;
  }

  private function acl(string $level = 'all'): Acl
  {
    $acl = $this->createMock(Acl::class);
    $acl->method('check')->with('Calendar')->willReturn(true);
    $acl->method('getPermissionLevel')->with('userCalendar')->willReturn($level);

    return $acl;
  }

  private function manager(array $explicit = [], array $memberships = [], ?array &$queries = null): EntityManager
  {
    $builder = $this->createMock(RDBSelectBuilder::class);
    $builder->method('distinct')->willReturnSelf();
    $builder->method('limit')->with(0, 301)->willReturnSelf();
    $builder->method('sth')->willReturnSelf();
    $builder->method('where')->willReturnCallback(function ($where) use ($builder, &$queries) {
      $queries[] = $where;
      return $builder;
    });
    $rows = [];
    $rowCache = [];
    $candidates = [];
    foreach ($memberships as $user) {
      $key = spl_object_id($user);
      $row = $rowCache[$key] ??= ['id' => $user->getId(), 'teamId' => $user->get('calendarPlusTeamId')];
      $rows[] = $row;
      $candidates[$row['id']] = $user;
    }
    $builder->method('find')->willReturn(new EntityCollection([...$explicit, ...array_values($candidates)]));
    $repository = $this->createMock(RDBRepository::class);
    $repository->method('where')->willReturn($builder);
    $repository->method('leftJoin')->with('teams')->willReturn($builder);
    $manager = $this->createMock(EntityManager::class);
    $manager->method('getRDBRepositoryByClass')->with(User::class)->willReturn($repository);
    $manager->method('getQueryBuilder')->willReturn(new QueryBuilder());
    $statement = new MembershipStatement($rows);
    $executor = $this->createMock(QueryExecutor::class);
    $executor->method('execute')->willReturnCallback(function ($query) use ($statement, &$queries) {
      self::assertNull($query->getLimit());
      $queries[] = $query->getRaw();
      return $statement;
    });
    $manager->method('getQueryExecutor')->willReturn($executor);

    return $manager;
  }

  private function resolve(UserResolver $resolver, array $data): array
  {
    $request = $this->createMock(Request::class);
    $request->method('getParsedBody')->willReturn((object) $data);
    $response = (new TimelineUsers($resolver))->process($request);

    return json_decode((string) $response->getBody(), true)['users'];
  }

  public function testStoredOrderAndPermissionsArePreservedWithOneQueryForAllTeams(): void
  {
    $queries = [];
    $manager = $this->manager(
      [$this->user('ann', 'Ann'), $this->user('zoe', 'Zoe')],
      [
        $this->user('ann', 'Ann', 'team-a'),
        $this->user('bob', 'Bob', 'team-b'),
        $this->user('zoe', 'Zoe', 'team-b'),
        $this->user('hidden', 'Hidden', 'team-b'),
        $this->user('bob', 'Bob', 'team-a'),
        $this->user('hidden', 'Hidden', 'team-a'),
      ],
      $queries,
    );
    $checks = [];
    $acl = $this->acl();
    $acl->method('checkUserPermission')->willReturnCallback(function ($user) use (&$checks) {
      $checks[] = $user->getId();
      return $user->getId() !== 'hidden';
    });
    $resolver = new UserResolver($manager, $acl, $this->user('me', 'Me'));
    $users = $this->resolve($resolver, [
      'userIdList' => ['zoe', 'missing', 'ann', 'zoe'],
      'teamIdList' => ['team-b', 'team-a', 'team-b'],
    ]);
    self::assertSame(['zoe', 'ann', 'bob'], array_column($users, 'id'));
    self::assertSame(['ann', 'zoe', 'bob', 'hidden'], $checks);
    self::assertCount(2, $queries);
    self::assertSame(['zoe', 'missing', 'ann'], $queries[0]['OR'][0]['id']);
    self::assertSame(['team-b', 'team-a'], $queries[0]['OR'][1]['teams.id']);
    self::assertSame(['regular', 'admin', 'super-admin'], $queries[0]['type']);
    self::assertTrue($queries[0]['isActive']);
  }

  public function testTeamOrderAndAlphabeticalMemberOrderAreIndependentOfDatabaseOrder(): void
  {
    $manager = $this->manager([], [
      $this->user('ann', 'Ann', 'team-a'),
      $this->user('zoe', 'Zoe', 'team-b'),
      $this->user('bob', 'Bob', 'team-b'),
      $this->user('bob', 'Bob', 'team-a'),
    ]);
    $acl = $this->acl();
    $acl->method('checkUserPermission')->willReturn(true);
    $users = $this->resolve(new UserResolver($manager, $acl, $this->user('me', 'Me')), [
      'teamIdList' => ['team-b', 'team-a'],
    ]);
    self::assertSame(['bob', 'zoe', 'ann'], array_column($users, 'id'));
  }

  public function testInactiveOptionDoesNotIncludePortalApiOrSystemUsers(): void
  {
    $queries = [];
    $manager = $this->manager([
      $this->user('former', 'Former member'),
      $this->user('api', 'Integration', null, 'api'),
      $this->user('portal', 'Portal', null, 'portal'),
      $this->user('system', 'System', null, 'system'),
      $this->user('admin', 'Administrator', null, 'admin'),
    ], [], $queries);
    $acl = $this->acl();
    $acl->expects(self::exactly(2))->method('checkUserPermission')->willReturn(true);
    $users = $this->resolve(new UserResolver($manager, $acl, $this->user('me', 'Me')), [
      'userIdList' => ['former', 'api', 'portal', 'system', 'admin'],
      'includeInactiveUsers' => true,
    ]);
    self::assertSame(['former', 'admin'], array_column($users, 'id'));
    self::assertArrayNotHasKey('isActive', $queries[0]);
  }

  public function testEmptySelectionNeverQueriesEveryone(): void
  {
    $manager = $this->createMock(EntityManager::class);
    $manager->expects(self::never())->method('getRDBRepositoryByClass');
    self::assertSame([], $this->resolve(new UserResolver($manager, $this->acl(), $this->user('me', 'Me')), []));
  }

  public function testCalendarPermissionNoRejectsResolution(): void
  {
    $this->expectException(Forbidden::class);
    (new UserResolver($this->createMock(EntityManager::class), $this->acl('no'), $this->user('me', 'Me')))->resolve(['other']);
  }

  public function testTeamPermissionCannotResolveUnrelatedTeamsEvenWhenInactiveUsersAreIncluded(): void
  {
    $user = $this->user('me', 'Me');
    $user->method('getLinkMultipleIdList')->with('teams')->willReturn(['my-team']);
    $this->expectException(Forbidden::class);
    (new UserResolver($this->createMock(EntityManager::class), $this->acl('team'), $user))->resolve([], ['other-team'], true);
  }

  public function testMalformedIdsAndInactiveOptionAreRejectedBeforeQuerying(): void
  {
    $manager = $this->createMock(EntityManager::class);
    $manager->expects(self::never())->method('getRDBRepositoryByClass');
    $resolver = new UserResolver($manager, $this->acl(), $this->user('me', 'Me'));
    foreach ([['not-array', [], false], [[1], [], false], [[], [''], false], [[], [], 'true'], [array_fill(0, 301, 'user'), [], false], [[], array_fill(0, 101, 'team'), false]] as $arguments) {
      try {
        $resolver->resolve(...$arguments);
        self::fail('Malformed selection was accepted.');
      } catch (BadRequest) {
      }
    }
  }

  public function testOversizedTeamExpansionFailsInsteadOfReturningPartialMembership(): void
  {
    $members = [];
    for ($i = 0; $i < 301; $i++) {
      $members[] = $this->user('user-' . $i, 'User ' . $i, 'team');
    }
    $manager = $this->manager([], $members);
    $acl = $this->acl();
    $acl->expects(self::exactly(300))->method('checkUserPermission')->willReturn(true);
    $this->expectException(BadRequest::class);
    (new UserResolver($manager, $acl, $this->user('me', 'Me')))->resolve([], ['team']);
  }
}
