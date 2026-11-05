## Stack: Next.js (App Router) + TypeScript
- Datos: Prisma (o Drizzle si una ADR lo decide) sobre `DATABASE_URL`. Auth: Better Auth (`src/lib/auth.ts`). Tests: Vitest.
- `src/app/`: solo enrutamiento (`page`, `layout`, `loading`, `error`). `src/features/<f>/`: `schemas.ts` (Zod) · `services.ts` (`server-only`) · `actions.ts` (`"use server"`) · `server.ts` · `hooks/` · `stores.ts` · `components/` · `index.ts` (API pública, nada de servidor).
- Entre features solo se importa `@/features/<f>`, `/server` o `/actions` (regla de ESLint).
- Toda Server Action valida sesión (`getSession()`) y su input (`safeParse`): es un endpoint público. El middleware no basta como única capa de auth.

| Rol | Zona |
|---|---|
| orquestador | lo común + `package.json`, configs, `prisma/`, `src/lib/`, `src/types/`, root layout, middleware |
| data-writer | `schemas`, `services`, `actions`, `server.ts`, `src/app/api/**` |
| logic-writer | `stores.ts`, `hooks/` |
| ui-writer | `components/`, `index.ts`, páginas y layouts |
| qa-writer | `tests/` |

Comandos: `make dev` (puerto 3000) · `make test` · `make verify SCOPE=src/features/<f>` · `make migration NAME=x` (Prisma) · `make migrate`
