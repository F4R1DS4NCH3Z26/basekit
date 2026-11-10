<?php

declare(strict_types=1);

use App\Core\Http\Request;
use App\Core\Kernel;

// Front controller: FrankenPHP (php-server) sends every request that is not a file in public/ here.
require dirname(__DIR__) . '/vendor/autoload.php';

Kernel::boot()->handle(Request::fromGlobals())->send();
