---
name: nest-patterns
description: "Código de referencia seguro para un módulo de API REST con NestJS - schema Zod estricto, repository Prisma con select (o Mongoose con proyección si la BD es MongoDB), errores de dominio, service sin HTTP, controller con guard JWT y ZodValidationPipe, y tests con Vitest. Úsala SIEMPRE antes de escribir schemas, repositories, services, controllers o tests de un módulo NestJS."
---

# nest-patterns

Ejemplo con el módulo `products`. Copia la forma y cambia los nombres. El proyecto es ESM (`"type": "module"`): los imports relativos llevan `.js`. Busca con Grep lo que ya existe en `src/common/` y `src/prisma/` (`ZodValidationPipe`, `PrismaService`, `JwtAuthGuard`, `CurrentUser`) antes de asumir sus nombres; el guard y el decorador están en `references/auth.md`.

**¿Prisma o Mongoose?** Si existe `src/mongo/` (BD MongoDB), el modelo y el repository son los de [Variante MongoDB](#variante-mongodb-mongoose); schemas Zod, errores, service, controller y tests no cambian.

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

Después: `make migration NAME=create_products` (genera el SQL y el cliente) y `make migrate`.

## products.schemas.ts — data-writer

```ts
import { z } from 'zod';

// strictObject: un cliente no puede colar ownerId, role, isAdmin… (mass assignment) → 400.
export const createProductSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  price: z.number().positive().max(1_000_000),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

// Salida: solo los campos que el contrato declara.
export type ProductRead = { id: string; name: string; price: number };
```

## products.repository.ts — data-writer

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CreateProductInput, ProductRead } from './products.schemas.js';

const productSelect = { id: true, name: true, price: true } as const; // nunca la fila completa

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateProductInput, ownerId: string): Promise<ProductRead> {
    return this.prisma.product.create({ data: { ...data, ownerId }, select: productSelect });
  }

  findOwned(id: string, ownerId: string): Promise<ProductRead | null> {
    return this.prisma.product.findFirst({ where: { id, ownerId }, select: productSelect });
  }

  listOwned(ownerId: string, page: number): Promise<ProductRead[]> {
    const take = 20; // paginación acotada (máximo 100)
    return this.prisma.product.findMany({ where: { ownerId }, select: productSelect, skip: (page - 1) * take, take });
  }
}
```

## products.errors.ts y products.service.ts — logic-writer

```ts
// products.errors.ts — sin imports de @nestjs/common: el dominio no conoce HTTP
export class ProductNotFoundError extends Error {
  constructor() {
    super('Producto no encontrado');
  }
}
```

```ts
// products.service.ts
import { Injectable } from '@nestjs/common';
import { ProductNotFoundError } from './products.errors.js';
import { ProductsRepository } from './products.repository.js';
import type { CreateProductInput, ProductRead } from './products.schemas.js';

@Injectable()
export class ProductsService {
  constructor(private readonly repository: ProductsRepository) {}

  create(input: CreateProductInput, userId: string): Promise<ProductRead> {
    return this.repository.create(input, userId); // el dueño sale de la sesión, nunca del body
  }

  async getOwned(id: string, userId: string): Promise<ProductRead> {
    const product = await this.repository.findOwned(id, userId);
    if (!product) throw new ProductNotFoundError(); // ajeno o inexistente: misma respuesta
    return product;
  }
}
```

## products.controller.ts y products.module.ts — web-writer

```ts
import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ProductNotFoundError } from './products.errors.js';
import { type CreateProductInput, type ProductRead, createProductSchema } from './products.schemas.js';
import { ProductsService } from './products.service.js';

@Controller('products')
@UseGuards(JwtAuthGuard)
export class ProductsController {
  constructor(private readonly service: ProductsService) {}

  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductRead> {
    return this.service.create(body, user.id);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<ProductRead> {
    try {
      return await this.service.getOwned(id, user.id);
    } catch (e) {
      if (e instanceof ProductNotFoundError) throw new NotFoundException(); // recurso ajeno → 404
      throw e;
    }
  }
}
```

```ts
// products.module.ts
import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

@Module({ controllers: [ProductsController], providers: [ProductsService, ProductsRepository] })
export class ProductsModule {}
```

El registro en `src/app.module.ts` (`imports: [..., ProductsModule]`) es del orquestador: indícalo en NOTAS.

## Tests — qa-writer (`products.controller.spec.ts`, Vitest con globals)

```ts
import { type ExecutionContext, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import { ProductsController } from './products.controller.js';
import { ProductNotFoundError } from './products.errors.js';
import { ProductsService } from './products.service.js';

describe('ProductsController', () => {
  const service = { create: vi.fn(), getOwned: vi.fn() };
  let app: INestApplication;
  let authenticated = true;

  beforeEach(async () => {
    vi.clearAllMocks();
    authenticated = true;
    const moduleRef = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProductsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { id: 'u1' };
          return authenticated;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterEach(() => app.close());

  it('sin sesión → 403', async () => {
    authenticated = false;
    await request(app.getHttpServer()).post('/products').send({ name: 'A', price: 1 }).expect(403);
  });
  it('input inválido o campo extra → 400 sin llamar al service', async () => {
    await request(app.getHttpServer()).post('/products').send({ name: 'A', price: 1, ownerId: 'x' }).expect(400);
    expect(service.create).not.toHaveBeenCalled();
  });
  it('recurso ajeno → 404', async () => {
    service.getOwned.mockRejectedValue(new ProductNotFoundError());
    await request(app.getHttpServer()).get('/products/7d9f1c1e-2b1a-4c3d-9e8f-0a1b2c3d4e5f').expect(404);
  });
  it('crea con input válido → 201', async () => {
    service.create.mockResolvedValue({ id: 'p1', name: 'A', price: 1 });
    await request(app.getHttpServer()).post('/products').send({ name: 'A', price: 1 }).expect(201, { id: 'p1', name: 'A', price: 1 });
    expect(service.create).toHaveBeenCalledWith({ name: 'A', price: 1 }, 'u1');
  });
});
```

Con el guard real, una petición sin token responde 401 (lo prueba el test del guard, no cada controller). Nada de red ni de BD real: el repository se mockea en los tests del service y el service en los del controller.

## Variante MongoDB (Mongoose)

Con MongoDB no hay Prisma: `src/mongo/mongo.module.ts` abre la conexión (`MONGO_URL`) y cada módulo declara su modelo en `<m>.model.ts`. El `_id` es un UUID en texto, así el contrato, `ParseUUIDPipe` y el tipo `id: string` son los mismos que con Prisma.

### products.model.ts — data-writer

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';

// Tipo explícito en cada @Prop: Vitest no emite metadata de decoradores.
@Schema({ collection: 'products', timestamps: true, versionKey: false })
export class ProductsEntity {
  @Prop({ type: String, default: () => randomUUID() })
  _id!: string;

  @Prop({ type: String, required: true, maxlength: 120 })
  name!: string;

  @Prop({ type: Number, required: true })
  price!: number;

  @Prop({ type: String, required: true })
  ownerId!: string;
}

export const ProductsEntitySchema = SchemaFactory.createForClass(ProductsEntity);
ProductsEntitySchema.index({ ownerId: 1, createdAt: -1 }); // los índices viven aquí, no en migraciones
```

Índices: en dev Mongoose los crea al arrancar (`autoIndex`); en prod no, los crea `make migrate ENV=prod` (`src/mongo/sync-indexes.ts`, que también borra los que el modelo ya no declara). `make migration` no aplica: no hay migraciones.

### products.repository.ts — data-writer

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ProductsEntity } from './products.model.js';
import type { CreateProductInput, ProductRead } from './products.schemas.js';

const productProjection = { _id: 1, name: 1, price: 1 } as const; // nunca el documento completo
const toRead = (d: Pick<ProductsEntity, '_id' | 'name' | 'price'>): ProductRead => ({ id: d._id, name: d.name, price: d.price });

@Injectable()
export class ProductsRepository {
  constructor(@InjectModel(ProductsEntity.name) private readonly model: Model<ProductsEntity>) {}

  async create(data: CreateProductInput, ownerId: string): Promise<ProductRead> {
    return toRead(await this.model.create({ ...data, ownerId }));
  }

  async findOwned(id: string, ownerId: string): Promise<ProductRead | null> {
    const doc = await this.model.findOne({ _id: id, ownerId }, productProjection).lean();
    return doc ? toRead(doc) : null;
  }

  async listOwned(ownerId: string, page: number): Promise<ProductRead[]> {
    const take = 20; // paginación acotada (máximo 100)
    const docs = await this.model.find({ ownerId }, productProjection).sort({ createdAt: -1 }).skip((page - 1) * take).limit(take).lean();
    return docs.map(toRead);
  }
}
```

- Filtros solo con valores ya validados por Zod (strings, números): nunca el `body` o un objeto del cliente dentro de un filtro (`{ $ne: … }` es inyección NoSQL). Nada de `$where` ni `$function`.
- `.lean()` + proyección en las lecturas; mapea `_id` a `id` antes de devolver.

### products.module.ts — web-writer

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductsController } from './products.controller.js';
import { ProductsEntity, ProductsEntitySchema } from './products.model.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [MongooseModule.forFeature([{ name: ProductsEntity.name, schema: ProductsEntitySchema }])],
  controllers: [ProductsController],
  providers: [ProductsService, ProductsRepository],
})
export class ProductsModule {}
```

Tests: iguales; el service se prueba con el repository mockeado, nunca con una BD real.

## Redis (si el proyecto lo activó)

`REDIS_URL` llega del overlay `compose.redis.yaml`. Úsalo para caché, rate limit o colas (`@nestjs/bullmq`); nunca como BD principal. Dependencias, con aprobación del usuario.
