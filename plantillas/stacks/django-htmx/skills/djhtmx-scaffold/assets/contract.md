# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo de rutas: `/__NAME__/` (páginas HTML; sin API JSON)

## data-writer
### Modelo `__PASCAL__` (app `__NAME__`)
| Campo | Tipo Django | Nulo | Índice / FK (on_delete) |
|---|---|---|---|
| id | UUIDField(primary_key) | no | PK |

- `Meta.ordering`:

### Admin
- `list_display`:
- `search_fields`:

## logic-writer
- Excepciones: `__PASCAL__NotFound`
- `def __NAME___of(owner: User) -> QuerySet[__PASCAL__]:`
- `def create___NAME__(*, owner: User, ...) -> __PASCAL__:`

## views-writer
### Formularios
| Formulario | Campos (explícitos) | Reglas de validación |
|---|---|---|
| __PASCAL__Form | | |

### Pantallas
| Método | Path | Vista | Página completa | Parcial (HTMX) | Código | Swaps out-of-band |
|---|---|---|---|---|---|---|
| GET | /__NAME__/ | list | `__NAME__/list.html` | `__NAME__/_list.html` | 200 | — |
| POST | /__NAME__/new/ | create | `__NAME__/create.html` | `__NAME__/_create_form.html` (422 con errores) | 200 / 422 | |

- Login requerido: sí / no. Paginación: `?page=` con `hx-get` (20 por página).

## qa-writer
- Casos obligatorios: sin sesión → 302 al login (HTMX: `HX-Redirect`), página completa vs parcial con `HX-Request`, POST sin CSRF → 403, inválido → 422 con errores en el parcial, recurso ajeno → 404, datos escapados, caso feliz
