<?php

namespace Espo\Modules\CalendarPlus\Tools\Calendar;

use Espo\Core\Exceptions\BadRequest;
use Espo\Core\Utils\Config;
use Espo\Entities\User;
use JsonException;
use RuntimeException;

/** Signed, caller-bound continuation state; no server cache files are needed. */
class AvailabilityCursor
{
  private const TTL = 900;
  private const MAX_BYTES = 1048576;

  public function __construct(private Config $config, private User $user)
  {
  }

  /** @param array{earliest: int, nextFrom: int, blocked: list<array{int, int}>} $state */
  public function encode(array $state, string $fingerprint): string
  {
    $payload = base64_encode(json_encode([
      'fingerprint' => $fingerprint,
      'expires' => time() + self::TTL,
      'state' => $state,
    ], JSON_THROW_ON_ERROR));
    $token = $payload . '.' . hash_hmac('sha256', $payload, $this->key());

    if (strlen($token) > self::MAX_BYTES) {
      throw new BadRequest('Availability continuation is too large.');
    }

    return $token;
  }

  /** @return array{earliest: int, nextFrom: int, blocked: list<array{int, int}>} */
  public function decode(string $token, string $fingerprint): array
  {
    if (strlen($token) > self::MAX_BYTES) {
      throw new BadRequest('Invalid availability cursor.');
    }

    $parts = explode('.', $token);

    if (count($parts) !== 2 || !hash_equals(hash_hmac('sha256', $parts[0], $this->key()), $parts[1])) {
      throw new BadRequest('Invalid availability cursor.');
    }

    try {
      $json = base64_decode($parts[0], true);
      $payload = $json === false ? null : json_decode($json, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
      throw new BadRequest('Invalid availability cursor.');
    }

    if (
      !is_array($payload) ||
      ($payload['fingerprint'] ?? null) !== $fingerprint ||
      !is_int($payload['expires'] ?? null) ||
      $payload['expires'] <= time()
    ) {
      throw new BadRequest('Availability search expired or changed. Start a new search.');
    }

    $state = $payload['state'] ?? null;

    if (
      !is_array($state) ||
      !is_int($state['earliest'] ?? null) ||
      !is_int($state['nextFrom'] ?? null) ||
      !is_array($state['blocked'] ?? null) ||
      !array_is_list($state['blocked'])
    ) {
      throw new BadRequest('Invalid availability cursor.');
    }

    foreach ($state['blocked'] as $range) {
      if (!is_array($range) || count($range) !== 2 || !isset($range[0], $range[1]) ||
        !is_int($range[0]) || !is_int($range[1]) || $range[1] <= $range[0]) {
        throw new BadRequest('Invalid availability cursor.');
      }
    }

    return $state;
  }

  private function key(): string
  {
    $secret = $this->config->get('cryptKey');

    if (!is_string($secret) || $secret === '') {
      throw new RuntimeException('Availability continuation signing is not configured.');
    }

    return hash_hmac('sha256', $this->user->getId(), $secret, true);
  }
}
