<?php

namespace Espo\Modules\CalendarPlus\Api\Calendar;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Modules\CalendarPlus\Tools\Calendar\WorkingTimeRanges as RangeService;

class WorkingTimeRanges implements Action
{
  public function __construct(private RangeService $service)
  {
  }

  public function process(Request $request): Response
  {
    $data = $request->getParsedBody();

    return ResponseComposer::json([
      'ranges' => $this->service->fetch($data->userIdList ?? [], $data->from ?? null, $data->to ?? null),
    ]);
  }
}
