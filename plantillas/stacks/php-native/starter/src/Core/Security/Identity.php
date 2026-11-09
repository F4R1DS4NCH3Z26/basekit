<?php

declare(strict_types=1);

namespace App\Core\Security;

/** Who is calling: set by the Authenticator on every route that is not public. */
final readonly class Identity
{
    public function __construct(
        public string $userId,
        public string $role = 'member',
    ) {}
}
