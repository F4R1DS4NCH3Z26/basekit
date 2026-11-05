# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__`

## data-writer
### Tabla `__NAME__`
| Columna | Tipo | Nulo | Índice / FK |
|---|---|---|---|
| id | UUID | no | PK |

### Schemas
| Schema | Campos (tipo, restricciones) |
|---|---|
| __PASCAL__Create | |
| __PASCAL__Read | |

## logic-writer
- Excepciones: `__PASCAL__NotFound`, `__PASCAL__Forbidden`
- `def create___NAME__(db: Session, data: __PASCAL__Create, owner_id: UUID) -> __PASCAL__:`

## web-writer
| Método | Path | Entrada | Salida | Código | Auth |
|---|---|---|---|---|---|
| POST | /__NAME__ | __PASCAL__Create | __PASCAL__Read | 201 | sí |

## qa-writer
- Casos obligatorios: 401 sin auth, 404 recurso ajeno, 422 input inválido o campo extra, caso feliz
