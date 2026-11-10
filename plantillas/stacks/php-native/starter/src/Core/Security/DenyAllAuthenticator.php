<?php

declare(strict_types=1);

namespace App\Core\Security;

use App\Core\Http\Request;

/** Secure by default: until the Auth module exists, every private route answers 401. */
final class DenyAllAuthenticator implements Authenticator
{
    public function authenticate(Request $request): ?Identity
    {
        return null;
    }
}
