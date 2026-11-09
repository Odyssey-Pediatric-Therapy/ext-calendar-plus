<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use DateTimeImmutable;
use DateTimeZone;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Field\DateTime;
use Espo\Core\Utils\Config;
use Espo\Modules\Crm\Tools\Calendar\Service as CalendarService;
use InvalidArgumentException;
use stdClass;

class AvailabilitySearch
{
  private const STEP = 300;
  private const BUDGET_NS = 3000000000;

  public function __construct(
    private CalendarService $calendar,
    private Config $config,
    private AvailabilityCursor $cursor,
  ) {
  }

  /** @return array<string, mixed> */
  public function search(stdClass $input): array
  {
    $users = Selection::ids($input->userIdList ?? null);
    $entityType = $input->entityType ?? null;
    $entityId = $input->entityId ?? null;
    $duration = $input->duration ?? null;
    $token = $input->cursor ?? null;

    if (
      !$users || !in_array($entityType, ['Meeting', 'Call'], true) ||
      ($entityId !== null && !Selection::isId($entityId)) ||
      !is_int($duration) || $duration <= 0 ||
      ($token !== null && !is_string($token)) ||
      !is_string($input->timeZone ?? null) || strlen($input->timeZone) > 100
    ) {
      throw new BadRequest('Invalid availability request.');
    }

    try {
      $zone = new DateTimeZone($input->timeZone);
    } catch (\Exception) {
      throw new BadRequest('Invalid availability timezone.');
    }

    $start = $this->date($input->dateStart ?? null);
    $maximum = $this->date('9999-12-31 23:59:59')->getTimestamp();

    if ($duration > $maximum - $start->getTimestamp()) {
      return ['status' => 'exhausted'];
    }

    $fingerprint = hash('sha256', json_encode([
      $users, $entityType, $entityId, $start->toString(), $duration, $zone->getName(),
    ], JSON_THROW_ON_ERROR));
    $earliest = $this->roundUp($start->getTimestamp() + 1);
    $state = $token !== null ? $this->cursor->decode($token, $fingerprint) : [
      'earliest' => $earliest,
      'nextFrom' => $this->instant($earliest)->setTimezone($zone)->setTime(0, 0)->getTimestamp(),
      'blocked' => [],
    ];

    // Espo deliberately omits busy events when its range limit is exceeded.
    // Stay inside that limit so an oversized batch cannot appear falsely free.
    $maxDays = $this->config->get('busyRangesMaxRange', 20);

    if (!is_int($maxDays) || $maxDays < 1) {
      throw new BadRequest('The availability query range must allow at least one day.');
    }

    $batchDays = min(7, $maxDays);
    $started = $this->now();

    while ($state['nextFrom'] < $maximum) {
      $from = $this->instant($state['nextFrom']);
      $to = min($maximum, $from->setTimezone($zone)->modify("+$batchDays days")->getTimestamp());
      $data = $this->calendar->fetchBusyRangesForUsers(
        $users,
        DateTime::fromString($from->format('Y-m-d H:i:s')),
        DateTime::fromString($this->instant($to)->format('Y-m-d H:i:s')),
        $entityType,
        $entityId,
      );
      $ranges = $state['blocked'];

      foreach ($users as $userId) {
        if (!isset($data[$userId]) || !is_array($data[$userId])) {
          return ['status' => 'unavailable'];
        }

        foreach ($data[$userId] as $item) {
          $range = $item->getRaw();

          if (empty($range->isBusyRange) && empty($range->isNonWorkingRange)) continue;

          $rangeStart = $this->date($range->dateStart ?? null)->getTimestamp();
          $rangeEnd = $this->date($range->dateEnd ?? null)->getTimestamp();

          if ($rangeEnd <= $rangeStart) {
            return ['status' => 'unavailable'];
          }

          $ranges[] = [$rangeStart, $rangeEnd];
        }
      }

      $ranges = $this->merge($ranges);
      $candidate = $state['earliest'];

      foreach ($ranges as [$rangeStart, $rangeEnd]) {
        if ($rangeEnd <= $candidate) continue;
        if ($candidate + $duration <= $rangeStart) break;

        $candidate = $this->roundUp($rangeEnd);
      }

      if ($candidate + $duration <= $to) {
        return [
          'status' => 'found',
          'dateStart' => $this->instant($candidate)->format('Y-m-d H:i:s'),
          'dateEnd' => $this->instant($candidate + $duration)->format('Y-m-d H:i:s'),
        ];
      }

      $state['earliest'] = max($candidate, $this->roundUp($to - $duration + 1));
      $state['nextFrom'] = max($to, $state['earliest']);
      $state['blocked'] = array_values(array_filter(
        $ranges,
        static fn (array $range): bool => $range[1] > $state['earliest'],
      ));

      if ($state['earliest'] + $duration > $maximum) {
        return ['status' => 'exhausted'];
      }

      if ($this->now() - $started >= self::BUDGET_NS) {
        return [
          'status' => 'continue',
          'cursor' => $this->cursor->encode($state, $fingerprint),
          'searchedThrough' => $this->instant($state['nextFrom'] - 1)->format('Y-m-d H:i:s'),
        ];
      }
    }

    return ['status' => 'exhausted'];
  }

  /**
   * @param list<array{int, int}> $ranges
   * @return list<array{int, int}>
   */
  private function merge(array $ranges): array
  {
    usort($ranges, static fn (array $a, array $b): int => $a[0] <=> $b[0]);
    $merged = [];

    foreach ($ranges as [$start, $end]) {
      $last = count($merged) - 1;

      $previous = $merged[$last] ?? null;

      if ($previous !== null && $start <= $previous[1]) {
        $merged[$last] = [$previous[0], max($previous[1], $end)];
      } else {
        $merged[] = [$start, $end];
      }
    }

    return array_values($merged);
  }

  private function date(mixed $value): DateTime
  {
    if (!is_string($value) || !preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(?::[0-9]{2})?$/D', $value)) {
      throw new BadRequest('Invalid availability date.');
    }

    try {
      return DateTime::fromString($value);
    } catch (InvalidArgumentException) {
      throw new BadRequest('Invalid availability date.');
    }
  }

  private function instant(int $timestamp): DateTimeImmutable
  {
    return (new DateTimeImmutable('@' . $timestamp))->setTimezone(new DateTimeZone('UTC'));
  }

  private function roundUp(int $timestamp): int
  {
    return (int) (ceil($timestamp / self::STEP) * self::STEP);
  }

  protected function now(): int
  {
    return hrtime(true);
  }
}
