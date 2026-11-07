<?php

namespace Espo\Modules\CalendarPlus\Api\Calendar;

use Espo\Core\Acl;
use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Entities\User;
use Espo\ORM\EntityManager;

/** Resolve the union of selected teams and people using calendar permissions. */
class TimelineUsers implements Action
{
  public function __construct(
    private EntityManager $entityManager,
    private Acl $acl,
    private User $user,
  ) {}

  public function process(Request $request): Response
  {
    if (!$this->acl->check('Calendar') || $this->acl->getPermissionLevel('userCalendar') === 'no') {
      throw new Forbidden();
    }
    $data = $request->getParsedBody();
    $teamIds = $data->teamIdList ?? [];
    $userIds = $data->userIdList ?? [];
    $includeInactive = $data->includeInactiveUsers ?? false;
    if (!is_bool($includeInactive)) {
      throw new BadRequest('Invalid inactive user option.');
    }
    $activeFilter = $includeInactive ? [] : ['isActive' => true];
    foreach ([$teamIds, $userIds] as $ids) {
      if (!is_array($ids) || count($ids) > 500) {
        throw new BadRequest('Invalid selection.');
      }
      foreach ($ids as $id) {
        if (!is_string($id) || $id === '' || strlen($id) > 100) {
          throw new BadRequest('Invalid ID.');
        }
      }
    }
    if ($this->acl->getPermissionLevel('userCalendar') === 'team') {
      if (array_diff($teamIds, $this->user->getLinkMultipleIdList('teams'))) {
        throw new Forbidden();
      }
    }
    $users = [];
    if ($userIds) {
      foreach ($this->entityManager->getRDBRepositoryByClass(User::class)
        ->where(['id' => $userIds, ...$activeFilter])->find() as $user) {
        if (!isset($users[$user->getId()]) && $this->acl->checkUserPermission($user, 'userCalendar')) {
          $users[$user->getId()] = ['id' => $user->getId(), 'name' => $user->get('name')];
        }
      }
    }
    // Database result order need not match the saved explicit selection.
    $users = array_replace(array_fill_keys($userIds, null), $users);
    $users = array_filter($users);
    foreach (array_unique($teamIds) as $teamId) {
      $teamUsers = [];
      foreach ($this->entityManager->getRDBRepositoryByClass(User::class)->distinct()->join('teams')
        ->where(['teams.id' => [$teamId], ...$activeFilter])->find() as $user) {
        if (!isset($users[$user->getId()]) && $this->acl->checkUserPermission($user, 'userCalendar')) {
          $teamUsers[$user->getId()] = ['id' => $user->getId(), 'name' => $user->get('name')];
        }
      }
      // Sort within each team without changing saved user or team order.
      uasort($teamUsers, static fn ($a, $b) =>
        strnatcasecmp($a['name'] ?? '', $b['name'] ?? '') ?: strcmp($a['id'], $b['id']));
      $users += $teamUsers;
    }
    $users = array_values($users);
    return ResponseComposer::json(['users' => $users]);
  }
}
