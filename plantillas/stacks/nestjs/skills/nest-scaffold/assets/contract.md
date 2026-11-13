# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__`
<!-- prisma -->
- Modelo Prisma (lo agrega el orquestador en `prisma/schema.prisma` y genera la migración):

| Campo | Tipo Prisma | Nulo | Índice / relación |
|---|---|---|---|
| id | String @id @default(uuid()) | no | PK |
<!-- /prisma -->
<!-- mongo -->
- Modelo Mongoose (`__NAME__.model.ts`, lo escribe el data-writer; colección `__NAME__`; los índices los sincroniza `make migrate`):

| Campo | Tipo (@Prop) | Nulo | Índice |
|---|---|---|---|
| _id | String, default randomUUID() | no | PK |
<!-- /mongo -->

## data-writer
### Schemas (`__NAME__.schemas.ts`, Zod)
| Schema | Campos (tipo, restricciones) | Uso |
|---|---|---|
| create__PASCAL__Schema | | body de POST |
| __PASCAL__Read (tipo) | | respuesta |

### Repository (`__NAME__.repository.ts`)
- `create(data: Create__PASCAL__Input, ownerId: string): Promise<__PASCAL__Read>` · solo los campos de `__PASCAL__Read` (`select` en Prisma, proyección en Mongoose)

## logic-writer
- Errores: `__PASCAL__NotFoundError`
- `__PASCAL__Service.create(input: Create__PASCAL__Input, userId: string): Promise<__PASCAL__Read>`

## web-writer
| Método | Path | Entrada | Salida | Código | Auth |
|---|---|---|---|---|---|
| POST | /__NAME__ | create__PASCAL__Schema | __PASCAL__Read | 201 | sí |

## qa-writer
- Casos obligatorios: 401 sin auth, 404 recurso ajeno, 400 input inválido o campo extra, caso feliz
