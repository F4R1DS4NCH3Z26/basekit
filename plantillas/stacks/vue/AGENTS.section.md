## Stack: Vue 3 + Vite + TypeScript (SPA frontend)
- SPA sin base de datos ni migraciones: los datos vienen de una API externa (`VITE_API_URL`). Componentes SFC con `<script setup lang="ts">`; tipos con `vue-tsc`. Tests: Vitest + @vue/test-utils. Prod: nginx sin root.
- `src/main.ts`, `src/App.vue`, `src/router/` (Vue Router) y `src/lib/` (cliente HTTP `api.ts`, env) son del orquestador. `src/features/<f>/`: `schemas.ts` (Zod) · `api.ts` · `composables/` · `stores.ts` (Pinia) · `components/` · `pages/` · `index.ts` (API pública).
- Entre features (y desde el router) solo se importa el `index.ts` de la otra (`../<f>`), nunca sus archivos internos.
- Toda respuesta de la API se valida con Zod antes de usarla. Nada secreto en `VITE_*`: Vite lo incrusta en el JS público. Prohibido `v-html` con datos de la API o del usuario.
- La sesión vive en una cookie `HttpOnly` del backend (`credentials: "include"`); nunca tokens en `localStorage`.

| Rol | Zona |
|---|---|
| orquestador | lo común + `package.json`, configs (`vite`, `vitest`, `tsconfig`, `eslint`), `index.html`, `nginx.conf`, `src/main.ts`, `src/App.vue`, `src/router/`, `src/lib/`, `src/types/` |
| logic-writer | `schemas.ts`, `api.ts`, `types.ts`, `stores.ts`, `composables/` |
| ui-writer | `components/`, `pages/`, `index.ts`, `src/components/`, `src/assets/`, `public/` |
| qa-writer | `tests/` |

Comandos: `make dev` (puerto 5173) · `make test` · `make verify SCOPE=src/features/<f>` · `make prod-up` (nginx). `make migrate` y `make db-shell` solo avisan: este stack no usa base de datos.
