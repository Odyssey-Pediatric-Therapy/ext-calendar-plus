<?php

namespace tests\unit\Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Acl;
use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Exceptions\Forbidden;
use Espo\Core\Field\DateTime;
use Espo\Modules\CalendarPlus\Tools\Calendar\WorkingTimeRanges;
use Espo\Modules\Crm\Tools\Calendar\FetchParams;
use Espo\Modules\Crm\Tools\Calendar\Items\NonWorkingRange;
use Espo\Modules\Crm\Tools\Calendar\Service as CalendarService;
use PHPUnit\Framework\TestCase;

class WorkingTimeRangesTest extends TestCase
{
  private function acl(bool $allowed = true): Acl
  {
    $acl = $this->createMock(Acl::class);
    $acl->method('check')->with('Calendar')->willReturn($allowed);

    return $acl;
  }

  public function testOnlyWorkingCalendarDataIsFetchedAndAttributedToItsUser(): void
  {
    $calendar = $this->createMock(CalendarService::class);
    $calendar->method('fetch')->willReturnCallback(function (string $id, FetchParams $params) {
      self::assertSame([], $params->getScopeList());
      self::assertTrue($params->workingTimeRangesInverted());
      self::assertSame('2026-11-04 07:00:00', $params->getFrom()->toString());
      self::assertSame('2026-11-05 07:00:00', $params->getTo()->toString());

      return $id === 'ann' ? [new NonWorkingRange(
        DateTime::fromString('2026-11-04 07:00:00'),
        DateTime::fromString('2026-11-04 16:00:00'),
      )] : [];
    });
    $service = new WorkingTimeRanges($calendar, $this->acl());
    self::assertSame([[
      'userId' => 'ann', 'dateStart' => '2026-11-04 07:00:00', 'dateEnd' => '2026-11-04 16:00:00',
    ]], $service->fetch(['ann', 'bob'], '2026-11-04 07:00', '2026-11-05 07:00'));
  }

  public function testCalendarPermissionIsRequired(): void
  {
    $calendar = $this->createMock(CalendarService::class);
    $calendar->expects(self::never())->method('fetch');
    $this->expectException(Forbidden::class);
    (new WorkingTimeRanges($calendar, $this->acl(false)))->fetch(['ann'], '2026-11-04 00:00', '2026-11-05 00:00');
  }

  public function testNativeUserPermissionFailuresDoNotExposeWorkingHours(): void
  {
    $calendar = $this->createMock(CalendarService::class);
    $calendar->method('fetch')->willThrowException(new Forbidden());
    self::assertSame([], (new WorkingTimeRanges($calendar, $this->acl()))->fetch(['ann'], '2026-11-04 00:00', '2026-11-05 00:00'));
  }

  public function testInvalidRangesAreRejectedBeforeFetching(): void
  {
    $calendar = $this->createMock(CalendarService::class);
    $calendar->expects(self::never())->method('fetch');
    $service = new WorkingTimeRanges($calendar, $this->acl());
    foreach ([['invalid', '2026-11-05 00:00'], ['2026-11-05 00:00', '2026-11-04 00:00']] as [$from, $to]) {
      try {
        $service->fetch(['ann'], $from, $to);
        self::fail('Invalid range was accepted.');
      } catch (BadRequest) {
        self::assertTrue(true);
      }
    }
  }
}
