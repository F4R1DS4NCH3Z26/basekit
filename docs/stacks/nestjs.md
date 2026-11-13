# Stack: TypeScript · NestJS (API REST modular) + Prisma · v1

Plantillas: `plantillas/stacks/nestjs/`. Auth por defecto: **JWT propio**. Puerto: 3000. Healthcheck: `/health`. Detección: `nest-cli.json`.

## Arquitectura (módulos por entidad)

```text
package.json  package-lock.json  nest-cli.json  tsconfig*.json  vitest.config*.ts   # orquestador
prisma/schema.prisma  prisma.config.ts                                             # orquestador (si hay BD)
src/
├── main.ts                  # CORS (CORS_ORIGINS), shutdown hooks, puerto (orquestador)
├── app.module.ts            # registro de módulos (orquestador)
├── health/                  # GET /health (lo crea make new-app)
├── common/                  # ZodValidationPipe; auth/ (JwtAuthGuard, CurrentUser)
├── prisma/                  # PrismaService con el adaptador de la BD (si la BD es SQL)
├── generated/prisma/        # cliente generado (ignorado por git)
├── mongo/                   # MongoModule (MONGO_URL) y sync-indexes.ts (si la BD es MongoDB)
└── modules/<m>/
    ├── <m>.schemas.ts  <m>.repository.ts     # data-writer
    ├── <m>.model.ts                          # data-writer (solo MongoDB: @Schema e índices)
    ├── <m>.errors.ts   <m>.service.ts        # logic-writer (sin HTTP)
    ├── <m>.controller.ts  <m>.module.ts      # web-writer
    └── *.spec.ts                             # qa-writer
test/                        # e2e (qa-writer)
```

- **ESM**: `nest new` (12.x) crea un proyecto `"type": "module"`, con Vitest y oxlint. Los imports relativos llevan `.js`.
- **Mismos patrones de datos que Next.js**: Prisma + Zod (con MongoDB, Mongoose + Zod). La validación usa un `ZodValidationPipe` propio (`src/common/zod-validation.pipe.ts`) con `z.strictObject`, así un campo extra responde 400.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, configs, `prisma/**`, `prisma.config.ts`, `src/main.ts`, `src/app.*`, `src/common/**`, `src/config/**`, `src/health/**`, `src/prisma/**`, `src/mongo/**`, `src/generated/**`, `src/types/**` |
| data-writer | `src/modules/*/*.schemas.ts`, `*.repository.ts`, `*.model.ts` |
| logic-writer | `*.service.ts`, `*.errors.ts` |
| web-writer | `*.controller.ts`, `*.module.ts`, `*.guard.ts` |
| qa-writer | `src/*.spec.ts`, `src/**/*.spec.ts`, `test/**` |

Skills: `nest-scaffold` (+ `scripts/app-setup.sh`), `nest-verify` (la usa `make verify`), `nest-patterns` (+ `references/auth.md`).

## Base de datos: una sola fuente, las variables del overlay

Prisma 7 fija el proveedor en `schema.prisma` y necesita un *driver adapter*. `app-setup.sh` lee `DB_DRIVER` de `compose.db.yaml` (el overlay que activó infra-setup) y elige ambos:

| `--db` | `provider` | Adaptador | Variables que lee la app |
|---|---|---|---|
| `postgres` | `postgresql` | `@prisma/adapter-pg` | `DATABASE_URL` |
| `mysql` | `mysql` | `@prisma/adapter-mariadb` | `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` (con `allowPublicKeyRetrieval`, porque MySQL 8.4 usa `caching_sha2_password` sin TLS en la red interna) |
| `sqlite` | `sqlite` | `@prisma/adapter-better-sqlite3` | `DATABASE_URL` (`file:/app/data/app.db`, volumen `app-data`) |

`prisma.config.ts` toma `DATABASE_URL` para las migraciones (los tres formatos del overlay son los de Prisma). Sin `compose.db.yaml` no se instala Prisma: la app arranca solo con `/health`. Si activas la BD después, ejecuta `bash .agents/skills/nest-scaffold/scripts/app-setup.sh` dentro de `make sh` y agrega `PrismaModule` a `src/app.module.ts` si el script lo avisa.

### MongoDB: Mongoose (`@nestjs/mongoose`)

Con `--db mongo` (`DB_DRIVER: mongodb`) no hay Prisma. `app-setup.sh` instala `@nestjs/mongoose@12` y `mongoose@9` (versión exacta, la más nueva con 14 días) y crea:

- `src/mongo/mongo.module.ts`: `MongooseModule.forRootAsync` con `MONGO_URL` (falla al arrancar si falta). El overlay conecta con el usuario de la app, que solo tiene `readWrite` en su base de datos. Nest espera la conexión antes de escuchar: un `/health` que responde prueba que la BD conectó.
- `autoIndex` encendido en dev y apagado con `NODE_ENV=production` (lo fijan el target `build`/`prod` del Dockerfile y `compose.prod.yaml`): en prod los índices los crea `make migrate ENV=prod`, no el arranque.
- `src/mongo/sync-indexes.ts`: lo corre `make migrate`. Levanta el contexto de la app y llama a `syncIndexes()` en cada modelo registrado (crea los índices declarados y borra los que el modelo ya no declara).

Por módulo, `scaffold.sh` agrega `<m>.model.ts` (clase `@Schema` + `SchemaFactory`, `_id` UUID en texto para que el contrato y `ParseUUIDPipe` no cambien), un repository que inyecta el `Model` con `@InjectModel` y `MongooseModule.forFeature` en `<m>.module.ts`. `make migration` solo explica que MongoDB no tiene migraciones: los índices se declaran en los modelos.

Redis llega como `REDIS_URL` / `REDIS_PASSWORD` desde `compose.redis.yaml`; la app no lo usa hasta que un contrato lo pida (caché, rate limit, colas).

## Docker

| Target | Uso |
|---|---|
| `deps` | `npm ci` (o `pnpm install --frozen-lockfile`) con caché |
| `dev` | `prisma generate` (si hay `prisma/schema.prisma`) + `nest start --watch` |
| `build` | `prisma generate` (si hay schema) + `nest build`. También lo usa `migrate` en prod (uid 1001) |
| `prod-deps` → `prod` | Solo dependencias de runtime + `dist/`; usuario `nestjs` (1001), `read_only` + `tmpfs: /tmp`, `cap_drop: [ALL]`, healthcheck con `fetch` |

- En dev, `node_modules` va en un **volumen con nombre** para que el bind mount no lo oculte; `make install` vuelve a ejecutar `npm ci` en el volumen. `TSC_WATCHFILE`/`TSC_WATCHDIRECTORY` con polling para que el hot reload funcione en Docker Desktop y WSL.
- `migrate` ejecuta `prisma migrate deploy` si existe `prisma/schema.prisma`; con MongoDB, `node dist/mongo/sync-indexes.js` (en dev compila antes con `tsc -p tsconfig.build.json`; en prod el target `build` ya lo compiló); sin BD informa que no hay nada que migrar.
- La base incluye `openssl` (lo necesita el motor de migraciones de Prisma en Alpine). `better-sqlite3` usa binarios precompilados para musl.

`make new-app` (si no hay `package.json`; si falla, quita `package.json` para que puedas reintentar):
1. Instala `@nestjs/cli@12.0.10` en `/tmp` del contenedor `node:24-alpine` (la misma versión de Node que el Dockerfile: el npm 10 de Node 22 falla al resolver los peers de Nest 12 con `Cannot read properties of null (reading 'edgesOut')`) y corre `nest new app --package-manager npm --skip-git --skip-install --no-observe` (sin TTY no pregunta nada: queda ESM con Vitest). Corre como root y al final devuelve los archivos a tu uid, también si un paso falla.
   Todas las dependencias se resuelven con `npm_config_before` = hace 14 días. La regla también vale para versiones exactas: si subes `NEST_CLI_VERSION` o `PRISMA_VERSION` (o las pasas con `make new-app NEST_CLI_VERSION=…`) a una versión publicada hace menos de 14 días, `make new-app` falla con `ETARGET` hasta que cumpla los 14 días.
2. Copia el resultado sin pisar archivos del kit (`AGENTS.md`, `README.md`, `.gitignore`…) y ejecuta `npm install`.
3. `app-setup.sh`: instala `zod`, crea `/health`, `ZodValidationPipe` y `src/main.ts` con CORS; si hay BD, instala `prisma@7.10.1`, `@prisma/client` y el adaptador (versión exacta), crea `prisma/schema.prisma`, `prisma.config.ts`, `src/prisma/` y genera el cliente (con MongoDB, `@nestjs/mongoose`, `mongoose` y `src/mongo/`); agrega `node_modules/`, `dist/`, `coverage/` y `src/generated/` a `.gitignore`.

## Auth: JWT (detalle en `nest-patterns/references/auth.md`)

1. Dependencias, con aprobación del usuario: `@nestjs/jwt` y `@node-rs/argon2` (argon2id, binarios precompilados).
2. `src/common/auth/`: `authConfig()` (falla al arrancar si `JWT_SECRET` tiene menos de 32 caracteres), `JwtAuthGuard` (Bearer, `HS256` fijado, issuer y audience) y el decorador `@CurrentUser()`.
3. Controllers protegidos con `@UseGuards(JwtAuthGuard)`; autorización por recurso en el service (`{ id, ownerId }`, ajeno → 404).
4. Login con error único y tiempo constante; rate limit con `@nestjs/throttler`.
5. Variables: `JWT_SECRET=__GENERATE__`, `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_MINUTES`, y `CORS_ORIGINS` (en prod, la URL real con https).

## Comandos

```bash
make dev
make test
make verify SCOPE=src/modules/<m>
make migration NAME=x   # Prisma; con MongoDB solo explica que no hay migraciones
make migrate            # Prisma: migraciones; MongoDB: sincroniza los índices
make sh
```

## Seguridad específica

- **Mass assignment**: schemas de entrada con `z.strictObject`; `ownerId`, `role` y fechas nunca vienen del body.
- **Salida**: el repository usa `select` con los campos del contrato; nunca devuelve la fila completa.
- **SQL**: solo el query builder de Prisma o `$queryRaw` con template; nunca `$queryRawUnsafe` con input.
- **MongoDB**: filtros solo con valores validados por Zod; nunca un objeto del cliente dentro de un filtro (inyección NoSQL con `$ne`, `$gt`…) ni `$where`. Lecturas con proyección y `.lean()`.
- **Errores**: mensajes genéricos; los errores de dominio se traducen a HTTP en el controller.

## Errores comunes

- Imports relativos sin `.js` (ESM): compilan con `tsc` pero fallan al arrancar.
- Lanzar `NotFoundException` desde el service (el dominio no conoce HTTP).
- Olvidar registrar el módulo en `src/app.module.ts`.
- `npx tsc` sin `--no-install`.
- Con MongoDB, `@Prop()` sin `type`: compila con `tsc`, pero Vitest no emite metadata de decoradores y el modelo falla en los tests.
- Cambiar de BD sin regenerar: el `provider` de `schema.prisma` y el adaptador son los de la BD activa al correr `app-setup.sh`.
