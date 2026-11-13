# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__` (Blueprint `bp` en `src/modules/__NAME__/routes.py`)

## data-writer
<!-- sql -->
### Tabla `__NAME__`
| Columna | Tipo | Nulo | Índice / FK |
|---|---|---|---|
| id | UUID | no | PK |
<!-- /sql -->
<!-- mongo -->
### Colección `__NAME__` (PyMongo, `models.py`: `COLLECTION`, `INDEXES` y `__PASCAL__Document`)
| Campo | Tipo | Nulo | Índice |
|---|---|---|---|
| _id | str (UUID) | no | PK |
<!-- /mongo -->

### Schemas (Pydantic v2)
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
- `def create___NAME__(db: Database[Any], data: __PASCAL__Create, owner_id: str) -> __PASCAL__Document:`
<!-- /mongo -->

## web-writer
| Método | Path | Entrada | Salida | Código | Auth |
|---|---|---|---|---|---|
| POST | /__NAME__ | __PASCAL__Create | __PASCAL__Read | 201 | sí |

## qa-writer
- Casos obligatorios: 401 sin auth, 404 recurso ajeno, 422 input inválido o campo extra, caso feliz
