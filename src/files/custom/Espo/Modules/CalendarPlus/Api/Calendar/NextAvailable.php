<?php

namespace Espo\Modules\CalendarPlus\Api\Calendar;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Modules\CalendarPlus\Tools\Calendar\AvailabilitySearch;

class NextAvailable implements Action
{
  public function __construct(private AvailabilitySearch $search)
  {
  }

  public function process(Request $request): Response
  {
    return ResponseComposer::json($this->search->search($request->getParsedBody()));
  }
}
