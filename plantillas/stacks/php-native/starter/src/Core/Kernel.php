<?php

declare(strict_types=1);

namespace App\Core;

use App\Core\Http\HealthController;
use App\Core\Http\HttpException;
use App\Core\Http\Request;
use App\Core\Http\Response;
use App\Core\Http\Router;
use App\Core\Security\Authenticator;

/**
 * Turns a Request into a Response: route, authenticate (every route that is not public), call the
 * controller and map errors to JSON. Modules add routes in src/Modules/<M>/Http/routes.php.
 */
final class Kernel
{
    public function __construct(
        private readonly Container $container,
        private readonly Router $router,
        private readonly bool $debug = false,
    ) {}

    public static function boot(?Env $env = null, ?Container $container = null): self
    {
        $env ??= Env::fromGlobals();
        $container ??= new Container();
        Services::register($container, $env);

        $router = new Router();
        $router->get('/health', HealthController::class, public: true);
        foreach (glob(dirname(__DIR__) . '/Modules/*/Http/routes.php') ?: [] as $file) {
            $register = require $file;
            if (!$register instanceof \Closure) {
                throw new \LogicException(sprintf('%s must return a Closure(Router): void', $file));
            }
            $register($router);
        }

        return new self($container, $router, $env->bool('APP_DEBUG'));
    }

    public function router(): Router
    {
        return $this->router;
    }

    public function handle(Request $request): Response
    {
        try {
            if ($request->isTooLarge()) {
                throw new HttpException(413, 'Payload Too Large');
            }
            [$route, $params] = $this->router->match($request->method, $request->path);
            $request = $request->withParams($params);
            if (!$route->public) {
                $identity = $this->container->get(Authenticator::class)->authenticate($request);
                if ($identity === null) {
                    throw new HttpException(401, 'Unauthorized', headers: ['www-authenticate' => 'Bearer']);
                }
                $request = $request->withIdentity($identity);
            }
            $controller = is_string($route->handler) ? $this->container->get($route->handler) : $route->handler;
            if (!is_callable($controller)) {
                throw new \LogicException(sprintf('The controller of %s %s is not invocable', $route->method, $route->path));
            }
            $response = $controller($request);
            if (!$response instanceof Response) {
                throw new \LogicException(sprintf('The controller of %s %s must return a Response', $route->method, $route->path));
            }

            return $response;
        } catch (HttpException $e) {
            $body = ['error' => $e->getMessage()];
            if ($e->errors !== []) {
                $body['errors'] = $e->errors;
            }

            return Response::json($body, $e->status, $e->headers);
        } catch (\Throwable $e) {
            // The detail goes to the log (stderr in Docker); the client only sees it with APP_DEBUG=1.
            error_log(sprintf('%s: %s in %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
            $body = ['error' => 'Internal Server Error'];
            if ($this->debug) {
                $body['detail'] = $e::class . ': ' . $e->getMessage();
            }

            return Response::json($body, 500);
        }
    }
}
