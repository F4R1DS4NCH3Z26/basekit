<?php

declare(strict_types=1);

namespace App\Core\Http;

/** Liveness probe used by the Docker HEALTHCHECK. It never touches the database. */
final class HealthController
{
    public function __invoke(Request $request): Response
    {
        return Response::json(['status' => 'ok']);
    }
}
