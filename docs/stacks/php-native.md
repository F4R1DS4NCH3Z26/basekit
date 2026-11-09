# Stack: PHP · Nativo (PDO, sin framework) · v1

Plantillas: `plantillas/stacks/php-native/`. Tipo: `backend`. Auth por defecto: **tokens bearer opacos** guardados como sha256. Puerto: 8000. Healthcheck: `/health`. Detección: ninguna (`detect: {}`): un proyecto PHP sin framework no se distingue de forma fiable, así que se elige con la pregunta de `init` o con `--stack php-native`. Laravel (`artisan`) y Symfony (`symfony.lock`) se siguen detectando igual.

API REST en PHP moderno sin framework web: front controller, router, contenedor y migrador propios en `src/Core/` (cubiertos por `tests/Core/`), autoload PSR-4 de Composer y PDO. Sin dependencias de runtime: Composer solo trae las herramientas de desarrollo (PHPUnit, PHPStan y PHP-CS-Fixer).

## Decisiones

| Tema | Elección | Por qué |
|---|---|---|
| PHP | 8.5 (`dunglas/frankenphp:1.13.2-php8.5-alpine`) | La versión estable más nueva con más de 14 días; la imagen 1.13.2 es del 23 de octubre de 2026 |
| Servidor | FrankenPHP `php-server` | Un solo proceso (Caddy + PHP) sin root y con `read_only`; php-fpm + nginx serían dos procesos y `php -S` no es para producción. Es la misma imagen base que el stack `symfony` |
| Migraciones | Runner propio (`src/Core/Database/Migrator.php`, `bin/migrate.php`) | SQL plano por módulo que el agente lee y escribe, variantes por motor y cero dependencias de runtime; phinx agregaría una decena de paquetes (consola de Symfony, cakephp/database) a un stack sin framework |
| Composer | `composer:2.10.2`, `config.platform.php` 8.5.0 | El lock se resuelve para el PHP de la imagen |
| Herramientas | PHPUnit 13.4.3, PHPStan 2.3.2 (nivel 6), PHP-CS-Fixer 3.95.27 (`@PER-CS`) | Versiones exactas con más de 14 días |

## Arquitectura

```text
composer.json  composer.lock                 # orquestador ("App\\": "src/")
public/index.php                             # orquestador: front controller
bin/migrate.php                              # orquestador: up | status | new <nombre> [Modulo]
migrations/                                  # orquestador: migraciones globales
src/Core/                                    # orquestador
├── Kernel.php        Services.php  Container.php  Env.php  Uuid.php
├── Http/{Router, Route, Request, Response, Input, HttpException, HealthController}.php
├── Database/{Database, DatabaseConfig, Migrator, SqlSplitter, NoDatabaseConfigured}.php
└── Security/{Authenticator, DenyAllAuthenticator, Identity}.php
src/Modules/<M>/
├── Migrations/*.sql                                  # data-writer
├── Domain/{Entity,Repository,Enum}/                  # data-writer
├── Application/{DTO,Handler,Security}/               # app-writer (Security = Policies)
└── Http/{routes.php, Controller/, Input/, Resource/} # http-writer
tests/Modules/<M>/                                    # qa-writer
tests/bootstrap.php  tests/Core/  tests/Support/      # orquestador
```

- **Sin registro manual**: el Kernel carga cada `src/Modules/*/Http/routes.php` (devuelve `static function (Router $r): void`), el `Container` construye repositorios, handlers y controladores por el tipo de los argumentos de su constructor, y el migrador lee `src/Modules/*/Migrations/`. Lo que no se puede autowirear (PDO, interfaces, escalares) va en `src/Core/Services.php`.
- **Seguro por omisión**: toda ruta exige autenticación salvo `public: true`. Hasta que exista el módulo `Auth`, el autenticador es `DenyAllAuthenticator` (401).
- **Errores**: `HttpException` → JSON `{"error": …}` con su código (422 agrega `errors` por campo; 405 agrega `Allow`; 401 agrega `WWW-Authenticate: Bearer`). Cualquier otra excepción → 500 sin detalles (van a `error_log`, salvo con `APP_DEBUG=1`). Cuerpos de más de 1 MiB → 413.
- **CORS** (`src/Core/Http/Cors.php`, que `Kernel::handle` aplica a cada petición del front controller): solo los orígenes de `CORS_ORIGINS` (separados por coma) reciben `Access-Control-Allow-Origin`, y su preflight (`OPTIONS` con `Access-Control-Request-Method`) se responde con 204 antes de enrutar y autenticar. Vacía, el valor por defecto: ningún origen externo. Un proyecto combinado la llena con el origen del frontend. Test: `tests/Core/CorsTest.php`.
- **PDO perezoso**: la conexión se crea cuando un servicio la pide; `/health` nunca toca la BD.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `composer.*`, `bin/**`, `public/**`, `migrations/**`, `src/Core/**`, configs de herramientas, `tests/bootstrap.php`, `tests/Core/**`, `tests/Support/**` |
| data-writer | `src/Modules/*/Domain/**`, `src/Modules/*/Migrations/**` |
| app-writer | `src/Modules/*/Application/**` |
| http-writer | `src/Modules/*/Http/**` |
| qa-writer | `tests/Modules/**` |

Skills: `phpnative-scaffold`, `phpnative-verify` (la usa `make verify`: `php -l`, PHP-CS-Fixer, PHPStan, arranque del Kernel y PHPUnit), `phpnative-patterns` (+ `references/auth.md`).

## Docker (FrankenPHP)

| Target | Uso |
|---|---|
| `base` | `dunglas/frankenphp:1.13.2-php8.5-alpine` + extensiones (pdo_pgsql, pdo_mysql, pdo_sqlite, opcache, redis) + composer 2.10.2 |
| `dev` | `php.ini-development`, `frankenphp php-server --listen :8000 --root public/` |
| `vendor` → `prod` | `composer install --no-dev`, autoload con classmap autoritativo, `opcache.validate_timestamps=0`, sin `tests/`, usuario `app` (1001) |

- **Prod con `read_only`** (`app` y `migrate`), `/tmp` en tmpfs y `cap_drop: [ALL]`. Caddy guarda su estado en `XDG_CONFIG_HOME`/`XDG_DATA_HOME` bajo `/tmp`. `setcap -r` quita la capacidad de archivo del binario de FrankenPHP, que con `cap_drop: [ALL]` impediría ejecutarlo. `/app/data` (volumen de SQLite) pertenece al usuario `app`.
- **El entorno lo fija compose**: `APP_ENV`/`APP_DEBUG` (`dev`/`1` y `prod`/`0`). No hay `.env` dentro de la app: `App\Core\Env` lee las variables del proceso (y nunca las cabeceras `HTTP_*`).
- **`vendor` en dev** va en un volumen con nombre; `make install` ejecuta `composer install` sobre él.

### Base de datos (overlays de `infra-setup`)

`App\Core\Database\DatabaseConfig::fromEnv()` arma el DSN de PDO:

| Variables | DSN |
|---|---|
| `DB_DRIVER=postgres`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | `pgsql:host=db;port=5432;dbname=app` |
| `DB_DRIVER=mysql`, igual que arriba | `mysql:host=db;port=3306;dbname=app;charset=utf8mb4` |
| `DB_DRIVER=sqlite`, `DB_DATABASE=/app/data/app.db` | `sqlite:/app/data/app.db` (con `foreign_keys`, `busy_timeout` y WAL) |
| Sin `DB_DRIVER`: `DATABASE_URL` (`postgresql://…`, `mysql://…`, `file:/app/data/app.db`) | lo mismo |

Host, puerto y nombre de la base se validan (un `;` agregaría opciones al DSN). En MySQL y PostgreSQL los prepared statements son del servidor (`ATTR_EMULATE_PREPARES=false`). Sin overlay (`--db none`), `make migrate` dice que no hay base y termina con 0.

### Migraciones

- Archivos `<YYYYMMDDHHMMSS>_<nombre>.sql` en `migrations/` (globales: `make migration NAME=x`) y en `src/Modules/<M>/Migrations/` (`make module-migration M=<M> NAME=x`). La versión es el nombre sin extensión y se aplica una sola vez, en orden de versión entre todas las carpetas.
- SQL portable por defecto; `<versión>.pgsql.sql`, `.mysql.sql` o `.sqlite.sql` reemplaza al portable en ese motor. Una versión sin archivo para el motor actual es un error.
- Cada migración corre en una transacción en PostgreSQL y SQLite (si falla, no queda nada); MySQL confirma cada DDL por su cuenta y el error lo advierte. Un candado (`pg_advisory_lock` / `GET_LOCK`) evita que dos despliegues migren a la vez.
- Una migración vacía (solo comentarios) falla a propósito: el archivo recién creado no se marca como aplicado por accidente.

### Redis

El overlay inyecta `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` y `REDIS_URL`. La imagen trae la extensión `redis`: registra en `src/Core/Services.php` un `\Redis` conectado con esas variables y pídelo por constructor.

### `make new-app` (si no hay `composer.lock`)

`init` deja el esqueleto completo (`starter/`): `composer.json`, `public/`, `bin/`, `src/Core/`, tests y configs. `make new-app` solo ejecuta `composer update --no-install` dentro de `composer:2.10.2` con tu uid para crear `composer.lock`, y agrega `/vendor/`, `/data/` y las cachés de herramientas a `.gitignore`. Con `composer.lock` presente no hace nada (ni llama a Docker). `make deps-add PKGS="vendor/paquete:1.2.3" [DEV=1]` agrega dependencias con versión exacta. Si las descargas fallan por límite de peticiones, exporta `COMPOSER_AUTH`; se pasa al contenedor por nombre.

## Auth: tokens opacos (detalle en `phpnative-patterns/references/auth.md`)

1. Módulo `Auth`: tablas `users`, `access_tokens` (sha256 del token, `expires_at`) y `login_attempts`.
2. `IssueAccessToken`: límite de intentos por email y por IP, hash de relleno si el email no existe y mensaje genérico.
3. `TokenAuthenticator` lee `Authorization: Bearer <token>`; el orquestador lo registra en `src/Core/Services.php` en lugar de `DenyAllAuthenticator`.
4. Logout: borra el token actual o todos los del usuario.

## Comandos

```bash
make new-app                # composer.lock
make env && make dev        # http://localhost:8000/health
make migrate
make test
make verify SCOPE=src/Modules/<M>
make module-migration M=Products NAME=create_products
make sh                     # y dentro: php bin/migrate.php status
```

## Seguridad específica

- **Tipado**: `declare(strict_types=1)` en todo; PHPStan nivel 6.
- **SQL**: `prepare()` con parámetros; columnas de `ORDER BY` desde una lista cerrada.
- **Entrada**: `App\Core\Http\Input` valida tipos, longitudes y rangos y responde 422 con todos los errores; los campos que asigna el servidor no se leen del cuerpo.
- **Autorización**: Policies del módulo; un recurso ajeno o un id inválido responde 404.
- **Salida**: Resources con campos explícitos; nunca la fila completa. Cabeceras `X-Content-Type-Options: nosniff` y `Cache-Control: no-store` por defecto.
- **Comandos prohibidos a los agentes**: `DROP`/`TRUNCATE` contra datos reales y editar migraciones ya aplicadas. Como corren dentro de Docker, los permisos de la herramienta no los ven: la regla está en la sección del stack de `AGENTS.md`.

## Errores comunes

- Un archivo `routes.php` que no devuelve un `Closure` (el Kernel no arranca; `make verify` lo detecta en `boot`).
- Migraciones que solo funcionan en PostgreSQL sin variante `.sqlite.sql`: los tests (SQLite en memoria) fallan.
- Escapar comillas con `\'` en SQL (usa `''`).
- Dinero en `float`.
- Leer `$_GET`/`$_POST` directamente en lugar de `Request`.
