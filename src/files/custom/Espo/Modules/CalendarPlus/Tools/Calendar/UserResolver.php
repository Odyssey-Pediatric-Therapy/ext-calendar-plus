<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Acl;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Entities\User;
use Espo\ORM\EntityManager;
use Espo\ORM\Query\Part\Selection as Column;

class UserResolver
{
  // Fail explicitly instead of returning a silently truncated calendar.
  private const USER_TYPES = [User::TYPE_REGULAR, User::TYPE_ADMIN, 'super-admin'];

  public function __construct(
    private EntityManager $entityManager,
    private Acl $acl,
    private User $user,
  ) {
  }

  /** @return array{users: list<array{id: string, name: ?string}>, teamUserIdLists: array<string, list<string>>} */
  public function resolve(UserSelection $selection): array
  {
    $this->checkAccess($selection);
    $userIds = $selection->userIds;
    $teamIds = $selection->teamIds;

    if (!$userIds && !$teamIds) {
      return ['users' => [], 'teamUserIdLists' => []];
    }

    $permissionCache = [];
    $eligible = [];
    $active = [];

    foreach ($this->findCandidates($selection) as $user) {
      if ($this->canInclude($user, $permissionCache)) {
        $eligible[$user->getId()] = $this->summary($user);
        $active[$user->getId()] = $user->get('isActive') !== false;
      }
    }

    $users = [];

    foreach ($userIds as $id) {
      if (isset($eligible[$id]) && ($active[$id] || $selection->allowsInactiveUser($id))) {
        $users[$id] = $eligible[$id];
      }
    }

    if (!$teamIds || !$eligible) {
      return ['users' => array_values($users), 'teamUserIdLists' => array_fill_keys($teamIds, [])];
    }

    $memberships = $this->findMemberships(array_keys($eligible), $teamIds);
    $teams = array_fill_keys($teamIds, []);
    $teamMembers = array_fill_keys($teamIds, []);

    while ($row = $memberships->fetch()) {
      $id = $row['id'];
      $teamId = $row['teamId'];

      if (
        isset($teams[$teamId], $eligible[$id]) &&
        ($active[$id] || $selection->allowsInactiveTeam($teamId))
      ) {
        $teamMembers[$teamId][$id] = $id;

        if (!isset($users[$id])) {
          $teams[$teamId][$id] = $eligible[$id];
        }
      }
    }

    foreach ($teams as $members) {
      uasort($members, static fn ($a, $b) =>
        strnatcasecmp($a['name'] ?? '', $b['name'] ?? '') ?: strcmp($a['id'], $b['id']));
      $users += $members;
    }

    return [
      'users' => array_values($users),
      'teamUserIdLists' => array_map(static fn (array $ids): array => array_values($ids), $teamMembers),
    ];
  }

  private function checkAccess(UserSelection $selection): void
  {
    if (!$this->acl->check('Calendar') || $this->acl->getPermissionLevel('userCalendar') === 'no') {
      throw new Forbidden();
    }

    if (
      $this->acl->getPermissionLevel('userCalendar') === 'team' &&
      array_diff($selection->teamIds, $this->user->getLinkMultipleIdList('teams'))
    ) {
      throw new Forbidden();
    }
  }

  /** @return iterable<User> */
  private function findCandidates(UserSelection $selection): iterable
  {
    $userIds = $selection->userIds;
    $teamIds = $selection->teamIds;
    $filter = ['type' => self::USER_TYPES];

    $needsInactive =
      $selection->includeInactiveUsers || $selection->inactiveTeamIds || $selection->inactiveUserIds;

    if (!$needsInactive) {
      $filter['isActive'] = true;
    }

    $repository = $this->entityManager->getRDBRepositoryByClass(User::class);
    $conditions = [];

    if ($userIds) {
      $conditions[] = [
        'id' => $userIds,
        ...($needsInactive && !$selection->includeInactiveUsers ? ['isActive' => true] : []),
      ];

      if ($selection->inactiveUserIds) {
        $conditions[] = ['id' => $selection->inactiveUserIds];
      }
    }

    if ($teamIds) {
      $conditions[] = ['teams.id' => $teamIds, ...($needsInactive ? ['isActive' => true] : [])];

      if ($selection->inactiveTeamIds) {
        $conditions[] = ['teams.id' => array_values($selection->inactiveTeamIds)];
      }
    }

    $query = $teamIds ? $repository->leftJoin('teams')->distinct() : $repository->where([]);

    return $query
      ->where(['OR' => $conditions, ...$filter])
      ->limit(0, Selection::MAX_USERS + 1)
      ->sth()
      ->find();
  }

  /**
   * @param list<string> $userIds
   * @param list<string> $teamIds
   */
  private function findMemberships(array $userIds, array $teamIds): \PDOStatement
  {
    // Read relation aliases as raw rows; ORM User entities discard unknown attributes.
    $membershipQuery = $this->entityManager->getQueryBuilder()
      ->select(['id', Column::fromString('teams.id')->withAlias('teamId')])
      ->from(User::ENTITY_TYPE)
      ->join('teams')
      ->where(['id' => $userIds, 'teams.id' => $teamIds])
      ->distinct()
      ->build();

    return $this->entityManager->getQueryExecutor()->execute($membershipQuery);
  }

  /** @param array<string, bool> $cache */
  private function canInclude(User $user, array &$cache): bool
  {
    if (!in_array($user->getType(), self::USER_TYPES, true)) {
      return false;
    }

    $id = $user->getId();

    if (!array_key_exists($id, $cache)) {
      if (count($cache) >= Selection::MAX_USERS) {
        throw new BadRequest('Calendar selection exceeds 300 users. Select fewer teams or users.');
      }

      $cache[$id] = $this->acl->checkUserPermission($user, 'userCalendar');
    }

    return $cache[$id];
  }

  /** @return array{id: string, name: ?string} */
  private function summary(User $user): array
  {
    return ['id' => $user->getId(), 'name' => $user->get('name')];
  }
}
