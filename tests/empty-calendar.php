<?php

declare(strict_types=1);

use Espo\Core\Utils\SystemUser;
use Espo\ORM\EntityManager;
use Espo\ORM\Query\DeleteBuilder;
use Espo\ORM\Query\SelectBuilder;
use function Tests\Fixtures\{application, options, sitePath, writeManifest};

require __DIR__ . '/fixtures/manual.php';

try {
  $options = options($argv, [], ['users', 'dry-run', 'help']);

  if (isset($options['help'])) {
    echo <<<'HELP'
Empty calendar event tables in this repository's site.

php tests/empty-calendar.php --dry-run
php tests/empty-calendar.php
php tests/empty-calendar.php --users

--users         Also delete regular users, all teams and all roles.
--dry-run       Count existing rows without deleting records or relationships.
--help          Show this help without connecting to a database.

By default, only Task, Meeting and Call rows are deleted, including non-generated
and soft-deleted events. Users, teams, roles and their memberships are unchanged.
--users also removes non-admin users, teams and roles.
Admin, super-admin and internal system accounts are preserved.
Deletes are transactional and run without hooks. Keep tests/.fixtures manifests until cleanup is complete.
HELP;
    echo "\n";
    exit(0);
  }

  $site = sitePath();
  $paths = glob(__DIR__ . '/.fixtures/*.json');
  $manifests = [];
  $allowed = ['Task', 'Meeting', 'Call', 'User', 'Team', 'Role'];
  $targets = ['Task', 'Meeting', 'Call'];

  if (isset($options['users'])) {
    $targets = $allowed;
  }

  foreach ($paths as $path) {
    if (!is_file($path)) {
      throw new RuntimeException('No cleanup manifest found for this run.');
    }

    $manifest = json_decode(file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);

    if (($manifest['site'] ?? null) !== $site) {
      continue;
    }

    foreach ($manifest['records'] as $type => $ids) {
      if (!in_array($type, $allowed, true) || !is_array($ids)) {
        throw new RuntimeException('Invalid fixture manifest.');
      }
    }

    $manifests[$path] = $manifest;
  }

  printf("Test instance: %s\nRecorded batches: %d\n", $site, count($manifests));
  $app = application();
  $container = $app->getContainer();
  $manager = $container->getByClass(EntityManager::class);
  $systemUserId = $container->get('injectableFactory')->create(SystemUser::class)->getId();
  $executor = $manager->getQueryExecutor();
  $dryRun = isset($options['dry-run']);
  $execute = static function () use ($manager, $executor, $manifests, $targets, $dryRun, $systemUserId): array {
    $counts = array_fill_keys($targets, 0);

    foreach ($manifests as $manifest) {
      if ($dryRun) {
        continue;
      }

      foreach ($manifest['links'] as [$type, $id, $link, $foreignId]) {
        if (!in_array($type, $targets, true)) {
          continue;
        }

        $entity = $manager->getNewEntity($type);
        $entity->set('id', $id);
        $entity->setAsFetched();
        $manager->getRDBRepository($type)->getRelation($entity, $link)
          ->unrelateById($foreignId, ['skipHooks' => true]);
      }
    }

    foreach ($targets as $type) {
      $query = $dryRun
        ? SelectBuilder::create()->select('COUNT:(id)', 'count')
        : DeleteBuilder::create();

      $query->from($type);

      if ($type === 'User') {
        $query->where([
          'type!=' => ['admin', 'super-admin', 'system'],
          'userName!=' => SystemUser::NAME,
          'id!=' => $systemUserId,
        ]);
      }

      $statement = $executor->execute($query->build());
      $counts[$type] = $dryRun ? (int) $statement->fetchColumn() : $statement->rowCount();
    }

    return $counts;
  };

  $counts = $dryRun ? $execute() : $manager->getTransactionManager()->run($execute);

  foreach ($counts as $type => $count) {
    printf("%s: %d %s\n", $type, $count, $dryRun ? 'rows would be deleted' : 'rows deleted');
  }

  if (!$dryRun) {
    foreach ($manifests as $path => $manifest) {
      foreach ($targets as $type) {
        unset($manifest['records'][$type]);
      }

      $manifest['links'] = array_values(array_filter(
        $manifest['links'],
        static fn (array $link): bool => !in_array($link[0], $targets, true),
      ));

      if ($manifest['records']) {
        writeManifest($path, $manifest);
      } elseif (!unlink($path)) {
        throw new RuntimeException('Records removed, but could not remove manifest: ' . $path);
      }
    }
  }

  echo $dryRun ? "Dry run: no writes.\n" : "Committed cleanup.\n";
} catch (Throwable $error) {
  fwrite(STDERR, 'Calendar cleanup failed: ' . $error->getMessage() . "\n");
  exit(1);
}
