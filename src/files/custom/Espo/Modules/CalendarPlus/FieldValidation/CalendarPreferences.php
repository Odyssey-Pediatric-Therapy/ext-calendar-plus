<?php

namespace Espo\Modules\CalendarPlus\FieldValidation;

use Espo\Core\Exceptions\BadRequest;
use Espo\Core\FieldValidation\Validator;
use Espo\Core\FieldValidation\Validator\Data;
use Espo\Core\FieldValidation\Validator\Failure;
use Espo\Modules\CalendarPlus\Tools\Calendar\Selection;
use Espo\ORM\Entity;
use JsonException;
use stdClass;

/** @implements Validator<Entity> */
class CalendarPreferences implements Validator
{
  private const MAX_JSON_BYTES = 1048576;
  private const BOOLEAN_SETTINGS = [
    'showInactiveUsers', 'showWeekends', 'showGradient', 'showTooltips',
    'showDeclinedEvents', 'showCanceledEvents', 'showCompletedEvents',
    'rememberHiddenPeople', 'tooltipAttendees', 'tooltipAssignee',
    'tooltipLocation', 'tooltipStatus',
  ];
  private const MODES = ['basicDay', 'basicWeek', 'agendaDay', 'agendaWeek', 'month', 'timeline'];

  public function validate(Entity $entity, string $field, Data $data): ?Failure
  {
    if (!$data->has($field) || $data->get($field) === null) {
      return null;
    }

    $value = $data->get($field);

    try {
      if (strlen(json_encode($value, JSON_THROW_ON_ERROR)) > self::MAX_JSON_BYTES) {
        return Failure::create();
      }

      $valid = match ($field) {
        'calendarPlusList', 'calendarViewDataList' => $this->calendars($value),
        'calendarPlusSharedSelection' => $value instanceof stdClass && $this->membership($value),
        'calendarPlusViewSettings' => $this->viewSettings($value),
        'calendarPlusSearchSettings' => $this->searchSettings($value),
        default => true,
      };
    } catch (BadRequest | JsonException) {
      return Failure::create();
    }

    return $valid ? null : Failure::create();
  }

  private function calendars(mixed $value): bool
  {
    if (!is_array($value) || !array_is_list($value)) {
      return false;
    }

    $ids = [];

    foreach ($value as $calendar) {
      if (
        !$calendar instanceof stdClass ||
        !Selection::isId($calendar->id ?? null) ||
        !is_string($calendar->name ?? null) ||
        trim($calendar->name) === '' ||
        mb_strlen($calendar->name) > 100 ||
        isset($ids[$calendar->id]) ||
        (property_exists($calendar, 'mode') && !in_array($calendar->mode, self::MODES, true)) ||
        !$this->membership($calendar)
      ) {
        return false;
      }

      $ids[$calendar->id] = true;
    }

    return true;
  }

  private function membership(stdClass $value): bool
  {
    foreach (['teamIdList', 'userIdList', 'staticUserIdList'] as $field) {
      if (property_exists($value, $field)) {
        Selection::ids(
          $value->$field,
          $field === 'teamIdList' ? Selection::MAX_TEAMS : Selection::MAX_USERS
        );
      }
    }

    foreach (['teamNames', 'userNames'] as $field) {
      if (!property_exists($value, $field)) {
        continue;
      }

      // Empty name maps have historically also been saved as empty arrays.
      if ($value->$field === []) {
        continue;
      }

      if (!$value->$field instanceof stdClass) {
        return false;
      }

      foreach (get_object_vars($value->$field) as $id => $name) {
        if (!Selection::isId((string) $id) || !is_string($name) || mb_strlen($name) > 255) {
          return false;
        }
      }
    }

    if (property_exists($value, 'membershipMode')) {
      if (!in_array($value->membershipMode, ['dynamic', 'static'], true)) {
        return false;
      }

      if ($value->membershipMode === 'static' && !property_exists($value, 'staticUserIdList')) {
        return false;
      }
    }

    return true;
  }

  private function viewSettings(mixed $value): bool
  {
    if (!$value instanceof stdClass) {
      return false;
    }

    foreach (get_object_vars($value) as $key => $settings) {
      if ($key === '' || strlen($key) > 150 || !$settings instanceof stdClass) {
        return false;
      }

      foreach (self::BOOLEAN_SETTINGS as $field) {
        if (property_exists($settings, $field) && !is_bool($settings->$field)) {
          return false;
        }
      }

      if (
        property_exists($settings, 'slotDuration') &&
        !in_array($settings->slotDuration, [5, 10, 15, 30], true)
      ) {
        return false;
      }

      if (
        property_exists($settings, 'scrollHour') &&
        (!is_int($settings->scrollHour) || $settings->scrollHour < 0 || $settings->scrollHour > 23)
      ) {
        return false;
      }

      foreach ([
        'eventTextSize' => ['small', 'medium', 'large'],
        'dayBoundary' => ['subtle', 'strong', 'black'],
        'timelineRowHeight' => ['compact', 'comfortable', 'spacious'],
      ] as $field => $options) {
        if (property_exists($settings, $field) && !in_array($settings->$field, $options, true)) {
          return false;
        }
      }

      $start = $this->time(
        property_exists($settings, 'visibleTimeStart') ? $settings->visibleTimeStart : '00:00'
      );
      $end = $this->time(
        property_exists($settings, 'visibleTimeEnd') ? $settings->visibleTimeEnd : '24:00'
      );

      if ($start === null || $end === null || $start >= $end) {
        return false;
      }
    }

    return true;
  }

  private function time(mixed $value): ?int
  {
    if (!is_string($value) || !preg_match('/^(?:\d{3,4}|\d{1,2}:\d{2})$/', trim($value))) {
      return null;
    }

    $digits = str_pad(str_replace(':', '', trim($value)), 4, '0', STR_PAD_LEFT);
    $hour = (int) substr($digits, 0, 2);
    $minute = (int) substr($digits, 2);

    if ($hour > 24 || $minute > 59 || ($hour === 24 && $minute !== 0)) {
      return null;
    }

    return $hour * 60 + $minute;
  }

  private function searchSettings(mixed $value): bool
  {
    if (!$value instanceof stdClass) {
      return false;
    }

    if (property_exists($value, 'columns')) {
      if (!is_array($value->columns) || !array_is_list($value->columns) || count($value->columns) > 20) {
        return false;
      }

      foreach ($value->columns as $column) {
        if (!is_string($column) || $column === '' || strlen($column) > 100) {
          return false;
        }
      }
    }

    foreach ([
      'sortBy' => ['date', 'title'],
      'sortOrder' => ['asc', 'desc'],
      'sortDirection' => ['asc', 'desc'],
    ] as $field => $options) {
      if (property_exists($value, $field) && !in_array($value->$field, $options, true)) {
        return false;
      }
    }

    // Preserve unknown keys so future settings and other extensions remain compatible.
    return true;
  }
}
