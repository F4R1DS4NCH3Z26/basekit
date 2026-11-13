# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; dueño puede <acción>
- Prefijo: `/api/__KEBAB__` · Auth: access token (firewall `main`)

## data-writer
<!-- sql -->
### Entidad `__NAME__` → tabla `__SNAKE__`
| Campo | Tipo Doctrine | Nulo | Índice / relación |
|---|---|---|---|
| id | uuid (Symfony Uid) | no | PK |
| owner | ManyToOne(User) | no | index, onDelete CASCADE |
<!-- /sql -->
<!-- mongo -->
### Documento `__NAME__` → colección `__SNAKE__` (Doctrine MongoDB ODM, `Domain/Entity/__NAME__.php`)
| Campo | Tipo ODM | Nulo | Índice |
|---|---|---|---|
| id | string (UUID, strategy NONE) | no | PK (`_id`) |
| ownerId | string | no | `#[ODM\Index]` |

- Índices: `#[ODM\Index]` en el documento; los crea `make migrate`.
<!-- /mongo -->

- Campos que asigna el servidor (sin setter):
- Enums:
- Repositorio: `findOneOwnedBy(string $id, User $owner): ?<X>`

## app-writer
- DTO `Create<X>Data(string $name, int $priceCents)`
- Handler `Create<X>::handle(Create<X>Data $data, User $owner): <X>`
- Voter `<X>Voter`: VIEW/EDIT/DELETE solo dueño

## http-writer
| Método | URI | Request (constraints) | Handler | Resource | Código |
|---|---|---|---|---|---|
| POST | /api/__KEBAB__ | | | | 201 |

## qa-writer
- Casos obligatorios: 401, 422, campo protegido ignorado, 404 ajeno, caso feliz
