<?php

declare(strict_types=1);

namespace App\Core\Http;

final class Response
{
    /** Sent with every response unless the response sets the same header. */
    private const array DEFAULT_HEADERS = [
        'x-content-type-options' => 'nosniff',
        'cache-control' => 'no-store',
    ];

    /** @param array<string, string> $headers names in lower case */
    public function __construct(
        public readonly int $status = 200,
        public readonly string $body = '',
        public readonly array $headers = [],
    ) {}

    /**
     * @param array<mixed>|\JsonSerializable $data
     * @param array<string, string>          $headers
     */
    public static function json(array|\JsonSerializable $data, int $status = 200, array $headers = []): self
    {
        $body = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return new self($status, $body, array_change_key_case($headers, CASE_LOWER) + ['content-type' => 'application/json']);
    }

    public static function noContent(): self
    {
        return new self(204);
    }

    /**
     * The body decoded as JSON (for tests).
     *
     * @return array<mixed>
     */
    public function decoded(): array
    {
        $data = json_decode($this->body, true, 64, JSON_THROW_ON_ERROR);

        return is_array($data) ? $data : [];
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers + self::DEFAULT_HEADERS as $name => $value) {
            header($name . ': ' . $value);
        }
        echo $this->body;
    }
}
