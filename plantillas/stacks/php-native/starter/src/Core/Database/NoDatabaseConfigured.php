<?php

declare(strict_types=1);

namespace App\Core\Database;

/** The project has no database overlay (`--db none`): migrations have nothing to do. */
final class NoDatabaseConfigured extends \RuntimeException {}
