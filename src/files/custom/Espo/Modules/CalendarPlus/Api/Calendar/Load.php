<?php

namespace Espo\Modules\CalendarPlus\Api\Calendar;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Modules\CalendarPlus\Tools\Calendar\Loader;
class Load implements Action
{

  public function __construct(
    private Loader $loader,
  ) {}

  public function process(Request $request): Response {
    return ResponseComposer::json($this->loader->load($request->getParsedBody()));
  }
}
