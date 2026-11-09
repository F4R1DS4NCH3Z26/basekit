# Stack: Vue 3 + Vite + TypeScript (SPA frontend) · v1

Plantillas: `plantillas/stacks/vue/`. Tipo: **frontend** (`kind: "frontend"`). Puerto: 5173. Healthcheck: `/health`. Sin base de datos ni migraciones. Es el espejo de [`react`](react.md): mismo Docker, mismo nginx, mismos roles y la misma forma de `make new-app`; cambian el framework y sus herramientas.

Detección: `package.json` contiene `"vue"` (con comillas, como clave de dependencia: no coincide con `@vitejs/plugin-vue` ni con `vue-router`). Los stacks se prueban por `detect.priority` y luego por id, y gana el primero (`vue` tiene prioridad 30); `vue` es el último:
- `laravel` (`artisan`), `nestjs` (`nest-cli.json`) y `nextjs` (`next.config.*`) van antes y un proyecto Vue no tiene esos archivos. Un proyecto Laravel con Vue se detecta como `laravel`.
- `react` va antes y hoy se detecta por `vite.config.ts`, que un proyecto Vue + Vite también tiene: mientras esa regla no se acote a `@vitejs/plugin-react` (pendiente del core), un proyecto Vue con `vite.config.ts` se detecta como `react`. Elige `--stack vue` en ese caso.
- Un proyecto Nuxt también lista `"vue"` y se detecta como `vue`: ningún stack detecta Nuxt. Se acepta; el kit asume una SPA con Vite.

## Arquitectura (por features)

```text
index.html                     # orquestador
vite.config.ts  vitest.config.ts  tsconfig*.json  eslint.config.js  nginx.conf
public/health                  # lo crea make new-app (Vite lo sirve en dev)
src/
├── main.ts  App.vue           # entrada (createApp + router) y RouterView (orquestador)
├── router/index.ts            # rutas de Vue Router (orquestador)
├── lib/api.ts                 # apiFetch: URL base, cookies, validación Zod (lo crea make new-app)
├── features/<f>/
│   ├── schemas.ts  api.ts  types.ts  stores.ts  composables/   # logic-writer
│   ├── components/  pages/  index.ts                            # ui-writer
├── components/  assets/       # ui-writer
tests/features/<f>/            # qa-writer (tests/setup.ts activa enableAutoUnmount)
```

- **Una sola puerta por feature**: `index.ts`. Entre features (y desde `src/router/index.ts`) solo se importa ese archivo.
- **Toda respuesta de la API pasa por un schema Zod** dentro de `apiFetch`: una forma inesperada falla en un solo lugar.
- **Idioms de Vue**: SFC con `<script setup lang="ts">`; composables (`use*`, devuelven refs y cancelan con `onScopeDispose`) en lugar de hooks; Pinia (`defineStore`) en `stores.ts` solo si el contrato pide estado global, igual que Zustand en `react` (no se instala por defecto: es una dependencia que pide el logic-writer).

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, `tsconfig*.json`, `vite.config.*`, `vitest.config.*`, `eslint.config.*`, `index.html`, `nginx.conf`, `src/main.ts`, `src/App.vue`, `src/style.css`, `src/vite-env.d.ts`, `src/env.d.ts`, `src/router/**`, `src/lib/**`, `src/types/**`, `.vscode/extensions.json` (lo trae la plantilla `vue-ts`) |
| logic-writer | `schemas.ts`, `api.ts`, `types.ts`, `stores.ts`, `composables/**` |
| ui-writer | `components/**`, `pages/**`, `index.ts`, `src/components/**`, `src/assets/**`, `public/**` |
| qa-writer | `tests/**`, `e2e/**` |

Capas de frontend en vez de datos/lógica de servidor: no hay `data-writer`. Skills: `vue-scaffold` (+ `assets/app/`, los archivos base de `make new-app`), `vue-verify` (la usa `make verify`: `vue-tsc -b`, ESLint y Vitest), `vue-patterns` (+ `references/auth.md`).

## Docker

| Target | Uso |
|---|---|
| `deps` | `npm ci` (o `pnpm install --frozen-lockfile`) con caché |
| `dev` | `vite --host 0.0.0.0 --port 5173 --strictPort` con hot reload |
| `build` | `vue-tsc -b && vite build`; recibe `VITE_API_URL` como build arg |
| `prod` | `nginxinc/nginx-unprivileged:1.30-alpine` (uid 101, puerto 8080) sirve `dist/`; healthcheck con `wget` a `/health` |

Puerto: 5173 en el host en dev y en prod (`APP_PORT`), igual que `react` (nunca están en el mismo proyecto). En prod nginx escucha en 8080 dentro del contenedor y compose lo publica en `APP_PORT`.

- **nginx** (`nginx.conf`, idéntico al de `react`):
  - `/health` responde 200.
  - Fallback de SPA: cualquier ruta sin archivo devuelve `index.html` (por eso funciona `createWebHistory`).
  - `/assets/` (archivos con hash) se cachea un año y un faltante da 404.
  - `index.html` nunca se cachea.
  - Cabeceras `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` y `server_tokens off`.
- **Prod endurecido**: `read_only`, `tmpfs` en `/tmp` y `/var/cache/nginx`, `cap_drop: [ALL]` y `no-new-privileges`.
- **Variables**: Vite incrusta `VITE_*` en el JS al construir. En dev llegan por `env_file: .env`. En prod `.dockerignore` deja fuera todo `.env*`, así que `compose.prod.yaml` pasa `VITE_API_URL` como build arg (Compose la lee de `.env.prod` por `--env-file`). Cambiarla exige `make prod-up` (reconstruye).

En dev, `node_modules` va en un **volumen con nombre** para que el bind mount no lo oculte; `make install` vuelve a ejecutar `npm ci` en el volumen. `CHOKIDAR_USEPOLLING` activa el hot reload en Docker Desktop y WSL.

`make new-app` (si no hay `package.json`; si existe, no hace nada ni llama a Docker):
1. Instala `create-vite@9.3.1` fijado y lo ejecuta con `npx --no-install` (plantilla `vue-ts`, sin preguntas) dentro de `node:22-alpine` como root; al final devuelve los archivos a tu uid.
   Todas las dependencias se resuelven con `npm_config_before` = hace 14 días. La regla también vale para versiones exactas: si subes `CREATE_VITE_VERSION` a una versión de hace menos de 14 días, falla con `ETARGET`.
2. Descarta el `src/main.ts` y el `src/App.vue` de demostración y copia el resultado sin pisar archivos del kit (el `README.md` y el `.gitignore` del kit se conservan).
3. Instala `zod` y `vue-router`; en desarrollo, Vitest, jsdom, `@vue/test-utils`, `eslint`, `eslint-plugin-vue` y `@vue/eslint-config-typescript` (`--eslint` de create-vite solo existe para React). Agrega el script `lint`.
4. Copia, si faltan, `eslint.config.js`, `vitest.config.ts`, `tests/setup.ts`, `src/main.ts`, `src/App.vue`, `src/router/index.ts`, `src/lib/api.ts` y `public/health` desde `vue-scaffold/assets/app/`. La ruta `/` apunta al `HelloWorld.vue` de create-vite hasta que exista la primera página.
5. Agrega `node_modules/`, `dist/` y `coverage/` al `.gitignore`, fuera del bloque gestionado.

## Base de datos

No hay. `init` rechaza `--db` (salvo `none`/`auto`) y `--redis` para stacks frontend. No hay servicio `migrate` en compose.

Los objetivos de BD del Makefile común siguen en `make help` (siguen siendo ≥ 25), pero solo imprimen "Este stack no usa base de datos (frontend Vue): nada que hacer" y salen con 0, sin Docker:
- `migrate` y `prod-migrate`.
- `migration NAME=x` (valida `NAME` antes).
- `db-shell`.

`stack.mk` lo logra con un `DC` específico de esos objetivos, como `react`.

## Auth (detalle en `vue-patterns/references/auth.md`)

La SPA no autentica: el backend pone una cookie `HttpOnly` y valida cada endpoint. `apiFetch` envía `credentials: "include"`. Las rutas privadas usan `meta: { requiresAuth: true }` y un `router.beforeEach` que consulta `getMe()`: es UX, la API decide. Nunca hay tokens en `localStorage` ni secretos en `VITE_*`.

## Comandos

```bash
make new-app
make env && make dev        # http://localhost:5173
make test
make verify SCOPE=src/features/<f>
make env ENV=prod && make prod-up
```

## Seguridad específica

- **Bundle público**: todo `VITE_*` y todo el código llega al navegador.
- **HTML**: prohibido `v-html` con datos de la API o del usuario.
- **Respuestas**: validadas con Zod antes de usarlas.
- **Autorización**: ocultar una ruta en la SPA es UX; el backend decide.

## Errores comunes

- `fetch` directo en un componente en vez de `apiFetch` en `api.ts`.
- Importar archivos internos de otra feature (o una página sin pasar por su `index.ts` desde el router).
- Desestructurar un `reactive` o las props sin `toRefs`: se pierde la reactividad.
- Poner un secreto en `VITE_*` o un token en `localStorage`.
- Cambiar `VITE_API_URL` en `.env.prod` sin reconstruir la imagen.
- `npx vue-tsc` sin `--no-install`, o `tsc` en lugar de `vue-tsc` (no lee los `.vue`).
