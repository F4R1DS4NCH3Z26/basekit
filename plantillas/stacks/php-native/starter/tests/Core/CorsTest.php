<?php

declare(strict_types=1);

namespace App\Tests\Core;

use App\Core\Env;
use App\Core\Http\Cors;
use App\Core\Http\Request;
use App\Core\Kernel;
use App\Tests\Support\AppTestCase;

final class CorsTest extends AppTestCase
{
    private const string ALLOWED = 'http://localhost:5173';

    private function kernelWithCors(): Kernel
    {
        return new Kernel($this->container, $this->kernel->router(), false, new Cors([self::ALLOWED]));
    }

    public function testPreflightFromAnAllowedOriginIs204WithTheHeaders(): void
    {
        $response = $this->kernelWithCors()->handle(Request::create('OPTIONS', '/health', null, [
            'Origin' => self::ALLOWED,
            'Access-Control-Request-Method' => 'POST',
        ]));

        self::assertSame(204, $response->status);
        self::assertSame(self::ALLOWED, $response->headers['access-control-allow-origin']);
        self::assertStringContainsString('POST', $response->headers['access-control-allow-methods']);
    }

    public function testResponsesToAnAllowedOriginCarryTheHeader(): void
    {
        $response = $this->kernelWithCors()->handle(Request::create('GET', '/health', null, ['Origin' => self::ALLOWED]));

        self::assertSame(200, $response->status);
        self::assertSame(self::ALLOWED, $response->headers['access-control-allow-origin']);
    }

    public function testAnOriginOutsideTheListGetsNoAccess(): void
    {
        $kernel = $this->kernelWithCors();
        $preflight = $kernel->handle(Request::create('OPTIONS', '/health', null, [
            'Origin' => 'https://evil.example',
            'Access-Control-Request-Method' => 'POST',
        ]));
        $get = $kernel->handle(Request::create('GET', '/health', null, ['Origin' => 'https://evil.example']));

        self::assertSame(405, $preflight->status);
        self::assertArrayNotHasKey('access-control-allow-origin', $preflight->headers);
        self::assertArrayNotHasKey('access-control-allow-origin', $get->headers);
    }

    public function testCorsOriginsIsReadFromTheEnvironmentAndEmptyMeansNobody(): void
    {
        $request = Request::create('GET', '/health', null, ['Origin' => self::ALLOWED]);
        $listed = Cors::fromEnv(new Env(['CORS_ORIGINS' => ' https://a.test , ' . self::ALLOWED . ',']));
        $empty = Cors::fromEnv(new Env([]));

        self::assertSame(self::ALLOWED, $listed->apply($request, $this->request('GET', '/health'))->headers['access-control-allow-origin']);
        self::assertArrayNotHasKey('access-control-allow-origin', $empty->apply($request, $this->request('GET', '/health'))->headers);
    }
}
