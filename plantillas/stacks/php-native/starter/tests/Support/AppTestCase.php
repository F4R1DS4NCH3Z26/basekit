<?php

declare(strict_types=1);

namespace App\Tests\Support;

use App\Core\Container;
use App\Core\Database\Database;
use App\Core\Database\DatabaseConfig;
use App\Core\Database\Migrator;
use App\Core\Env;
use App\Core\Http\Request;
use App\Core\Http\Response;
use App\Core\Kernel;
use App\Core\Security\Authenticator;
use App\Core\Security\Identity;
use PHPUnit\Framework\TestCase;

/**
 * Base for HTTP tests: the real Kernel (routes, auth, controllers) over an in-memory SQLite database with
 * every migration applied. Each test starts from an empty database. No network, no server.
 */
abstract class AppTestCase extends TestCase
{
    protected Container $container;

    protected \PDO $pdo;

    protected Kernel $kernel;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pdo = Database::connect(new DatabaseConfig('sqlite', 'sqlite::memory:'));
        Migrator::forProject($this->pdo, dirname(__DIR__, 2))->migrate(static function (string $line): void {});
        $this->container = new Container();
        $this->container->instance(\PDO::class, $this->pdo);
        $this->kernel = Kernel::boot(new Env(['APP_ENV' => 'test', 'APP_DEBUG' => '1']), $this->container);
    }

    /**
     * @param array<mixed>|null     $json
     * @param array<string, string> $headers
     */
    protected function request(string $method, string $path, ?array $json = null, array $headers = []): Response
    {
        return $this->kernel->handle(Request::create($method, $path, $json, $headers));
    }

    /** Every following request is authenticated as $identity (to test 401, do not call it). */
    protected function actingAs(Identity $identity): void
    {
        $this->container->instance(Authenticator::class, new class ($identity) implements Authenticator {
            public function __construct(private readonly Identity $identity) {}

            public function authenticate(Request $request): ?Identity
            {
                return $this->identity;
            }
        });
    }
}
