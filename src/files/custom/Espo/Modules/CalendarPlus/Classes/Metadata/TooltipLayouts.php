<?php

namespace Espo\Modules\CalendarPlus\Classes\Metadata;

use Espo\Core\Utils\Metadata\AdditionalBuilder;
use Espo\Modules\CalendarPlus\Tools\Calendar\TooltipLayout;
use stdClass;

class TooltipLayouts implements AdditionalBuilder
{
  public function build(stdClass $data): void
  {
    foreach (get_object_vars($data->scopes ?? new stdClass()) as $scope => $definition) {
      if (!($definition->calendar ?? false) || ($definition->disabled ?? false)) {
        continue;
      }

      $fields = $data->entityDefs->{$scope}->fields ?? new stdClass();
      $available = [];

      foreach (get_object_vars($fields) as $name => $field) {
        if (TooltipLayout::supportsField($field)) {
          $available[] = $name;
        }
      }

      $fieldArray = array_map(fn ($field) => (array) $field, get_object_vars($fields));

      if ($scope !== 'Task' && TooltipLayout::hasAttendees($fieldArray)) {
        $available[] = ':attendees';
      }

      $data->clientDefs ??= new stdClass();
      $data->clientDefs->{$scope} ??= new stdClass();
      $client = $data->clientDefs->{$scope};
      $client->calendarPlusTooltipFields = $available;
      $client->additionalLayouts ??= new stdClass();
      $client->additionalLayouts->calendarPlusTooltip = (object) ['type' => 'calendarPlusTooltip'];

      if (in_array($scope, ['Meeting', 'Call', 'Task'], true)) {
        $data->app->layouts ??= new stdClass();
        $data->app->layouts->{$scope} ??= new stdClass();
        $data->app->layouts->{$scope}->calendarPlusTooltip ??= (object) ['module' => 'CalendarPlus'];
      }
    }
  }
}
