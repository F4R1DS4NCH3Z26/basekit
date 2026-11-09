<?php

declare(strict_types=1);

namespace App\Core;

use App\Core\Database\Database;
use App\Core\Database\DatabaseConfig;
use App\Core\Security\Authenticator;
use App\Core\Security\DenyAllAuthenticator;

/**
 * Services that cannot be autowired: PDO (built from the environment, only when a service asks for it,
 * so /health never touches the database), interfaces and classes with scalar arguments.
 * Everything else (repositories, handlers, controllers) is autowired by the Container.
 */
final class Services
{
    public static function register(Container $container, Env $env): void
    {
        $container->set(Env::class, static fn(): Env => $env);
        $container->set(\PDO::class, static fn(): \PDO => Database::connect(DatabaseConfig::fromEnv($env)));
        // The Auth module replaces this with its token authenticator (references/auth.md).
        $container->set(Authenticator::class, static fn(): Authenticator => new DenyAllAuthenticator());
    }
}
