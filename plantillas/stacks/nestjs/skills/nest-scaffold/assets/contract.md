# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__`
- Modelo Prisma (lo agrega el orquestador en `prisma/schema.prisma` y genera la migración):

| Campo | Tipo Prisma | Nulo | Índice / relación |
|---|---|---|---|
| id | String @id @default(uuid()) | no | PK |

## data-writer
### Schemas (`__NAME__.schemas.ts`, Zod)
| Schema | Campos (tipo, restricciones) | Uso |
|---|---|---|
| create__PASCAL__Schema | | body de POST |
| __PASCAL__Read (tipo) | | respuesta |

### Repository (`__NAME__.repository.ts`)
- `create(data: Create__PASCAL__Input, ownerId: string): Promise<__PASCAL__Read>` · `select` solo con los campos de `__PASCAL__Read`

## logic-writer
- Errores: `__PASCAL__NotFoundError`
- `__PASCAL__Service.create(input: Create__PASCAL__Input, userId: string): Promise<__PASCAL__Read>`

## web-writer
| Método | Path | Entrada | Salida | Código | Auth |
|---|---|---|---|---|---|
| POST | /__NAME__ | create__PASCAL__Schema | __PASCAL__Read | 201 | sí |

## qa-writer
- Casos obligatorios: 401 sin auth, 404 recurso ajeno, 400 input inválido o campo extra, caso feliz
