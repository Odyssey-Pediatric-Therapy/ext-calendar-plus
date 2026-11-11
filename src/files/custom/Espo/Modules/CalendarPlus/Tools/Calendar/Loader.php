<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Acl;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Field\DateTime;
use Espo\Entities\User;
use Espo\Modules\Crm\Tools\Calendar\FetchParams;
use Espo\Modules\Crm\Tools\Calendar\Service as Calendar;
use Espo\ORM\EntityManager;
use InvalidArgumentException;
use stdClass;

/** One request produces the complete visible calendar, using Espo's selection rules. */
class Loader
{
  public function __construct(
    private Calendar $calendar,
    private UserResolver $users,
    private WorkingTimeRanges $working,
    private EventDetails $details,
    private Acl $acl,
    private User $user,
    private EntityManager $entityManager,
  ) {}

  public function load(stdClass $input): stdClass {
    if (!$this->acl->check('Calendar')) {
      throw new Forbidden();
    }

    $mode = $input->type ?? 'grid';

    if (!in_array($mode, ['grid', 'timeline'], true)) {
      throw new BadRequest('Invalid calendar type.');
    }

    if (!is_string($input->from ?? null) || !is_string($input->to ?? null)) {
      throw new BadRequest('Invalid calendar range.');
    }

    try {
      $from = DateTime::fromString($this->normalizeTime($input->from));
      $to = DateTime::fromString($this->normalizeTime($input->to));
    } catch (InvalidArgumentException) {
      throw new BadRequest('Invalid calendar range.');
    }

    $duration = $to->toTimestamp() - $from->toTimestamp();

    if ($duration <= 0 || $duration > 123 * 86400) {
      throw new BadRequest('Invalid calendar range.');
    }

    $scopes = null;

    if (isset($input->scopeList)) {
      $scopes = Selection::ids($input->scopeList, 100);
    }

    foreach (['agenda', 'workingTime'] as $flag) {
      if (isset($input->{$flag}) && !is_bool($input->{$flag})) {
        throw new BadRequest('Invalid calendar option.');
      }
    }

    $params = FetchParams::create($from, $to)->withScopeList($scopes);
    $shared = isset($input->selection);

    if ($shared) {
      if (!$input->selection instanceof stdClass) {
        throw new BadRequest('Invalid calendar selection.');
      }
      $users = $this->users->resolve(new UserSelection($input->selection))['users'];
      $ids = array_column($users, 'id');
    } else {
      $id = $input->userId ?? $this->user->getId();
      if (!Selection::isId($id)) {
        throw new BadRequest('Invalid calendar user.');
      }
      $ids = [$id];
      $users = [];
    }

    $events = [];

    if ($mode === 'timeline') {
      foreach ($this->calendar->fetchTimelineForUsers($ids, $params) as $id => $items) {
        foreach ($items as $item) {
          $events[] = (object) [...get_object_vars($item->getRaw()), 'userId' => $id];
        }
      }
    } else {
      if ($shared) {
        $items = $this->calendar->fetchForUsers($ids, $params);
      } else {
        $items = $this->calendar->fetch(
          $ids[0],
          $params->withIsAgenda($input->agenda ?? false)->withWorkingTimeRanges(),
        );
      }

      foreach ($items as $item) {
        $events[] = $item->getRaw();
      }
    }

    if (!$shared) {
      // Espo has checked calendar access above before exposing this user's name.
      $person = $this->entityManager->getRDBRepository('User')->getById($ids[0]);
      if ($person) {
        $users[] = ['id' => $person->getId(), 'name' => $person->get('name')];
      }
    }

    // Event IDs come from Espo's permission-checked calendar result, not another
    // client request. Repeated timeline/person appearances share one projection.
    $records = [];

    foreach ($events as $event) {
      if (isset($event->scope, $event->id)) {
        $records[$event->scope . ':' . $event->id] = $event;
      }
    }

    $details = [];

    foreach (array_chunk($records, EventDetails::MAX_RECORDS, true) as $chunk) {
      $groups = new stdClass();
      foreach ($chunk as $event) {
        $groups->{$event->scope}[] = $event->id;
      }
      $details += $this->details->fetch($groups);
    }

    foreach ($events as $event) {
      $event->calendarPlusDetails = null;

      if (isset($event->scope, $event->id)) {
        $event->calendarPlusDetails = $details[$event->scope . ':' . $event->id] ?? null;
      }
    }

    $ranges = [];

    if ($mode === 'grid' && $shared && ($input->workingTime ?? false)) {
      $ranges = $this->working->fetch($ids, $from->toString(), $to->toString());
    }

    return (object) ['users' => $users, 'events' => $events, 'ranges' => $ranges];
  }

  private function normalizeTime(string $value): string {
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $value)) {
      return $value . ':00';
    }

    return $value;
  }
}
