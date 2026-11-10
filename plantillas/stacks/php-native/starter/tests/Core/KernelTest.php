<?php

declare(strict_types=1);

namespace App\Tests\Core;

use App\Core\Http\Request;
use App\Core\Http\Response;
use App\Core\Kernel;
use App\Core\Security\Identity;
use App\Tests\Support\AppTestCase;

final class KernelTest extends AppTestCase
{
    public function testHealthIsPublicAndNeedsNoDatabase(): void
    {
        $response = $this->request('GET', '/health');

        self::assertSame(200, $response->status);
        self::assertSame(['status' => 'ok'], $response->decoded());
        self::assertSame('application/json', $response->headers['content-type']);
    }

    public function testUnknownRouteIs404(): void
    {
        self::assertSame(404, $this->request('GET', '/nope')->status);
    }

    public function testWrongMethodIs405WithAllow(): void
    {
        $response = $this->request('POST', '/health');

        self::assertSame(405, $response->status);
        self::assertSame('GET', $response->headers['allow']);
    }

    public function testPrivateRoutesNeedAuthenticationByDefault(): void
    {
        $this->kernel->router()->get('/api/secret/{id}', static fn(Request $r): Response => Response::json([
            'id' => $r->param('id'),
            'user' => $r->identity()->userId,
        ]));

        $anonymous = $this->request('GET', '/api/secret/42');
        self::assertSame(401, $anonymous->status);
        self::assertSame('Bearer', $anonymous->headers['www-authenticate']);

        $this->actingAs(new Identity('user-1'));
        $response = $this->request('GET', '/api/secret/42');
        self::assertSame(200, $response->status);
        self::assertSame(['id' => '42', 'user' => 'user-1'], $response->decoded());
    }

    public function testInvalidJsonIs400(): void
    {
        $this->kernel->router()->post('/echo', static fn(Request $r): Response => Response::json($r->json()), public: true);

        $request = new Request('POST', '/echo', [], ['content-type' => 'application/json'], '{"broken"');
        self::assertSame(400, $this->kernel->handle($request)->status);
    }

    public function testTooLargeBodyIs413(): void
    {
        $request = new Request('POST', '/health', [], [], str_repeat('a', Request::MAX_BODY_BYTES + 1));

        self::assertSame(413, $this->kernel->handle($request)->status);
    }

    public function testUnexpectedErrorsAre500AndOnlyShowTheDetailInDebug(): void
    {
        $this->kernel->router()->get('/boom', static fn(Request $r): Response => throw new \RuntimeException('secret detail'), public: true);

        $debug = $this->request('GET', '/boom');
        self::assertSame(500, $debug->status);
        self::assertSame('RuntimeException: secret detail', $debug->decoded()['detail']);

        $prod = (new Kernel($this->container, $this->kernel->router()))->handle(Request::create('GET', '/boom'));
        self::assertSame(500, $prod->status);
        self::assertSame(['error' => 'Internal Server Error'], $prod->decoded());
    }
}
