<?php

declare(strict_types=1);

namespace App\Tests\Core;

use App\Core\Database\DatabaseConfig;
use App\Core\Database\NoDatabaseConfigured;
use App\Core\Env;
use PHPUnit\Framework\TestCase;

/** The variables each infra-setup overlay injects (compose.<db>.yaml) become a PDO DSN. */
final class DatabaseConfigTest extends TestCase
{
    public function testPostgresOverlay(): void
    {
        $config = DatabaseConfig::fromEnv(new Env([
            'DB_DRIVER' => 'postgres',
            'DB_HOST' => 'db',
            'DB_PORT' => '5432',
            'DB_DATABASE' => 'app',
            'DB_USERNAME' => 'app',
            'DB_PASSWORD' => 's3cret;x',
            'DATABASE_URL' => 'postgresql://ignored:ignored@other:5432/other',
        ]));

        self::assertSame('pgsql', $config->driver);
        self::assertSame('pgsql:host=db;port=5432;dbname=app', $config->dsn);
        self::assertSame('app', $config->user);
        self::assertSame('s3cret;x', $config->password);
    }

    public function testMysqlOverlay(): void
    {
        $config = DatabaseConfig::fromEnv(new Env([
            'DB_DRIVER' => 'mysql',
            'DB_HOST' => 'db',
            'DB_PORT' => '3306',
            'DB_DATABASE' => 'app',
            'DB_USERNAME' => 'app',
            'DB_PASSWORD' => 'pw',
        ]));

        self::assertSame('mysql:host=db;port=3306;dbname=app;charset=utf8mb4', $config->dsn);
    }

    public function testSqliteOverlay(): void
    {
        $config = DatabaseConfig::fromEnv(new Env(['DB_DRIVER' => 'sqlite', 'DB_DATABASE' => '/app/data/app.db']));

        self::assertSame('sqlite', $config->driver);
        self::assertSame('sqlite:/app/data/app.db', $config->dsn);
    }

    public function testDatabaseUrlFallback(): void
    {
        $file = DatabaseConfig::fromEnv(new Env(['DATABASE_URL' => 'file:/app/data/app.db']));
        self::assertSame('sqlite:/app/data/app.db', $file->dsn);

        $postgres = DatabaseConfig::fromEnv(new Env(['DATABASE_URL' => 'postgresql://app:p%40ss@db:5432/app']));
        self::assertSame('pgsql:host=db;port=5432;dbname=app', $postgres->dsn);
        self::assertSame('p@ss', $postgres->password);

        $mysql = DatabaseConfig::fromEnv(new Env(['DATABASE_URL' => 'mysql://app:pw@db/app']));
        self::assertSame('mysql:host=db;port=3306;dbname=app;charset=utf8mb4', $mysql->dsn);
    }

    public function testNoDatabase(): void
    {
        $this->expectException(NoDatabaseConfigured::class);

        DatabaseConfig::fromEnv(new Env([]));
    }

    public function testDsnInjectionIsRejected(): void
    {
        $this->expectException(\RuntimeException::class);

        DatabaseConfig::fromEnv(new Env(['DB_DRIVER' => 'postgres', 'DB_HOST' => 'db;sslmode=disable', 'DB_DATABASE' => 'app']));
    }
}
