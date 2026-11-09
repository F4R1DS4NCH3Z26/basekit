<?php

declare(strict_types=1);

namespace App\Core\Doctrine;

use Symfony\Component\DependencyInjection\EnvVarProcessorInterface;

/**
 * `%env(db_url:DATABASE_URL)%`: the infra-setup overlays send postgresql:// and mysql:// URLs, which DBAL
 * reads as is, and file:/app/data/app.db for SQLite, which DBAL needs as sqlite:////app/data/app.db.
 */
final class DatabaseUrlEnvVarProcessor implements EnvVarProcessorInterface
{
    public function getEnv(string $prefix, string $name, \Closure $getEnv): mixed
    {
        $url = (string) $getEnv($name);

        return str_starts_with($url, 'file:') ? 'sqlite:///'.substr($url, 5) : $url;
    }

    /** @return array<string, string> */
    public static function getProvidedTypes(): array
    {
        return ['db_url' => 'string'];
    }
}
