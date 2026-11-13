# Stack: PHP · Symfony (API REST) + Doctrine · v1

Plantillas: `plantillas/stacks/symfony/`. Auth por defecto: **access tokens opacos** de Symfony Security. Puerto: 8000. Healthcheck: `/health` (lo agrega `make new-app` en `src/Core/Http/HealthController.php`). Detección: existe `symfony.lock` (Laravel se evalúa antes y no tiene ese archivo).

## Arquitectura

```text
composer.json  symfony.lock          # orquestador ("App\\": "src/" ya cubre src/Modules)
bin/  config/  public/  migrations/  # orquestador
src/Kernel.php  src/Core/            # orquestador: /health y el procesador de DATABASE_URL
src/Modules/<M>/
├── Domain/{Entity,Repository,Enum}/                 # data-writer
├── Application/{DTO,Handler,Security}/              # app-writer (Security = Voters)
└── Http/{Controller,Request,Resource}/              # http-writer
tests/Modules/<M>/                                   # qa-writer
tests/bootstrap.php  tests/Core/                     # orquestador
```

- Sin registro manual: `config/services.yaml` registra `src/` con autowiring (excepto entidades, DTOs, Requests y Resources), `config/routes.yaml` carga los `#[Route]` de `src/Core/Http/` y `src/Modules/`, y Doctrine mapea las entidades de `src/Modules/`.
- Las migraciones las genera el orquestador con `make migration NAME=x` (Doctrine diff sobre las entidades) en `migrations/`. Doctrine nombra la clase `VersionYYYYMMDDHHMMSS`: `NAME` solo se valida.
- `/api/**` exige autenticación desde el primer día (`config/packages/security.yaml`, 401 hasta configurar el autenticador). `/health` es público.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `composer.*`, `symfony.lock`, `bin/**`, `config/**`, `public/**`, `migrations/**`, `src/Kernel.php`, `src/Core/**`, configs de herramientas, `tests/bootstrap.php`, `tests/Core/**` |
| data-writer | `src/Modules/*/Domain/**` |
| app-writer | `src/Modules/*/Application/**` |
| http-writer | `src/Modules/*/Http/**` |
| qa-writer | `tests/Modules/**` |

Skills: `symfony-scaffold`, `symfony-verify` (la usa `make verify`: `php -l`, PHP-CS-Fixer, PHPStan, `lint:container`, PHPUnit), `symfony-patterns` (+ `references/auth.md`).

## Docker (FrankenPHP)

| Target | Uso |
|---|---|
| `base` | `dunglas/frankenphp:1-php8.3-alpine` + extensiones (pdo_pgsql, pdo_mysql, pdo_sqlite, intl, zip, opcache, redis) + composer |
| `dev` | `php.ini-development`, `frankenphp php-server --listen :8000 --root public/` |
| `vendor` → `prod` | `composer install --no-dev`, autoload con classmap autoritativo, usuario `app` (1001). Al arrancar ejecuta `cache:warmup` |

- **Sin `.env` dentro de la app**: `composer.json` lleva `extra.runtime.disable_dotenv: true`. Las variables llegan de compose (`env_file` + overlays) y `.env.example` es la única fuente. `make new-app` borra los `.env*` del esqueleto y agrega a `.env.example` las variables que los recipes ponían ahí (por ejemplo `DEFAULT_URI`).
- **El entorno lo fija compose**: `APP_ENV`/`APP_DEBUG` (`dev`/`1` y `prod`/`0`).
- **Prod con `read_only`**: el sistema de archivos es de solo lectura y `/tmp` es tmpfs. La imagen fija `APP_CACHE_DIR=/tmp/symfony/cache` y `APP_LOG_DIR=/tmp/symfony/log`, y `cache:warmup` compila el contenedor al arrancar con el entorno real. `/app/data` (volumen de SQLite) pertenece al usuario `app`.
- **`vendor` en dev** va en un volumen con nombre; `make install` ejecuta `composer install` sobre él.
- **CORS sin bundle** (`src/Core/Http/CorsSubscriber.php`, del kit en `.make/symfony/app`): solo los orígenes de `CORS_ORIGINS` (separados por coma; `env(CORS_ORIGINS): ''` en `services.yaml`) reciben `Access-Control-Allow-Origin`. Su preflight (`OPTIONS` con `Access-Control-Request-Method`) se responde con 204 en `kernel.request` con prioridad 250, antes del router y del firewall (un preflight no lleva token). Vacía, el valor por defecto: ningún origen externo. Un proyecto combinado la llena con el origen del frontend. No usa `nelmio/cors-bundle`: son unas 70 líneas sin otra dependencia que fijar y auditar, con el mismo comportamiento que FastAPI y NestJS (lista explícita, credenciales, sin `*`). Test: `tests/Core/CorsSubscriberTest.php`.

### Base de datos (overlays de `infra-setup`)

`config/packages/doctrine.yaml` usa `url: '%env(db_url:resolve:DATABASE_URL)%'`. El procesador `db_url` (`src/Core/Doctrine/DatabaseUrlEnvVarProcessor.php`) deja pasar `postgresql://…` y `mysql://…`, y convierte `file:/app/data/app.db` (overlay de SQLite) en `sqlite:////app/data/app.db`. Sin overlay (`--db none`), `config/services.yaml` usa por defecto `sqlite:///%kernel.project_dir%/var/data.db`.

Tests con BD: `when@test` de `doctrine.yaml` agrega el sufijo `_test` al nombre de la base. Créala una vez: `make sh` y dentro `php bin/console doctrine:database:create --env=test --if-not-exists && php bin/console doctrine:migrations:migrate --env=test -n`. En MySQL el usuario `app` no puede crear bases: créala con el usuario root (`make db-shell`) o quita el sufijo en `when@test`.

### Redis

El overlay inyecta `REDIS_URL` en `app`. Para usarlo como caché (y almacenamiento del rate limiter), en `config/packages/cache.yaml`:

```yaml
framework:
    cache:
        app: cache.adapter.redis
        default_redis_provider: '%env(REDIS_URL)%'
```

### `make new-app` (si no hay `composer.json`)

1. `composer create-project symfony/skeleton:7.4.* --no-install` dentro de `composer:2`, con tu uid.
2. `.make/symfony/setup.php composer`: `platform.php 8.3.0` (el PHP de la imagen), `disable_dotenv` y `symfony.docker: false` (Flex no agrega sus compose).
3. `composer require` de Doctrine (bundle 2.x, ORM 3, migrations), Security, Serializer, Validator, Uid y Rate Limiter, y en dev PHPUnit 12, BrowserKit, PHPStan 2 y PHP-CS-Fixer 3. Flex aplica los recipes.
4. Copia los archivos del kit de `.make/symfony/app/` (rutas, servicios, seguridad, `/health`, procesador `db_url`, PHPUnit, PHPStan, PHP-CS-Fixer y su test de `/health`) y `setup.php config` ajusta `doctrine.yaml`.
5. Copia el resultado sin pisar el kit (`cp -n`) y agrega `/vendor/`, `/var/` y las cachés de herramientas a `.gitignore`.

Si las descargas fallan con `504` o por límite de peticiones, exporta `COMPOSER_AUTH='{"github-oauth":{"github.com":"<token>"}}'` antes; `make new-app` lo pasa al contenedor por nombre.

## MongoDB (Doctrine MongoDB ODM)

Con `--db mongo` (o el overlay MongoDB de infra-setup), `make new-app` cambia tres pasos. Con otra BD, todo queda igual que antes.

1. Antes de crear la app, `symfony-scaffold/scripts/mongo-setup.sh` agrega la extensión PECL `mongodb-2.5.5` a la línea `install-php-extensions` del `Dockerfile`. La imagen SQL no cambia. Si el `Dockerfile` no tiene la línea del kit, el script se detiene sin cambiar nada y dice qué agregar.
2. `composer require` pide `doctrine/mongodb-odm-bundle` 5.6.1, `doctrine/mongodb-odm` 2.17.4 y `mongodb/mongodb` 2.5.0, con versión exacta, en lugar del bundle de Doctrine, el ORM y Migrations.
3. `setup.php config-mongo` escribe `config/packages/doctrine_mongodb.yaml`:
   - conexión `%env(MONGO_URL)%` (el usuario de la app, con permisos solo sobre `DB_NAME`);
   - `default_database` `%env(DB_DATABASE)%`;
   - documentos con atributos en `src/Modules`.

   Descarta lo que deja el recipe del bundle (`MONGODB_URI`, `src/Document`).

- **Documentos**: viven en `src/Modules/<M>/Domain/Entity/`, la misma carpeta que las entidades, así que `services.yaml` y las zonas no cambian. `symfony-scaffold` genera un documento con `_id` UUID en texto.
- **Índices**: se declaran con `#[ODM\Index]`. `make migrate` (también en prod, con el usuario `app`) corre `doctrine:mongodb:schema:create --index`, que crea los que falten y nunca borra uno. `schema:update` no se usa porque borra los índices no declarados. Quitar un índice del documento no lo borra de la BD: se borra a mano con `make db-shell` y `db.<colección>.dropIndex('<nombre>')`.
- **`make migration`** solo dice que MongoDB no tiene migraciones.
- **Tests**: no hay BD `_test`, porque el usuario de la app solo puede usar `DB_NAME`, ni transacciones, porque el servidor no es un replica set. Los tests corren contra el MongoDB de `make dev` y vacían sus colecciones en `setUp()` con `deleteMany([])`.
- **Prod**: `cache:warmup` genera los proxies y los hydrators del ODM en `/tmp`, así que funciona con el sistema de archivos de solo lectura.

## Auth: access tokens (detalle en `symfony-patterns/references/auth.md`)

1. Módulo `Auth`: entidades `User` y `AccessToken` (se guarda el sha256 del token, con `expiresAt`), `IssueAccessToken` y `AccessTokenHandler`.
2. `security.yaml`: provider de entidad y `access_token.token_handler` en el firewall `main` (stateless).
3. `POST /api/auth/token`: dos rate limiters (por IP y por email), verificación con hash de relleno si el email no existe y mensaje genérico.
4. Logout: borra el token actual o todos los del usuario.
5. CORS con orígenes explícitos en `CORS_ORIGINS` (ya resuelto por `src/Core/Http/CorsSubscriber.php`); nunca `*` con credenciales.

## Comandos

```bash
make new-app
make env && make dev        # http://localhost:8000/health
make test
make verify SCOPE=src/Modules/<M>
make migration NAME=x       # doctrine:migrations:diff
make migrate
make sh                     # y dentro: php bin/console …
```

## Seguridad específica

- **Tipado**: `declare(strict_types=1)` en todo.
- **Entrada**: Requests con constraints y `#[MapRequestPayload]` (422 automático); los campos que asigna el servidor no existen en la Request y no tienen setter en la entidad.
- **Autorización**: Voters; un recurso ajeno responde 404 con `findOneOwnedBy`.
- **SQL**: QueryBuilder/DQL con parámetros; nunca concatenes entrada en DQL o SQL.
- **Salida**: Resources con campos explícitos; nunca serialices la entidad.
- **Comandos prohibidos a los agentes**: `doctrine:schema:drop`, `doctrine:database:drop` y `doctrine:fixtures:load` contra datos reales. Como se ejecutan dentro de Docker, los permisos de la herramienta no los ven: la regla está en la sección del stack de `AGENTS.md`.

## Errores comunes

- Entidades `final` (Doctrine no puede crear proxies).
- Controladores con lógica o con `EntityManager` directo.
- `loginUser()` en tests con un firewall stateless (no autentica): usa un token real.
- Dinero en `float`.
- Usar `cache:clear` como verificación (usa `make verify`).
