<?php

declare(strict_types=1);

namespace App\Core\Http;

/**
 * Reads and validates the fields of a JSON body. Every getter records its error and returns null;
 * validate() then throws one 422 with all of them. Fields the input never reads are ignored.
 */
final class Input
{
    /** @var array<string, list<string>> */
    private array $errors = [];

    /** @param array<string, mixed> $data */
    public function __construct(private readonly array $data) {}

    public static function from(Request $request): self
    {
        return new self($request->json());
    }

    public function string(string $field, int $max, int $min = 1, bool $required = true): ?string
    {
        $value = $this->data[$field] ?? null;
        if ($value === null) {
            return $this->missing($field, $required);
        }
        if (!is_string($value)) {
            return $this->fail($field, 'must be a string');
        }
        $value = trim($value);
        $length = mb_strlen($value);
        if ($length < $min || $length > $max) {
            return $this->fail($field, sprintf('must have between %d and %d characters', $min, $max));
        }

        return $value;
    }

    public function email(string $field, bool $required = true): ?string
    {
        $value = $this->string($field, 180, 3, $required);
        if ($value !== null && filter_var($value, FILTER_VALIDATE_EMAIL) === false) {
            return $this->fail($field, 'must be a valid email');
        }

        return $value === null ? null : mb_strtolower($value);
    }

    public function int(string $field, int $min = PHP_INT_MIN, int $max = PHP_INT_MAX, bool $required = true): ?int
    {
        $value = $this->data[$field] ?? null;
        if ($value === null) {
            return $this->missing($field, $required);
        }
        if (!is_int($value)) {
            return $this->fail($field, 'must be an integer');
        }
        if ($value < $min || $value > $max) {
            return $this->fail($field, sprintf('must be between %d and %d', $min, $max));
        }

        return $value;
    }

    public function bool(string $field, bool $required = true): ?bool
    {
        $value = $this->data[$field] ?? null;
        if ($value === null) {
            return $this->missing($field, $required);
        }
        if (!is_bool($value)) {
            return $this->fail($field, 'must be a boolean');
        }

        return $value;
    }

    /**
     * One of the allowed values (for enums: array_column(Status::cases(), 'value')).
     *
     * @param list<string> $allowed
     */
    public function oneOf(string $field, array $allowed, bool $required = true): ?string
    {
        $value = $this->data[$field] ?? null;
        if ($value === null) {
            return $this->missing($field, $required);
        }
        if (!is_string($value) || !in_array($value, $allowed, true)) {
            return $this->fail($field, sprintf('must be one of: %s', implode(', ', $allowed)));
        }

        return $value;
    }

    /** Throws 422 with every recorded error. Call it before using the values. */
    public function validate(): void
    {
        if ($this->errors !== []) {
            throw HttpException::validation($this->errors);
        }
    }

    private function missing(string $field, bool $required): null
    {
        if ($required) {
            $this->errors[$field][] = 'is required';
        }

        return null;
    }

    private function fail(string $field, string $message): null
    {
        $this->errors[$field][] = $message;

        return null;
    }
}
