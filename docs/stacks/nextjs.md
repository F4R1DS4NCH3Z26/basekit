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
│   ├── schemas.ts   services.ts ("server-only")   actions.ts ("use server")   server.ts
│   ├── hooks/   stores.ts   components/
│   └── index.ts                     # API pública: solo componentes, tipos y schemas
├── components/  lib/ (db, env, auth, auth-client)  types/
prisma/  tests/features/<f>/
```

- **Dos puertas de API pública** por feature: `index.ts` (seguro para el cliente) y `server.ts` (servidor).
- **Las fugas entre features se bloquean con ESLint** (`no-restricted-imports` con `@/features/*/*`, salvo `/server` y `/actions`).

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, configs, `prisma/`, `src/lib/`, `src/types/`, root layout, `middleware.ts`/`proxy.ts` |
| data-writer | `schemas.ts`, `services.ts`, `actions.ts`, `server.ts`, `types.ts`, `src/app/api/**` |
| logic-writer | `stores.ts`, `hooks/**` |
| ui-writer | `components/**`, `index.ts`, `src/components/**`, `page`/`layout`/`loading`/`error`/`not-found` |
| qa-writer | `tests/**`, `e2e/**` |

Skills: `nextjs-scaffold`, `nextjs-verify` (la usa `make verify`), `nextjs-patterns` (+ `references/auth.md`).

## Docker

| Target | Uso |
|---|---|
| `deps` | `npm ci` (o `pnpm install --frozen-lockfile`) con caché |
| `dev` | `prisma generate` (si hay `prisma/`) + `next dev` en `0.0.0.0` |
| `build` | `prisma generate` + `next build`. También lo usa `migrate` en prod |
| `prod` | `output: "standalone"`, usuario `nextjs` (1001), healthcheck con `fetch` |

En dev, `node_modules` y `.next` van en **volúmenes con nombre**, para que el bind mount no los oculte; `make install` vuelve a ejecutar `npm ci` en el volumen. Se activa `WATCHPACK_POLLING` para que el hot reload funcione en Docker Desktop y WSL.

`make new-app` (si no hay `package.json`):
1. Corre `create-next-app@16.4.3` (TypeScript, ESLint, App Router, `src/`, Tailwind, alias `@/*`) dentro de `node:22-alpine` como root y al final devuelve los archivos a tu uid (`create-next-app` falla con un uid sin usuario en la imagen).
   Todas las dependencias se resuelven con `npm_config_before` = hace 14 días: ninguna versión publicada en las últimas dos semanas (rota o comprometida) entra en un proyecto nuevo.
2. Copia el resultado sin pisar archivos del kit.
3. Instala `zod`, `server-only` y Vitest + Testing Library.
4. Añade `output: "standalone"` a `next.config`.
5. Crea `/api/health`.

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
make migration NAME=x
make migrate
make sh
```

## Seguridad específica

- **Server Actions**: son endpoints POST públicos. Cada una valida la sesión y usa `safeParse`.
- **`import "server-only"`** en `services.ts` y `server.ts`.
- **Variables públicas**: nunca un secreto con prefijo `NEXT_PUBLIC_`. El entorno se valida en `src/lib/env.ts`.
- **Datos hacia el cliente**: usa `select` con los campos del contrato; no pases filas completas a Client Components.
- **HTML**: prohibido `dangerouslySetInnerHTML`.

## Errores comunes

- Lógica de negocio en `page.tsx`.
- Un barril mixto (`index.ts` que reexporta services).
- `"use client"` en toda la página.
- Auth solo en el middleware.
- `npx tsc` sin `--no-install`.
- Olvidar `output: "standalone"`: la imagen de prod no arranca.
