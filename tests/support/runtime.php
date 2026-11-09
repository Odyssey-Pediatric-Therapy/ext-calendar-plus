<?php

function repositoryRoot(): string
{
  return dirname(__DIR__, 2);
}

function testSite(): string
{
  return repositoryRoot() . '/tests/.runtime/site';
}

function assertTestEnvironment(): array
{
  $site = testSite();
  if (!is_file($site . '/.calendar-plus-test-runtime')) {
    throw new RuntimeException('Run npm run test:prepare first.');
  }
  $internal = require $site . '/data/config-internal.php';
  $database = $internal['database'];
  $source = require repositoryRoot() . '/site/data/config-internal.php';
  if (
    !preg_match('/^[a-zA-Z0-9_]+_test$/', $database['dbname']) ||
    $database['dbname'] === $source['database']['dbname']
  ) {
    throw new RuntimeException('Refusing to use a non-test database.');
  }
  return $database;
}

function bootTestApplication(): Espo\Core\Application
{
  assertTestEnvironment();
  require_once testSite() . '/bootstrap.php';
  return new Espo\Core\Application(new Espo\Core\Application\ApplicationParams(noErrorHandler: true));
}
