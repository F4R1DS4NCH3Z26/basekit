<?php

declare(strict_types=1);

namespace App\Tests\Core;

use App\Core\Database\Database;
use App\Core\Database\DatabaseConfig;
use App\Core\Database\Migrator;
use App\Core\Database\SqlSplitter;
use PHPUnit\Framework\TestCase;

final class MigratorTest extends TestCase
{
    private string $dir;

    private \PDO $pdo;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/migrator-' . bin2hex(random_bytes(6));
        mkdir($this->dir . '/migrations', 0o700, true);
        mkdir($this->dir . '/src/Modules/Products/Migrations', 0o700, true);
        $this->pdo = Database::connect(new DatabaseConfig('sqlite', 'sqlite::memory:'));
    }

    protected function tearDown(): void
    {
        foreach (['migrations', 'src/Modules/Products/Migrations'] as $sub) {
            array_map(unlink(...), glob($this->dir . '/' . $sub . '/*') ?: []);
        }
        foreach (['src/Modules/Products/Migrations', 'src/Modules/Products', 'src/Modules', 'src', 'migrations', ''] as $sub) {
            rmdir(rtrim($this->dir . '/' . $sub, '/'));
        }
    }

    public function testAppliesModulesAndGlobalInVersionOrderOnce(): void
    {
        file_put_contents($this->dir . '/src/Modules/Products/Migrations/20260101000002_create_products.sql', "CREATE TABLE products (id CHAR(36) PRIMARY KEY, name VARCHAR(120) NOT NULL);\n-- a comment; with a semicolon\nCREATE INDEX products_name ON products (name);");
        file_put_contents($this->dir . '/migrations/20260101000001_create_settings.sql', 'CREATE TABLE settings (k VARCHAR(50) PRIMARY KEY);');
        $migrator = Migrator::forProject($this->pdo, $this->dir);

        self::assertSame(['20260101000001_create_settings', '20260101000002_create_products'], $migrator->migrate(static function (string $l): void {}));
        self::assertSame([], $migrator->migrate(static function (string $l): void {}));
        self::assertSame(['20260101000001_create_settings' => true, '20260101000002_create_products' => true], $migrator->status());
    }

    public function testEngineVariantWinsOverThePortableFile(): void
    {
        file_put_contents($this->dir . '/migrations/20260101000001_create_t.sql', 'CREATE TABLE portable (id INTEGER);');
        file_put_contents($this->dir . '/migrations/20260101000001_create_t.sqlite.sql', 'CREATE TABLE only_sqlite (id INTEGER);');
        Migrator::forProject($this->pdo, $this->dir)->migrate(static function (string $l): void {});

        $tables = $this->pdo->query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")->fetchAll(\PDO::FETCH_COLUMN);
        self::assertContains('only_sqlite', $tables);
        self::assertNotContains('portable', $tables);
    }

    public function testFailedMigrationIsRolledBackAndNotRecorded(): void
    {
        file_put_contents($this->dir . '/migrations/20260101000001_broken.sql', 'CREATE TABLE ok_table (id INTEGER); CREATE TABLE broken (;');
        $migrator = Migrator::forProject($this->pdo, $this->dir);

        try {
            $migrator->migrate(static function (string $l): void {});
            self::fail('The broken migration must throw');
        } catch (\RuntimeException $e) {
            self::assertStringContainsString('20260101000001_broken', $e->getMessage());
        }
        self::assertSame([], $migrator->applied());
        $tables = $this->pdo->query("SELECT name FROM sqlite_master WHERE name = 'ok_table'")->fetchAll();
        self::assertSame([], $tables);
    }

    public function testEmptyMigrationFails(): void
    {
        file_put_contents($this->dir . '/migrations/20260101000001_todo.sql', "-- todo\n");

        $this->expectExceptionMessageMatches('/is empty/');
        Migrator::forProject($this->pdo, $this->dir)->migrate(static function (string $l): void {});
    }

    public function testInvalidFileNameFails(): void
    {
        file_put_contents($this->dir . '/migrations/create_products.sql', 'SELECT 1;');

        $this->expectExceptionMessageMatches('/Invalid migration file name/');
        Migrator::forProject($this->pdo, $this->dir)->available();
    }

    public function testSplitterKeepsQuotedSemicolonsAndDollarBodies(): void
    {
        $sql = "INSERT INTO t VALUES ('a;b', 'it''s');\n/* x; */ CREATE FUNCTION f() RETURNS int AS \$\$ SELECT 1; \$\$ LANGUAGE sql;";

        self::assertSame([
            "INSERT INTO t VALUES ('a;b', 'it''s')",
            'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql',
        ], SqlSplitter::split($sql));
    }
}
