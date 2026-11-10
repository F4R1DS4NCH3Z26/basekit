# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Prefijo HTTP: `/__NAME__`
- Paquete Go: `app/internal/__NAME__`

## data-writer
### Tabla `__NAME__` (migración SQL que crea el orquestador)
| Columna | Tipo SQL portable | Nulo | Índice / FK |
|---|---|---|---|
| id | VARCHAR(26) | no | PK (`rand.Text()`) |
| owner_id | VARCHAR(26) | no | índice |
| created_at | TIMESTAMP | no | |

### Modelo y DTO
| Tipo | Campos (tipo Go, tag `json`; reglas de `Validate()`) |
|---|---|
| __PASCAL__ (model.go) | |
| Create__PASCAL__Request | |
| __PASCAL__Response | |

### Repositorio (`SQLRepository` sobre `db.Querier`, implementa `Repository`; SQL con `?`)
- `func (r *SQLRepository) Create(ctx context.Context, x *__PASCAL__) error`
- `func (r *SQLRepository) Get(ctx context.Context, id string) (__PASCAL__, error)` → `ErrNotFound`

## logic-writer
- Errores (`errors.go`): `ErrNotFound`, `ErrForbidden`
- `type Repository interface { … }` (los métodos de arriba)
- `func (s *Service) Create(ctx context.Context, ownerID string, in Create__PASCAL__Request) (__PASCAL__, error)`

## web-writer
| Método | Path | Entrada | Salida | Código | Auth |
|---|---|---|---|---|---|
| POST | /__NAME__ | Create__PASCAL__Request | __PASCAL__Response | 201 | sí |

## qa-writer
- Casos obligatorios: 401 sin auth, 404 recurso ajeno, 422 input inválido o campo extra, 405 método equivocado, 413 cuerpo de más de 1 MiB, caso feliz
- Repositorio sobre SQLite en memoria con el SQL de la migración
