## Stack: TypeScript · NestJS (API REST modular) + Prisma
- ESM (`"type": "module"`): imports relativos con `.js`. Datos: Prisma 7 sobre las variables del overlay de BD (`src/prisma/`) o, con MongoDB, Mongoose (`src/mongo/`, `MONGO_URL`). Validación: Zod con `ZodValidationPipe`. Auth: JWT propio (`src/common/auth/`). Tests: Vitest + supertest.
- `src/main.ts` (CORS, puerto) y `src/app.module.ts` (registro de módulos). `/health` en `src/health/`.
- `src/modules/<m>/`: `<m>.schemas.ts` (Zod estricto) · `<m>.repository.ts` (Prisma con `select`, o Mongoose con proyección) · `<m>.model.ts` (solo MongoDB: `@Schema` e índices) · `<m>.errors.ts` · `<m>.service.ts` (sin HTTP) · `<m>.controller.ts` · `<m>.module.ts` · `*.spec.ts`.
- El controller solo llama al service y traduce errores de dominio a HTTP (recurso ajeno → 404). El dueño de un recurso sale del token, nunca del body.

| Rol | Zona |
|---|---|
| orquestador | lo común + `package.json`, configs, `prisma/`, `prisma.config.ts`, `src/main.ts`, `src/app.*`, `src/common/`, `src/prisma/`, `src/mongo/`, `src/health/` |
| data-writer | `*.schemas.ts`, `*.repository.ts`, `*.model.ts` |
| logic-writer | `*.service.ts`, `*.errors.ts` |
| web-writer | `*.controller.ts`, `*.module.ts`, `*.guard.ts` de módulo |
| qa-writer | `src/**/*.spec.ts`, `test/` |

Comandos: `make dev` (puerto 3000) · `make test` · `make verify SCOPE=src/modules/<m>` · `make migration NAME=x` (Prisma; con MongoDB no hay migraciones) · `make migrate` (Prisma: migraciones; MongoDB: crea los índices de los modelos, nunca los borra)
