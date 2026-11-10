## Stack: TypeScript nativo · DOM + Vite (SPA frontend, sin framework)
- SPA sin framework de UI ni base de datos: los datos vienen de una API externa (`VITE_API_URL`). Tests: Vitest (jsdom) + Testing Library (DOM). Prod: nginx sin root.
- `src/main.ts`, `src/routes.ts` (tabla de rutas) y `src/lib/` (`api.ts` cliente HTTP, `dom.ts` `h()`, `router.ts` History API, `store.ts`) son del orquestador. `src/features/<f>/`: `schemas.ts` (Zod) · `api.ts` · `stores.ts` · `components/` · `pages/` · `index.ts` (API pública).
- Un componente es una función que devuelve un `HTMLElement` hecho con `h()`. Prohibido `innerHTML`, `outerHTML`, `insertAdjacentHTML` y `document.write` (ESLint los rechaza).
- Entre features solo se importa el `index.ts` de la otra (`../<f>`), nunca sus archivos internos.
- Toda respuesta de la API se valida con un schema Zod (`apiFetch(path, schema.parse)`) antes de usarla. Nada secreto en `VITE_*`: Vite lo incrusta en el JS público.
- La sesión vive en una cookie `HttpOnly` del backend (`credentials: "include"`); nunca tokens en `localStorage`.

| Rol | Zona |
|---|---|
| orquestador | lo común + `package.json`, configs (`tsconfig`, `vitest`, `eslint`), `index.html`, `nginx.conf`, `src/main.ts`, `src/routes.ts`, `src/style.css`, `src/lib/`, `src/types/` |
| logic-writer | `schemas.ts`, `api.ts`, `types.ts`, `stores.ts` |
| ui-writer | `components/`, `pages/`, `index.ts`, `src/components/`, `src/pages/`, `src/assets/`, `public/` |
| qa-writer | `tests/` |

Comandos: `make dev` (puerto 5173) · `make test` · `make verify SCOPE=src/features/<f>` · `make prod-up` (nginx). `make migrate` y `make db-shell` solo avisan: este stack no usa base de datos.
