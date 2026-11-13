# Stack: TypeScript · Express (API REST minimalista) + Prisma o Mongoose (MongoDB)

Plantillas: `plantillas/stacks/express/`. Auth por defecto: **JWT propio** (`jose`). Puerto: 3000. Healthcheck: `/health`.

Express 5 + TypeScript strict (ESM, `module: NodeNext`) + Zod para validar + Prisma 7 para los datos (solo si hay BD SQL; con MongoDB, Mongoose). Tests con Vitest y Supertest.

## Elección (sin detección automática)

`express` **nunca se detecta solo**: su `detect` está vacío. Se elige en la pregunta de `init` o con `--stack express`. Los stacks se prueban por `detect.priority` y luego por id; con una regla de texto, `express` se adelantaría a `nestjs` y `nextjs`: buscar `"express"` en `package.json` les robaría esos proyectos (NestJS trae `@nestjs/platform-express` y muchos proyectos Next.js usan Express).

## Base de datos: Prisma 7, igual que NestJS

Prisma 7 (`PRISMA_VERSION ?= 7.10.1` en `.make/stack.mk`, la misma versión exacta que el stack `nestjs`) fija el `provider` en `schema.prisma` y necesita un *driver adapter*. `.agents/skills/express-scaffold/scripts/app-setup.sh` lee `DB_DRIVER` de `compose.db.yaml` (el overlay que activó infra-setup) y elige ambos:

| `--db` | `provider` | Adaptador | Variables que lee `src/lib/db.ts` |
|---|---|---|---|
| `postgres` | `postgresql` | `@prisma/adapter-pg` | `DATABASE_URL` |
| `mysql` | `mysql` | `@prisma/adapter-mariadb` | `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` (con `allowPublicKeyRetrieval`, porque MySQL 8.4 usa `caching_sha2_password` sin TLS en la red interna) |
| `sqlite` | `sqlite` | `@prisma/adapter-better-sqlite3` | `DATABASE_URL` (`file:/app/data/app.db`, volumen `app-data`) |

- `prisma.config.ts` toma `process.env.DATABASE_URL ?? ''` para las migraciones (los tres formatos del overlay son los de Prisma). No usa `env()`, que falla si la variable falta: `prisma generate` corre en el build de la imagen, sin BD.
- El cliente se genera en `src/generated/prisma/` (generator `prisma-client`, ESM, imports con `.js`; ignorado por git) y `tsc` lo compila a `dist/` con la app. `src/lib/env.ts` valida `DATABASE_URL` y `DB_*` como opcionales.
- **Sin `compose.db.yaml` no hay Prisma**: ni dependencias, ni `prisma/`, ni `src/lib/db.ts`; la app arranca solo con `/health` y `make migrate` informa que no hay nada que migrar. Si activas la BD después, ejecuta `bash .agents/skills/express-scaffold/scripts/app-setup.sh` dentro de `make sh` (instala en el volumen `node_modules` de dev).
- Prisma 7 ya no regenera el cliente en `migrate dev`: `make migration NAME=x` corre `prisma migrate dev` y después `prisma generate`.
- Si cambias de BD, cambia el `provider` y el adaptador de `src/lib/db.ts` (o bórralos y vuelve a correr `app-setup.sh`) y vuelve a crear las migraciones.

### MongoDB: Mongoose

Con `--db mongo` (`DB_DRIVER: mongodb`, leído con el mismo `sed` en `app-setup.sh`, `scaffold.sh` y `.make/stack.mk`) no hay Prisma. `app-setup.sh` instala `mongoose` en `MONGOOSE_VERSION ?= 9.11.4` (`.make/stack.mk`, la misma versión exacta que el stack `nestjs`, publicada el 2026-10-23) y crea:

- `src/mongo/connection.ts`: `connectMongo()` con `MONGO_URL` (sin ella falla al arrancar con un mensaje claro). El overlay conecta con el usuario de la app, que solo tiene `readWrite` en su base de datos. `autoIndex` encendido en dev y apagado con `NODE_ENV=production`: en prod los índices los crea `make migrate ENV=prod`, no el arranque.
- `src/server.ts` conecta antes de escuchar, así un `/health` que responde prueba la conexión, y cierra la conexión en `SIGTERM`. El script solo reemplaza `src/server.ts` mientras sigue siendo el del kit (lo reconoce por su `cksum`); si lo cambiaste, se detiene antes de instalar o escribir nada y dice qué agregar (`await connectMongo()` antes de `listen`).
- `src/mongo/sync-indexes.ts`: lo corre `make migrate`. Importa `src/app.ts` (así se registran los modelos de cada módulo) y llama a `createIndexes()` en cada modelo: crea los índices declarados y nunca borra uno. Un índice que quitas del modelo sigue en la BD hasta que lo borras a mano (`make db-shell` → `db.<colección>.dropIndex('<nombre>')`).

Por módulo, `scaffold.sh` agrega `model.ts` (un `Schema` de Mongoose con `_id` UUID en texto, así `z.uuid()` y el contrato no cambian; colección `<m>`, `timestamps`) y el contrato trae la tabla del modelo Mongoose en vez de la de Prisma. `make migration` solo explica que MongoDB no tiene migraciones: los índices se declaran en los modelos.

## Arquitectura (por módulos, capas por rol)

```text
src/
├── server.ts                  # arranque y cierre ordenado (SIGTERM)
├── app.ts                     # createApp(): helmet, json 100kb, /health, routers, 404 y errores
├── lib/ env.ts (Zod) · db.ts (Prisma + adaptador, perezoso; si hay BD) · http.ts (notFound, errorHandler) · auth.ts (JWT)
├── generated/prisma/          # cliente de Prisma (prisma generate; ignorado por git)
├── mongo/                     # connection.ts (MONGO_URL) y sync-indexes.ts (si la BD es MongoDB)
└── modules/<m>/
    ├── schemas.ts             # Zod .strict() + tipos              (data-writer)
    ├── repository.ts          # Prisma con select                  (data-writer)
    ├── errors.ts  services.ts # casos de uso sin Express ni Prisma (logic-writer)
    └── router.ts              # safeParse, auth, errores → HTTP    (web-writer)
prisma/schema.prisma  prisma.config.ts                     # si hay BD
tests/ health.test.ts · modules/<m>/*.test.ts                        (qa-writer)
```

- **Capas forzadas por ESLint** (`no-restricted-imports`): `services.ts`, `errors.ts` y `schemas.ts` no importan `express`, `@prisma/*`, `src/generated/` ni `src/lib/db`; `router.ts` no importa el repositorio ni el ORM. `src/generated/` no se revisa.
- **Errores**: Express 5 lleva los rechazos de handlers async a `errorHandler`; los 4xx de Express (JSON mal formado, cuerpo grande) conservan su código, el resto es 500 sin detalles.
- **`db()` perezoso**: la app y `/health` arrancan sin base de datos; la primera consulta falla con un mensaje claro si falta una variable de la BD.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, lockfiles, `tsconfig*.json`, `eslint.config.*`, `vitest.config.*`, `prisma/**`, `prisma.config.ts`, `src/generated/**`, `src/app.ts`, `src/server.ts`, `src/lib/**`, `src/mongo/**`, `src/types/**` |
| data-writer | `src/modules/*/schemas.ts`, `src/modules/*/repository.ts`, `src/modules/*/model.ts` (solo MongoDB) |
| logic-writer | `src/modules/*/services.ts`, `src/modules/*/errors.ts` |
| web-writer | `src/modules/*/router.ts`, `src/modules/*/middleware.ts` |
| qa-writer | `tests/**` |

Skills: `express-scaffold` (módulo + contrato; también guarda el `package.json` inicial y `scripts/app-setup.sh`), `express-verify` (la usa `make verify`), `express-patterns` (+ `references/auth.md`).

## Docker

| Target | Uso |
|---|---|
| `deps` | `npm ci` con caché (exige `package-lock.json`) |
| `dev` | `prisma generate` (si hay `prisma/schema.prisma`) + `tsx watch src/server.ts` |
| `build` | `prisma generate` (si hay esquema) + `tsc -p tsconfig.build.json`. También lo usa `migrate` en prod (uid 1001) |
| `prod-deps` → `prod` | Solo dependencias de runtime (`npm ci --omit=dev`) + `dist/`; `node dist/server.js`, usuario `app` (1001), código de root (solo lectura para la app), healthcheck con `fetch` |

- En dev, `node_modules` va en un **volumen con nombre** para que el bind mount no lo oculte; `make install` vuelve a ejecutar `npm ci` en el volumen. `CHOKIDAR_USEPOLLING` activa el hot reload en Docker Desktop y WSL.
- En prod: `read_only`, `tmpfs: /tmp`, `cap_drop: [ALL]` y `no-new-privileges`. SQLite vive en el volumen `app-data` (`/app/data`).
- `migrate` ejecuta `prisma migrate deploy` solo si existe `prisma/schema.prisma` (comando en `compose.yaml`): target `dev` en dev; en prod, el target `build` (tiene el CLI `prisma`, dependencia de desarrollo, `prisma.config.ts` y `prisma/`) con el uid de la app (1001), así el archivo SQLite queda escribible para la app. Con MongoDB crea los índices de los modelos: en dev `tsx src/mongo/sync-indexes.ts`; en prod `node dist/mongo/sync-indexes.js` (el target `build` ya lo compiló; `compose.prod.yaml` le fija `NODE_ENV=production`). Sin ninguno de los dos, falla: no hay nada que migrar.
- La base incluye `openssl` (lo necesita el motor de migraciones de Prisma en Alpine). `better-sqlite3` usa binarios precompilados para musl.
- Base de datos y Redis: los overlays de infra-setup inyectan `DATABASE_URL`, `DB_*`, `REDIS_URL` y `REDIS_PASSWORD`; `src/lib/env.ts` los valida.

## `make new-app` (si no hay `package.json`)

`init` deja el esqueleto (`src/`, `tests/`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`) cuando el proyecto no tiene `package.json`. Luego `make new-app`:
1. Copia `package.json` desde `.agents/skills/express-scaffold/assets/package.json.tpl` (ESM, scripts `dev`, `build`, `start`, `test`, `lint`).
2. En `node:22-alpine` instala versiones exactas: `express@5.3.0 zod@4.6.7 helmet@8.3.0` y, como desarrollo, `typescript@5.9.3`, `tsx@4.23.15`, `@types/node@22.20.5`, `@types/express@5.0.6`, `vitest@3.2.7`, `supertest@7.3.1`, `@types/supertest@6.0.3`, `eslint@10.13.0`, `@eslint/js@10.0.1` y `typescript-eslint@8.72.0` (ESLint 9 llegó a fin de vida el 2026-08-06, https://eslint.org/version-support/) (`DEPS` y `DEV_DEPS` en `.make/stack.mk`). `npm_config_before` = hace 14 días: también vale para versiones exactas, así que si subes una (o `PRISMA_VERSION`) a una publicada hace menos de 14 días, `make new-app` falla con `ETARGET` hasta que los cumpla. Corre como root (agrega `bash`) y al final devuelve los archivos a tu uid, también si un paso falla.
3. `app-setup.sh`: si hay `compose.db.yaml`, instala `@prisma/client`, el adaptador y `prisma` (desarrollo) en `PRISMA_VERSION`, crea `prisma/schema.prisma`, `prisma.config.ts` y `src/lib/db.ts` y genera el cliente. Con MongoDB, `mongoose` en `MONGOOSE_VERSION`, `src/mongo/` y `src/server.ts` que conecta antes de escuchar. Siempre agrega `node_modules/`, `dist/`, `coverage/` y `src/generated/` a `.gitignore`.
4. Si un paso falla, quita `package.json` para poder reintentar.

Con `package.json` presente no hace nada (ni llama a Docker). Para agregar dependencias después: `make deps-add PKGS="jose@6" [DEV=1]` (misma regla de 14 días y versión exacta) y luego `make install`.

## Auth: JWT propio (detalle en `express-patterns/references/auth.md`)

1. `make deps-add PKGS="jose@6"` (y `argon2` si la API guarda contraseñas), con aprobación del usuario.
2. `src/lib/auth.ts`: `signAccessToken()`, `requireUser` (HS256 fijo, `iss`, `aud`, expiración; 401 sin detalles), `currentUser(res)` y `requireRole()`.
3. Autorización por recurso en los services; recurso ajeno → 404.
4. Variables: `JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES`.

## Comandos

```bash
make new-app        # una vez
make env && make dev
make test
make verify SCOPE=src/modules/<m>
make migration NAME=x   # Prisma; con MongoDB solo explica que no hay migraciones
make migrate            # Prisma: migraciones; MongoDB: crea los índices de los modelos
make sh
```

## Seguridad específica

- **Entrada**: `safeParse` con schemas `.strict()` en body, params y query; inválido → 422 con `fieldErrors`.
- **Salida**: `select` con los campos del contrato; nunca la fila completa.
- **Cabeceras y tamaño**: `helmet()` y `express.json({ limit: "100kb" })`; sin `x-powered-by`.
- **CORS** (`src/lib/cors.ts`, sin dependencia): solo los orígenes de `CORS_ORIGINS` (separados por coma) reciben `Access-Control-Allow-Origin` y su preflight `OPTIONS` (204). Vacía, el valor por defecto: ningún origen externo. Un proyecto combinado (`--stack express+<frontend>`) la llena con el origen del frontend. `createApp({ corsOrigins })` la reemplaza en los tests (`tests/cors.test.ts`).
- **MongoDB**: filtros solo con valores validados por Zod; nunca un objeto del cliente dentro de un filtro (inyección NoSQL con `$ne`, `$gt`…) ni `$where`. Lecturas con proyección y `.lean()`.
- **SQL**: solo la API de Prisma o `$queryRaw` con plantilla; nunca `$queryRawUnsafe` con datos del usuario.
- **Detrás de un proxy**: `app.set("trust proxy", 1)`; si no, no lo actives (la IP del cliente sería falsificable).

## Errores comunes

- Lógica de negocio o consultas en `router.ts`.
- `ownerId` tomado del body.
- Imports relativos sin `.js` (falla en ESM al compilar).
- `npx tsc` o `npx prisma` sin `--no-install`.
- Cambiar de BD sin cambiar el `provider` de Prisma y el adaptador de `src/lib/db.ts`.
- Agregar un modelo y no regenerar el cliente: usa `make migration` (corre `prisma generate`), no `prisma migrate dev` solo.
- `new PrismaClient()` fuera de `src/lib/db.ts`: en Prisma 7 necesita el adaptador.
