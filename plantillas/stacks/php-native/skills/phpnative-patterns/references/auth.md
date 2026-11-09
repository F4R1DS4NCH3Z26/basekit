# Auth en PHP nativo: tokens opacos (bearer) guardados como hash

Requiere base de datos: usuarios y tokens. Hasta que exista este módulo, `App\Core\Services` registra `DenyAllAuthenticator` y toda ruta que no sea `public: true` responde 401.

Por qué tokens opacos y no JWT: el servidor guarda solo el sha256 del token, así que revocar es borrar una fila y un token robado de la BD no sirve. Sin librerías: `random_bytes`, `hash('sha256')`, `password_hash` y `hash_equals` vienen con PHP. Si de verdad necesitas JWT (varios servicios validan sin BD), escribe una ADR y agrega `firebase/php-jwt` con `make deps-add`.

## Módulo `src/Modules/Auth/` (con `phpnative-scaffold Auth`, delegado por roles)

### Migrations + Domain (data-writer)

```sql
-- Migrations/20260101000000_create_auth.sql (versión anterior a cualquier tabla que apunte a users)
CREATE TABLE users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(180) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(30) NOT NULL,
    created_at TIMESTAMP NOT NULL
);
CREATE TABLE access_tokens (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,   -- sha256 del token; el token en claro nunca se guarda
    user_id CHAR(36) NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL
);
CREATE INDEX access_tokens_user_id ON access_tokens (user_id);
CREATE TABLE login_attempts (
    id CHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(180) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    attempted_at TIMESTAMP NOT NULL
);
CREATE INDEX login_attempts_email ON login_attempts (email, attempted_at);
CREATE INDEX login_attempts_ip ON login_attempts (ip, attempted_at);
```

- `User` (entidad con `fromRow`): `email` en minúsculas, `passwordHash`, `role` sin setter público (lo cambia un caso de uso de admin).
- `UserRepository::findByEmail()`, `AccessTokenRepository::{insert, findValid(string $hash, string $now), delete, deleteForUser}`, `LoginAttemptRepository::{record, countByEmailSince, countByIpSince}` (borra los intentos de más de un día al registrar uno nuevo).

### Application (app-writer)

```php
// Application/Handler/IssueAccessToken.php
final class IssueAccessToken
{
    private const int TTL_SECONDS = 3600 * 12;
    private const int MAX_ATTEMPTS = 5;           // por email y por IP en 15 minutos

    public function __construct(
        private readonly UserRepository $users,
        private readonly AccessTokenRepository $tokens,
        private readonly LoginAttemptRepository $attempts,
    ) {}

    /** El token en claro, o null con un mensaje genérico (nunca dice si el email existe). */
    public function handle(LoginData $data, string $ip): ?string
    {
        $since = gmdate('Y-m-d H:i:s', time() - 900);
        if ($this->attempts->countByEmailSince($data->email, $since) >= self::MAX_ATTEMPTS
            || $this->attempts->countByIpSince($ip, $since) >= self::MAX_ATTEMPTS * 4) {
            throw new TooManyAttempts();
        }
        $user = $this->users->findByEmail($data->email);
        // Hash de relleno: el tiempo de respuesta no revela si el email existe.
        $hash = $user?->passwordHash ?? '$2y$12$usesomesillystringfore7hnbRJHxXVLeakoG8K30oukPsA.ztMG';
        if (!password_verify($data->password, $hash) || $user === null) {
            $this->attempts->record($data->email, $ip);
            return null;
        }
        $token = bin2hex(random_bytes(32));
        $this->tokens->insert(hash('sha256', $token), $user->id, gmdate('Y-m-d H:i:s', time() + self::TTL_SECONDS));
        return $token;
    }
}
```

- Registro (`RegisterUser`): `password_hash($password, PASSWORD_DEFAULT)`; contraseña de 12 a 128 caracteres; email único (atrapa la violación de unicidad y responde 409 con mensaje genérico).
- Al iniciar sesión, si `password_needs_rehash()` es true, guarda el hash nuevo.

### Autenticador (orquestador: `src/Core/Services.php` lo registra)

```php
// src/Modules/Auth/Application/Security/TokenAuthenticator.php (app-writer)
final class TokenAuthenticator implements Authenticator
{
    public function __construct(private readonly AccessTokenRepository $tokens) {}

    public function authenticate(Request $request): ?Identity
    {
        $token = $request->bearerToken();
        if ($token === null || strlen($token) !== 64) {
            return null;
        }
        $row = $this->tokens->findValid(hash('sha256', $token), gmdate('Y-m-d H:i:s'));   // JOIN users: user_id, role

        return $row === null ? null : new Identity($row['user_id'], $row['role']);
    }
}
```

```php
// src/Core/Services.php (orquestador): reemplaza DenyAllAuthenticator
$container->set(Authenticator::class, static fn(Container $c): Authenticator => $c->get(TokenAuthenticator::class));
```

La búsqueda es por el hash exacto (clave primaria), así que no hace falta comparar en tiempo constante; si alguna vez comparas secretos en PHP, usa `hash_equals`.

### Http (http-writer)

| Método | URI | Público | Respuesta |
|---|---|---|---|
| POST | `/api/auth/register` | sí | 201 `{id, email}` |
| POST | `/api/auth/token` | sí | 200 `{token, expires_in}` · 401 `Invalid credentials` · 429 con `Retry-After` |
| DELETE | `/api/auth/token` | no | 204 (borra el token actual) |
| DELETE | `/api/auth/tokens` | no | 204 (cierra todas las sesiones) |
| GET | `/api/auth/me` | no | 200 `{id, email, role}` |

- La IP del cliente: `$_SERVER['REMOTE_ADDR']` por defecto. Detrás de un proxy, confía en `X-Forwarded-For` solo si el orquestador fija la IP del proxy (variable `TRUSTED_PROXY`).
- CORS: si un navegador de otro origen consume la API, agrega en `src/Core/Kernel.php` (orquestador) las cabeceras `Access-Control-Allow-*` con una lista explícita de orígenes desde el entorno; nunca `*` con credenciales.

### Tests (qa-writer)

- `POST /api/auth/token` con contraseña errónea → 401 y el mismo mensaje que con un email inexistente.
- Seis intentos fallidos → 429.
- Token expirado (inserta uno con `expires_at` pasado) → 401 en `/api/auth/me`.
- `DELETE /api/auth/token` → el mismo token da 401 después.
- La tabla `access_tokens` nunca contiene el token en claro.
