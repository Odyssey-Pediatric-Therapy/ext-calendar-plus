<?php

namespace Espo\Custom\Classes\DefaultLayouts;

use Espo\Core\Utils\Metadata;
use Espo\Modules\CalendarPlus\Tools\Calendar\TooltipLayout;
use stdClass;

class CalendarPlusTooltipType
{
  public function __construct(private Metadata $metadata) {}

  /** @return list<stdClass> */
  public function get(string $scope): array
  {
    return TooltipLayout::defaults($scope, $this->metadata);
  }
}
