# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Entidad / tabla y campos (nombre: tipo, nullable):
- Permisos: <rol> puede <acción>; anónimo puede <acción>
- Rutas: `/__NAME__` (pública | requiere sesión)

## data-writer
### Schemas (`schemas.ts`)
| Schema | Campos (Zod) | Uso |
|---|---|---|
| | | |

### Services (`services.ts`, server-only)
- `get__PASCAL__List(params: { page: number }): Promise<__PASCAL__ListItem[]>`

### Server Actions (`actions.ts`)
- `create__PASCAL__(prev, formData): Promise<ActionResult<{ id: string }>>` · auth: sesión · revalida: `/__NAME__`

## logic-writer
- Stores: ninguno
- Hooks: ninguno

## ui-writer
| Componente | server/client | Props | Usa |
|---|---|---|---|
| | | | |

| Ruta (`src/app/…`) | Componentes |
|---|---|
| | |

## qa-writer
- Casos obligatorios: input inválido, sin sesión, caso feliz, render del formulario
