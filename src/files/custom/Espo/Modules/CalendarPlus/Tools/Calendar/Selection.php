<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Exceptions\BadRequest;

final class Selection
{
  public const MAX_USERS = 300;
  public const MAX_TEAMS = 100;

  public static function isId(mixed $id): bool
  {
    return is_string($id) && $id !== '' && strlen($id) <= 100;
  }

  /** @return string[] */
  public static function ids(mixed $value, int $limit = self::MAX_USERS): array
  {
    if (!is_array($value) || !array_is_list($value) || count($value) > $limit) {
      throw new BadRequest('Invalid calendar selection.');
    }

    foreach ($value as $id) {
      if (!self::isId($id)) {
        throw new BadRequest('Invalid calendar user or team ID.');
      }
    }

    return array_values(array_unique($value));
  }
}
