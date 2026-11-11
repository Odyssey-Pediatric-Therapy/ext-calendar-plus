<?php

// Run only against the suite-owned test database, using the installed ZIP's classes.
require __DIR__ . '/runtime.php';
$app = bootTestApplication();
$app->setupSystemUser();
$container = $app->getContainer();
$manager = $container->getByClass(Espo\ORM\EntityManager::class);
$details = $container->get('injectableFactory')->create(Espo\Modules\CalendarPlus\Tools\Calendar\EventDetails::class);
$ids = [];
foreach ($manager->getRDBRepository('Meeting')->select(['id'])->where(['name*' => '[CP Test]%'])->limit(0, 100)->find() as $entity) {
  $ids[] = $entity->getId();
}
$pdo = $manager->getPDO();
$counter = static function () use ($pdo): int {
  return (int) $pdo->query("SHOW SESSION STATUS LIKE 'Com_select'")->fetch(PDO::FETCH_NUM)[1];
};
$measure = static function (array $selection) use ($counter, $details): array {
  $before = $counter();
  $records = $details->fetch((object) ['Meeting' => $selection]);
  return ['records' => count($records), 'selects' => $counter() - $before];
};
// Warm metadata, ACL, and service creation before comparing the query counts.
$measure(array_slice($ids, 0, 1));
echo json_encode(['one' => $measure(array_slice($ids, 0, 1)), 'many' => $measure($ids)], JSON_THROW_ON_ERROR);
