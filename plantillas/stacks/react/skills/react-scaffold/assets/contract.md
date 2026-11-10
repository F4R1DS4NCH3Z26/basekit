# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Endpoints de la API que consume (método, ruta, respuesta):
- Sesión: pública | requiere sesión (cookie del backend)
- Rutas de la SPA: `/__NAME__`

## logic-writer
### Schemas (`schemas.ts`)
| Schema | Campos (Zod) | Uso |
|---|---|---|
| | | |

### API (`api.ts`)
- `get__PASCAL__List(params: { page: number }): Promise<__PASCAL__ListItem[]>` · `GET /__NAME__`

### Hooks y estado
- Hooks: `use__PASCAL__List()` → `{ data, error, loading, reload }`
- Stores: ninguno

## ui-writer
| Componente | Props | Usa |
|---|---|---|
| | | |

| Página (`pages/`) | Ruta | Componentes |
|---|---|---|
| | | |

## qa-writer
- Casos obligatorios: schema válido e inválido, error de la API (401 y 500), estado de carga, render e interacción del formulario
