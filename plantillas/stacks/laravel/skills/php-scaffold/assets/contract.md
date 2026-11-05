# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Permisos: <rol> puede <acción>; dueño puede <acción>
- Prefijo: `/api/__KEBAB__` · Guard: sanctum

## data-writer
### Tabla `__SNAKE__`
| Columna | Tipo | Nulo | Índice / FK |
|---|---|---|---|
| id | uuid | no | PK |
| owner_id | foreignId(users) | no | index, cascadeOnDelete |

- `$fillable`:
- Enums:

## app-writer
- DTO `Create<X>Data(string $name, int $priceCents)`
- Action `Create<X>::handle(Create<X>Data $data, User $owner): <X>`
- Policy `<X>Policy`: view/update/delete solo dueño

## http-writer
| Método | URI | FormRequest (reglas) | Action | Resource | Código |
|---|---|---|---|---|---|
| POST | /api/__KEBAB__ | | | | 201 |

## qa-writer
- Casos obligatorios: 401, 422, campo protegido ignorado, 404 ajeno, caso feliz
