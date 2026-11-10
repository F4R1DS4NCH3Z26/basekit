## Stack: TypeScript · Express (API REST minimalista)
- Express 5 + TypeScript strict (ESM). Validación: Zod. Datos: Prisma 7 con el adaptador de la BD activa (postgres, mysql o sqlite; sin BD, sin Prisma). Auth: JWT propio (`src/lib/auth.ts`). Tests: Vitest + Supertest.
- `src/app.ts`: `createApp()`, middlewares, `/health` y registro de routers. `src/server.ts`: arranque. `src/lib/`: `env.ts` (Zod), `db.ts` (Prisma, si hay BD; cliente en `src/generated/prisma/`), `http.ts` (errores).
- `src/modules/<m>/`: `schemas.ts` (Zod) · `repository.ts` (Prisma, con `select`) · `errors.ts` · `services.ts` (sin Express) · `router.ts`. Tests en `tests/modules/<m>/`.
- Entrada siempre con `safeParse` sobre schemas `.strict()`; salida solo con los campos del contrato. Express 5 propaga los errores async al manejador de `src/lib/http.ts`.

| Rol | Zona |
|---|---|
| orquestador | lo común + `package.json`, configs, `prisma/`, `prisma.config.ts`, `src/generated/`, `src/app.ts`, `src/server.ts`, `src/lib/`, `src/types/` |
| data-writer | `schemas.ts`, `repository.ts` |
| logic-writer | `services.ts`, `errors.ts` |
| web-writer | `router.ts`, `middleware.ts` |
| qa-writer | `tests/` |

Comandos: `make new-app` (una vez) · `make dev` (puerto 3000) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (Prisma: SQL + cliente) · `make migrate`
