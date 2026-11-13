# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__`

## data-writer
<!-- sql -->
### Tabla `__NAME__`
| Columna | Tipo | Nulo | Índice / FK |
|---|---|---|---|
| id | UUID | no | PK |
<!-- /sql -->
<!-- mongo -->
### Colección `__NAME__` (Beanie, `models.py`, clase `__PASCAL__`)
| Campo | Tipo | Nulo | Índice |
|---|---|---|---|
| _id | str (UUID) | no | PK |
<!-- /mongo -->

### Schemas
| Schema | Campos (tipo, restricciones) |
|---|---|
| __PASCAL__Create | |
| __PASCAL__Read | |

## logic-writer
- Excepciones: `__PASCAL__NotFound`, `__PASCAL__Forbidden`
<!-- sql -->
- `def create___NAME__(db: Session, data: __PASCAL__Create, owner_id: UUID) -> __PASCAL__:`
<!-- /sql -->
<!-- mongo -->
- `async def create___NAME__(data: __PASCAL__Create, owner_id: str) -> __PASCAL__:`
<!-- /mongo -->

## web-writer
| Método | Path | Entrada | Salida | Código | Auth |
|---|---|---|---|---|---|
| POST | /__NAME__ | __PASCAL__Create | __PASCAL__Read | 201 | sí |

## qa-writer
- Casos obligatorios: 401 sin auth, 404 recurso ajeno, 422 input inválido o campo extra, caso feliz
