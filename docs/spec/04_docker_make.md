# 04 · Docker + Makefile (dev y prod)

Regla: **todo corre en Docker y el `Makefile` es la única interfaz**, igual para humanos, agentes y CI. Nadie instala el toolchain del stack en su máquina.

## 1. Piezas

| Archivo | Origen | Rol |
|---|---|---|
| `Makefile` | `plantillas/core/Makefile` | Común a todos los stacks; incluye `.make/stack.mk` y `.make/db.mk` |
| `.make/stack.mk` | `plantillas/stacks/<s>/files/.make/` | Variables del stack y su objetivo `new-app` |
| `.make/db.mk` | Lo crea `infra.sh` | `DB_SHELL_CMD` según el motor |
| `Dockerfile` | Stack | Multi-stage con targets `dev` y `prod` (Next.js agrega `build`) |
| `compose.yaml` | Stack | Base: servicios `app` y `migrate` (perfil `tools`) |
| `compose.dev.yaml` / `compose.prod.yaml` | Stack | Target, `env_file`, puertos, volúmenes y endurecimiento |
| `compose.db.yaml` / `compose.redis.yaml` | `infra.sh` desde `skills/infra-setup/assets/` | Overlays opcionales; si existen, el Makefile los incluye solo |
| `.env.example` | Stack (+ bloques de `infra.sh`) | Única fuente de variables; los secretos van como marcadores |

## 2. Cómo se combina compose

```make
ENV ?= dev                                   # solo dev | prod (otro valor aborta)
ENV_FILE := $(if $(filter prod,$(ENV)),.env.prod,.env)
OVERLAYS := $(wildcard compose.db.yaml compose.redis.yaml)
DEV_PROJECT := <nombre normalizado>-dev-<cksum de la ruta del checkout>   # ver plantillas/core/Makefile
DC = docker compose $(if $(filter dev,$(ENV)),-p $(DEV_PROJECT),) --env-file $(ENV_FILE) -f compose.yaml -f compose.$(ENV).yaml $(foreach f,$(OVERLAYS),-f $(f))
```

`--env-file` alimenta la interpolación (`${DB_PASSWORD}`). El `env_file:` de cada servicio pasa las variables al contenedor.

**Dev y prod nunca comparten proyecto de Compose.** Prod usa el nombre por defecto de Compose (el del directorio, normalizado), así los despliegues existentes conservan sus volúmenes. Dev usa `<nombre>-dev-<checksum de la ruta del checkout>`: el checksum evita que coincida con el proyecto de prod de otro directorio (por ejemplo, un hermano llamado `<nombre>-dev` que corre como staging). Por eso `make clean` (que hace `down -v` en dev) no puede borrar volúmenes de producción, aunque el servidor también tenga un `.env`. Si mueves la carpeta, dev pasa a otro proyecto y arranca con datos vacíos; los de prod no cambian. `make _compose-project` imprime el nombre que se usa.

Si tenías contenedores de dev creados antes de este cambio, quedaron bajo el nombre viejo (el mismo que usa prod) y siguen ocupando el puerto; sus datos de dev se quedan en esos volúmenes viejos. **Solo en tu máquina de desarrollo, nunca en un servidor con producción**, bájalos una vez con `docker compose --env-file .env -f compose.yaml -f compose.dev.yaml down` (más los overlays que uses) antes del próximo `make dev`.

## 3. Objetivos del Makefile (contrato)

| Objetivo | Qué hace |
|---|---|
| `help` | Lista los objetivos con `##` (incluidos los de `stack.mk`) |
| `env` | `.env` (o `.env.prod` con `ENV=prod`) desde `.env.example`; reemplaza `__GENERATE__` por `openssl rand -hex 32` y `__GENERATE_B64__` por `openssl rand -base64 32`; `umask 077`; nunca sobrescribe un valor: si el archivo ya existe, solo agrega las claves nuevas de `.env.example` (p. ej., después de `infra.sh`); escribe en un temporal y lo mueve al final, así un fallo no deja un archivo a medias |
| `doctor` | docker, compose v2, git, openssl, archivo de entorno, overlays activos |
| `dev` / `up` / `down` / `restart` / `logs` / `ps` / `sh` / `build` | Ciclo de vida (`logs S=servicio`) |
| `install` | Dependencias dentro del contenedor (`$(INSTALL)`) |
| `test` / `lint` | `$(TEST_CMD)` / `$(LINT_CMD)` en un contenedor efímero |
| `verify` | `$(VERIFY_CMD)` con `--no-deps`; `SCOPE` validado con regex. Es la verificación de bajo consumo de tokens para agentes |
| `migrate` | `docker compose --profile tools run --rm migrate` (dev o prod) |
| `migration NAME=x` | `$(MAKE_MIGRATION_CMD)`; `NAME` validado (`^[a-z0-9_]{3,60}$`) y pasado con `-e NAME` |
| `db-shell` | `exec db $(DB_SHELL_CMD)` |
| `prod-build` / `prod-up` / `prod-down` / `prod-logs` / `prod-migrate` | Alias con `ENV=prod` |
| `clean` | `down -v` del proyecto de dev (`<nombre>-dev`); exige `CONFIRM=1`, está prohibido con `ENV=prod` y nunca alcanza los volúmenes de prod |
| `fix-perms` | Devuelve la propiedad de los archivos creados por contenedores (Linux) |
| `new-app` | Definido por cada stack: crea la app del framework **dentro de Docker** |

## 4. Contrato de `.make/stack.mk`

| Variable | Obligatoria | Ejemplo (Next.js) |
|---|---|---|
| `APP` | sí | `app` |
| `PORT` | sí | `3000` |
| `SHELL_CMD` | sí | `sh` |
| `INSTALL_CMD`, o `INSTALL` completo | sí | `npm ci` / `INSTALL = $(DC) build $(APP)` |
| `TEST_CMD`, `LINT_CMD` | sí | `npx --no-install vitest run` |
| `MAKE_MIGRATION_CMD` | sí | `npx --no-install prisma migrate dev --name "$$NAME"` |
| `VERIFY_CMD` | sí | `bash .agents/skills/nextjs-verify/scripts/verify.sh "$${SCOPE:-src}"` |
| `VERIFY_ENV` | no | `-e OFFLINE=0` (Spring) |
| objetivo `new-app` | sí | `create-next-app`, `composer create-project`, Initializr o `uv lock` |

Reglas:
- **Datos del usuario** (`NAME`, `SCOPE`) se leen como variables de entorno (`export NAME SCOPE` + `"$$NAME"`), nunca interpolados por make dentro del comando.
- **`npx --no-install`** siempre: sin eso, un binario ausente se descarga del registro (con `tsc`, se descarga un paquete ajeno).

## 5. El servicio `migrate` (todos los stacks)

Los overlays inyectan la conexión en `app` **y** en `migrate` usando un ancla YAML:

```yaml
x-db-env: &db-env
  DATABASE_URL: postgresql://${DB_USER:-app}:${DB_PASSWORD}@db:5432/${DB_NAME:-app}
  DB_CONNECTION: pgsql
  DB_HOST: db
  # … Laravel (DB_*) y Spring (SPRING_DATASOURCE_*) en el mismo bloque
services:
  app:     { depends_on: { db: { condition: service_healthy } }, environment: *db-env }
  migrate: { depends_on: { db: { condition: service_healthy } }, environment: *db-env }
```

**Por qué**: en producción, la imagen mínima de Next.js (*standalone*) no incluye el CLI de Prisma. Un servicio `migrate` con el target adecuado resuelve todos los stacks con base de datos igual:

| Stack | `migrate` |
|---|---|
| Next.js | Target `dev` (dev) o `build` (prod), con `prisma migrate deploy` |
| FastAPI | Target `dev` o `prod`, con `alembic upgrade head` (Alembic es dependencia de runtime) |
| Laravel | Target `dev` o `prod`, con `php artisan migrate --force` |
| Spring | Imagen `flyway/flyway:11` sobre `src/main/resources/db/migration`, usando `SPRING_DATASOURCE_*`. La app también migra al arrancar |
| Django, Django + HTMX | Target `dev` o `prod`, con `python manage.py migrate --noinput` |
| Flask, Python nativo | Target `dev` o `prod`, con `alembic upgrade head` |
| NestJS, Express, Node nativo | Target `dev` o `prod`, con `prisma migrate deploy` (solo si existe `prisma/schema.prisma`) |
| Symfony | Target `dev` o `prod`, con `php bin/console doctrine:migrations:migrate --no-interaction --allow-no-migration` |
| PHP nativo | Target `dev` o `prod`, con su propio migrador: `php bin/migrate.php up` |
| Gin, Go nativo | Dev: `go run ./cmd/api migrate`. Prod: el binario estático de la imagen `scratch` con `api migrate` (goose embebido) |
| React, Vue, TypeScript + Vite (frontend) | Sin servicio `migrate`: un stack frontend no tiene base de datos (`init` rechaza `--db` y `--redis`). `make migrate`, `migration` y `db-shell` solo avisan |

**Requisito**: `environment` siempre como **mapa** (no lista) en todos los archivos compose; si no, Compose no los fusiona.

## 6. Variables de conexión: un overlay sirve para todos los stacks

| Formato | Lo usa |
|---|---|
| `DATABASE_URL=postgresql://…` / `mysql://…` / `file:/app/data/app.db` | Prisma (Next.js, NestJS, Express, Node nativo), Drizzle, Django, Gin y Go nativo. Los stacks Python con SQLAlchemy (FastAPI, Flask, Python nativo) la convierten a `postgresql+psycopg://`, `mysql+pymysql://` o `sqlite:///` |
| `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | Laravel, de forma nativa. Symfony y PHP nativo leen `DATABASE_URL` |
| `SPRING_DATASOURCE_URL`, `_USERNAME`, `_PASSWORD` | Spring, de forma nativa |
| `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | Todos menos los frontend |

Los secretos de la BD están en `.env.example` como bloques marcados (`# >>> db`). `infra.sh` los reemplaza de forma idempotente.

## 7. Endurecimiento incluido

| Medida | Dev | Prod |
|---|---|---|
| Puerto de la app | `127.0.0.1:${APP_PORT}` (no se expone a la LAN) | `${APP_PORT}` (detrás de tu proxy o TLS) |
| BD y Redis | Sin `ports` (acceso con `make db-shell`) | Igual |
| Usuario | root (por los bind mounts) | **No root** (uid 1001; los frontend usan `nginx-unprivileged`) |
| `no-new-privileges` | sí | sí |
| `cap_drop: [ALL]` | — | sí |
| `read_only` + `tmpfs: /tmp` | — | Todos menos Next.js y Laravel, que escriben caché |
| Healthcheck | — | `stack.json → health`: `/api/health` (Next.js), `/up` (Laravel), `/actuator/health` (Spring) y `/health` en el resto |
| Debug | activo | `APP_DEBUG=false`, sin `/docs` (FastAPI), sin stacktrace (Spring), cookie `Secure` (Laravel) |
| Redis | `--requirepass` | Igual |

Lo que cambia entre entornos (debug, perfil) lo fija **compose**, no `.env`: así un `.env.prod` generado desde el mismo `.env.example` nunca hereda `APP_DEBUG=true`.

## 8. Imágenes y versiones fijadas (revisar al adoptar)

| Imagen | Tag en las plantillas | Comentario |
|---|---|---|
| Node | `node:22-alpine` | LTS. Next.js, NestJS, Express, Node nativo y el build de los frontend |
| Frontend (prod) | `nginxinc/nginx-unprivileged:1.30-alpine` | Sirve la SPA compilada (React, Vue, TypeScript + Vite) sin root |
| Python | `python:3.12-slim` + `ghcr.io/astral-sh/uv:0.13.4` | uv del 20 de octubre de 2026. FastAPI, Django, Django + HTMX, Flask y Python nativo |
| PHP | `dunglas/frankenphp:1-php8.3-alpine` + `composer:2` | Laravel y Symfony. Se usa `frankenphp php-server` para no depender de la ruta del Caddyfile |
| PHP nativo | `dunglas/frankenphp:1.13.2-php8.5-alpine` + `composer:2.10.2` | Un solo proceso, no root, `read_only` |
| Java | `eclipse-temurin:21-jdk` / `-jre` | LTS |
| Go | `golang:1.27.3-trixie` (dev y build) + `scratch` (prod) | Gin y Go nativo. Binario estático sin CGO; recarga en dev con `air` v1.67.4; migra con `api migrate` |
| BD | `postgres:17-alpine`, `mysql:8.4` (LTS), `redis:7.4-alpine` | Postgres 18 cambia la ruta del volumen: si subes, ajusta el montaje |
| Migraciones Spring | `flyway/flyway:11` | Fija el minor exacto al adoptar |
| Generadores | `create-next-app@16.4.3`, `laravel/laravel:^12.0`, `symfony/skeleton:7.4.*`, `@nestjs/cli@12.0.10`, `create-vite@9.3.1`, Spring Initializr | Actualiza a versiones con ≥ 14 días |
| ORM de Node | `prisma@7.10.1` (NestJS, Express y Node nativo) con un driver adapter por `DB_DRIVER` | Versión exacta |

Para producción seria, fija **por digest** (`image@sha256:…`) y deja que Renovate o Dependabot lo actualicen.

## 9. Añadir un stack nuevo (checklist)

1. `plantillas/stacks/<id>/stack.json` (guía 02, sección 6).
2. `files/`:
   - `Dockerfile` con `dev`/`prod`, no root en prod y healthcheck.
   - `compose.yaml` con `app` y `migrate` (perfil `tools`).
   - `compose.dev.yaml` y `compose.prod.yaml` con `environment` en forma de mapa.
   - `.dockerignore` que excluya `.env*`, `.agents` y `docs`.
   - `.env.example`.
   - `.make/stack.mk` (sección 4).
3. `roles/`, `zones/` (incluido `orchestrator.stack.txt`) y `skills/<x>-scaffold|verify|patterns` (con `references/auth.md`).
4. `AGENTS.section.md` en menos de 25 líneas.
5. Pruebas de aceptación 1, 6, 8, 9 y 12 de la guía 02.

## 10. Proyecto combinado: `backend/` + `frontend/` (guía 02, sección 14)

Con `--stack <backend>+<frontend>` cada carpeta es un proyecto completo de su stack, con todas las piezas de la sección 1: `backend/Makefile` y `frontend/Makefile` son el `Makefile` core sin cambios, y cada uno incluye su `.make/stack.mk`. Cada lado funciona solo (`make -C backend dev`, `make -C frontend new-app`) y es su propio proyecto de Compose (`backend-dev-<cksum>`, `frontend-dev-<cksum>`): no comparten red ni volúmenes, así que sus servicios `app` no chocan. En prod, el nombre por defecto de Compose sería el de la carpeta (`backend`, `frontend`) y dos proyectos combinados en un mismo servidor se pisarían contenedores y volúmenes; por eso `init` agrega a cada `<lado>/compose.yaml` un `name: <proyecto>-<lado>` (normalizado como Compose). En dev manda el `-p` del Makefile. Los overlays de base de datos y Redis (`infra.sh`) solo van a `backend/`.

La raíz tiene un `Makefile` propio (`plantillas/core/combo/Makefile`) que no incluye nada: solo delega con `$(MAKE) -C`.

| Objetivo de la raíz | Qué hace |
|---|---|
| `help` | Lista los objetivos de la raíz (`make -C <lado> help` muestra los de cada lado) |
| `dev` / `up` / `build` / `logs` / `prod-build` / `prod-logs` | Los dos lados **en paralelo** (`$(MAKE) -j2 _backend-<obj> _frontend-<obj>`): `logs` sigue los dos a la vez |
| `env` / `doctor` / `down` / `restart` / `ps` / `install` / `test` / `lint` / `verify` / `new-app` / `prod-up` / `prod-down` / `clean` / `fix-perms` | Backend y luego frontend; el primer fallo corta |
| `migrate` / `migration NAME=x` / `db-shell` / `prod-migrate` | Solo el backend (el frontend no tiene base de datos) |

Las variables de la línea de comandos (`ENV=prod`, `SCOPE=…`, `NAME=…`, `S=…`, `CONFIRM=1`) llegan a los dos Makefiles por `MAKEFLAGS`. Las recetas que delegan con `$(call …)` empiezan con `+`: make no ve `$(MAKE)` dentro de `$(call)`, y `make -n` debe seguir bajando a cada lado. `sh` no está en la raíz porque es ambiguo: usa `make -C <lado> sh`.

**API entre los dos**: el navegador llama al backend por el host. `frontend/.env.example` trae `VITE_API_URL=http://127.0.0.1:<puerto del backend>` (en prod, el `VITE_API_URL` de `frontend/.env.prod` se incrusta al construir), y `backend/.env.example` permite `http://127.0.0.1:<puerto del frontend>` y `http://localhost:<puerto del frontend>` en `CORS_ORIGINS`.

