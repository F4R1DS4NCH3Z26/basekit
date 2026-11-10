# Stack: TypeScript nativo · DOM + Vite (SPA frontend, sin framework) · v1

Plantillas: `plantillas/stacks/vanilla-ts/`. Tipo: **frontend** (`kind: "frontend"`). Puerto: 5173. Healthcheck: `/health`. Sin base de datos ni migraciones.

Sin framework de UI (ni React, Vue, Svelte o lit): DOM y TypeScript, con Vite para dev y build. "Nativo" significa sin framework web; sí usa librerías: Zod (validación), Vitest y Testing Library (tests) y nginx (prod).

Detección: ninguna (`detect: {}`). Un proyecto Vite sin framework no se distingue con seguridad de otros proyectos Vite, así que este stack solo se elige por la pregunta de `init` o con `--stack vanilla-ts`. Nunca le quita un proyecto a `react` ni a `vue`.

## Arquitectura (por features)

Lo mínimo para que cada agente tenga su zona: un router, componentes como funciones, un cliente HTTP tipado y un store.

```text
index.html                     # orquestador (create-vite; monta #app)
tsconfig.json  vitest.config.ts  eslint.config.js  nginx.conf
public/health                  # lo crea make new-app (Vite lo sirve en dev)
src/
├── main.ts                    # entrada: monta el router en #app (orquestador)
├── routes.ts                  # tabla de rutas: "/products/:id" → página (orquestador)
├── lib/                       # orquestador; lo crea make new-app
│   ├── api.ts                 # apiFetch(path, parse, init): URL base, cookies, validación
│   ├── dom.ts                 # h(tag, attrs, ...children) y mount(): el texto va siempre como nodo de texto
│   ├── router.ts              # History API: startRouter, navigate, RouteContext (params, query, signal)
│   └── store.ts               # createStore(initial): get, set, subscribe
├── pages/home.ts  pages/not-found.ts                       # ui-writer
├── features/<f>/
│   ├── schemas.ts  api.ts  types.ts  stores.ts             # logic-writer
│   ├── components/  pages/  index.ts                       # ui-writer
├── components/  assets/       # ui-writer
tests/features/<f>/            # qa-writer
```

- **Componente** = función que recibe un objeto de opciones y devuelve un `HTMLElement` hecho con `h()`. Sin clases de componente ni Web Components.
- **Página** = `xxxPage(ctx: RouteContext)`. El router aborta `ctx.signal` al salir de la página: se pasa a cada petición, así una respuesta tardía no pinta una página que ya no está.
- **Router** (History API): los `<a href>` del mismo origen se manejan sin recargar; los externos, `target`, `download` y `data-external` siguen el comportamiento del navegador. Un error al renderizar muestra "No se pudo cargar la página", sin detalles internos.
- **Una sola puerta por feature**: `index.ts`. Entre features (y desde `src/routes.ts`) solo se importa ese archivo.
- **Toda respuesta de la API pasa por un parser** (el `.parse` de un schema Zod) dentro de `apiFetch`: una forma inesperada es un `ApiError` en un solo lugar.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, `tsconfig*.json`, `vite.config.*`, `vitest.config.*`, `eslint.config.*`, `index.html`, `nginx.conf`, `src/main.ts`, `src/routes.ts`, `src/style.css`, `src/vite-env.d.ts`, `src/lib/**`, `src/types/**` |
| logic-writer | `schemas.ts`, `api.ts`, `types.ts`, `stores.ts` (sin DOM) |
| ui-writer | `components/**`, `pages/**`, `index.ts`, `src/components/**`, `src/pages/**`, `src/assets/**`, `public/**` |
| qa-writer | `tests/**`, `e2e/**` |

Igual que `react`, pero sin `hooks/` (no hay framework de reactividad): la lógica de carga vive en la página con `ctx.signal`. Registrar una ruta es del orquestador (`src/routes.ts`). Skills: `vanilla-scaffold` (+ `assets/app/`, los archivos base de `make new-app`), `vanilla-verify` (la usa `make verify`), `vanilla-patterns` (+ `references/auth.md`).

## Docker

Mismo Dockerfile, compose y `nginx.conf` que `react`:

| Target | Uso |
|---|---|
| `deps` | `npm ci` (o `pnpm install --frozen-lockfile`) con caché |
| `dev` | `vite --host 0.0.0.0 --port 5173 --strictPort` con hot reload |
| `build` | `tsc && vite build`; recibe `VITE_API_URL` como build arg |
| `prod` | `nginxinc/nginx-unprivileged:1.30-alpine` (uid 101, puerto 8080) sirve `dist/`; healthcheck con `wget` a `/health` |

Puerto: 5173 en el host en dev y en prod (`APP_PORT`). En prod nginx escucha en 8080 dentro del contenedor (el puerto sin root de la imagen) y compose lo publica en `APP_PORT`.

- **nginx**: `/health` responde 200, fallback de SPA a `index.html` (el router resuelve la ruta), `/assets/` cacheado un año (un faltante da 404), `index.html` sin caché, cabeceras `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` y `server_tokens off`.
- **Prod endurecido**: `read_only`, `tmpfs` en `/tmp` y `/var/cache/nginx`, `cap_drop: [ALL]` y `no-new-privileges`.
- **Variables**: Vite incrusta `VITE_*` en el JS al construir. En prod `compose.prod.yaml` pasa `VITE_API_URL` como build arg (de `.env.prod` por `--env-file`). Cambiarla exige `make prod-up` (reconstruye).

En dev, `node_modules` va en un volumen con nombre; `CHOKIDAR_USEPOLLING` activa el hot reload en Docker Desktop y WSL.

`make new-app` (si no hay `package.json`; si existe, no hace nada ni llama a Docker):
1. Instala `create-vite@9.3.1` fijado y lo ejecuta con `npx --no-install` (plantilla `vanilla-ts`, sin preguntas) dentro de `node:22-alpine` como root; al final devuelve los archivos a tu uid.
   Todas las dependencias se resuelven con `npm_config_before` = hace 14 días. La regla también vale para versiones exactas: si subes `CREATE_VITE_VERSION` a una versión de hace menos de 14 días, falla con `ETARGET`.
2. Descarta la demo de la plantilla (`src/main.ts`, `src/counter.ts`) y su `tsconfig.json` dentro del contenedor, y copia el resto sin pisar archivos del kit.
3. Agrega los scripts `lint` y `test` e instala con versión exacta (`-E`) `zod`, Vitest, jsdom, Testing Library (`dom`, `user-event`) y ESLint (`@eslint/js`, `typescript-eslint`, `globals`).
4. Copia, si faltan, desde `vanilla-scaffold/assets/app/`: `tsconfig.json` (strict, incluye `src` y `tests`), `eslint.config.js`, `vitest.config.ts`, `src/main.ts`, `src/routes.ts`, `src/lib/` (`api.ts`, `dom.ts`, `router.ts`, `store.ts`), `src/pages/` (`home.ts`, `not-found.ts`) y `public/health`.
5. Agrega `node_modules/`, `dist/` y `coverage/` al `.gitignore`, fuera del bloque gestionado.

No hay `vite.config.ts`: los valores por defecto de Vite bastan y el puerto va como flag. Si lo agregas, es zona del orquestador.

## Base de datos

No hay. `init` rechaza `--db` (salvo `none`/`auto`) y `--redis` para stacks frontend. No hay servicio `migrate` en compose.

Los objetivos de BD del Makefile común siguen en `make help` (siguen siendo ≥ 25), pero solo imprimen "Este stack no usa base de datos (frontend nativo TypeScript): nada que hacer" y salen con 0, sin Docker: `migrate`, `prod-migrate`, `migration NAME=x` (valida `NAME` antes) y `db-shell`. `stack.mk` lo logra con un `DC` específico de esos objetivos, como `react`.

## Verificación (`vanilla-verify`)

`tsc --noEmit -p tsconfig.json` (proyecto completo), ESLint y Vitest limitados a la ruta. Usa `node_modules/.bin`, nunca `npx`. ESLint rechaza `innerHTML`, `outerHTML`, `insertAdjacentHTML` y `document.write`.

## Auth (detalle en `vanilla-patterns/references/auth.md`)

La SPA no autentica: el backend pone una cookie `HttpOnly` y valida cada endpoint. `apiFetch` envía `credentials: "include"`. Nunca hay tokens en `localStorage` ni secretos en `VITE_*`. Una ruta protegida envuelve la página con `requireSession` en `src/routes.ts` (solo UX). Con API en otro origen, CORS con el origen exacto y credenciales, más CSRF en el backend.

## Comandos

```bash
make new-app
make env && make dev        # http://localhost:5173
make test
make verify SCOPE=src/features/<f>
make env ENV=prod && make prod-up
```

## Seguridad específica

- **HTML**: el DOM se construye con `h()`, que solo crea nodos de texto. `innerHTML` y similares están prohibidos por ESLint.
- **URLs de datos**: un `href` o `src` que viene de la API o del usuario se valida (`https:`), nunca `javascript:`.
- **Bundle público**: todo `VITE_*` y todo el código llega al navegador.
- **Respuestas**: validadas con Zod antes de usarlas.
- **Autorización**: ocultar una ruta en la SPA es UX; el backend decide.

## Errores comunes

- `innerHTML` con una plantilla de texto en vez de `h()`.
- `fetch` directo en una página en vez de `apiFetch` en `api.ts`.
- Olvidar pasar `ctx.signal` a la petición de una página.
- Importar archivos internos de otra feature.
- Registrar la ruta desde una feature: `src/routes.ts` es del orquestador.
- Poner un secreto en `VITE_*` o un token en `localStorage`.
- `npx tsc` sin `--no-install`.
