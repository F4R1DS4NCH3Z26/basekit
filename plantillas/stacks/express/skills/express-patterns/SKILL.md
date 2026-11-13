---
name: express-patterns
description: Código de referencia seguro para un módulo de una API Express 5 + TypeScript - modelo Prisma 7, schemas Zod estrictos, repositorio Prisma con select, errores de dominio, service sin HTTP, router con safeParse y auth, y tests con Vitest y Supertest. Úsala SIEMPRE antes de escribir schemas, repository, services, router o tests de un módulo Express, para copiar el patrón del proyecto en vez de inventar uno.
---

# express-patterns

Copia la forma, cambia los nombres. Ejemplo con el módulo `products`. Busca con Grep lo que ya existe en `src/lib/` (`db`, `requireUser`, `currentUser`) antes de asumir sus nombres. Auth: `references/auth.md`.

Imports relativos con extensión `.js` (ESM con `module: NodeNext`), aunque el archivo sea `.ts`.

Prisma 7: el cliente se genera en `src/generated/prisma/` (ignorado por git) y `src/lib/db.ts` lo crea con el *driver adapter* de la BD activa. Solo `repository.ts` toca datos, siempre con `db()`; nunca `new PrismaClient()` ni imports de `@prisma/*` en un módulo. Si `src/lib/db.ts` no existe, el proyecto no tiene BD: actívala con la skill infra-setup y ejecuta `bash .agents/skills/express-scaffold/scripts/app-setup.sh` dentro de `make sh`.

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

## MongoDB (Mongoose): model.ts y repository.ts — data-writer

Solo si existe `src/mongo/` (la BD es MongoDB; no hay Prisma ni `src/lib/db.ts`). `src/server.ts` conecta con `connectMongo()` antes de escuchar; los módulos solo importan su modelo. El `_id` es un UUID en texto, así `productIdSchema` (`z.uuid()`) y el contrato no cambian.

```ts
// model.ts
import { randomUUID } from "node:crypto";
import { model, Schema } from "mongoose";

const productSchema = new Schema(
  {
    _id: { type: String, default: () => randomUUID() },
    name: { type: String, required: true, maxlength: 120 },
    price: { type: Number, required: true },
    ownerId: { type: String, required: true, index: true }, // índice: en dev lo crea la app; en prod, make migrate
  },
  { collection: "products", timestamps: true, versionKey: false },
);

export const ProductModel = model("Product", productSchema);
```

```ts
// repository.ts
import { ProductModel } from "./model.js";
import type { CreateProductInput, ProductRead } from "./schemas.js";

// Solo campos del contrato (+ dueño): proyección y .lean() (objetos planos, no documentos).
const fields = { _id: 1, name: 1, price: 1, ownerId: 1 } as const;
type Row = { _id: string; name: string; price: number; ownerId: string };

export async function insertProduct(data: CreateProductInput, ownerId: string) {
  const doc = await ProductModel.create({ ...data, ownerId });
  return { _id: doc._id, name: doc.name, price: doc.price, ownerId: doc.ownerId } satisfies Row;
}

export function findProduct(id: string) {
  return ProductModel.findById(id, fields).lean<Row>().exec(); // id ya validado con z.uuid()
}

export function listProducts(ownerId: string, take: number, skip: number) {
  // Filtros solo con valores validados (strings, números): nunca un objeto del cliente (inyección NoSQL), ni $where.
  return ProductModel.find({ ownerId }, fields).sort({ createdAt: -1 }).skip(skip).limit(Math.min(take, 100)).lean<Row[]>().exec();
}

export const toRead = ({ _id, name, price }: Row): ProductRead => ({ id: _id, name, price });
```

- Quitar un índice del modelo no lo borra: `make migrate` solo crea (`createIndexes`). Bórralo a mano: `make db-shell` → `db.products.dropIndex('<nombre>')`.
- `services.ts` y `router.ts` no importan `mongoose` ni `model.ts` (ESLint solo bloquea Prisma y `src/lib/db`: respétalo igual).
- Tests: igual que con Prisma, mockea `repository.js` con `vi.mock`; no hace falta MongoDB.

## errors.ts y services.ts — logic-writer

```ts
// errors.ts
export class ProductNotFound extends Error {}
export class ProductForbidden extends Error {}
```

```ts
// services.ts — sin express, @prisma/*, src/generated/ ni db() (ESLint lo bloquea)
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
import { Router } from "express";
import { z } from "zod";
import { currentUser, requireUser } from "../../lib/auth.js";
import { ProductForbidden, ProductNotFound } from "./errors.js";
import { createProductSchema, listQuerySchema, productIdSchema } from "./schemas.js";
import * as services from "./services.js";

export const productsRouter = Router();
productsRouter.use(requireUser); // todo el módulo exige sesión (401 sin token)

const invalid = (error: z.ZodError) => ({ error: "Datos inválidos", fieldErrors: z.flattenError(error).fieldErrors });

productsRouter.post("/", async (req, res) => {
  const parsed = createProductSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(422).json(invalid(parsed.error));
  res.status(201).json(await services.createProduct(parsed.data, currentUser(res).id));
});

productsRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return void res.status(422).json(invalid(parsed.error));
  res.json(await services.listProducts(currentUser(res).id, parsed.data.limit, parsed.data.offset));
});

productsRouter.get("/:id", async (req, res) => {
  const parsed = productIdSchema.safeParse(req.params);
  if (!parsed.success) return void res.status(422).json(invalid(parsed.error));
  try {
    res.json(await services.getProduct(parsed.data.id, currentUser(res).id));
  } catch (e) {
    // 404 también para recursos ajenos: no revela que existen. Lo demás sigue al errorHandler (500 sin detalles).
    if (e instanceof ProductNotFound || e instanceof ProductForbidden) return void res.status(404).json({ error: "No encontrado" });
    throw e;
  }
});
```

Registro (orquestador, `src/app.ts`): `app.use("/products", productsRouter);`

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

const app = createApp();

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
