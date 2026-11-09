<?php

declare(strict_types=1);

namespace App\Core;

/**
 * The environment that compose injects (env_file + infra-setup overlays). There is no .env inside the app:
 * .env.example is the only source of variables, and APP_ENV/APP_DEBUG are set by compose.
 */
final class Env
{
    /** @param array<string, string> $values */
    public function __construct(private readonly array $values) {}

    public static function fromGlobals(): self
    {
        $values = [];
        foreach ([getenv(), $_ENV, $_SERVER] as $source) {
            foreach ($source as $key => $value) {
                // $_SERVER also holds request headers (HTTP_*): a client must never be able to set a variable.
                if (!is_string($key) || !is_string($value) || str_starts_with($key, 'HTTP_') || isset($values[$key])) {
                    continue;
                }
                $values[$key] = $value;
            }
        }

        return new self($values);
    }

    /** The value, or $default when the variable is missing or empty. */
    public function get(string $key, ?string $default = null): ?string
    {
        $value = $this->values[$key] ?? '';

        return $value === '' ? $default : $value;
    }

    public function bool(string $key): bool
    {
        return in_array(strtolower((string) $this->get($key)), ['1', 'true', 'yes', 'on'], true);
    }
}
