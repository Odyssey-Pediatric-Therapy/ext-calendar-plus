<?php

namespace Espo\Modules\CalendarPlus\Api\Calendar;

use Espo\Core\Api\Action;
use Espo\Core\Api\Request;
use Espo\Core\Api\Response;
use Espo\Core\Api\ResponseComposer;
use Espo\Modules\CalendarPlus\Tools\Calendar\UserResolver;
use Espo\Modules\CalendarPlus\Tools\Calendar\UserSelection;

class TimelineUsers implements Action
{
  public function __construct(private UserResolver $resolver)
  {
  }

  public function process(Request $request): Response
  {
    $selection = new UserSelection($request->getParsedBody());

    return ResponseComposer::json($this->resolver->resolve($selection));
  }
}
