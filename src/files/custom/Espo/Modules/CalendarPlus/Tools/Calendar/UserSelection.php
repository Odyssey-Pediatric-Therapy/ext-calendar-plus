<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Exceptions\BadRequest;
use stdClass;

/** Validated calendar membership options, shared by dynamic and static calendars. */
final class UserSelection
{
  /** @var list<string> */
  public readonly array $userIds;

  /** @var list<string> */
  public readonly array $teamIds;

  /** @var list<string> */
  public readonly array $inactiveTeamIds;

  /** @var list<string> */
  public readonly array $inactiveUserIds;

  public readonly bool $includeInactiveUsers;

  public function __construct(stdClass $data)
  {
    $this->userIds = Selection::ids($data->userIdList ?? []);
    $this->teamIds = Selection::ids($data->teamIdList ?? [], Selection::MAX_TEAMS);
    $this->inactiveTeamIds = array_values(array_intersect(
      Selection::inactiveTeams($data->teamColumns ?? []),
      $this->teamIds,
    ));
    $this->inactiveUserIds = Selection::ids($data->inactiveUserIdList ?? []);

    if (array_diff($this->inactiveUserIds, $this->userIds)) {
      throw new BadRequest('Inactive user overrides must be part of the selected user list.');
    }

    $includeInactive = $data->includeInactiveUsers ?? false;

    if (!is_bool($includeInactive)) {
      throw new BadRequest('Invalid inactive user option.');
    }

    $this->includeInactiveUsers = $includeInactive;
  }

  public function allowsInactiveUser(string $id): bool
  {
    return $this->includeInactiveUsers || in_array($id, $this->inactiveUserIds, true);
  }

  public function allowsInactiveTeam(string $id): bool
  {
    return in_array($id, $this->inactiveTeamIds, true);
  }
}
