<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Acl;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Exceptions\NotFound;
use Espo\Core\Field\DateTime;
use Espo\Modules\Crm\Tools\Calendar\FetchParams;
use Espo\Modules\Crm\Tools\Calendar\Items\NonWorkingRange;
use Espo\Modules\Crm\Tools\Calendar\Service as CalendarService;
use InvalidArgumentException;

class WorkingTimeRanges
{
  public function __construct(private CalendarService $calendar, private Acl $acl)
  {
  }

  /** @return list<array{userId: string, dateStart: string, dateEnd: string}> */
  public function fetch(mixed $userIds, mixed $from, mixed $to): array
  {
    if (!$this->acl->check('Calendar')) {
      throw new Forbidden();
    }

    $userIds = Selection::ids($userIds);

    if (!is_string($from) || !is_string($to)) {
      throw new BadRequest('Invalid working-time range.');
    }

    try {
      $start = DateTime::fromString($from);
      $end = DateTime::fromString($to);
    } catch (InvalidArgumentException) {
      throw new BadRequest('Invalid working-time range.');
    }

    if ($end->toTimestamp() <= $start->toTimestamp()) {
      throw new BadRequest('Invalid working-time range.');
    }

    // Fetch only working-calendar data, without querying activity records again.
    $params = FetchParams::create($start, $end)
      ->withScopeList([])
      ->withIsAgenda()
      ->withWorkingTimeRangesInverted();
    $ranges = [];

    foreach ($userIds as $userId) {
      try {
        $items = $this->calendar->fetch($userId, $params);
      } catch (Forbidden | NotFound) {
        continue;
      }

      foreach ($items as $item) {
        if (!$item instanceof NonWorkingRange) continue;

        $ranges[] = [
          'userId' => $userId,
          'dateStart' => $item->getStart()->toString(),
          'dateEnd' => $item->getEnd()->toString(),
        ];
      }
    }

    return $ranges;
  }
}
