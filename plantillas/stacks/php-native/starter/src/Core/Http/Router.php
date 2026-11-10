<?php

declare(strict_types=1);

namespace App\Core\Http;

/**
 * Method + path router. `{name}` matches one path segment. Routes are private by default: only a route
 * added with `public: true` is reachable without authentication.
 */
final class Router
{
    /** @var list<Route> */
    private array $routes = [];

    /** @param class-string|\Closure(Request): Response $handler */
    public function get(string $path, string|\Closure $handler, bool $public = false): void
    {
        $this->add('GET', $path, $handler, $public);
    }

    /** @param class-string|\Closure(Request): Response $handler */
    public function post(string $path, string|\Closure $handler, bool $public = false): void
    {
        $this->add('POST', $path, $handler, $public);
    }

    /** @param class-string|\Closure(Request): Response $handler */
    public function put(string $path, string|\Closure $handler, bool $public = false): void
    {
        $this->add('PUT', $path, $handler, $public);
    }

    /** @param class-string|\Closure(Request): Response $handler */
    public function patch(string $path, string|\Closure $handler, bool $public = false): void
    {
        $this->add('PATCH', $path, $handler, $public);
    }

    /** @param class-string|\Closure(Request): Response $handler */
    public function delete(string $path, string|\Closure $handler, bool $public = false): void
    {
        $this->add('DELETE', $path, $handler, $public);
    }

    /** @param class-string|\Closure(Request): Response $handler */
    public function add(string $method, string $path, string|\Closure $handler, bool $public = false): void
    {
        if (preg_match('#^/[A-Za-z0-9_./{}-]*$#', $path) !== 1) {
            throw new \InvalidArgumentException(sprintf('Invalid route path: %s', $path));
        }
        $params = [];
        $segments = [];
        foreach (explode('/', $path) as $segment) {
            if (preg_match('/^\{([a-z][A-Za-z0-9_]*)\}$/', $segment, $m) === 1) {
                $params[] = $m[1];
                $segments[] = '([^/]+)';
            } else {
                $segments[] = preg_quote($segment, '#');
            }
        }
        foreach ($this->routes as $route) {
            if ($route->method === strtoupper($method) && $route->path === $path) {
                throw new \LogicException(sprintf('Duplicate route: %s %s', $method, $path));
            }
        }
        $this->routes[] = new Route(strtoupper($method), $path, '#^' . implode('/', $segments) . '$#', $params, $handler, $public);
    }

    /**
     * The route for this request and its parameters; 404 or 405 (with Allow) when there is none.
     *
     * @return array{Route, array<string, string>}
     */
    public function match(string $method, string $path): array
    {
        $allowed = [];
        foreach ($this->routes as $route) {
            if (preg_match($route->regex, $path, $m) !== 1) {
                continue;
            }
            if ($route->method !== $method && !($method === 'HEAD' && $route->method === 'GET')) {
                $allowed[] = $route->method;
                continue;
            }
            $values = array_map(rawurldecode(...), array_slice($m, 1));

            return [$route, array_combine($route->params, $values)];
        }
        if ($allowed !== []) {
            throw new HttpException(405, 'Method Not Allowed', headers: ['allow' => implode(', ', array_unique($allowed))]);
        }

        throw HttpException::notFound();
    }

    /** @return list<Route> */
    public function routes(): array
    {
        return $this->routes;
    }
}
