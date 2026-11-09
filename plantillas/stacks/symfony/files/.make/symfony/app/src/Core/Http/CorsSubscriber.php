<?php

declare(strict_types=1);

namespace App\Core\Http;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * CORS without a bundle: only an origin listed in CORS_ORIGINS (comma separated) gets Access-Control-Allow-Origin,
 * and only its preflight (OPTIONS with Access-Control-Request-Method) is answered here with 204, before routing and
 * the firewall (a preflight never carries the token). An empty list means no cross-origin access.
 */
final class CorsSubscriber implements EventSubscriberInterface
{
    private const string METHODS = 'GET, POST, PUT, PATCH, DELETE';

    private const string HEADERS = 'Authorization, Content-Type';

    /** @var list<string> */
    private readonly array $origins;

    public function __construct(#[Autowire('%env(CORS_ORIGINS)%')] string $origins)
    {
        $list = array_map(trim(...), explode(',', $origins));
        $this->origins = array_values(array_filter($list, static fn(string $o): bool => $o !== ''));
    }

    public static function getSubscribedEvents(): array
    {
        return [
            // Before the router (32) and the firewall (8).
            KernelEvents::REQUEST => ['onRequest', 250],
            KernelEvents::RESPONSE => ['onResponse', 0],
        ];
    }

    public function onRequest(RequestEvent $event): void
    {
        $request = $event->getRequest();
        if (!$event->isMainRequest() || !$request->isMethod('OPTIONS') || !$request->headers->has('Access-Control-Request-Method')) {
            return;
        }
        $origin = $this->allowedOrigin($request);
        if ($origin === null) {
            return;
        }
        $response = new Response(null, Response::HTTP_NO_CONTENT, [
            'Access-Control-Allow-Methods' => self::METHODS,
            'Access-Control-Allow-Headers' => self::HEADERS,
            'Access-Control-Max-Age' => '600',
        ]);
        $event->setResponse($response);
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $response = $event->getResponse();
        // The response depends on Origin: a cache must never serve one origin's answer to another.
        $response->setVary('Origin', false);
        $origin = $this->allowedOrigin($event->getRequest());
        if ($origin !== null) {
            $response->headers->set('Access-Control-Allow-Origin', $origin);
            $response->headers->set('Access-Control-Allow-Credentials', 'true');
        }
    }

    private function allowedOrigin(Request $request): ?string
    {
        $origin = $request->headers->get('Origin');

        return $origin !== null && in_array($origin, $this->origins, true) ? $origin : null;
    }
}
