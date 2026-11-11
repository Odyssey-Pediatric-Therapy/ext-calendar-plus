<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Utils\Metadata;
use Espo\Tools\Layout\LayoutProvider;
use stdClass;

class TooltipLayout
{
  public const NAME = 'calendarPlusTooltip';

  private const TYPES = [
    'varchar', 'text', 'enum', 'multiEnum', 'array', 'int', 'float',
    'bool', 'date', 'datetime', 'datetimeOptional', 'currency', 'url',
    'link', 'linkMultiple',
  ];

  public function __construct(
    private Metadata $metadata,
    private LayoutProvider $layouts,
  ) {}

  /** @return list<string> */
  public function fields(string $scope): array
  {
    $json = $this->layouts->get($scope, self::NAME);
    $layout = json_decode($json ?? 'null');

    if (!is_array($layout)) {
      $layout = self::defaults($scope, $this->metadata);
    }

    $available = $this->metadata->get(['clientDefs', $scope, 'calendarPlusTooltipFields']) ?? [];
    $names = [];

    foreach ($layout as $item) {
      $name = $item;

      if ($item instanceof stdClass) {
        $name = $item->name ?? null;
      }

      if (is_string($name) && in_array($name, $available, true)) {
        $names[] = $name;
      }
    }

    return array_values(array_unique($names));
  }

  public static function supportsField(stdClass $field): bool
  {
    if (($field->disabled ?? false) || ($field->utility ?? false)) {
      return false;
    }

    if (($field->notStorable ?? false) && !isset($field->select)) {
      return false;
    }

    return in_array($field->type ?? null, self::TYPES, true);
  }

  /** @return list<stdClass> */
  public static function defaults(string $scope, Metadata $metadata): array
  {
    $fields = $metadata->get(['entityDefs', $scope, 'fields']) ?? [];
    $names = ['dateStart', 'dateEnd', 'assignedUser', 'assignedUsers', ':attendees', 'collaborators', 'status', 'location'];
    $result = [];
    $hasAttendees = $scope !== 'Task' && self::hasAttendees($fields);

    foreach ($names as $name) {
      if ($name === ':attendees') {
        if ($hasAttendees) {
          $result[] = (object) ['name' => $name];
        }

        continue;
      }

      if ($name === 'collaborators' && $hasAttendees) {
        continue;
      }

      $field = (object) ($fields[$name] ?? []);

      if (self::supportsField($field)) {
        $result[] = (object) ['name' => $name];
      }
    }

    return $result;
  }

  /** @param array<string, mixed> $fields */
  public static function hasAttendees(array $fields): bool
  {
    foreach (['users', 'contacts', 'leads'] as $name) {
      if (($fields[$name]['type'] ?? null) === 'linkMultiple' && !($fields[$name]['disabled'] ?? false)) {
        return true;
      }
    }

    return false;
  }
}
