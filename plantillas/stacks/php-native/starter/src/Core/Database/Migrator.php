<?php

declare(strict_types=1);

namespace App\Core\Database;

/**
 * Plain SQL migrations with a `schema_migrations` table.
 *
 * Files: migrations/ (global) and src/Modules/<M>/Migrations/ (per module), named
 * YYYYMMDDHHMMSS_name.sql (portable SQL) and optionally YYYYMMDDHHMMSS_name.<pgsql|mysql|sqlite>.sql
 * (one engine's variant, which wins over the portable file). The version is YYYYMMDDHHMMSS_name and every
 * version runs once, in version order across all folders.
 */
final class Migrator
{
    private const string FILE = '/^(\d{14}_[a-z0-9_]{3,60})(?:\.(pgsql|mysql|sqlite))?\.sql$/';

    /** @param list<string> $directories */
    public function __construct(
        private readonly \PDO $pdo,
        private readonly array $directories,
    ) {}

    public static function forProject(\PDO $pdo, string $root): self
    {
        $modules = glob($root . '/src/Modules/*/Migrations', GLOB_ONLYDIR) ?: [];

        return new self($pdo, [$root . '/migrations', ...$modules]);
    }

    public function dialect(): string
    {
        return (string) $this->pdo->getAttribute(\PDO::ATTR_DRIVER_NAME);
    }

    /**
     * Every version and the file that runs on this engine, in version order.
     *
     * @return array<string, string>
     */
    public function available(): array
    {
        $variants = [];
        foreach ($this->directories as $directory) {
            foreach (glob($directory . '/*.sql') ?: [] as $file) {
                if (preg_match(self::FILE, basename($file), $m) !== 1) {
                    throw new \RuntimeException(sprintf('Invalid migration file name: %s (expected YYYYMMDDHHMMSS_name[.pgsql|.mysql|.sqlite].sql)', $file));
                }
                $engine = $m[2] ?? '';
                if (isset($variants[$m[1]][$engine])) {
                    throw new \RuntimeException(sprintf('Duplicate migration %s: %s and %s', $m[1], $variants[$m[1]][$engine], $file));
                }
                $variants[$m[1]][$engine] = $file;
            }
        }
        ksort($variants, SORT_STRING);
        $dialect = $this->dialect();
        $files = [];
        foreach ($variants as $version => $byEngine) {
            $files[$version] = $byEngine[$dialect] ?? $byEngine[''] ?? throw new \RuntimeException(
                sprintf('Migration %s has no portable file and no %s variant', $version, $dialect),
            );
        }

        return $files;
    }

    /** @return list<string> */
    public function applied(): array
    {
        $this->ensureTable();
        $versions = $this->pdo->query('SELECT version FROM schema_migrations ORDER BY version')->fetchAll(\PDO::FETCH_COLUMN);

        return array_values(array_map(strval(...), $versions));
    }

    /**
     * Applies every pending migration. Returns the versions applied.
     *
     * @param callable(string): void $log
     *
     * @return list<string>
     */
    public function migrate(callable $log): array
    {
        $this->lock();
        try {
            $applied = array_flip($this->applied());
            $done = [];
            foreach ($this->available() as $version => $file) {
                if (isset($applied[$version])) {
                    continue;
                }
                $this->apply($version, $file);
                $log(sprintf('  + %s (%s)', $version, basename($file)));
                $done[] = $version;
            }

            return $done;
        } finally {
            $this->unlock();
        }
    }

    /** @return array<string, bool> version => applied */
    public function status(): array
    {
        $applied = array_flip($this->applied());
        $status = [];
        foreach (array_keys($this->available()) as $version) {
            $status[$version] = isset($applied[$version]);
        }

        return $status;
    }

    private function apply(string $version, string $file): void
    {
        $statements = SqlSplitter::split((string) file_get_contents($file));
        if ($statements === []) {
            throw new \RuntimeException(sprintf('Migration %s is empty: write its SQL before running it', $file));
        }
        // PostgreSQL and SQLite roll back DDL; MySQL commits every DDL statement on its own.
        $transactional = $this->dialect() !== 'mysql';
        if ($transactional) {
            $this->pdo->beginTransaction();
        }
        try {
            foreach ($statements as $statement) {
                $this->pdo->exec($statement);
            }
            $insert = $this->pdo->prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
            $insert->execute([$version, gmdate('Y-m-d H:i:s')]);
            if ($transactional) {
                $this->pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($transactional && $this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            $hint = $transactional ? 'nothing was applied' : 'MySQL does not roll back DDL: check the schema before retrying';

            throw new \RuntimeException(sprintf('Migration %s failed (%s): %s', $version, $hint, $e->getMessage()), 0, $e);
        }
    }

    private function ensureTable(): void
    {
        $this->pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(191) NOT NULL PRIMARY KEY, applied_at VARCHAR(32) NOT NULL)');
    }

    /** Two instances migrating at once (two deploys) wait for each other. SQLite runs a single instance. */
    private function lock(): void
    {
        $dialect = $this->dialect();
        if ($dialect === 'pgsql') {
            $this->pdo->exec('SELECT pg_advisory_lock(727274)');
        } elseif ($dialect === 'mysql') {
            $locked = $this->pdo->query("SELECT GET_LOCK('schema_migrations', 60)")->fetchColumn();
            if ((int) $locked !== 1) {
                throw new \RuntimeException('Another migration is running (GET_LOCK timed out after 60 s)');
            }
        }
    }

    private function unlock(): void
    {
        $dialect = $this->dialect();
        if ($dialect === 'pgsql') {
            $this->pdo->exec('SELECT pg_advisory_unlock(727274)');
        } elseif ($dialect === 'mysql') {
            $this->pdo->query("SELECT RELEASE_LOCK('schema_migrations')")->fetchColumn();
        }
    }
}
