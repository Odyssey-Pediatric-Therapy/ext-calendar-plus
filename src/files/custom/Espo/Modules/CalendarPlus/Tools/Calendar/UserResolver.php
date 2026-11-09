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

  /** @return array<int, array{id: string, name: ?string}> */
  public function resolve(
    mixed $userIds = [],
    mixed $teamIds = [],
    mixed $includeInactive = false,
    mixed $teamColumns = [],
    mixed $inactiveUserIds = [],
  ): array {
    return $this->resolveSelection($userIds, $teamIds, $includeInactive, $teamColumns, $inactiveUserIds)['users'];
  }

  /** @return array{users: list<array{id: string, name: ?string}>, teamUserIdLists: array<string, list<string>>} */
  public function resolveSelection(
    mixed $userIds = [],
    mixed $teamIds = [],
    mixed $includeInactive = false,
    mixed $teamColumns = [],
    mixed $inactiveUserIds = [],
  ): array {
    if (!$this->acl->check('Calendar') || $this->acl->getPermissionLevel('userCalendar') === 'no') {
      throw new Forbidden();
    }

    $userIds = Selection::ids($userIds);
    $teamIds = Selection::ids($teamIds, Selection::MAX_TEAMS);
    $inactiveTeams = array_intersect(Selection::inactiveTeams($teamColumns), $teamIds);
    $inactiveUserIds = Selection::ids($inactiveUserIds);

    if (array_diff($inactiveUserIds, $userIds)) {
      throw new BadRequest('Inactive user overrides must be part of the selected user list.');
    }

    if (!is_bool($includeInactive)) {
      throw new BadRequest('Invalid inactive user option.');
    }

    if (
      $this->acl->getPermissionLevel('userCalendar') === 'team' &&
      array_diff($teamIds, $this->user->getLinkMultipleIdList('teams'))
    ) {
      throw new Forbidden();
    }

    if (!$userIds && !$teamIds) {
      return ['users' => [], 'teamUserIdLists' => []];
    }

    $filter = ['type' => self::USER_TYPES];

    $needsInactive = $includeInactive || $inactiveTeams || $inactiveUserIds;

    if (!$needsInactive) {
      $filter['isActive'] = true;
    }

    $repository = $this->entityManager->getRDBRepositoryByClass(User::class);
    $permissionCache = [];
    $eligible = [];
    $active = [];
    $conditions = [];

    if ($userIds) {
      $conditions[] = ['id' => $userIds, ...($needsInactive && !$includeInactive ? ['isActive' => true] : [])];

      if ($inactiveUserIds) {
        $conditions[] = ['id' => $inactiveUserIds];
      }
    }

    if ($teamIds) {
      $conditions[] = ['teams.id' => $teamIds, ...($needsInactive ? ['isActive' => true] : [])];

      if ($inactiveTeams) {
        $conditions[] = ['teams.id' => array_values($inactiveTeams)];
      }
    }

    $query = $teamIds ? $repository->leftJoin('teams')->distinct() : $repository->where([]);
    $candidates = $query
      ->where(['OR' => $conditions, ...$filter])
      ->limit(0, Selection::MAX_USERS + 1)
      ->sth()
      ->find();

    foreach ($candidates as $user) {
      if ($this->canInclude($user, $permissionCache)) {
        $eligible[$user->getId()] = $this->summary($user);
        $active[$user->getId()] = $user->get('isActive') !== false;
      }
    }

    $users = [];

    foreach ($userIds as $id) {
      if (isset($eligible[$id]) && ($active[$id] || $includeInactive || in_array($id, $inactiveUserIds, true))) {
        $users[$id] = $eligible[$id];
      }
    }

    if (!$teamIds || !$eligible) {
      return ['users' => array_values($users), 'teamUserIdLists' => array_fill_keys($teamIds, [])];
    }

    // Read relation aliases as raw rows; ORM User entities discard unknown attributes.
    $membershipQuery = $this->entityManager->getQueryBuilder()
      ->select(['id', Column::fromString('teams.id')->withAlias('teamId')])
      ->from(User::ENTITY_TYPE)
      ->join('teams')
      ->where(['id' => array_keys($eligible), 'teams.id' => $teamIds])
      ->distinct()
      ->build();
    $memberships = $this->entityManager->getQueryExecutor()->execute($membershipQuery);
    $teams = array_fill_keys($teamIds, []);
    $teamMembers = array_fill_keys($teamIds, []);

    while ($row = $memberships->fetch()) {
      $id = $row['id'];
      $teamId = $row['teamId'];

      if (isset($teams[$teamId], $eligible[$id]) && ($active[$id] || in_array($teamId, $inactiveTeams, true))) {
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
