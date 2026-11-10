<?php

declare(strict_types=1);

namespace App\Core\Http;

use App\Core\Security\Identity;

/** The HTTP request: built once from the PHP globals (or with create() in tests). */
final class Request
{
    /** Larger bodies are rejected with 413 before any route runs. */
    public const int MAX_BODY_BYTES = 1_048_576;

    /** @var array<string, string> */
    private array $params = [];

    private ?Identity $identity = null;

    /**
     * @param array<mixed>          $query
     * @param array<string, string> $headers names in lower case
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query = [],
        private readonly array $headers = [],
        public readonly string $body = '',
    ) {}

    public static function fromGlobals(): self
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (!is_string($key) || !is_string($value)) {
                continue;
            }
            if (str_starts_with($key, 'HTTP_')) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
            } elseif ($key === 'CONTENT_TYPE' || $key === 'CONTENT_LENGTH') {
                $headers[strtolower(str_replace('_', '-', $key))] = $value;
            }
        }
        $method = is_string($_SERVER['REQUEST_METHOD'] ?? null) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';
        $uri = is_string($_SERVER['REQUEST_URI'] ?? null) ? $_SERVER['REQUEST_URI'] : '/';
        $path = parse_url($uri, PHP_URL_PATH);
        // One byte over the limit is enough to know the body is too large (Kernel answers 413).
        $body = file_get_contents('php://input', false, null, 0, self::MAX_BODY_BYTES + 1);

        return new self($method, is_string($path) && $path !== '' ? $path : '/', $_GET, $headers, (string) $body);
    }

    /**
     * For tests: a request with an optional JSON body.
     *
     * @param array<mixed>|null     $json
     * @param array<string, string> $headers
     */
    public static function create(string $method, string $path, ?array $json = null, array $headers = []): self
    {
        $headers = array_change_key_case($headers, CASE_LOWER);
        $body = '';
        if ($json !== null) {
            $body = json_encode($json, JSON_THROW_ON_ERROR);
            $headers['content-type'] ??= 'application/json';
        }
        $query = [];
        parse_str((string) parse_url($path, PHP_URL_QUERY), $query);

        return new self(strtoupper($method), (string) parse_url($path, PHP_URL_PATH), $query, $headers, $body);
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    /** The token of an `Authorization: Bearer <token>` header, or null. */
    public function bearerToken(): ?string
    {
        $header = $this->header('authorization') ?? '';
        if (preg_match('/^Bearer\s+([A-Za-z0-9._~+\/-]+=*)$/', $header, $m) !== 1) {
            return null;
        }

        return $m[1];
    }

    public function isTooLarge(): bool
    {
        return strlen($this->body) > self::MAX_BODY_BYTES;
    }

    /**
     * The body as a JSON object. An empty body is an empty object.
     *
     * @return array<string, mixed>
     */
    public function json(): array
    {
        if (trim($this->body) === '') {
            return [];
        }
        try {
            $data = json_decode($this->body, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new HttpException(400, 'Invalid JSON body');
        }
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw new HttpException(400, 'The JSON body must be an object');
        }

        /** @var array<string, mixed> $data */
        return $data;
    }

    /** A route parameter (`/api/products/{id}` → param('id')). */
    public function param(string $name): string
    {
        return $this->params[$name] ?? throw new \LogicException(sprintf('The route has no {%s} parameter', $name));
    }

    /** @param array<string, string> $params */
    public function withParams(array $params): self
    {
        $clone = clone $this;
        $clone->params = $params;

        return $clone;
    }

    /** The authenticated user. Only routes that are not public reach a controller, so it is always there. */
    public function identity(): Identity
    {
        return $this->identity ?? throw new HttpException(401, 'Unauthorized', headers: ['www-authenticate' => 'Bearer']);
    }

    public function withIdentity(Identity $identity): self
    {
        $clone = clone $this;
        $clone->identity = $identity;

        return $clone;
    }
}
