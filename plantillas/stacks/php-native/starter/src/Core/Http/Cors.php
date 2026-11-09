<?php

declare(strict_types=1);

namespace App\Core\Http;

use App\Core\Env;

/**
 * CORS by hand: only an origin listed in CORS_ORIGINS (comma separated) gets Access-Control-Allow-Origin, and
 * only its preflight (OPTIONS with Access-Control-Request-Method) is answered with 204. An empty list means no
 * cross-origin access. Kernel::handle applies it to every request that the front controller passes in.
 */
final class Cors
{
    private const string METHODS = 'GET, POST, PUT, PATCH, DELETE';

    private const string HEADERS = 'Authorization, Content-Type';

    /** @param list<string> $origins */
    public function __construct(private readonly array $origins = []) {}

    public static function fromEnv(Env $env): self
    {
        $origins = array_map(trim(...), explode(',', (string) $env->get('CORS_ORIGINS', '')));

        return new self(array_values(array_filter($origins, static fn(string $o): bool => $o !== '')));
    }

    /** The answer to an allowed preflight, or null to let the request through. */
    public function preflight(Request $request): ?Response
    {
        $origin = $this->allowedOrigin($request);
        if ($origin === null || $request->method !== 'OPTIONS' || $request->header('access-control-request-method') === null) {
            return null;
        }

        return new Response(204, '', $this->originHeaders($origin) + [
            'access-control-allow-methods' => self::METHODS,
            'access-control-allow-headers' => self::HEADERS,
            'access-control-max-age' => '600',
        ]);
    }

    /** Adds the CORS headers of an allowed origin to the response (and Vary: Origin to every response). */
    public function apply(Request $request, Response $response): Response
    {
        $origin = $this->allowedOrigin($request);
        $headers = $origin === null ? ['vary' => 'Origin'] : $this->originHeaders($origin);

        return new Response($response->status, $response->body, $response->headers + $headers);
    }

    private function allowedOrigin(Request $request): ?string
    {
        $origin = $request->header('origin');

        return $origin !== null && in_array($origin, $this->origins, true) ? $origin : null;
    }

    /** @return array<string, string> */
    private function originHeaders(string $origin): array
    {
        return [
            'access-control-allow-origin' => $origin,
            'access-control-allow-credentials' => 'true',
            // The response depends on Origin: a cache must never serve one origin's answer to another.
            'vary' => 'Origin',
        ];
    }
}
