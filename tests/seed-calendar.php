<?php

declare(strict_types=1);

use Espo\ORM\EntityManager;
use Tests\Fixtures\CalendarSeed;
use function Tests\Fixtures\{application, manifestPath, options, relate, sitePath, writeManifest};

require __DIR__ . '/fixtures/manual.php';

try {
  $options = options($argv, ['users', 'teams', 'events-per-day', 'start-time', 'end-time', 'timezone', 'run-id'], ['generate-users', 'dry-run', 'help']);

  if (isset($options['help'])) {
    echo <<<'HELP'
Create Calendar Plus demo data in a local test/development Espo instance.

php tests/seed-calendar.php --dry-run
php tests/seed-calendar.php

--generate-users     Create users and teams instead of using existing active users.
--users=15           Users to create with --generate-users; 15–300.
--teams=5            Teams to create with --generate-users; 2–100.
--events-per-day=8   Maximum events per person per weekday; randomized from 4 to this value (4–12).
--start-time=0800    Earliest event start in local time; HHmm or HH:mm.
--end-time=1800      Latest event end in local time; HHmm or HH:mm (2400 allowed).
--timezone=ZONE      Defaults to this repository's site timezone, then UTC.
--run-id=LABEL       Unique 1–24 lowercase letters/digits; random by default.
--dry-run            Preview without writing records; default mode reads existing users.
--help               Show this help.

By default, each run appends only events for existing active internal users.
--generate-users additionally creates users, teams, and a demo role.
The existing admin user receives events in both modes.
Writes run with hooks disabled.
Events cover weekdays from six calendar months ago through six months from now.
New-user login password: CALENDAR_PLUS_SEED_PASSWORD or CalendarDemo!2026.
HELP;
    echo "\n";
    exit(0);
  }

  $autoload = __DIR__ . '/vendor/autoload.php';
  $faker = __DIR__ . '/vendor/fakerphp/faker/src/Faker/Factory.php';

  if (!is_file($autoload) || !is_file($faker)) {
    echo "Installing fixture dependencies...\n";

    $process = proc_open(
      [
        'composer',
        'install',
        '--working-dir=' . __DIR__,
        '--no-interaction',
        '--prefer-dist',
        '--no-progress',
        '--no-scripts',
        '--no-plugins',
      ],
      [STDIN, STDOUT, STDERR],
      $pipes,
      __DIR__,
    );

    if (!is_resource($process) || proc_close($process) !== 0) {
      throw new RuntimeException('Automatic fixture dependency installation failed. Composer must be available on PATH.');
    }
  }

  require $autoload;
  require __DIR__ . '/fixtures/CalendarSeed.php';

  $generateUsers = isset($options['generate-users']);

  if (!$generateUsers && (isset($options['users']) || isset($options['teams']))) {
    throw new InvalidArgumentException('--users and --teams require --generate-users.');
  }

  $site = sitePath();
  $config = is_file($site . '/data/config.php') ? require $site . '/data/config.php' : [];
  $timezone = new DateTimeZone($options['timezone'] ?? $config['timeZone'] ?? 'UTC');
  $runId = $options['run-id'] ?? bin2hex(random_bytes(4));
  $counts = [];

  foreach (['users' => 15, 'teams' => 5, 'events-per-day' => 8] as $key => $default) {
    $value = $options[$key] ?? (string) $default;

    if (!preg_match('/^[0-9]+$/D', $value)) {
      throw new InvalidArgumentException("--$key must be a whole number.");
    }

    $counts[$key] = (int) $value;
  }

  $app = null;
  $manager = null;
  $savedUsers = [];
  $savedTeams = [];
  $users = [];
  $teams = [];

  if (!$generateUsers) {
    $app = application();
    $manager = $app->getContainer()->getByClass(EntityManager::class);
    $existing = $manager->getRDBRepository('User')
      ->where(['isActive' => true, 'type' => ['regular', 'admin', 'super-admin']])
      ->order('userName')
      ->limit(0, 301)
      ->find();
    $teamIndexes = [];

    foreach ($existing as $user) {
      $savedUsers[] = $user;
      $memberships = [];
      $relation = $manager->getRDBRepository('User')->getRelation($user, 'teams');

      foreach ($relation->find() as $team) {
        $id = $team->getId();

        if (!isset($teamIndexes[$id])) {
          $teamIndexes[$id] = count($savedTeams);
          $savedTeams[] = $team;
          $teams[] = ['name' => $team->get('name')];
        }

        $memberships[] = $teamIndexes[$id];
      }

      $users[] = [
        'attributes' => ['name' => $user->get('name')],
        'teams' => $memberships,
      ];
    }

    if (!$users) {
      throw new RuntimeException('No active internal users found. Use --generate-users to create users and teams.');
    }
  } elseif ($counts['users'] < 15 || $counts['teams'] < 2) {
    throw new InvalidArgumentException('--generate-users requires at least 15 users and 2 teams.');
  } elseif ($generateUsers && $counts['teams'] > $counts['users']) {
    throw new InvalidArgumentException('There must be at least one generated user per team.');
  }

  $today = new DateTimeImmutable('today', $timezone);
  $plan = new CalendarSeed(
    $today,
    $runId,
    $generateUsers ? $counts['users'] : count($users),
    $generateUsers ? $counts['teams'] : count($teams),
    $counts['events-per-day'],
    $options['start-time'] ?? '0800',
    $options['end-time'] ?? '1800',
  );

  if ($generateUsers) {
    $teams = $plan->teams();
    $users = $plan->users();
  }

  $app ??= application();
  $manager ??= $app->getContainer()->getByClass(EntityManager::class);
  $admin = $manager->getRDBRepository('User')
    ->where(['userName' => 'admin', 'type' => ['admin', 'super-admin']])
    ->findOne();

  if (!$admin) {
    throw new RuntimeException('The existing admin user was not found.');
  }

  $adminIncluded = false;

  foreach ($savedUsers as $user) {
    if ($user->getId() === $admin->getId()) {
      $adminIncluded = true;
      break;
    }
  }

  if (!$adminIncluded) {
    $adminTeamIds = [];
    $relation = $manager->getRDBRepository('User')->getRelation($admin, 'teams');

    foreach ($relation->find() as $team) {
      $adminTeamIds[] = $team->getId();
    }

    $users[] = [
      'attributes' => ['name' => $admin->get('name')],
      'teams' => [],
      'teamIds' => $adminTeamIds,
      'existingUser' => $admin,
    ];

    if (!$generateUsers) {
      $savedUsers[] = $admin;
    }
  }

  $summary = ['Task' => 0, 'Meeting' => 0, 'Call' => 0];
  $samples = [];
  $summarize = static function (array $event) use (&$summary, &$samples): void {
    $summary[$event['entityType']]++;
    $samples[$event['entityType']] ??= $event['attributes']['name'];
  };

  printf(
    "Run: %s\nTest instance: %s\nTimezone: %s\nRange: %s through %s\nLocal hours: %s to %s\nUsers: %d; teams: %d\n",
    $runId,
    $site,
    $timezone->getName(),
    $plan->start->format('Y-m-d'),
    $plan->end->format('Y-m-d'),
    $plan->startTime,
    $plan->endTime,
    count($users),
    count($teams),
  );

  echo $generateUsers ? "Creating users and teams with events.\n" : "Generating events for existing users and teams.\n";
  echo "Existing admin user included in event schedules.\n";

  if (isset($options['dry-run'])) {
    foreach ($plan->events(count($users)) as $event) {
      $summarize($event);
    }

    echo "Dry run: no records written.\n";
  } else {
    $manifestFile = manifestPath($runId);

    if (is_file($manifestFile)) {
      throw new RuntimeException('This run ID already exists. Empty it first or choose another run ID.');
    }

    $app ??= application();
    $manager ??= $app->getContainer()->getByClass(EntityManager::class);
    $manifest = ['site' => $site, 'runId' => $runId, 'records' => [], 'links' => []];

    $manager->getTransactionManager()->run(static function () use (
      $app,
      $manager,
      $generateUsers,
      $savedUsers,
      $savedTeams,
      $runId,
      $plan,
      $teams,
      $users,
      $summarize,
      &$manifest,
      $manifestFile,
    ): void {
      $create = static function (string $type, array $attributes) use ($manager, &$manifest) {
        $entity = $manager->createEntity($type, $attributes, ['skipAll' => true]);
        $manifest['records'][$type][] = $entity->getId();

        return $entity;
      };

      $link = static function ($entity, string $name, string $id, ?array $columns = null) use ($manager, &$manifest): void {
        relate($manager, $entity, $name, $id, $columns);
        $manifest['links'][] = [$entity->getEntityType(), $entity->getId(), $name, $id];
      };

      if ($generateUsers) {
        $hash = $app->getContainer()->get('passwordHash')->hash(
          getenv('CALENDAR_PLUS_SEED_PASSWORD') ?: 'CalendarDemo!2026',
        );

        $access = (object) ['Calendar' => true];

        foreach (['Task', 'Meeting', 'Call', 'User', 'Team'] as $type) {
          $access->$type = (object) ['read' => 'all', 'create' => 'yes', 'edit' => 'all', 'delete' => 'all', 'stream' => 'all'];
        }

        $role = $create('Role', [
          'name' => "Calendar Plus demo role [$runId]",
          'data' => $access,
          'userCalendarPermission' => 'all',
          'userPermission' => 'all',
          'assignmentPermission' => 'all',
        ]);

        foreach ($teams as $team) {
          $savedTeams[] = $create('Team', $team);
        }

        foreach ($users as $user) {
          if (isset($user['existingUser'])) {
            $savedUsers[] = $user['existingUser'];
            continue;
          }

          $entity = $create('User', $user['attributes'] + ['password' => $hash]);
          $savedUsers[] = $entity;
          $link($entity, 'roles', $role->getId());

          foreach ($user['teams'] as $index) {
            $link($entity, 'teams', $savedTeams[$index]->getId());
          }
        }
      }

      foreach ($plan->events(count($users)) as $event) {
        $owner = $savedUsers[$event['owner']];
        $entity = $create($event['entityType'], $event['attributes'] + [
          'assignedUserId' => $owner->getId(),
          'createdById' => $owner->getId(),
          'modifiedById' => $owner->getId(),
        ]);

        foreach ($users[$event['owner']]['teams'] as $index) {
          $link($entity, 'teams', $savedTeams[$index]->getId());
        }

        foreach ($users[$event['owner']]['teamIds'] ?? [] as $teamId) {
          $link($entity, 'teams', $teamId);
        }

        if ($event['entityType'] !== 'Task') {
          $link($entity, 'users', $owner->getId(), ['status' => 'Accepted']);

          if ($event['guest'] !== $event['owner']) {
            $link($entity, 'users', $savedUsers[$event['guest']]->getId(), ['status' => $event['guestStatus']]);
          }
        } elseif ($event['owner'] % 4 === 0 && $event['guest'] !== $event['owner']) {
          $link($entity, 'collaborators', $savedUsers[$event['guest']]->getId());
        }

        $summarize($event);
      }

      // Save cleanup IDs before committing: a failed file write rolls back the database.
      writeManifest($manifestFile, $manifest);
    });

    echo "Committed demo fixtures. Cleanup manifest: $manifestFile\n";
  }

  foreach ($summary as $type => $count) {
    printf("%s: %d; example: %s\n", $type, $count, $samples[$type]);
  }

  printf("Example users: %s\n", implode(', ', array_column(array_column(array_slice($users, 0, 5), 'attributes'), 'name')));
} catch (Throwable $error) {
  fwrite(STDERR, 'Calendar seed failed: ' . $error->getMessage() . "\n");
  exit(1);
}
