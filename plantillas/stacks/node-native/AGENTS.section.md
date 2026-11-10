## Stack: TypeScript · Nativo (node:http, sin framework)
- `node:http` + TypeScript strict (ESM), sin framework web (ni Express, Fastify, Koa, Hono o NestJS). Validación: Zod. Datos: Prisma 7 con el adaptador de la BD activa (postgres, mysql o sqlite; sin BD, sin Prisma). Auth: JWT propio (`src/lib/auth.ts`). Tests: Vitest + Supertest.
- `src/app.ts`: `createApp()` arma el `Router`, `/health` y monta los routers de cada módulo. `src/server.ts`: `createServer`, timeouts y cierre con SIGTERM. `src/lib/`: `router.ts` (método + ruta con `:params`, middlewares, 404/405), `http.ts` (cuerpo JSON ≤ 100 KB, cabeceras de seguridad, errores → JSON), `env.ts` (Zod), `db.ts` (Prisma, si hay BD; cliente en `src/generated/prisma/`).
- `src/modules/<m>/`: `schemas.ts` (Zod) · `repository.ts` (Prisma, con `select`) · `errors.ts` · `services.ts` (sin HTTP) · `router.ts` (`new Router()`). Tests en `tests/modules/<m>/`.
- Entrada siempre con `safeParse` sobre schemas `.strict()` (`ctx.body`, `ctx.params`, `ctx.query`); salida solo con los campos del contrato. Un error lanzado en un handler termina en `sendError` (`src/lib/http.ts`): 500 sin detalles.

| Rol | Zona |
|---|---|
| orquestador | lo común + `package.json`, configs, `prisma/`, `prisma.config.ts`, `src/generated/`, `src/app.ts`, `src/server.ts`, `src/lib/`, `src/types/` |
| data-writer | `schemas.ts`, `repository.ts` |
| logic-writer | `services.ts`, `errors.ts` |
| web-writer | `router.ts`, `middleware.ts` |
| qa-writer | `tests/` |

Comandos: `make new-app` (una vez) · `make dev` (puerto 3000) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (Prisma: SQL + cliente) · `make migrate`
