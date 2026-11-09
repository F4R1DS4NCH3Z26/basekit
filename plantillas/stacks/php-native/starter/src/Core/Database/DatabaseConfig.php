<?php

declare(strict_types=1);

namespace App\Core\Database;

use App\Core\Env;

/**
 * PDO connection settings from the infra-setup overlays. DB_DRIVER + DB_* win; DATABASE_URL is the fallback
 * (postgresql://, mysql://, file:/app/data/app.db or sqlite:).
 */
final readonly class DatabaseConfig
{
    private const string NAME = '/^[A-Za-z0-9_.-]{1,128}$/';

    public function __construct(
        public string $driver,
        public string $dsn,
        public ?string $user = null,
        public ?string $password = null,
    ) {}

    public static function fromEnv(Env $env): self
    {
        $driver = $env->get('DB_DRIVER');
        if ($driver !== null) {
            return self::fromParts($driver, $env);
        }
        $url = $env->get('DATABASE_URL');
        if ($url !== null) {
            return self::fromUrl($url);
        }

        throw new NoDatabaseConfigured('No database configured: set DB_DRIVER and DB_*, or DATABASE_URL (skill infra-setup)');
    }

    public static function fromParts(string $driver, Env $env): self
    {
        $driver = self::normalize($driver);
        $database = $env->get('DB_DATABASE') ?? throw new \RuntimeException('DB_DATABASE is missing');
        if ($driver === 'sqlite') {
            return new self('sqlite', 'sqlite:' . $database);
        }
        $port = $env->get('DB_PORT', $driver === 'pgsql' ? '5432' : '3306');

        return self::server($driver, $env->get('DB_HOST', 'db') ?? 'db', (string) $port, $database, $env->get('DB_USERNAME'), $env->get('DB_PASSWORD'));
    }

    public static function fromUrl(string $url): self
    {
        if (str_starts_with($url, 'file:')) {
            return new self('sqlite', 'sqlite:' . substr($url, 5));
        }
        if (str_starts_with($url, 'sqlite:')) {
            $path = substr($url, 7);
            // sqlite:///abs/path (URL form) and sqlite:/abs/path or sqlite::memory: (PDO form)
            return new self('sqlite', 'sqlite:' . (str_starts_with($path, '//') ? substr($path, 2) : $path));
        }
        $parts = parse_url($url);
        if ($parts === false || !isset($parts['scheme'], $parts['host'], $parts['path'])) {
            throw new \RuntimeException('DATABASE_URL is not a valid URL');
        }
        $driver = self::normalize($parts['scheme']);
        $port = (string) ($parts['port'] ?? ($driver === 'pgsql' ? 5432 : 3306));
        $user = isset($parts['user']) ? rawurldecode($parts['user']) : null;
        $password = isset($parts['pass']) ? rawurldecode($parts['pass']) : null;

        return self::server($driver, $parts['host'], $port, rawurldecode(ltrim($parts['path'], '/')), $user, $password);
    }

    private static function server(string $driver, string $host, string $port, string $database, ?string $user, ?string $password): self
    {
        // A `;` in a DSN value would add DSN options: host, port and database name are validated.
        foreach (['host' => $host, 'port' => $port, 'database' => $database] as $what => $value) {
            if (preg_match(self::NAME, $value) !== 1) {
                throw new \RuntimeException(sprintf('Invalid database %s', $what));
            }
        }
        $dsn = sprintf('%s:host=%s;port=%s;dbname=%s', $driver, $host, $port, $database);

        return new self($driver, $driver === 'mysql' ? $dsn . ';charset=utf8mb4' : $dsn, $user, $password);
    }

    private static function normalize(string $driver): string
    {
        return match (strtolower($driver)) {
            'postgres', 'postgresql', 'pgsql' => 'pgsql',
            'mysql', 'mariadb' => 'mysql',
            'sqlite', 'sqlite3' => 'sqlite',
            default => throw new \RuntimeException(sprintf('Unsupported database driver: %s', $driver)),
        };
    }
}
