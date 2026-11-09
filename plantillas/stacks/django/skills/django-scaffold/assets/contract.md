# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/api/__NAME__/`

## data-writer
### Modelo `__PASCAL__` (app `__NAME__`)
| Campo | Tipo Django | Nulo | Índice / FK (on_delete) |
|---|---|---|---|
| id | UUIDField(primary_key) | no | PK |

### Serializers
| Serializer | Campos (explícitos) | read_only_fields |
|---|---|---|
| __PASCAL__CreateSerializer | | |
| __PASCAL__ReadSerializer | | |

### Admin
- `list_display`:
- `search_fields`:

## logic-writer
- Excepciones: `__PASCAL__NotFound`, `__PASCAL__Forbidden`
- `def create___NAME__(*, owner: User, data: dict[str, Any]) -> __PASCAL__:`

## web-writer
| Método | Path | Entrada | Salida | Código | Permisos |
|---|---|---|---|---|---|
| POST | /api/__NAME__/ | __PASCAL__CreateSerializer | __PASCAL__ReadSerializer | 201 | IsAuthenticated |

## qa-writer
- Casos obligatorios: 401/403 sin auth, 404 recurso ajeno, 400 input inválido, campo del servidor ignorado, caso feliz
