<?php

declare(strict_types=1);

namespace App\Core\Http;

/** An error the client may see: the Kernel turns it into a JSON response with this status. */
final class HttpException extends \RuntimeException
{
    /**
     * @param array<string, list<string>> $errors  field => messages (422)
     * @param array<string, string>       $headers extra response headers (Allow, WWW-Authenticate)
     */
    public function __construct(
        public readonly int $status,
        string $message,
        public readonly array $errors = [],
        public readonly array $headers = [],
    ) {
        parent::__construct($message);
    }

    /** @param array<string, list<string>> $errors */
    public static function validation(array $errors): self
    {
        return new self(422, 'Unprocessable Entity', $errors);
    }

    public static function notFound(): self
    {
        return new self(404, 'Not Found');
    }

    public static function forbidden(): self
    {
        return new self(403, 'Forbidden');
    }
}
