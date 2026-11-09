<?php

declare(strict_types=1);

namespace App\Tests\Core;

use App\Core\Http\CorsSubscriber;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

final class CorsSubscriberTest extends TestCase
{
    private const string ALLOWED = 'http://localhost:5173';

    public function testPreflightFromAnAllowedOriginIs204WithTheHeaders(): void
    {
        $subscriber = new CorsSubscriber(' https://a.test , ' . self::ALLOWED . ',');
        $request = $this->preflight(self::ALLOWED);
        $event = new RequestEvent($this->createStub(HttpKernelInterface::class), $request, HttpKernelInterface::MAIN_REQUEST);

        $subscriber->onRequest($event);
        $response = $event->getResponse();
        self::assertNotNull($response);
        $subscriber->onResponse(new ResponseEvent($this->createStub(HttpKernelInterface::class), $request, HttpKernelInterface::MAIN_REQUEST, $response));

        self::assertSame(204, $response->getStatusCode());
        self::assertSame(self::ALLOWED, $response->headers->get('Access-Control-Allow-Origin'));
        self::assertStringContainsString('POST', (string) $response->headers->get('Access-Control-Allow-Methods'));
    }

    public function testAnOriginOutsideTheListGetsNoAccess(): void
    {
        $subscriber = new CorsSubscriber(self::ALLOWED);
        $request = $this->preflight('https://evil.example');
        $event = new RequestEvent($this->createStub(HttpKernelInterface::class), $request, HttpKernelInterface::MAIN_REQUEST);

        $subscriber->onRequest($event);
        self::assertNull($event->getResponse());

        $response = $this->respond($subscriber, Request::create('/health', 'GET', server: ['HTTP_ORIGIN' => 'https://evil.example']));
        self::assertFalse($response->headers->has('Access-Control-Allow-Origin'));
    }

    public function testAnEmptyListMeansNoCrossOriginAccess(): void
    {
        $response = $this->respond(new CorsSubscriber(''), Request::create('/health', 'GET', server: ['HTTP_ORIGIN' => self::ALLOWED]));

        self::assertFalse($response->headers->has('Access-Control-Allow-Origin'));
    }

    public function testResponsesToAnAllowedOriginCarryTheHeader(): void
    {
        $response = $this->respond(new CorsSubscriber(self::ALLOWED), Request::create('/health', 'GET', server: ['HTTP_ORIGIN' => self::ALLOWED]));

        self::assertSame(self::ALLOWED, $response->headers->get('Access-Control-Allow-Origin'));
        self::assertContains('Origin', $response->getVary());
    }

    private function preflight(string $origin): Request
    {
        return Request::create('/api/products', 'OPTIONS', server: [
            'HTTP_ORIGIN' => $origin,
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        ]);
    }

    private function respond(CorsSubscriber $subscriber, Request $request): Response
    {
        $response = new Response('{"status":"ok"}');
        $subscriber->onResponse(new ResponseEvent($this->createStub(HttpKernelInterface::class), $request, HttpKernelInterface::MAIN_REQUEST, $response));

        return $response;
    }
}
