<?php

namespace tests\unit\Espo\Modules\CalendarPlus\FieldValidation;

require_once dirname(__DIR__, 6) . '/bootstrap.php';

use Espo\Core\FieldValidation\Validator\Data;
use Espo\Entities\Preferences;
use Espo\Modules\CalendarPlus\FieldValidation\CalendarPreferences;
use PHPUnit\Framework\TestCase;

final class CalendarPreferencesTest extends TestCase
{
  private function valid(string $field, string $json): bool
  {
    $data = new Data((object) [$field => json_decode($json, false, 512, JSON_THROW_ON_ERROR)]);
    return (new CalendarPreferences())->validate($this->createMock(Preferences::class), $field, $data) === null;
  }

  public function testSavedCalendarFormatsRemainAccepted(): void
  {
    self::assertTrue($this->valid('calendarPlusList', '[{"id":"legacy","name":"Legacy timeline","userIdList":["ann"],"userNames":[]}]'));
    self::assertTrue($this->valid('calendarViewDataList', '[{"id":"week","name":"Team week","mode":"basicWeek","teamIdList":["team"],"membershipMode":"static","staticUserIdList":[]}]'));
    self::assertTrue($this->valid('calendarPlusSharedSelection', '{"teamIdList":[],"userIdList":["ann"],"membershipMode":"dynamic"}'));
  }

  public function testMalformedCalendarMembershipIsRejected(): void
  {
    foreach ([
      '[{"id":"view","name":"View","mode":"bad"}]',
      '[{"id":"view","name":"View","userIdList":"ann"}]',
      '[{"id":"view","name":"View","teamIdList":[null]}]',
      '[{"id":"view","name":"View","membershipMode":"static"}]',
      '[{"id":"view","name":"View","membershipMode":"bad"}]',
      '[{"id":"view","name":"View"},{"id":"view","name":"Duplicate"}]',
      '[{"id":"view","name":"View","userNames":{"ann":false}}]',
    ] as $json) {
      self::assertFalse($this->valid('calendarViewDataList', $json), $json);
    }
  }

  public function testKnownSettingsAreValidatedWithoutDiscardingFutureKeys(): void
  {
    self::assertTrue($this->valid('calendarPlusViewSettings', '{"view:week":{"showTooltips":false,"showCompletedEvents":true,"slotDuration":5,"scrollHour":0,"eventTextSize":"small","futureOption":17}}'));
    foreach ([
      '{"week":{"showTooltips":"false"}}',
      '{"week":{"slotDuration":120}}',
      '{"week":{"scrollHour":24}}',
      '{"week":{"eventTextSize":"huge"}}',
      '{"week":[]}',
    ] as $json) {
      self::assertFalse($this->valid('calendarPlusViewSettings', $json), $json);
    }
  }

  public function testTimeRangeMatchesExistingCompactInputAndRejectsInvalidBounds(): void
  {
    self::assertTrue($this->valid('calendarPlusViewSettings', '{"day":{"visibleTimeStart":"300","visibleTimeEnd":"2400"}}'));
    foreach ([['15:00','08:00'], ['08:00','08:00'], ['24:00','24:00'], ['08:60','15:00'], ['08:00','25:00'], [null,'15:00']] as [$start, $end]) {
      $json = json_encode(['day' => ['visibleTimeStart' => $start, 'visibleTimeEnd' => $end]]);
      self::assertFalse($this->valid('calendarPlusViewSettings', $json));
    }
  }

  public function testSearchOptionsAndPreferenceResetsAreAccepted(): void
  {
    self::assertTrue($this->valid('calendarPlusSearchSettings', '{"columns":["when","status"],"sortBy":"date","sortDirection":"desc","futureOption":true}'));
    self::assertTrue($this->valid('calendarPlusSearchSettings', '{"columns":[]}'));
    self::assertFalse($this->valid('calendarPlusSearchSettings', '{"columns":"when"}'));
    self::assertFalse($this->valid('calendarPlusSearchSettings', '{"sortDirection":"bad"}'));
    foreach (['calendarPlusList','calendarPlusSharedSelection','calendarPlusViewSettings','calendarPlusSearchSettings','calendarViewDataList'] as $field) {
      self::assertTrue($this->valid($field, 'null'));
    }
  }

  public function testUnrelatedPreferenceSavesDoNotValidateOldCalendarData(): void
  {
    $validator = new CalendarPreferences();
    self::assertNull($validator->validate($this->createMock(Preferences::class), 'calendarPlusList', new Data((object) ['language' => 'en_US'])));
  }

  public function testOversizedPayloadsAndSnapshotsAreRejected(): void
  {
    $json = json_encode(['userIdList' => array_fill(0, 301, 'ann')]);
    self::assertFalse($this->valid('calendarPlusSharedSelection', $json));
    $json = json_encode(['teamIdList' => array_fill(0, 101, 'team')]);
    self::assertFalse($this->valid('calendarPlusSharedSelection', $json));
    $json = json_encode(['userIdList' => array_fill(0, 300, 'ann'), 'teamIdList' => array_fill(0, 100, 'team')]);
    self::assertTrue($this->valid('calendarPlusSharedSelection', $json));
    $json = json_encode(['extra' => str_repeat('x', 1048577)]);
    self::assertFalse($this->valid('calendarPlusSearchSettings', $json));
  }
}
