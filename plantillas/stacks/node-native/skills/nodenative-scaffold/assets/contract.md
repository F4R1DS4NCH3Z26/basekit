# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__`
- Modelo Prisma `__PASCAL__` (lo agrega el orquestador en `prisma/schema.prisma` antes de delegar):

| Campo | Tipo | Nulo | Índice / relación |
|---|---|---|---|
| id | String @id @default(uuid()) | no | PK |

## data-writer
### Schemas (`schemas.ts`, Zod `.strict()`)
| Schema | Campos (tipo, restricciones) | Uso |
|---|---|---|
| create__PASCAL__Schema | | body de POST |
| __PASCAL__Read (tipo) | | respuesta |

### Repositorio (`repository.ts`, Prisma con `select`)
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
