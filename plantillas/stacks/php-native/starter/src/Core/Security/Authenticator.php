<?php

declare(strict_types=1);

namespace App\Core\Security;

use App\Core\Http\Request;

/** Resolves the caller of a private route. Null means 401. The Auth module provides the real one. */
interface Authenticator
{
    public function authenticate(Request $request): ?Identity;
}
