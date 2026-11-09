<?php

namespace tests\unit\Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Field\DateTime;
use Espo\Core\Utils\Config;
use Espo\Entities\User;
use Espo\Modules\CalendarPlus\Tools\Calendar\AvailabilityCursor;
use Espo\Modules\CalendarPlus\Tools\Calendar\AvailabilitySearch;
use Espo\Modules\Crm\Tools\Calendar\Items\BusyRange;
use Espo\Modules\Crm\Tools\Calendar\Items\NonWorkingRange;
use Espo\Modules\Crm\Tools\Calendar\Service as CalendarService;
use PHPUnit\Framework\TestCase;
use stdClass;

class AvailabilitySearchTest extends TestCase
{
  private int $clock = 0;

  private function config(int $days = 20): Config
  {
    $config = $this->createMock(Config::class);
    $config->method('get')->willReturnCallback(static fn ($key, $default = null) => match ($key) {
      'cryptKey' => 'fixture-only-signing-secret',
      'busyRangesMaxRange' => $days,
      default => $default,
    });

    return $config;
  }

  private function cursor(?Config $config = null, string $caller = 'operator'): AvailabilityCursor
  {
    $user = $this->createMock(User::class);
    $user->method('getId')->willReturn($caller);

    return new AvailabilityCursor($config ?? $this->config(), $user);
  }

  private function service(callable $fetch, int $days = 20): AvailabilitySearch
  {
    $calendar = $this->createMock(CalendarService::class);
    $calendar->method('fetchBusyRangesForUsers')->willReturnCallback($fetch);
    $config = $this->config($days);
    $service = $this->getMockBuilder(AvailabilitySearch::class)
      ->setConstructorArgs([$calendar, $config, $this->cursor($config)])
      ->onlyMethods(['now'])
      ->getMock();
    $service->method('now')->willReturnCallback(fn () => $this->clock);

    return $service;
  }

  private function input(array $values = []): stdClass
  {
    return (object) array_replace([
      'userIdList' => ['a', 'b'],
      'entityType' => 'Meeting',
      'entityId' => 'existing-event',
      'dateStart' => '2026-11-09 09:00:00',
      'duration' => 1800,
      'timeZone' => 'UTC',
    ], $values);
  }

  private function busy(string $from, string $to): BusyRange
  {
    return new BusyRange(DateTime::fromString($from), DateTime::fromString($to));
  }

  public function testFreeSlotPreservesDurationAndNativeQueryParameters(): void
  {
    $calls = [];
    $service = $this->service(function ($users, $from, $to, $type, $ignore) use (&$calls) {
      $calls[] = [$users, $from->toString(), $to->toString(), $type, $ignore];
      return ['a' => [], 'b' => []];
    });
    $result = $service->search($this->input());

    self::assertSame(['status' => 'found', 'dateStart' => '2026-11-09 09:05:00', 'dateEnd' => '2026-11-09 09:35:00'], $result);
    self::assertSame([[['a', 'b'], '2026-11-09 00:00:00', '2026-11-16 00:00:00', 'Meeting', 'existing-event']], $calls);
  }

  public function testNativeMinuteOnlyDatesAreAccepted(): void
  {
    $service = $this->service(fn () => ['a' => [], 'b' => []]);
    self::assertSame('2026-11-09 09:05:00', $service->search($this->input(['dateStart' => '2026-11-09 09:00']))['dateStart']);
  }

  public function testBusyAndNonWorkingPeriodsForEveryUserBlockCommonSlots(): void
  {
    $service = $this->service(fn () => [
      'a' => [
        $this->busy('2026-11-09 09:00:00', '2026-11-09 10:00:00'),
        $this->busy('2026-11-09 10:45:00', '2026-11-09 12:00:00'),
      ],
      'b' => [
        $this->busy('2026-11-09 09:30:00', '2026-11-09 10:15:00'),
        new NonWorkingRange(DateTime::fromString('2026-11-09 00:00:00'), DateTime::fromString('2026-11-09 09:00:00')),
      ],
    ]);
    self::assertSame('2026-11-09 10:15:00', $service->search($this->input())['dateStart']);
  }

  public function testMissingUserAvailabilityCannotBeTreatedAsFree(): void
  {
    self::assertSame(['status' => 'unavailable'], $this->service(fn () => ['a' => []])->search($this->input()));
  }

  public function testSearchExtendsBeyondFourteenDaysAndSkipsKnownLongBlocks(): void
  {
    $calls = [];
    $service = $this->service(function ($users, $from) use (&$calls) {
      $calls[] = $from->toString();
      return ['a' => [$this->busy('2026-11-09 00:00:00', '2028-01-01 00:00:00')], 'b' => []];
    });
    self::assertSame('2028-01-01 00:00:00', $service->search($this->input())['dateStart']);
    self::assertSame(['2026-11-09 00:00:00', '2028-01-01 00:00:00'], $calls);
  }

  public function testRepeatedBatchesHaveNoFixedFinalDate(): void
  {
    $calls = 0;
    $service = $this->service(function ($users, $from, $to) use (&$calls) {
      $calls++;
      return ['a' => $calls <= 4 ? [new BusyRange($from, $to)] : [], 'b' => []];
    });
    self::assertSame('2026-12-07 00:00:00', $service->search($this->input())['dateStart']);
    self::assertSame(5, $calls);
  }

  public function testContinuationResumesFromTheServerCursor(): void
  {
    $calls = [];
    $service = $this->service(function ($users, $from, $to) use (&$calls) {
      $calls[] = $from->toString();
      $this->clock += 4000000000;
      return ['a' => count($calls) === 1 ? [new BusyRange($from, $to)] : [], 'b' => []];
    });
    $first = $service->search($this->input());
    self::assertSame('continue', $first['status']);
    self::assertIsString($first['cursor']);
    $next = $service->search($this->input(['cursor' => $first['cursor']]));
    self::assertSame('2026-11-16 00:00:00', $next['dateStart']);
    self::assertSame(['2026-11-09 00:00:00', '2026-11-16 00:00:00'], $calls);
  }

  public function testContinuationRetainsSlotsCrossingBatchBoundaries(): void
  {
    $calls = 0;
    $service = $this->service(function () use (&$calls) {
      $calls++;
      $this->clock += 4000000000;
      return ['a' => $calls === 1 ? [$this->busy('2026-11-15 00:00:00', '2026-11-21 23:05:00')] : [], 'b' => []];
    });
    $input = ['dateStart' => '2026-11-15 23:00:00', 'duration' => 3600];
    $first = $service->search($this->input($input));
    self::assertSame('continue', $first['status']);
    $next = $service->search($this->input($input + ['cursor' => $first['cursor']]));
    self::assertSame('2026-11-21 23:05:00', $next['dateStart']);
    self::assertSame('2026-11-22 00:05:00', $next['dateEnd']);
  }

  public function testQueryLimitAndDaylightSavingTimezoneAreRespected(): void
  {
    $calls = [];
    $service = $this->service(function ($users, $from, $to) use (&$calls) {
      $calls[] = [$from->toString(), $to->toString()];
      return ['a' => [], 'b' => []];
    }, 1);
    $service->search($this->input(['dateStart' => '2026-11-01 08:00:00', 'timeZone' => 'America/Denver']));
    self::assertSame([['2026-11-01 06:00:00', '2026-11-02 07:00:00']], $calls);
  }

  public function testTamperedOrOtherCallerCursorsAreRejected(): void
  {
    $cursor = $this->cursor();
    $token = $cursor->encode(['earliest' => 100, 'nextFrom' => 200, 'blocked' => []], 'request');
    self::assertSame(100, $cursor->decode($token, 'request')['earliest']);

    foreach ([[$cursor, $token . 'x', 'request'], [$cursor, $token, 'changed'], [$this->cursor(null, 'other-user'), $token, 'request']] as [$decoder, $value, $fingerprint]) {
      try {
        $decoder->decode($value, $fingerprint);
        self::fail('An invalid cursor was accepted.');
      } catch (BadRequest) {
        self::assertTrue(true);
      }
    }
  }

  public function testInvalidInputsAreRejectedBeforeFetching(): void
  {
    $service = $this->service(static function () { throw new \RuntimeException('Must not fetch'); });
    foreach ([['userIdList' => []], ['duration' => 0], ['duration' => 1.5], ['entityType' => 'User'], ['dateStart' => '2026-02-30 09:00:00'], ['timeZone' => 'not-a-zone']] as $values) {
      try {
        $service->search($this->input($values));
        self::fail('An invalid request was accepted.');
      } catch (BadRequest) {
        self::assertTrue(true);
      }
    }
  }
}
