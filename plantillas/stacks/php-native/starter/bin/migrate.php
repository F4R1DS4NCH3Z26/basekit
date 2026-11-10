<?php

declare(strict_types=1);

use App\Core\Database\Database;
use App\Core\Database\DatabaseConfig;
use App\Core\Database\Migrator;
use App\Core\Database\NoDatabaseConfigured;
use App\Core\Env;

// Usage: php bin/migrate.php up | status | new <name> [Module]
// `make migrate` runs `up` in the migrate service; `make migration NAME=x` and `make module-migration` run `new`.
require dirname(__DIR__) . '/vendor/autoload.php';

$root = dirname(__DIR__);
$command = $argv[1] ?? 'up';

if ($command === 'new') {
    $name = $argv[2] ?? '';
    $module = $argv[3] ?? '';
    if (preg_match('/^[a-z0-9_]{3,60}$/', $name) !== 1 || ($module !== '' && preg_match('/^[A-Z][A-Za-z0-9]{1,40}$/', $module) !== 1)) {
        fwrite(STDERR, "Usage: php bin/migrate.php new <snake_case_name> [Module]\n");
        exit(2);
    }
    if ($module !== '' && !is_dir($root . '/src/Modules/' . $module)) {
        fwrite(STDERR, "src/Modules/$module does not exist (run the phpnative-scaffold skill first)\n");
        exit(1);
    }
    $directory = $module === '' ? $root . '/migrations' : $root . '/src/Modules/' . $module . '/Migrations';
    if (!is_dir($directory) && !mkdir($directory, 0o775, true) && !is_dir($directory)) {
        fwrite(STDERR, "Cannot create $directory\n");
        exit(1);
    }
    $file = $directory . '/' . gmdate('YmdHis') . '_' . $name . '.sql';
    if (file_exists($file)) {
        fwrite(STDERR, "$file already exists\n");
        exit(1);
    }
    $template = "-- $name\n"
        . "-- Portable SQL (PostgreSQL, MySQL and SQLite). When one engine needs other syntax, add a variant next to\n"
        . "-- this file with the same version: <version>.pgsql.sql, <version>.mysql.sql or <version>.sqlite.sql.\n"
        . "-- An empty migration fails on purpose: write the SQL before `make migrate`.\n";
    $tmp = $file . '.tmp' . getmypid();
    file_put_contents($tmp, $template);
    rename($tmp, $file);
    echo '  + ' . substr($file, strlen($root) + 1) . "\n";
    exit(0);
}

if ($command !== 'up' && $command !== 'status') {
    fwrite(STDERR, "Usage: php bin/migrate.php up | status | new <name> [Module]\n");
    exit(2);
}

try {
    $config = DatabaseConfig::fromEnv(Env::fromGlobals());
} catch (NoDatabaseConfigured) {
    echo "No database configured (DB_DRIVER/DATABASE_URL): nothing to migrate. Add one with the infra-setup skill.\n";
    exit(0);
}

try {
    $migrator = Migrator::forProject(Database::connect($config), $root);
    if ($command === 'status') {
        foreach ($migrator->status() as $version => $applied) {
            echo ($applied ? '  applied  ' : '  pending  ') . $version . "\n";
        }
        exit(0);
    }
    $done = $migrator->migrate(static function (string $line): void {
        echo $line . "\n";
    });
    echo $done === [] ? "migrate: nothing pending\n" : sprintf("migrate: %d applied\n", count($done));
} catch (Throwable $e) {
    fwrite(STDERR, 'migrate: ' . $e->getMessage() . "\n");
    exit(1);
}
