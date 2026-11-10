# Stack: TypeScript · Nativo (node:http, sin framework) + Prisma

Plantillas: `plantillas/stacks/node-native/`. Tipo: **backend**. Auth por defecto: **JWT propio** (`jose`). Puerto: 3000. Healthcheck: `/health`.

API REST sobre el módulo `node:http` de Node, sin framework web (ni Express, Fastify, Koa, Hono o NestJS). TypeScript strict (ESM, `module: NodeNext`) + Zod para validar + Prisma 7 para los datos (solo si hay BD). Tests con Vitest y Supertest. Es el stack `express` con la capa web cambiada: datos, migraciones, Docker, roles y zonas son los mismos.

## Elección (sin detección automática)

`node-native` **nunca se detecta solo**: su `detect` está vacío, como todos los stacks nativos (un proyecto Node sin framework no se distingue de forma fiable de uno con framework). Se elige en la pregunta de `init` (Tipo → Lenguaje → Template) o con `--stack node-native`.

## Capa web propia (`src/lib/`, zona del orquestador)

| Archivo | Qué hace |
|---|---|
| `router.ts` | `Router` con `get/post/put/patch/delete(path, ...handlers)`, parámetros `:id` (decodificados; mal codificados → 400), `use()` para middlewares del router y `mount(prefix, router)` para los módulos. Ruta existente con otro método → 405 con `Allow`; sin ruta → 404. `HEAD` usa la ruta `GET`. `createHandler(router)` devuelve el listener de `createServer` |
| `http.ts` | `readJsonBody` (≤ 100 KB: 413; otro `Content-Type` con cuerpo: 415; JSON mal formado: 400), `sendJson`, `HttpError`, `sendError` (errores → JSON: `HttpError` 4xx conserva código y mensaje, el resto 500 `{"error":"Error interno"}` sin detalles) y las cabeceras de seguridad |
| `env.ts` | Variables de entorno validadas con Zod |
| `db.ts` | Cliente de Prisma con el adaptador de la BD (solo si hay BD) |

- El handler recibe `ctx`: `params`, `query` (objeto; si una clave se repite gana la última), `body` (JSON ya parseado o `undefined`), `locals` (datos entre middlewares, p. ej. el usuario) y responde con `ctx.json(status, data)` o `ctx.empty(204)`. Un handler que no responde → 500.
- El cuerpo se lee antes de enrutar, como `express.json()`: el límite y los 400/413/415 valen para cualquier ruta. Lo que sobra de un cuerpo rechazado se descarta.
- **CORS a mano** (`createHandler(router, { corsOrigins })` en `router.ts`): solo los orígenes de `CORS_ORIGINS` (separados por coma) reciben `Access-Control-Allow-Origin`, y su preflight (`OPTIONS` con `Access-Control-Request-Method`) se responde con 204 antes de enrutar. Vacía, el valor por defecto: ningún origen externo (un preflight ajeno sigue el camino normal: 404/405 sin cabeceras CORS). Siempre `Vary: Origin`. Un proyecto combinado la llena con el origen del frontend. ESLint 10 (ESLint 9 llegó a fin de vida el 2026-08-06, https://eslint.org/version-support/).
- **Cabeceras de seguridad a mano** (no hay helmet, que es middleware de Express): `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control: off`, `X-Permitted-Cross-Domain-Policies: none`. `node:http` no envía `X-Powered-By`.
- **`src/server.ts`**: `createServer` con `requestTimeout` 30 s y `headersTimeout` 15 s (acotan cuerpos lentos o enormes). Con SIGTERM (o SIGINT) deja de aceptar conexiones, cierra las inactivas, termina las peticiones en curso y sale con 0; a los 8 s corta las que sigan abiertas (antes del SIGKILL de `docker stop`).

## Base de datos: Prisma 7, igual que Express y NestJS

`PRISMA_VERSION ?= 7.10.1` en `.make/stack.mk`. `.agents/skills/nodenative-scaffold/scripts/app-setup.sh` lee `DB_DRIVER` de `compose.db.yaml` y elige el `provider` y el *driver adapter*:

| `--db` | `provider` | Adaptador | Variables que lee `src/lib/db.ts` |
|---|---|---|---|
| `postgres` | `postgresql` | `@prisma/adapter-pg` | `DATABASE_URL` |
| `mysql` | `mysql` | `@prisma/adapter-mariadb` | `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` (con `allowPublicKeyRetrieval`: MySQL 8.4 usa `caching_sha2_password` sin TLS en la red interna) |
| `sqlite` | `sqlite` | `@prisma/adapter-better-sqlite3` | `DATABASE_URL` (`file:/app/data/app.db`, volumen `app-data`) |

- `prisma.config.ts` toma `process.env.DATABASE_URL ?? ''` (no `env()`, que falla si falta: `prisma generate` corre en el build, sin BD).
- El cliente se genera en `src/generated/prisma/` (ESM, imports con `.js`; ignorado por git) y `tsc` lo compila a `dist/`.
- **Sin `compose.db.yaml` no hay Prisma**: ni dependencias, ni `prisma/`, ni `src/lib/db.ts`; `make migrate` informa que no hay nada que migrar. Si activas la BD después, ejecuta `bash .agents/skills/nodenative-scaffold/scripts/app-setup.sh` dentro de `make sh`.
- Prisma 7 ya no regenera el cliente en `migrate dev`: `make migration NAME=x` corre `prisma migrate dev` y después `prisma generate`.
- `db()` es perezoso: la app y `/health` arrancan sin base de datos.

## Arquitectura (por módulos, capas por rol)

```text
src/
├── server.ts                  # createServer, timeouts y cierre ordenado (SIGTERM → exit 0)
├── app.ts                     # createApp(): Router, /health y router.mount() de cada módulo
├── lib/ router.ts · http.ts · env.ts (Zod) · db.ts (Prisma, si hay BD) · auth.ts (JWT)
├── generated/prisma/          # cliente de Prisma (prisma generate; ignorado por git)
└── modules/<m>/
    ├── schemas.ts             # Zod .strict() + tipos              (data-writer)
    ├── repository.ts          # Prisma con select                  (data-writer)
    ├── errors.ts  services.ts # casos de uso sin HTTP ni Prisma    (logic-writer)
    └── router.ts              # new Router(): safeParse, auth, errores → HTTP (web-writer)
prisma/schema.prisma  prisma.config.ts                     # si hay BD
tests/ health.test.ts · router.test.ts · modules/<m>/*.test.ts       (qa-writer)
```

- **Capas forzadas por ESLint** (`no-restricted-imports`): `services.ts`, `errors.ts` y `schemas.ts` no importan `node:http`, `src/lib/router`, `src/lib/http`, `@prisma/*`, `src/generated/` ni `src/lib/db`; `router.ts` y `middleware.ts` no importan el repositorio ni el ORM.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, lockfiles, `tsconfig*.json`, `eslint.config.*`, `vitest.config.*`, `prisma/**`, `prisma.config.ts`, `src/generated/**`, `src/app.ts`, `src/server.ts`, `src/lib/**`, `src/types/**` |
| data-writer | `src/modules/*/schemas.ts`, `src/modules/*/repository.ts` |
| logic-writer | `src/modules/*/services.ts`, `src/modules/*/errors.ts` |
| web-writer | `src/modules/*/router.ts`, `src/modules/*/middleware.ts` |
| qa-writer | `tests/**` |

Skills: `nodenative-scaffold` (módulo + contrato; también guarda el `package.json` inicial y `scripts/app-setup.sh`), `nodenative-verify` (la usa `make verify`), `nodenative-patterns` (+ `references/auth.md`).

## Docker

Igual que `express`:

| Target | Uso |
|---|---|
| `deps` | `npm ci` con caché (exige `package-lock.json`) |
| `dev` | `prisma generate` (si hay esquema) + `tsx watch src/server.ts` |
| `build` | `prisma generate` (si hay esquema) + `tsc -p tsconfig.build.json`. También lo usa `migrate` en prod (uid 1001) |
| `prod-deps` → `prod` | Solo dependencias de runtime (`npm ci --omit=dev`) + `dist/`; `node dist/server.js`, usuario `app` (1001), código de root, healthcheck con `fetch` |

- En dev, `node_modules` va en un volumen con nombre; `make install` vuelve a ejecutar `npm ci`.
- En prod: `read_only`, `tmpfs: /tmp`, `cap_drop: [ALL]` y `no-new-privileges`. SQLite vive en el volumen `app-data` (`/app/data`).
- `migrate` ejecuta `prisma migrate deploy` solo si existe `prisma/schema.prisma`: target `dev` en dev; en prod, el target `build` con el uid de la app (1001).

## `make new-app` (si no hay `package.json`)

`init` deja el esqueleto (`src/`, `tests/`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`). Luego `make new-app`:
1. Copia `package.json` desde `.agents/skills/nodenative-scaffold/assets/package.json.tpl`.
2. En `node:22-alpine` instala versiones exactas: `zod@4.6.7` (única dependencia de runtime sin BD) y, como desarrollo, `typescript@5.9.3`, `tsx@4.23.15`, `@types/node@22.20.5`, `vitest@3.2.7`, `supertest@7.3.1`, `@types/supertest@6.0.3`, `eslint@10.13.0`, `@eslint/js@10.0.1` y `typescript-eslint@8.72.0` (`DEPS` y `DEV_DEPS` en `.make/stack.mk`). `npm_config_before` = hace 14 días: también vale para versiones exactas.
3. `app-setup.sh`: con `compose.db.yaml`, instala `@prisma/client`, el adaptador y `prisma` (desarrollo) en `PRISMA_VERSION`, crea `prisma/schema.prisma`, `prisma.config.ts` y `src/lib/db.ts` y genera el cliente. Siempre agrega `node_modules/`, `dist/`, `coverage/` y `src/generated/` a `.gitignore`.
4. Si un paso falla, quita `package.json` para poder reintentar.

Con `package.json` presente no hace nada (ni llama a Docker). Para agregar dependencias: `make deps-add PKGS="jose@6" [DEV=1]` y luego `make install`.

## Auth: JWT propio (detalle en `nodenative-patterns/references/auth.md`)

1. `make deps-add PKGS="jose@6"` (y `argon2` si la API guarda contraseñas), con aprobación del usuario.
2. `src/lib/auth.ts`: `signAccessToken()`, el middleware `requireUser` (HS256 fijo, `iss`, `aud`, expiración; 401 sin detalles; deja el usuario en `ctx.locals.user`), `currentUser(ctx)` y `requireRole()`.
3. Autorización por recurso en los services; recurso ajeno → 404.
4. Variables: `JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES`.

## Comandos

```bash
make new-app        # una vez
make env && make dev
make test
make verify SCOPE=src/modules/<m>
make migration NAME=x
make migrate
make sh
```

## Seguridad específica

- **Entrada**: `safeParse` con schemas `.strict()` sobre `ctx.body`, `ctx.params` y `ctx.query`; inválido → 422 con `fieldErrors`.
- **Salida**: `select` con los campos del contrato; nunca la fila completa.
- **Tamaño y tiempos**: cuerpo ≤ 100 KB (413), `requestTimeout` y `headersTimeout` en `server.ts`.
- **Errores**: nunca el mensaje de un error inesperado al cliente (500 genérico; el detalle va al log). El mensaje de un `HttpError` sí llega al cliente.
- **SQL**: solo la API de Prisma o `$queryRaw` con plantilla; nunca `$queryRawUnsafe` con datos del usuario.
- **Detrás de un proxy**: `X-Forwarded-For` solo si el proxy es tuyo; si no, la IP del cliente es falsificable.

## Errores comunes

- Agregar Express u otro framework "para un middleware": el stack es nativo; escribe el middleware como `Handler`.
- Lógica de negocio o consultas en `router.ts`; `ownerId` tomado del body.
- Un handler que no llama a `ctx.json`/`ctx.empty` (responde 500) o un middleware que ni responde ni llama a `next()`.
- Imports relativos sin `.js` (falla en ESM al compilar).
- `npx tsc` o `npx prisma` sin `--no-install`.
- Agregar un modelo y no regenerar el cliente: usa `make migration`.
- `new PrismaClient()` fuera de `src/lib/db.ts`: en Prisma 7 necesita el adaptador.
