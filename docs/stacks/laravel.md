# Stack: PHP · Laravel (monolito modular) · v3

Plantillas: `plantillas/stacks/laravel/`. Auth por defecto: **Sanctum** (+ Fortify para los flujos de cuenta). Puerto: 8000. Healthcheck: `/up` (incluido en Laravel 11+).

## Arquitectura

```text
composer.json                      # "App\\Modules\\": "src/Modules/" (lo agrega make new-app)
bootstrap/  config/  routes/        # orquestador
src/Modules/<M>/
├── Domain/Models/  Database/{Migrations,Factories}/        # data-writer
├── Application/{Actions,DTOs,Policies}/                    # app-writer
├── Http/{Controllers,Requests,Resources}/  routes.php      # http-writer
└── Providers/<M>ServiceProvider.php                        # orquestador (lo genera php-scaffold)
tests/Modules/<M>/                                          # qa-writer
```

- Las migraciones viven en el módulo y las carga el provider con `loadMigrationsFrom`.
- Las Policies se registran en el provider.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `composer.*`, `config/**`, `bootstrap/**`, `routes/**`, `app/Providers/**`, `src/Modules/*/Providers/**`, configs de herramientas, `tests/Pest.php` |
| data-writer | `src/Modules/*/Domain/**`, `src/Modules/*/Database/**` |
| app-writer | `src/Modules/*/Application/**` |
| http-writer | `src/Modules/*/Http/**` |
| qa-writer | `tests/Modules/**` |

Skills: `php-scaffold`, `php-verify` (la usa `make verify`), `php-patterns` (+ `references/auth.md` y la tabla de equivalencias con Symfony).

## Docker (FrankenPHP)

| Target | Uso |
|---|---|
| `base` | `dunglas/frankenphp:1-php8.3-alpine` + extensiones (pdo_pgsql, pdo_mysql, pdo_sqlite, intl, zip, opcache, bcmath, pcntl, redis) + composer |
| `dev` | `php.ini-development`, `frankenphp php-server --listen :8000 --root public/` |
| `vendor` → `prod` | `composer install --no-dev`, autoload con classmap autoritativo, usuario `app` (1001). Al arrancar ejecuta `php artisan optimize` |

- **Por qué `php-server`**: no depende de la ruta del Caddyfile, que cambió entre versiones de FrankenPHP.
- **`optimize`**: en prod es correcto (cachea con el entorno real del contenedor). Nunca se usa como "verificación".
- **`vendor` en dev** va en un volumen con nombre; `make install` ejecuta `composer install` sobre él.
- **El entorno lo fija compose** (`APP_ENV` y `APP_DEBUG`; en prod, `SESSION_SECURE_COOKIE=true`). Así `.env.prod` nunca hereda el modo debug.
- **`APP_KEY=base64:__GENERATE_B64__`**: `make env` lo convierte en una clave válida de 32 bytes.
- **Sin BD ni Redis**, sesión y caché usan `file` y las colas `sync`. Tras `infra-setup` se cambian a `database` o `redis`.

`make new-app` (si no hay `composer.json`):
1. `composer create-project laravel/laravel:^12.0 --no-scripts` dentro de `composer:2`, con tu uid.
2. Copia el resultado sin pisar el kit; descarta el `.env.example` de Laravel y conserva el del kit.
3. Agrega el autoload `App\Modules\` con `.make/laravel-autoload.php` y ejecuta `dump-autoload`.

Composer descarga los paquetes desde la API de GitHub. Si las descargas fallan con `504` o por límite de peticiones, exporta un token antes de ejecutar `make new-app`: `export COMPOSER_AUTH='{"github-oauth":{"github.com":"<token>"}}'`. `make new-app` lo pasa al contenedor por nombre, así que el token no queda en la línea de comandos.

## MongoDB (mongodb/laravel-mongodb)

Con `--db mongo` (o el overlay MongoDB de infra-setup), `make new-app` crea la app como siempre y después ejecuta `php-scaffold/scripts/mongo-setup.sh`. Con otra BD, ese paso no se ejecuta y la app queda igual que antes.

| Pieza | Qué deja |
|---|---|
| `Dockerfile` | La extensión PECL `mongodb-2.5.5` en la línea `install-php-extensions`. La imagen SQL no cambia: la extensión solo se agrega en proyectos MongoDB. |
| `composer.json` | `mongodb/laravel-mongodb` 5.12.0 y `mongodb/mongodb` 2.5.0 exactos, y `config.platform.ext-mongodb` (la imagen `composer:2` que resuelve el lock no tiene la extensión) |
| `config/database.php` | La conexión `mongodb` con `dsn` = `MONGO_URL` (el usuario de la app, con permisos solo sobre `DB_NAME`). El overlay pone `DB_CONNECTION=mongodb`, así que es la conexión por defecto. |
| `stubs/migration*.stub` | `make migration` genera migraciones que solo crean índices (`Schema::table` + `index`), y `down()` quita solo esos índices |

- El script es idempotente y nunca pisa un archivo cambiado: si el `Dockerfile` no tiene la línea del kit, `config/database.php` no tiene `'connections' => [` o un stub ya existe con otro contenido, se detiene sin cambiar nada y dice qué agregar a mano. Si falla, `make new-app` termina con error y dice cómo reintentarlo. Para pasar a MongoDB una app ya creada, activa la BD con infra-setup y ejecuta el script.
- **Migraciones**: siguen existiendo. `make migrate` (también en prod, con el usuario `app`) corre `php artisan migrate --force`. Las migraciones de un módulo MongoDB crean los índices de su colección y nunca borran una colección. Quitar un índice de una migración ya aplicada no lo borra: hace falta una migración nueva con `dropIndex`, o hacerlo a mano con `make db-shell` y `db.<colección>.dropIndex('<nombre>')`. Las migraciones de Laravel (users, cache, jobs) también corren sobre MongoDB: crean sus colecciones y el índice único de `email`.
- **php-scaffold** genera `Domain/Models/<M>.php`, un modelo de `MongoDB\Laravel\Eloquent\Model` con `HasUuids` (`_id` UUID en texto), `$connection = 'mongodb'` y `$table` = la colección. El contrato trae la colección en vez de la tabla.
- **Tests**: `make test` corre contra el MongoDB de `make dev`. `RefreshDatabase`, `DatabaseMigrations` y `DatabaseTruncation` fallan porque borran la base de datos y el usuario de la app no tiene permiso. Cada test vacía sus colecciones en `setUp()` con `<Modelo>::truncate()`, que borra los documentos y conserva los índices.

## Auth: Sanctum (detalle en `php-patterns/references/auth.md`)

1. Instalación, dentro de `make sh`: `php artisan install:api` (Sanctum, `routes/api.php` y la tabla de tokens), y opcionalmente `composer require laravel/fortify`. Después, `make migrate`.
2. Elige el modo con una ADR:
   - **SPA en el mismo dominio raíz**: cookie de sesión. Requiere `statefulApi()`, `SANCTUM_STATEFUL_DOMAINS` y CSRF por `/sanctum/csrf-cookie`.
   - **Móvil o terceros**: `createToken($device, ['*'], now()->addDays(30))`.
3. `RateLimiter::for('login', …)` (5 intentos por minuto por email + IP), y la ruta con `throttle:login`.
4. Login con mensaje genérico (`__('auth.failed')`) y `session()->regenerate()`.
5. Logout: invalida la sesión o borra el token actual.
6. CORS: `supports_credentials` con orígenes explícitos. En `sanctum.php`, `expiration` fijado.

## Comandos

```bash
make dev
make test
make verify SCOPE=src/Modules/<M>
make migrate
make sh          # y dentro: php artisan …
make migration NAME=x
```

## Seguridad específica

- **Tipado**: `declare(strict_types=1)` en todo.
- **Mass assignment**: `$fillable` explícito, nunca `$guarded = []`.
- **Autorización**: `authorize()` vía Policy; un recurso ajeno responde 404 con `whereBelongsTo`.
- **SQL**: sin `whereRaw` ni `DB::raw` con interpolación.
- **Blade**: sin `{!! !!}`.
- **Uploads**: validados con `mimes` y `max`, guardados fuera de `public/`.
- **`env()`**: solo dentro de `config/`.
- **Comandos prohibidos a los agentes**: `migrate:fresh`, `db:wipe` y `tinker` contra datos reales. Como se ejecutan dentro de Docker, los permisos de la herramienta no los ven: la regla está en la sección del stack de `AGENTS.md`.

## Errores comunes

- Fat controllers.
- `authorize(): return true`.
- Resources con `parent::toArray()`.
- Dinero en `float`.
- Olvidar registrar el provider del módulo en `bootstrap/providers.php`.
