# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__`
<!-- prisma -->
- Modelo Prisma `__PASCAL__` (lo agrega el orquestador en `prisma/schema.prisma` antes de delegar):

| Campo | Tipo | Nulo | Índice / relación |
|---|---|---|---|
| id | String @id @default(uuid()) | no | PK |
<!-- /prisma -->
<!-- mongo -->
- Modelo Mongoose `__PASCAL__Model` (`model.ts`, lo escribe el data-writer; colección `__NAME__`; los índices los crea `make migrate`):

| Campo | Tipo (Schema) | Nulo | Índice |
|---|---|---|---|
| _id | String, default randomUUID() | no | PK |
<!-- /mongo -->

## data-writer
### Schemas (`schemas.ts`, Zod `.strict()`)
| Schema | Campos (tipo, restricciones) | Uso |
|---|---|---|
| create__PASCAL__Schema | | body de POST |
| __PASCAL__Read (tipo) | | respuesta |

<!-- prisma -->
### Repositorio (`repository.ts`, Prisma con `select`)
<!-- /prisma -->
<!-- mongo -->
### Repositorio (`repository.ts`, Mongoose con proyección y `.lean()`; `_id` se devuelve como `id`)
<!-- /mongo -->
- `insert__PASCAL__(data: Create__PASCAL__Input, ownerId: string): Promise<__PASCAL__Read>`

## logic-writer
- Errores: `__PASCAL__NotFound`, `__PASCAL__Forbidden`
- `create__PASCAL__(data: Create__PASCAL__Input, ownerId: string): Promise<__PASCAL__Read>`

## web-writer
| Método | Path | Entrada | Salida | Código | Auth |
|---|---|---|---|---|---|
| POST | /__NAME__ | create__PASCAL__Schema | __PASCAL__Read | 201 | sí |

## qa-writer
- Casos obligatorios: 401 sin auth, 404 recurso ajeno, 422 input inválido o campo extra, caso feliz
