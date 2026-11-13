# Stack: Next.js (App Router) + TypeScript · v3

Plantillas: `plantillas/stacks/nextjs/`. Auth por defecto: **Better Auth**. Puerto: 3000. Healthcheck: `/api/health`.

## Arquitectura (por features)

```text
src/
├── app/                        # solo enrutamiento: page, layout, loading, error
│   ├── api/auth/[...all]/route.ts   # handler de Better Auth (data-writer)
│   ├── api/health/route.ts          # lo crea make new-app
│   └── layout.tsx                   # orquestador
├── features/<f>/
│   ├── schemas.ts   model.ts (solo MongoDB)   services.ts ("server-only")   actions.ts ("use server")   server.ts
│   ├── hooks/   stores.ts   components/
│   └── index.ts                     # API pública: solo componentes, tipos y schemas
├── components/  lib/ (db, env, auth, auth-client; con MongoDB, sync-indexes)  types/
├── instrumentation.ts             # solo MongoDB: conecta al arrancar el servidor
prisma/  tests/features/<f>/
```

- **Dos puertas de API pública** por feature: `index.ts` (seguro para el cliente) y `server.ts` (servidor).
- **Las fugas entre features se bloquean con ESLint** (`no-restricted-imports` con `@/features/*/*`, salvo `/server` y `/actions`).

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, configs, `prisma/`, `src/lib/`, `src/instrumentation.ts`, `src/types/`, root layout, `middleware.ts`/`proxy.ts` |
| data-writer | `schemas.ts`, `model.ts` (solo MongoDB), `services.ts`, `actions.ts`, `server.ts`, `types.ts`, `src/app/api/**` |
| logic-writer | `stores.ts`, `hooks/**` |
| ui-writer | `components/**`, `index.ts`, `src/components/**`, `page`/`layout`/`loading`/`error`/`not-found` |
| qa-writer | `tests/**`, `e2e/**` |

Skills: `nextjs-scaffold`, `nextjs-verify` (la usa `make verify`), `nextjs-patterns` (+ `references/auth.md`).

## MongoDB: Mongoose

Con `--db mongo` (`DB_DRIVER: mongodb`, leído con el mismo `sed` en `app-setup.sh`, `scaffold.sh` y `.make/stack.mk`), `make new-app` corre además `.agents/skills/nextjs-scaffold/scripts/app-setup.sh` (con cualquier otra BD, o sin BD, `make new-app` es el de siempre y no lo llama). El script instala en versión exacta `mongoose` (`MONGOOSE_VERSION ?= 9.11.4`, publicada el 2026-10-23, la misma que nestjs, express y node-native) y `tsx` (`TSX_VERSION ?= 4.23.15`, desarrollo, la misma que express) y crea:

- `src/lib/db.ts`: `connectDb()` con `MONGO_URL` (sin ella falla con un mensaje claro). Una sola conexión por proceso, guardada en `globalThis` para que la recarga de `next dev` no abra otra. El overlay conecta con el usuario de la app, que solo tiene `readWrite` en su base de datos. `autoIndex` encendido en dev y apagado con `NODE_ENV=production`: en prod los índices los crea `make migrate ENV=prod`, no el arranque. Sin `"server-only"`, porque también lo importa `make migrate`.
- `src/instrumentation.ts`: `register()` conecta al arrancar el servidor (runtime `nodejs`), antes de atender peticiones. Si ya tienes uno, el script lo conserva y avisa qué agregar.
- `src/lib/sync-indexes.ts`: lo corre `make migrate` con `tsx`, en dev (target `dev`) y en prod (target `build`, uid 1001). Carga el `model.ts` de cada feature y llama a `createIndexes()`: crea los índices declarados y nunca borra uno. Un índice que quitas del modelo sigue en la BD hasta que lo borras a mano (`make db-shell` → `db.<colección>.dropIndex('<nombre>')`).

Por feature, `scaffold.sh` agrega `model.ts` (un `Schema` de Mongoose con `_id` UUID en texto, colección `<f>`, `timestamps` y `overwriteModels: true`) y el contrato trae la tabla del modelo Mongoose. Cada función de `services.ts` hace `await connectDb()` antes de usar el modelo. `make migration` solo explica que MongoDB no tiene migraciones: los índices se declaran en los modelos.

## Docker

| Target | Uso |
|---|---|
| `deps` | `npm ci` (o `pnpm install --frozen-lockfile`) con caché |
| `dev` | `prisma generate` (si hay `prisma/`) + `next dev` en `0.0.0.0` |
| `build` | `prisma generate` (si hay `prisma/`) + `next build`. También lo usa `migrate` en prod (uid 1001) |
| `prod` | `output: "standalone"`, usuario `nextjs` (1001), healthcheck con `fetch` |

`migrate` ejecuta `prisma migrate deploy`; con MongoDB (existe `src/lib/sync-indexes.ts`), `tsx src/lib/sync-indexes.ts`. Sin Prisma ni MongoDB falla: no hay nada que migrar.

En dev, `node_modules` y `.next` van en **volúmenes con nombre**, para que el bind mount no los oculte; `make install` vuelve a ejecutar `npm ci` en el volumen. Se activa `WATCHPACK_POLLING` para que el hot reload funcione en Docker Desktop y WSL.

`make new-app` (si no hay `package.json`):
1. Instala `create-next-app@16.4.3` con versión fija (`npm install --prefix /tmp/cli`, igual que `@nestjs/cli` en NestJS; sin `npx --yes`) y lo ejecuta (TypeScript, ESLint, App Router, `src/`, Tailwind, alias `@/*`) dentro de `node:22-alpine` como root y al final devuelve los archivos a tu uid (`create-next-app` falla con un uid sin usuario en la imagen).
   Todas las dependencias se resuelven con `npm_config_before` = hace 14 días: ninguna versión publicada en las últimas dos semanas (rota o comprometida) entra en un proyecto nuevo.
   La regla también vale para versiones exactas: si subes `CREATE_NEXT_VERSION` (o la pasas con `make new-app CREATE_NEXT_VERSION=…`) a una versión publicada hace menos de 14 días, `make new-app` falla con `ETARGET` hasta que cumpla los 14 días.
2. Copia el resultado sin pisar archivos del kit.
3. Instala `zod`, `server-only` y Vitest + Testing Library.
4. Añade `output: "standalone"` a `next.config`.
5. Crea `/api/health`.
6. Solo con MongoDB, antes de devolver los archivos a tu uid: `app-setup.sh` (ver «MongoDB: Mongoose»).

**ESLint sigue en 9** aunque ESLint 9 llegó a fin de vida el 2026-08-06 (https://eslint.org/version-support/): `create-next-app@16.4.3` escribe `eslint: "^9"` y `eslint-config-next` depende de `eslint-plugin-react` 7.37.5, `eslint-plugin-import` 2.32.0 y `eslint-plugin-jsx-a11y` 6.10.2, que solo aceptan ESLint hasta 9 (`peerDependencies`). Pasar a ESLint 10 espera a que Next.js publique una configuración compatible. Los demás stacks TypeScript ya usan ESLint 10 (express y node-native fijado; react, vue y vanilla-ts lo resuelven al crear la app); nestjs usa oxlint.

## Auth: Better Auth (detalle en `nextjs-patterns/references/auth.md`)

1. Requiere BD. Dependencias: `better-auth` + Prisma (o Drizzle), con aprobación del usuario.
2. `src/lib/auth.ts`: `betterAuth({ database: prismaAdapter(...), secret, baseURL, emailAndPassword: { minPasswordLength: 12 }, rateLimit, plugins: [nextCookies()] })`, más los helpers `getSession()` y `requireUser()`.
3. Handler: `export const { GET, POST } = toNextJsHandler(auth)`.
4. Esquema: `npx --no-install @better-auth/cli generate` dentro de `make sh`, y luego `make migration NAME=better_auth && make migrate`.
5. Defensa en capas:
   - **Middleware**: solo un chequeo optimista de la cookie (CVE-2025-29927 demostró que no basta).
   - **Páginas**: `requireUser()`.
   - **Actions y handlers**: `getSession()` + autorización por recurso.
6. Variables: `BETTER_AUTH_SECRET=__GENERATE__` y `BETTER_AUTH_URL` (https en prod).

## Comandos

```bash
make dev
make test
make verify SCOPE=src/features/<f>
make migration NAME=x   # Prisma; con MongoDB solo explica que no hay migraciones
make migrate            # Prisma: migraciones; MongoDB: crea los índices de los modelos
make sh
```

## Seguridad específica

- **Server Actions**: son endpoints POST públicos. Cada una valida la sesión y usa `safeParse`.
- **`import "server-only"`** en `services.ts` y `server.ts`.
- **Variables públicas**: nunca un secreto con prefijo `NEXT_PUBLIC_`. El entorno se valida en `src/lib/env.ts`.
- **Datos hacia el cliente**: usa `select` con los campos del contrato; no pases filas completas a Client Components.
- **HTML**: prohibido `dangerouslySetInnerHTML`.
- **MongoDB**: filtros solo con valores validados por Zod; nunca un objeto del cliente dentro de un filtro (inyección NoSQL con `$ne`, `$gt`…) ni `$where`. Lecturas con proyección y `.lean()`.

## Errores comunes

- Lógica de negocio en `page.tsx`.
- Un barril mixto (`index.ts` que reexporta services).
- `"use client"` en toda la página.
- Auth solo en el middleware.
- `npx tsc` sin `--no-install`.
- Olvidar `output: "standalone"`: la imagen de prod no arranca.
- Con MongoDB, `import "server-only"` en `model.ts` o `src/lib/db.ts`: `make migrate` los carga fuera de Next.js y falla.
