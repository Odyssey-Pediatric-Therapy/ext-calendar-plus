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
  public function resolve(mixed $userIds = [], mixed $teamIds = [], mixed $includeInactive = false): array
  {
    if (!$this->acl->check('Calendar') || $this->acl->getPermissionLevel('userCalendar') === 'no') {
      throw new Forbidden();
    }

    $userIds = Selection::ids($userIds);
    $teamIds = Selection::ids($teamIds, Selection::MAX_TEAMS);

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
      return [];
    }

    $filter = ['type' => self::USER_TYPES];

    if (!$includeInactive) {
      $filter['isActive'] = true;
    }

    $repository = $this->entityManager->getRDBRepositoryByClass(User::class);
    $permissionCache = [];
    $eligible = [];
    $conditions = [];

    if ($userIds) {
      $conditions[] = ['id' => $userIds];
    }

    if ($teamIds) {
      $conditions[] = ['teams.id' => $teamIds];
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
      }
    }

    $users = [];

    foreach ($userIds as $id) {
      if (isset($eligible[$id])) {
        $users[$id] = $eligible[$id];
      }
    }

    if (!$teamIds || !$eligible) {
      return array_values($users);
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

    while ($row = $memberships->fetch()) {
      $id = $row['id'];
      $teamId = $row['teamId'];

      if (!isset($users[$id]) && isset($teams[$teamId], $eligible[$id])) {
        $teams[$teamId][$id] = $eligible[$id];
      }
    }

    foreach ($teams as $members) {
      uasort($members, static fn ($a, $b) =>
        strnatcasecmp($a['name'] ?? '', $b['name'] ?? '') ?: strcmp($a['id'], $b['id']));
      $users += $members;
    }

    return array_values($users);
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
