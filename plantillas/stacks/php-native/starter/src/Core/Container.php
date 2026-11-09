<?php

declare(strict_types=1);

namespace App\Core;

/**
 * Minimal service container: one shared instance per class. Classes with typed constructor arguments are
 * autowired; interfaces, scalars and PDO need a factory (App\Core\Services).
 */
final class Container
{
    /** @var array<string, \Closure(self): object> */
    private array $factories = [];

    /** @var array<string, object> */
    private array $instances = [];

    /** @var array<string, true> */
    private array $resolving = [];

    /** @param \Closure(self): object $factory */
    public function set(string $id, \Closure $factory): void
    {
        $this->factories[$id] = $factory;
    }

    /** An already built service. It wins over any factory (tests use it to swap PDO or the authenticator). */
    public function instance(string $id, object $service): void
    {
        $this->instances[$id] = $service;
    }

    /**
     * @template T of object
     *
     * @param class-string<T> $id
     *
     * @return T
     */
    public function get(string $id): object
    {
        $service = $this->instances[$id]
            ?? (isset($this->factories[$id]) ? ($this->factories[$id])($this) : $this->autowire($id));
        if (!$service instanceof $id) {
            throw new \LogicException(sprintf('Service %s is a %s', $id, $service::class));
        }
        $this->instances[$id] = $service;

        return $service;
    }

    /** @param class-string $class */
    private function autowire(string $class): object
    {
        if (isset($this->resolving[$class])) {
            throw new \LogicException(sprintf('Circular dependency while building %s', $class));
        }
        $this->resolving[$class] = true;
        try {
            $reflection = new \ReflectionClass($class);
            if (!$reflection->isInstantiable()) {
                throw new \LogicException(sprintf('Cannot autowire %s: register a factory in App\Core\Services', $class));
            }
            $arguments = [];
            foreach ($reflection->getConstructor()?->getParameters() ?? [] as $parameter) {
                $type = $parameter->getType();
                if ($type instanceof \ReflectionNamedType && !$type->isBuiltin()) {
                    /** @var class-string $dependency */
                    $dependency = $type->getName();
                    $arguments[] = $this->get($dependency);
                } elseif ($parameter->isDefaultValueAvailable()) {
                    $arguments[] = $parameter->getDefaultValue();
                } else {
                    throw new \LogicException(sprintf(
                        'Cannot autowire $%s of %s: register a factory in App\Core\Services',
                        $parameter->getName(),
                        $class,
                    ));
                }
            }

            return $reflection->newInstanceArgs($arguments);
        } finally {
            unset($this->resolving[$class]);
        }
    }
}
