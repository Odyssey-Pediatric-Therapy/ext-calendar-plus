<?php

declare(strict_types=1);

namespace Tests\Fixtures;

use Espo\Core\Application;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;
use InvalidArgumentException;
use RuntimeException;

function options(array $arguments, array $values, array $flags): array
{
  $options = [];

  for ($index = 1; $index < count($arguments); $index++) {
    $parts = explode('=', $arguments[$index], 2);
    $name = substr($parts[0], 2);

    if (!str_starts_with($parts[0], '--') || !in_array($name, [...$values, ...$flags], true)) {
      throw new InvalidArgumentException('Unknown argument: ' . $arguments[$index]);
    }

    if (in_array($name, $flags, true)) {
      if (count($parts) !== 1) {
        throw new InvalidArgumentException("--$name does not take a value.");
      }

      $options[$name] = true;
      continue;
    }

    $value = $parts[1] ?? ($arguments[++$index] ?? '');

    if ($value === '' || str_starts_with($value, '--')) {
      throw new InvalidArgumentException("--$name requires a value.");
    }

    $options[$name] = $value;
  }

  return $options;
}

function sitePath(): string
{
  $repository = realpath(dirname(__DIR__, 2));
  $site = $repository . '/site';
  $resolved = realpath($site);

  if ($resolved !== false && $resolved !== $site) {
    throw new RuntimeException('The repository site directory must not point to another installation.');
  }

  return $site;
}

function application(): Application
{
  $site = sitePath();
  if (!is_file($site . '/bootstrap.php')) {
    throw new RuntimeException('Test Espo instance not found: ' . $site);
  }

  require $site . '/bootstrap.php';
  $application = new Application();
  $application->setupSystemUser();

  return $application;
}

function relate(EntityManager $manager, Entity $entity, string $link, string $id, ?array $columns = null): void
{
  $manager->getRDBRepository($entity->getEntityType())
    ->getRelation($entity, $link)
    ->relateById($id, $columns, ['skipHooks' => true]);
}

function manifestPath(string $runId): string
{
  return dirname(__DIR__) . '/.fixtures/' . $runId . '.json';
}

function writeManifest(string $path, array $manifest): void
{
  if (!is_dir(dirname($path)) && !mkdir(dirname($path), 0700, true)) {
    throw new RuntimeException('Cannot create fixture manifest directory.');
  }

  $json = json_encode($manifest, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);

  if (file_put_contents($path . '.tmp', $json, LOCK_EX) === false || !rename($path . '.tmp', $path)) {
    throw new RuntimeException('Cannot save fixture manifest.');
  }
}
