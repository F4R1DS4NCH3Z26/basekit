<?php

declare(strict_types=1);

// The environment comes from the container (compose env_file + overlays). Tests never use it for the
// database: App\Tests\Support\AppTestCase builds an in-memory SQLite with every migration applied.
require dirname(__DIR__) . '/vendor/autoload.php';

date_default_timezone_set('UTC');
