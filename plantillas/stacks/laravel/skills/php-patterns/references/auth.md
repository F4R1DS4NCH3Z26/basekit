# Auth en Laravel con Sanctum (+ Fortify para los flujos de cuenta)

Requiere base de datos: usuarios, sesiones y `personal_access_tokens`.

Instalación (orquestador, dentro de Docker y con aprobación del usuario):

```bash
make sh
php artisan install:api              # instala Sanctum, routes/api.php y la migración de tokens
composer require laravel/fortify     # opcional: reset de contraseña, verificación de email y 2FA sin vistas
exit
make migrate
```

## Elige el modo según el cliente (ADR)

| Cliente | Modo | Clave |
|---|---|---|
| SPA en el **mismo dominio raíz** (`app.ejemplo.com` + `api.ejemplo.com`) | Cookie de sesión de Sanctum | `statefulApi()`, `SANCTUM_STATEFUL_DOMAINS`, CSRF por `/sanctum/csrf-cookie` |
| App móvil, CLI o terceros | Tokens personales | `createToken()` con expiración y *abilities* |
| Blade o Livewire | Sesión web normal | Guard `web` |

## Configuración común (orquestador)

`bootstrap/app.php`:

```php
->withMiddleware(function (Middleware $middleware): void {
    $middleware->statefulApi();   // solo si hay SPA con cookie
})
```

`config/sanctum.php`: `'expiration' => 60 * 24 * 30` (los tokens personales caducan).

`config/cors.php`: `supports_credentials => true` y `allowed_origins` explícitos (nunca `*` con credenciales).

`AppServiceProvider::boot()`:

```php
RateLimiter::for('login', fn (Request $r) =>
    Limit::perMinute(5)->by(mb_strtolower((string) $r->input('email')).'|'.$r->ip()));
```

`App\Models\User`: `use HasApiTokens;`, `$fillable = ['name', 'email', 'password']`, `casts(): ['password' => 'hashed']`.

## Módulo `src/Modules/Auth/` (con `php-scaffold Auth`, delegado por roles)

### SPA con cookie: `Http/Controllers/LoginController.php` (http-writer)

Ruta `POST /login` en el grupo `web`, con `->middleware('throttle:login')`.

```php
final class LoginController
{
    public function __invoke(LoginRequest $request): JsonResponse
    {
        $credentials = $request->validated();
        if (! Auth::attempt(['email' => mb_strtolower($credentials['email']), 'password' => $credentials['password']])) {
            throw ValidationException::withMessages(['email' => __('auth.failed')]);  // mensaje genérico
        }
        $request->session()->regenerate();   // evita la fijación de sesión

        return UserResource::make($request->user())->response();
    }
}
```

Logout: `Auth::guard('web')->logout(); $request->session()->invalidate(); $request->session()->regenerateToken();`

### Tokens (móvil): `Http/Controllers/IssueTokenController.php` (http-writer)

Ruta `POST /api/auth/token` con `throttle:login`.

```php
final class IssueTokenController
{
    public function __invoke(IssueTokenRequest $request): JsonResponse
    {
        $data = $request->validated();   // email, password, device_name (max:100)
        $user = User::query()->where('email', mb_strtolower($data['email']))->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => __('auth.failed')]);
        }
        $token = $user->createToken($data['device_name'], ['*'], now()->addDays(30));

        return response()->json(['token' => $token->plainTextToken, 'type' => 'Bearer'], 201);
    }
}
```

Revocación: `$request->user()->currentAccessToken()->delete();` (logout del dispositivo) o `$user->tokens()->delete();` (de todos).

### Rutas protegidas

`Route::middleware('auth:sanctum')` (ya lo trae el `routes.php` del scaffold). La autorización por recurso va en Policies (app-writer).

## Producción
- `SESSION_SECURE_COOKIE=true` (lo fija `compose.prod.yaml`).
- `SESSION_DOMAIN=.tu-dominio.com` si el SPA y la API son subdominios.
- `SANCTUM_STATEFUL_DOMAINS` con los dominios reales.
- `APP_URL` con https.

## Tests obligatorios (qa-writer)
- Login fallido: 422 con el mismo mensaje exista o no el email.
- Sexto intento en un minuto: 429.
- Token expirado o revocado: 401.
- Ruta protegida sin auth: 401.
- Recurso ajeno: 404.
