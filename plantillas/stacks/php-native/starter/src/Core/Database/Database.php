<?php

declare(strict_types=1);

namespace App\Core\Database;

final class Database
{
    public static function connect(DatabaseConfig $config): \PDO
    {
        $options = [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
            \PDO::ATTR_STRINGIFY_FETCHES => false,
        ];
        if ($config->driver !== 'sqlite') {
            // Real server-side prepared statements: values never travel inside the SQL text.
            $options[\PDO::ATTR_EMULATE_PREPARES] = false;
        }
        $pdo = new \PDO($config->dsn, $config->user, $config->password, $options);
        if ($config->driver === 'sqlite') {
            $pdo->exec('PRAGMA foreign_keys = ON');
            $pdo->exec('PRAGMA busy_timeout = 5000');
            if (!str_contains($config->dsn, ':memory:')) {
                $pdo->exec('PRAGMA journal_mode = WAL');
            }
        }

        return $pdo;
    }

    /**
     * Runs $work in one transaction: commit when it returns, rollback when it throws.
     *
     * @template T
     *
     * @param callable(): T $work
     *
     * @return T
     */
    public static function transaction(\PDO $pdo, callable $work): mixed
    {
        $pdo->beginTransaction();
        try {
            $result = $work();
            $pdo->commit();

            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }

            throw $e;
        }
    }
}
