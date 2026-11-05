# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Paquete: `__PKG__.modules.__NAME__`
- Permisos: <rol> puede <acción>; dueño puede <acción>
- Base path: `/api/__NAME__`

## domain-writer
- Migración: `V<n>__create___NAME__.sql`  (n = <número único>)

| Columna | Tipo SQL | Nulo | Índice / FK |
|---|---|---|---|
| id | uuid | no | PK |
| owner_id | uuid | no | index |

- Entidad `__PASCAL__` (renómbrala en singular si aplica, p. ej. Order): fábrica `create(...)`, invariantes:
- Repositorio `__PASCAL__Repository`: `save`, `findByIdAndOwnerId(UUID, UUID): Optional<__PASCAL__>`
- Excepciones: `__PASCAL__NotFoundException`

## app-writer
- `record Create__PASCAL__Request(@NotBlank @Size(max=120) String name, …)`
- `record __PASCAL__Response(UUID id, …)`
- `__PASCAL__Service.create(Create__PASCAL__Request req, UUID ownerId): __PASCAL__Response`

## web-writer
| Método | Path | Request | Response | Código | Auth |
|---|---|---|---|---|---|
| POST | /api/__NAME__ | Create__PASCAL__Request | __PASCAL__Response | 201 | sí |

## qa-writer
- Casos obligatorios: 401, 400 validación, 404 ajeno, caso feliz; unitario del servicio
