<?php

require __DIR__ . '/runtime.php';

$root = repositoryRoot();
$runtime = testSite();
$config = require $root . '/site/data/config.php';
$internal = require $root . '/site/data/config-internal.php';
$sourceDatabase = $internal['database'];
$database = $sourceDatabase;
foreach (['HOST' => 'host', 'PORT' => 'port', 'USER' => 'user', 'PASSWORD' => 'password', 'NAME' => 'dbname'] as $environment => $field) {
  $value = getenv('CP_TEST_DB_' . $environment);
  if ($value !== false) $database[$field] = $value;
}
$database['dbname'] = getenv('CP_TEST_DB_NAME') ?: 'cp_calendar_plus_test';
if (!preg_match('/^[a-zA-Z0-9_]+_test$/', $database['dbname']) || $database['dbname'] === $sourceDatabase['dbname']) {
  throw new RuntimeException('The test database name must end in _test and differ from the demo database.');
}
$dsn = 'mysql:host=' . ($database['host'] ?: 'localhost');
if (!empty($database['port'])) $dsn .= ';port=' . (int) $database['port'];
$pdo = new PDO($dsn, $database['user'], $database['password'] ?? '', [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$name = $database['dbname'];
$pdo->exec("CREATE DATABASE IF NOT EXISTS `$name` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
$pdo->exec("USE `$name`");
$tables = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
if ($tables && !in_array('cp_test_environment_guard', $tables, true)) {
  throw new RuntimeException('Refusing to reuse a database not owned by the Calendar Plus test suite.');
}
$pdo->exec('CREATE TABLE IF NOT EXISTS cp_test_environment_guard (id VARCHAR(64) PRIMARY KEY)');
$pdo->exec("INSERT IGNORE INTO cp_test_environment_guard VALUES ('calendar-plus-repository-tests')");

$config = array_replace($config, [
  'siteUrl' => 'http://127.0.0.1:' . (getenv('CP_TEST_PORT') ?: '8878'),
  'isDeveloperMode' => false,
  'useCache' => true,
  'theme' => 'Espo',
  'language' => 'en_US',
  'timeZone' => 'UTC',
  'dateFormat' => 'YYYY-MM-DD',
  'timeFormat' => 'HH:mm',
  'calendarPlusTooltipEnabled' => true,
  'calendarPlusTooltipDelay' => 0.1,
  'calendarPlusColorGradientEnabled' => true,
  'calendarPlusTasksAllDay' => false,
  'calendarPlusTimelineEventGap' => 0,
  'recordsPerPage' => 10,
]);
$internal['database'] = $database;
$internal['isInstalled'] = true;
$internal['instanceId'] = 'calendar-plus-tests';
foreach (['config.php' => $config, 'config-internal.php' => $internal] as $file => $values) {
  file_put_contents($runtime . '/data/' . $file, '<?php return ' . var_export($values, true) . ';');
}

$archives = glob($root . '/build/calendar-plus-*.zip');
usort($archives, fn ($a, $b) => filemtime($b) <=> filemtime($a));
$zip = new ZipArchive();
if (!$archives || $zip->open($archives[0]) !== true) throw new RuntimeException('Extension build ZIP not found.');
for ($index = 0; $index < $zip->numFiles; $index++) {
  $entry = $zip->getNameIndex($index);
  if (!str_starts_with($entry, 'files/') || str_contains($entry, '..')) continue;
  $relative = substr($entry, 6);
  if ($relative === '' || str_ends_with($relative, '/')) continue;
  $path = $runtime . '/' . $relative;
  if (!is_dir(dirname($path))) mkdir(dirname($path), 0777, true);
  file_put_contents($path, $zip->getFromIndex($index));
}
$zip->close();

$app = bootTestApplication();
$app->getContainer()->getByClass(Espo\Core\DataManager::class)->rebuild();
$pdo->exec('CREATE TABLE IF NOT EXISTS cp_test_environment_guard (id VARCHAR(64) PRIMARY KEY)');
$pdo->exec("INSERT IGNORE INTO cp_test_environment_guard VALUES ('calendar-plus-repository-tests')");
echo "Isolated test instance ready ($name).\n";
