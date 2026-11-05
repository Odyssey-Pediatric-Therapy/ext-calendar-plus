<?php

$loader = require __DIR__ . '/site/vendor/autoload.php';
$loader->addPsr4('Espo\\Modules\\CalendarPlus\\', __DIR__ . '/src/files/custom/Espo/Modules/CalendarPlus', true);
