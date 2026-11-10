# Contrato: __NAME__
Estado: borrador   <!-- los agentes solo trabajan si dice "cerrado" -->

## Común
- Propósito (1 línea):
- Endpoints de la API que consume (método, ruta, respuesta):
- Sesión: pública | requiere sesión (cookie del backend)
- Rutas de la SPA (las registra el orquestador en `src/routes.ts`): `/__NAME__`

## logic-writer
### Schemas (`schemas.ts`)
| Schema | Campos (Zod) | Uso |
|---|---|---|
| | | |

### API (`api.ts`)
- `list__PASCAL__(signal?: AbortSignal): Promise<__PASCAL__[]>` · `GET /__NAME__`

### Estado
- Stores (`stores.ts`, con `createStore` de `src/lib/store.ts`): ninguno

## ui-writer
| Componente (`components/`) | Parámetros | Devuelve | Usa |
|---|---|---|---|
| | | `HTMLElement` | |

| Página (`pages/`) | Ruta | Componentes |
|---|---|---|
| `__CAMEL__Page(ctx: RouteContext)` | `/__NAME__` | |

## qa-writer
- Casos obligatorios: schema válido e inválido, error de la API (401 y 500), estado de carga, render e interacción del formulario
