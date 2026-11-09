---
name: nodenative-patterns
description: Código de referencia seguro para un módulo de una API en Node nativo (node:http + TypeScript, sin framework) - modelo Prisma 7, schemas Zod estrictos, repositorio Prisma con select, errores de dominio, service sin HTTP, router propio con safeParse y auth, y tests con Vitest y Supertest. Úsala SIEMPRE antes de escribir schemas, repository, services, router o tests de un módulo, para copiar el patrón del proyecto en vez de inventar uno.
---

# nodenative-patterns

Copia la forma, cambia los nombres. Ejemplo con el módulo `products`. Busca con Grep lo que ya existe en `src/lib/` (`Router`, `HttpError`, `db`, `requireUser`, `currentUser`) antes de asumir sus nombres. Auth: `references/auth.md`.

Imports relativos con extensión `.js` (ESM con `module: NodeNext`), aunque el archivo sea `.ts`.

Sin framework: la capa web es `node:http` con el router propio de `src/lib/router.ts` (método + ruta con `:params`, `use()` para middlewares, `mount()` para módulos) y `src/lib/http.ts` (cuerpo JSON con límite de 100 KB, cabeceras de seguridad, `HttpError` y errores → JSON). Un handler recibe `ctx` (`params`, `query`, `body` ya parseado, `locals`) y responde con `ctx.json(status, data)` o `ctx.empty()`. No agregues Express, Fastify, Koa, Hono ni NestJS.

Prisma 7: el cliente se genera en `src/generated/prisma/` (ignorado por git) y `src/lib/db.ts` lo crea con el *driver adapter* de la BD activa. Solo `repository.ts` toca datos, siempre con `db()`; nunca `new PrismaClient()` ni imports de `@prisma/*` en un módulo. Si `src/lib/db.ts` no existe, el proyecto no tiene BD: actívala con la skill infra-setup y ejecuta `bash .agents/skills/nodenative-scaffold/scripts/app-setup.sh` dentro de `make sh`.

## Modelo Prisma — orquestador (`prisma/schema.prisma`)

```prisma
model Product {
  id        String   @id @default(uuid())
  name      String   @db.VarChar(120) // en SQLite, quita @db.VarChar
  price     Float
  ownerId   String
  createdAt DateTime @default(now())

  @@index([ownerId])
}
```

Después: `make migration NAME=create_products` (crea el SQL y regenera el cliente: en Prisma 7 `migrate dev` ya no lo hace solo) y `make migrate`.

## schemas.ts — data-writer

```ts
import { z } from "zod";

// .strict(): un cliente no puede colar ownerId, role, isAdmin… (mass assignment)
export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().positive().max(1_000_000),
}).strict();
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const productIdSchema = z.object({ id: z.uuid() }).strict();

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export type ProductRead = { id: string; name: string; price: number };
```

## repository.ts — data-writer

```ts
import type { Prisma } from "../../generated/prisma/client.js"; // solo tipos; los datos, con db()
import { db } from "../../lib/db.js";
import type { CreateProductInput, ProductRead } from "./schemas.js";

// Solo campos del contrato (+ dueño). satisfies: un campo que no existe en el modelo no compila.
const fields = { id: true, name: true, price: true, ownerId: true } satisfies Prisma.ProductSelect;

export function insertProduct(data: CreateProductInput, ownerId: string) {
  return db().product.create({ data: { ...data, ownerId }, select: fields });
}

export function findProduct(id: string) {
  return db().product.findUnique({ where: { id }, select: fields });
}

export function listProducts(ownerId: string, take: number, skip: number) {
  return db().product.findMany({
    where: { ownerId },              // Prisma parametriza: nunca $queryRawUnsafe con datos del usuario
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 100),
    skip,
    select: fields,
  });
}

export const toRead = ({ id, name, price }: { id: string; name: string; price: unknown }): ProductRead =>
  ({ id, name, price: Number(price) });
```

## errors.ts y services.ts — logic-writer

```ts
// errors.ts
export class ProductNotFound extends Error {}
export class ProductForbidden extends Error {}
```

```ts
// services.ts — sin node:http, src/lib/router, src/lib/http, @prisma/*, src/generated/ ni db() (ESLint lo bloquea)
import { ProductForbidden, ProductNotFound } from "./errors.js";
import * as repo from "./repository.js";
import type { CreateProductInput, ProductRead } from "./schemas.js";

export async function createProduct(data: CreateProductInput, ownerId: string): Promise<ProductRead> {
  return repo.toRead(await repo.insertProduct(data, ownerId)); // ownerId viene del usuario autenticado
}

export async function getProduct(id: string, userId: string): Promise<ProductRead> {
  const product = await repo.findProduct(id);
  if (!product) throw new ProductNotFound(id);
  if (product.ownerId !== userId) throw new ProductForbidden(id);
  return repo.toRead(product);
}

export async function listProducts(ownerId: string, limit: number, offset: number): Promise<ProductRead[]> {
  return (await repo.listProducts(ownerId, limit, offset)).map(repo.toRead);
}
```

## router.ts — web-writer

```ts
import { z } from "zod";
import { currentUser, requireUser } from "../../lib/auth.js";
import { Router } from "../../lib/router.js";
import { ProductForbidden, ProductNotFound } from "./errors.js";
import { createProductSchema, listQuerySchema, productIdSchema } from "./schemas.js";
import * as services from "./services.js";

export const productsRouter = new Router();
productsRouter.use(requireUser); // todo el módulo exige sesión (401 sin token)

const invalid = (error: z.ZodError) => ({ error: "Datos inválidos", fieldErrors: z.flattenError(error).fieldErrors });

productsRouter.post("/", async (ctx) => {
  const parsed = createProductSchema.safeParse(ctx.body); // body ya es JSON (o undefined): 422 si no cumple
  if (!parsed.success) return ctx.json(422, invalid(parsed.error));
  ctx.json(201, await services.createProduct(parsed.data, currentUser(ctx).id));
});

productsRouter.get("/", async (ctx) => {
  const parsed = listQuerySchema.safeParse(ctx.query);
  if (!parsed.success) return ctx.json(422, invalid(parsed.error));
  ctx.json(200, await services.listProducts(currentUser(ctx).id, parsed.data.limit, parsed.data.offset));
});

productsRouter.get("/:id", async (ctx) => {
  const parsed = productIdSchema.safeParse(ctx.params);
  if (!parsed.success) return ctx.json(422, invalid(parsed.error));
  try {
    ctx.json(200, await services.getProduct(parsed.data.id, currentUser(ctx).id));
  } catch (e) {
    // 404 también para recursos ajenos: no revela que existen. Lo demás sigue a sendError (500 sin detalles).
    if (e instanceof ProductNotFound || e instanceof ProductForbidden) return ctx.json(404, { error: "No encontrado" });
    throw e;
  }
});
```

Registro (orquestador, `src/app.ts`): `router.mount("/products", productsRouter);`

- Un error lanzado (o una promesa rechazada) en un handler llega a `sendError` de `src/lib/http.ts`: `HttpError` 4xx conserva su código y mensaje; lo demás es 500 sin detalles. No uses `HttpError` en `services.ts`: el router traduce los errores de dominio.
- Un handler siempre responde (`ctx.json` o `ctx.empty`); si no, el router responde 500.
- Middleware del módulo (`middleware.ts`): `(ctx, next) => { …; await next(); }`. Si no llama a `next()`, debe responder.

## Test — qa-writer (`tests/modules/products/router.test.ts`)

```ts
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/modules/products/repository.js", () => ({
  insertProduct: vi.fn(), findProduct: vi.fn(), listProducts: vi.fn(),
  toRead: ({ id, name, price }: { id: string; name: string; price: unknown }) => ({ id, name, price: Number(price) }),
}));

import { createApp } from "../../../src/app.js";
import * as repo from "../../../src/modules/products/repository.js";
import { tokenFor } from "../../helpers/auth.js"; // firma un JWT de prueba con JWT_SECRET (tests/helpers, zona qa)

const app = createApp(); // un RequestListener de node:http: Supertest lo envuelve en un servidor efímero

describe("POST /products", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401 sin token", async () => {
    expect((await request(app).post("/products").send({ name: "A", price: 1 })).status).toBe(401);
  });

  it("422 con un campo extra", async () => {
    const res = await request(app).post("/products").set("Authorization", `Bearer ${await tokenFor("u1")}`)
      .send({ name: "A", price: 1, ownerId: "otro" });
    expect(res.status).toBe(422);
    expect(repo.insertProduct).not.toHaveBeenCalled();
  });

  it("201 con input válido", async () => {
    vi.mocked(repo.insertProduct).mockResolvedValue({ id: "p1", name: "A", price: 1, ownerId: "u1" } as never);
    const res = await request(app).post("/products").set("Authorization", `Bearer ${await tokenFor("u1")}`)
      .send({ name: "A", price: 1 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "p1", name: "A", price: 1 });
  });
});
```
