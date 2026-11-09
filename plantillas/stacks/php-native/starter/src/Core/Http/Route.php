<?php

declare(strict_types=1);

namespace App\Core\Http;

final readonly class Route
{
    /**
     * @param list<string>                            $params
     * @param class-string|\Closure(Request): Response $handler
     */
    public function __construct(
        public string $method,
        public string $path,
        public string $regex,
        public array $params,
        public string|\Closure $handler,
        public bool $public,
    ) {}
}
