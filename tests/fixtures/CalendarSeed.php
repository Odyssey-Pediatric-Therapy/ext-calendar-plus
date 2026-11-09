<?php

declare(strict_types=1);

namespace Tests\Fixtures;

use DateTimeImmutable;
use Faker\Factory;
use Faker\Generator;
use InvalidArgumentException;

/** Generate manual demo fixtures without booting Espo or connecting to a database. */
final class CalendarSeed
{
  public readonly DateTimeImmutable $start;
  public readonly DateTimeImmutable $end;

  public readonly string $startTime;
  public readonly string $endTime;

  private readonly int $dayStartMinutes;
  private readonly int $dayEndMinutes;
  private Generator $faker;

  public function __construct(
    DateTimeImmutable $today,
    public readonly string $runId,
    private int $userCount = 15,
    private int $teamCount = 5,
    private int $eventsPerDay = 8,
    string $startTime = '0800',
    string $endTime = '1800',
  ) {
    if (!preg_match('/^[a-z0-9]{1,24}$/D', $runId)) {
      throw new InvalidArgumentException('Run ID must contain 1–24 lowercase letters or digits.');
    }

    $limits = [
      'users' => [$userCount, 1, 300],
      'teams' => [$teamCount, 0, 100],
      'events-per-day' => [$eventsPerDay, 4, 12],
    ];

    foreach ($limits as $name => [$value, $minimum, $maximum]) {
      if ($value < $minimum || $value > $maximum) {
        throw new InvalidArgumentException("--$name must be between $minimum and $maximum.");
      }
    }

    $this->dayStartMinutes = $this->timeMinutes($startTime);
    $this->dayEndMinutes = $this->timeMinutes($endTime, true);

    if ($this->dayEndMinutes <= $this->dayStartMinutes) {
      throw new InvalidArgumentException('--end-time must be later than --start-time on the same day.');
    }

    $this->startTime = sprintf('%02d:%02d', intdiv($this->dayStartMinutes, 60), $this->dayStartMinutes % 60);
    $this->endTime = sprintf('%02d:%02d', intdiv($this->dayEndMinutes, 60), $this->dayEndMinutes % 60);

    $this->start = $this->monthOffset($today, -6);
    $this->end = $this->monthOffset($today, 6)->setTime(23, 59, 59);

    $this->faker = Factory::create('en_US');
    $this->faker->seed(random_int(0, 2147483647));
  }

  public function teams(): array
  {
    $departments = ['Customer Success', 'Delivery', 'Sales', 'Operations', 'Product'];
    $teams = [];

    for ($index = 0; $index < $this->teamCount; $index++) {
      $teams[] = [
        'name' => $this->faker->company() . ' — ' . $departments[$index % count($departments)],
        'description' => $this->description(),
      ];
    }

    return $teams;
  }

  public function users(): array
  {
    $users = [];

    for ($index = 0; $index < $this->userCount; $index++) {
      $first = $this->faker->firstName();
      $last = $this->faker->lastName();
      $teamIndexes = $this->teamCount ? [$index % $this->teamCount] : [];

      if ($this->teamCount > 1 && ($index % 3 === 0 || $this->faker->boolean(35))) {
        $teamIndexes[] = ($index + $this->faker->numberBetween(1, $this->teamCount - 1)) % $this->teamCount;
      }

      $users[] = [
        'attributes' => [
          'name' => "$first $last",
          'firstName' => $first,
          'lastName' => $last,
          'userName' => "cp_demo_{$this->runId}_" . ($index + 1),
          'type' => 'regular',
          'isActive' => true,
        ],
        'teams' => array_values(array_unique($teamIndexes)),
      ];
    }

    return $users;
  }

  public function events(?int $participantCount = null): \Generator
  {
    $participantCount ??= $this->userCount;

    if ($participantCount < 1 || $participantCount > 301) {
      throw new InvalidArgumentException('Event schedules require 1–301 participants, including admin.');
    }

    $dayMinutes = $this->dayEndMinutes - $this->dayStartMinutes;
    $types = ['Meeting', 'Call', 'Task'];
    $dayIndex = 0;

    for ($day = $this->start; $day <= $this->end; $day = $day->modify('+1 day')) {
      if ((int) $day->format('N') > 5) {
        continue;
      }

      for ($user = 0; $user < $participantCount; $user++) {
        $eventCount = $this->faker->numberBetween(4, $this->eventsPerDay);
        $previousStart = 0;
        $previousDuration = 0;

        for ($slot = 0; $slot < $eventCount; $slot++) {
          $type = $types[($user + $slot + $dayIndex) % count($types)];
          $minutes = $this->dayStartMinutes + (int) floor($slot * $dayMinutes / $eventCount);
          $jitterSteps = (int) floor(min(40, $dayMinutes / $eventCount / 2) / 5);
          $minutes += $this->faker->numberBetween(0, $jitterSteps) * 5;
          $duration = min($dayMinutes, $this->faker->randomElement([20, 25, 30, 40, 45, 50, 60, 75]));

          // Deliberate overlap alongside otherwise independently spaced appointments.
          if ($slot === 2 && $user % 3 === 0) {
            $minutes = $previousStart + max(5, $previousDuration - 15);
          }

          // Keep both ends inside the local daily window, including short windows.
          $minutes = max($this->dayStartMinutes, min($minutes, $this->dayEndMinutes - $duration));
          $start = $day->setTime(intdiv($minutes, 60), $minutes % 60);
          $end = $start->modify("+$duration minutes");
          $status = $type === 'Task' ? 'Not Started' : 'Planned';

          if ($day < new DateTimeImmutable('today', $day->getTimezone()) && $this->faker->boolean(70)) {
            $status = $type === 'Task' ? 'Completed' : 'Held';
          } elseif ($this->faker->boolean(6)) {
            $status = $type === 'Task' ? 'Canceled' : 'Not Held';
          }

          yield [
            'entityType' => $type,
            'owner' => $user,
            'guest' => $participantCount > 1
              ? ($user + $this->faker->numberBetween(1, $participantCount - 1)) % $participantCount
              : $user,
            'guestStatus' => $this->faker->randomElement(['Accepted', 'Accepted', 'Accepted', 'Tentative', 'None', 'Declined']),
            'attributes' => [
              'name' => $this->title($type),
              'description' => $this->description() . ' ' . $this->faker->sentence(10),
              'dateStart' => $start->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
              'dateEnd' => $end->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s'),
              'status' => $status,
            ],
          ];

          $previousStart = $minutes;
          $previousDuration = $duration;
        }
      }

      $dayIndex++;
    }
  }

  private function timeMinutes(string $value, bool $allowEndOfDay = false): int
  {
    $value = trim($value);

    if (!preg_match('/^(?:\d{3,4}|\d{1,2}:\d{2})$/D', $value)) {
      throw new InvalidArgumentException('Times must use HHmm or HH:mm format, for example 0800 or 08:00.');
    }

    $digits = str_pad(str_replace(':', '', $value), 4, '0', STR_PAD_LEFT);
    $hour = (int) substr($digits, 0, 2);
    $minute = (int) substr($digits, 2, 2);
    $endOfDay = $allowEndOfDay && $hour === 24 && $minute === 0;

    if ($minute > 59 || ($hour > 23 && !$endOfDay)) {
      throw new InvalidArgumentException('Invalid time: ' . $value);
    }

    return $hour * 60 + $minute;
  }

  private function monthOffset(DateTimeImmutable $day, int $months): DateTimeImmutable
  {
    $month = $day->modify('first day of this month')->modify("$months months");
    $dayOfMonth = min((int) $day->format('j'), (int) $month->format('t'));

    return $month->setDate(
      (int) $month->format('Y'),
      (int) $month->format('n'),
      $dayOfMonth,
    )->setTime(0, 0);
  }

  private function description(): string
  {
    return "Calendar Plus demo; Run: {$this->runId}.";
  }

  private function title(string $type): string
  {
    $company = $this->faker->company();
    $person = $this->faker->lastName();

    return match ($type) {
      'Meeting' => $this->faker->randomElement([
        "$company — project kickoff", "$company — quarterly account review",
        "$company — implementation walkthrough", "$company — delivery planning",
        "$person team — sprint review", "$company — requirements workshop",
      ]),
      'Call' => $this->faker->randomElement([
        "$company — onboarding check-in", "$company — renewal discussion",
        "$person — proposal follow-up", "$company — support escalation",
        "$company — discovery call", "$person — delivery update",
      ]),
      default => $this->faker->randomElement([
        "Prepare $company proposal", "Review $company implementation plan",
        "Update $company account notes", "Complete $company handoff checklist",
        "Send $person the revised estimate", "Document $company requirements",
      ]),
    };
  }
}
