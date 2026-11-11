<?php

require __DIR__ . '/runtime.php';
$app = bootTestApplication();
$container = $app->getContainer();
$manager = $container->getByClass(Espo\ORM\EntityManager::class);
$systemUser = $container->get('injectableFactory')->create(Espo\Core\Utils\SystemUser::class);
$container->set('user', $manager->getEntityById('User', $systemUser->getId()));
$passwordHash = $container->get('passwordHash');
$password = getenv('CP_TEST_PASSWORD') ?: 'CalendarPlusTest!2026';

function fixtureId(string $key): string
{
  return substr(sha1('calendar-plus-tests:' . $key), 0, 17);
}

function fixtureEntity(string $type, string $key, array $attributes): Espo\ORM\Entity
{
  global $manager;
  $id = fixtureId($key);
  $entity = $manager->getEntityById($type, $id) ?? $manager->getNewEntity($type);
  $entity->set('id', $id);
  $entity->set($attributes);
  $manager->saveEntity($entity, ['silent' => true, 'skipNotifications' => true]);
  return $entity;
}

function fixtureLinks(Espo\ORM\Entity $entity, string $link, array $ids, array $columns = []): void
{
  global $manager;
  if (!$entity->hasRelation($link)) return;
  $relation = $manager->getRDBRepository($entity->getEntityType())->getRelation($entity, $link);
  foreach ($relation->find() as $related) $relation->unrelate($related);
  foreach ($ids as $id) $relation->relateById($id, $columns[$id] ?? null);
}

$access = (object) ['Calendar' => true];
foreach (['Meeting', 'Call', 'Task', 'User', 'Team', 'Contact', 'Lead'] as $type) {
  $access->$type = (object) ['read' => 'all', 'create' => 'yes', 'edit' => 'all', 'delete' => 'all', 'stream' => 'all'];
}
$roles = [];
foreach (['all', 'team', 'no'] as $level) {
  $roles[$level] = fixtureEntity('Role', 'role-' . $level, [
    'name' => '[CP Test] ' . $level,
    'data' => $access,
    'userCalendarPermission' => $level,
    'userPermission' => 'all',
    'assignmentPermission' => 'all',
  ]);
}
$detailAccess = clone $access;
$detailAccess->Meeting = (object) ['read' => 'own', 'create' => 'yes', 'edit' => 'own', 'delete' => 'own'];
$roles['details'] = fixtureEntity('Role', 'role-details', [
  'name' => '[CP Test] Detail restrictions', 'data' => $detailAccess,
  'fieldData' => (object) ['Meeting' => (object) [
    'users' => (object) ['read' => 'no', 'edit' => 'no'],
    'location' => (object) ['read' => 'no', 'edit' => 'no'],
  ]],
  'userCalendarPermission' => 'all', 'userPermission' => 'all',
]);

$teamNames = ['success' => 'Customer Success', 'delivery' => 'Delivery', 'sales' => 'Sales', 'operations' => 'Operations', 'leadership' => 'Leadership'];
$teams = [];
foreach ($teamNames as $key => $name) {
  $teams[$key] = fixtureEntity('Team', 'team-' . $key, ['name' => '[CP Test] ' . $name]);
}
$roster = [
  ['amelia', 'Amelia', 'Chen'], ['isabella', 'Isabella', 'Reyes'], ['maya', 'Maya', 'Thompson'],
  ['noah', 'Noah', 'Mitchell'], ['sophia', 'Sophia', 'Patel'], ['liam', 'Liam', 'Brooks'],
  ['olivia', 'Olivia', 'Bennett'], ['ethan', 'Ethan', 'Rivera'], ['ava', 'Ava', 'Morgan'],
  ['lucas', 'Lucas', 'Hayes'], ['charlotte', 'Charlotte', 'Kim'], ['benjamin', 'Benjamin', 'Carter'],
  ['mia', 'Mia', 'Sullivan'], ['james', 'James', 'Cooper'], ['harper', 'Harper', 'Reed'],
];
$memberships = [
  'success' => [0, 1, 3, 4, 7, 10],
  'delivery' => [1, 2, 5, 6, 8, 11, 14],
  'sales' => [0, 2, 4, 9, 12],
  'operations' => [3, 5, 7, 8, 10, 13],
  'leadership' => [0, 6, 9, 11, 12, 14],
];
$people = [];
foreach ($roster as $index => [$key, $first, $last]) {
  $person = fixtureEntity('User', 'user-' . $key, [
    'userName' => 'cp_' . $key,
    'firstName' => $first,
    'lastName' => $last,
    'type' => 'regular',
    'isActive' => $key !== 'james',
    'password' => $passwordHash->hash($password),
  ]);
  fixtureLinks($person, 'roles', [$roles['all']->getId()]);
  $ids = [];
  foreach ($memberships as $team => $indices) if (in_array($index, $indices, true)) $ids[] = $teams[$team]->getId();
  fixtureLinks($person, 'teams', $ids);
  $people[$key] = ['id' => $person->getId(), 'name' => "$first $last", 'username' => 'cp_' . $key, 'password' => $password, 'teamsIds' => $ids, 'isActive' => $key !== 'james'];
}
$accounts = [];
foreach (['admin' => ['admin', 'all'], 'teamOnly' => ['regular', 'team'], 'personalOnly' => ['regular', 'no'], 'api' => ['api', 'all'], 'detailsRestricted' => ['regular', 'details']] as $key => [$type, $level]) {
  $entity = fixtureEntity('User', 'account-' . $key, [
    'userName' => 'cp_' . strtolower($key), 'firstName' => 'Calendar Test', 'lastName' => ucfirst($key),
    'type' => $type, 'isActive' => true, 'password' => $passwordHash->hash($password),
  ]);
  fixtureLinks($entity, 'roles', [$roles[$level]->getId()]);
  fixtureLinks($entity, 'teams', [$teams['success']->getId()]);
  $accounts[$key] = ['id' => $entity->getId(), 'username' => 'cp_' . strtolower($key), 'password' => $password];
}
$week = new DateTimeImmutable('monday this week', new DateTimeZone('UTC'));
$date = $week->modify('+2 days')->format('Y-m-d');
$types = ['Meeting', 'Call', 'Task'];
$titles = ['Client planning', 'Account review', 'Delivery walkthrough', 'Project working session', 'Implementation follow-up', 'Pipeline review', 'Customer check-in', 'Documentation update'];
$scheduled = array_values($people);
$scheduled[] = $accounts['admin'] + ['name' => 'Calendar Test Admin'];
$eventCount = 0;
foreach ($scheduled as $personIndex => $person) {
  for ($day = 0; $day < 5; $day++) {
    $dayDate = $week->modify("+$day days");
    $starts = [480 + ($personIndex * 17 + $day * 11) % 70, 585 + ($personIndex * 13 + $day * 19) % 80, 735 + ($personIndex * 23 + $day * 7) % 90, 885 + ($personIndex * 11 + $day * 31) % 100];
    if ($personIndex % 4 === 0) $starts[1] = $starts[0] + 30;
    foreach ($starts as $slot => $minutes) {
      $type = $types[($personIndex + $slot + $day) % 3];
      $duration = [30, 45, 60, 75, 90][($personIndex + $day + $slot) % 5];
      $status = $type === 'Task' ? 'Not Started' : 'Planned';
      if (($personIndex + $day + $slot) % 11 === 0) $status = $type === 'Task' ? 'Completed' : 'Held';
      else if (($personIndex + $day + $slot) % 17 === 0) $status = $type === 'Task' ? 'Canceled' : 'Not Held';
      $event = fixtureEntity($type, "schedule-$personIndex-$day-$slot", [
        'name' => '[CP Test] ' . $titles[($personIndex + $day + $slot) % count($titles)],
        'assignedUserId' => $person['id'],
        'dateStart' => $dayDate->modify("+$minutes minutes")->format('Y-m-d H:i:s'),
        'dateEnd' => $dayDate->modify('+' . ($minutes + $duration) . ' minutes')->format('Y-m-d H:i:s'),
        'status' => $status,
        'description' => 'Deterministic Calendar Plus integration fixture.',
      ]);
      if ($type !== 'Task') {
        $guest = $scheduled[($personIndex + 1) % count($scheduled)]['id'];
        $status = ['Accepted', 'Tentative', 'None', 'Declined'][($personIndex + $slot) % 4];
        fixtureLinks($event, 'users', [$person['id'], $guest], [$person['id'] => ['status' => 'Accepted'], $guest => ['status' => $status]]);
      } else fixtureLinks($event, 'collaborators', []);
      $eventCount++;
    }
  }
}
$special = [];
foreach (['meeting' => ['Meeting', 'Drag meeting', '10:00:00', '11:00:00'], 'task' => ['Task', 'Drag task', '13:00:00', '14:00:00'], 'search' => ['Call', 'Search target', '15:00:00', '15:45:00']] as $key => [$type, $title, $start, $end]) {
  $event = fixtureEntity($type, 'special-' . $key, [
    'name' => '[CP Test] ' . $title, 'assignedUserId' => $people['amelia']['id'],
    'dateStart' => "$date $start", 'dateEnd' => "$date $end", 'status' => $type === 'Task' ? 'Not Started' : 'Planned',
  ]);
  if ($type === 'Task') fixtureLinks($event, 'collaborators', []);
  else fixtureLinks($event, 'users', [$people['amelia']['id']], [$people['amelia']['id'] => ['status' => 'Accepted']]);
  $special[$key] = ['id' => $event->getId(), 'scope' => $type, 'name' => '[CP Test] ' . $title];
}
$detailFixture = fixtureEntity('Meeting', 'detail-restricted', [
  'name' => '[CP Test] Restricted detail projection',
  'assignedUserId' => $accounts['detailsRestricted']['id'],
  'dateStart' => "$date 17:00:00", 'dateEnd' => "$date 17:30:00",
  'status' => 'Planned', 'location' => 'Private location',
]);

fixtureLinks($detailFixture, 'users', [$people['amelia']['id'], $accounts['detailsRestricted']['id']],
  [$people['amelia']['id'] => ['status' => 'Declined'], $accounts['detailsRestricted']['id'] => ['status' => 'Accepted']]);

$calendars = [];
foreach (['week' => 'agendaWeek', 'day' => 'agendaDay', 'month' => 'month', 'timeline' => 'timeline'] as $key => $mode) {
  $calendars[$key] = [
    'id' => 'cp-test-' . $key, 'name' => '[CP Test] Team ' . $key, 'mode' => $mode,
    'userIdList' => [$people['amelia']['id'], $people['isabella']['id'], $accounts['admin']['id']],
    'userNames' => (object) [$people['amelia']['id'] => 'Amelia Chen', $people['isabella']['id'] => 'Isabella Reyes', $accounts['admin']['id'] => 'Calendar Test Admin'],
    'teamIdList' => [$teams['success']->getId()], 'teamNames' => (object) [$teams['success']->getId() => '[CP Test] Customer Success'],
    'membershipMode' => 'dynamic',
  ];
}
$preferences = [
  'calendarViewDataList' => array_values($calendars), 'calendarPlusList' => [],
  'calendarPlusSharedSelection' => (object) ['userIdList' => [$accounts['admin']['id']], 'teamIdList' => array_map(fn ($team) => $team->getId(), array_values($teams)), 'membershipMode' => 'dynamic'],
  'calendarPlusViewSettings' => (object) [], 'calendarPlusSearchSettings' => (object) [],
  'calendarSlotDuration' => 30, 'calendarScrollHour' => 8, 'timeZone' => 'UTC',
  'dateFormat' => 'YYYY-MM-DD', 'timeFormat' => 'HH:mm', 'weekStart' => 1,
];
foreach ($accounts as $key => $account) {
  if ($key === 'api') continue;
  $entity = $manager->getEntityById('Preferences', $account['id']);
  $entity->set($preferences);
  $manager->saveEntity($entity);
}
$manifest = [
  'database' => assertTestEnvironment()['dbname'], 'date' => $date,
  'from' => $week->format('Y-m-d'), 'to' => $week->modify('+4 days')->format('Y-m-d'),
  'people' => $people, 'accounts' => $accounts, 'calendars' => $calendars, 'events' => $special,
  'preferences' => $preferences, 'teams' => array_map(fn ($team) => ['id' => $team->getId(), 'name' => $team->get('name')], $teams),
  'detailFixtureId' => $detailFixture->getId(),
  'eventCount' => $eventCount + count($special) + 1,
];
file_put_contents(repositoryRoot() . '/tests/.runtime/fixtures.json', json_encode($manifest, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR));
echo sprintf("Seeded %d named users across %d teams, plus test accounts, with %d events.\n", count($people), count($teams), $manifest['eventCount']);
