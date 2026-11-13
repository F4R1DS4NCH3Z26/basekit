# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; dueño puede <acción>
- Prefijo: `/api/__KEBAB__` · Auth: bearer token (todas las rutas salvo `public: true`)

## data-writer
<!-- sql -->
### Tabla `__SNAKE__` (migración en `src/Modules/__NAME__/Migrations/`)
| Columna | Tipo SQL (portable) | Nulo | Índice / relación |
|---|---|---|---|
| id | CHAR(36) (UUID v7) | no | PK |
| owner_id | CHAR(36) | no | index, FK users(id) ON DELETE CASCADE |
| created_at | TIMESTAMP (UTC) | no | |

- Variantes por motor (solo si hace falta): `.pgsql.sql` / `.mysql.sql` / `.sqlite.sql`
<!-- /sql -->
<!-- mongo -->
### Colección `__SNAKE__` (MongoDB; índices en `src/Modules/__NAME__/Migrations/indexes.php`)
| Campo | Tipo | Nulo | Índice |
|---|---|---|---|
| _id | string (UUID v7) | no | PK |
| owner_id | string (UUID) | no | `['key' => ['owner_id' => 1]]` |
| created_at | string (ISO 8601, UTC) | no | |
<!-- /mongo -->
- Campos que asigna el servidor (sin setter):
- Enums:
- Repositorio: `findOwnedBy(string $id, string $ownerId): ?<X>`

## app-writer
- DTO `Create<X>Data(string $name, int $priceCents)`
- Handler `Create<X>::handle(Create<X>Data $data, Identity $owner): <X>`
- Policy `<X>Policy`: ver/editar/borrar solo dueño

## http-writer
| Método | URI | Input (validación) | Handler | Resource | Código |
|---|---|---|---|---|---|
| POST | /api/__KEBAB__ | | | | 201 |

## qa-writer
- Casos obligatorios: 401, 422, campo protegido ignorado, 404 ajeno, caso feliz
