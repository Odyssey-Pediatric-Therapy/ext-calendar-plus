<?php

require __DIR__ . '/runtime.php';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/health') {
  assertTestEnvironment();
  header('Content-Type: application/json');
  echo '{"application":"calendar-plus-tests"}';
  return;
}
if (str_starts_with($path, '/client/') && preg_match('/\.(js|css|map|json|tpl|woff2?|ttf|eot|svg|png|jpe?g|gif|ico|webp)$/i', $path)) {
  return false;
}
if (str_starts_with($path, '/api/v1/')) {
  $_SERVER['SCRIPT_NAME'] = '/api/v1/index.php';
  $_SERVER['PHP_SELF'] = '/api/v1/index.php';
  $app = bootTestApplication();
  $app->run(Espo\Core\ApplicationRunners\Api::class);
  return;
}
if ($path === '/' || $path === '/index.php') {
  $_SERVER['SCRIPT_NAME'] = '/index.php';
  $app = bootTestApplication();
  $app->run(Espo\Core\ApplicationRunners\Client::class);
  return;
}
http_response_code(404);
