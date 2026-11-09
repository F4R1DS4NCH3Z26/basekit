# Stack: React + Vite + TypeScript (SPA frontend) · v1

Plantillas: `plantillas/stacks/react/`. Tipo: **frontend** (`kind: "frontend"`). Puerto: 5173. Healthcheck: `/health`. Sin base de datos ni migraciones.

Detección: `package.json` contiene `"@vitejs/plugin-react`. Los stacks se prueban en orden de id y gana el primero: `nestjs` y `nextjs` van antes y se detectan por `nest-cli.json` y `next.config.*`. Un proyecto Laravel con Vite se detecta antes como `laravel`. Los proyectos Vite de Vue, Svelte o Symfony no usan ese plugin, así que no se detectan como `react`.

## Arquitectura (por features)

```text
index.html                     # orquestador
vite.config.ts  vitest.config.ts  tsconfig*.json  eslint.config.js  nginx.conf
public/health                  # lo crea make new-app (Vite lo sirve en dev)
src/
├── main.tsx  App.tsx          # entrada y rutas (orquestador)
├── lib/api.ts                 # apiFetch: URL base, cookies, validación Zod (lo crea make new-app)
├── features/<f>/
│   ├── schemas.ts  api.ts  types.ts  stores.ts  hooks/      # logic-writer
│   ├── components/  pages/  index.ts                        # ui-writer
├── components/  assets/       # ui-writer
tests/features/<f>/            # qa-writer (tests/setup.ts carga jest-dom)
```

- **Una sola puerta por feature**: `index.ts`. Entre features (y desde `App.tsx`) solo se importa ese archivo.
- **Toda respuesta de la API pasa por un schema Zod** dentro de `apiFetch`: una forma inesperada falla en un solo lugar.

## Roles y zonas

| Rol | Zona |
|---|---|
| Orquestador | común + `package.json`, `tsconfig*.json`, `vite.config.*`, `vitest.config.*`, `eslint.config.*`, `index.html`, `nginx.conf`, `src/main.tsx`, `src/App.tsx`, `src/App.css`, `src/index.css`, `src/lib/**`, `src/types/**` |
| logic-writer | `schemas.ts`, `api.ts`, `types.ts`, `stores.ts`, `hooks/**` |
| ui-writer | `components/**`, `pages/**`, `index.ts`, `src/components/**`, `src/assets/**`, `public/**` |
| qa-writer | `tests/**`, `e2e/**` |

Capas de frontend en vez de datos/lógica de servidor: no hay `data-writer`. Skills: `react-scaffold` (+ `assets/app/`, los archivos base de `make new-app`), `react-verify` (la usa `make verify`), `react-patterns` (+ `references/auth.md`).

## Docker

| Target | Uso |
|---|---|
| `deps` | `npm ci` (o `pnpm install --frozen-lockfile`) con caché |
| `dev` | `vite --host 0.0.0.0 --port 5173 --strictPort` con hot reload |
| `build` | `tsc -b && vite build`; recibe `VITE_API_URL` como build arg |
| `prod` | `nginxinc/nginx-unprivileged:1.30-alpine` (uid 101, puerto 8080) sirve `dist/`; healthcheck con `wget` a `/health` |

Puerto: 5173 en el host en dev y en prod (`APP_PORT`), para que la URL no cambie entre entornos. En dev es el puerto por defecto de Vite; en prod nginx escucha en 8080 dentro del contenedor (el puerto sin root de la imagen) y compose lo publica en `APP_PORT`.

- **nginx** (`nginx.conf`):
  - `/health` responde 200.
  - Fallback de SPA: cualquier ruta sin archivo devuelve `index.html`.
  - `/assets/` (archivos con hash) se cachea un año y un faltante da 404.
  - `index.html` nunca se cachea.
  - Cabeceras `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` y `server_tokens off`.
- **Prod endurecido**: `read_only`, `tmpfs` en `/tmp` (pid y temporales de nginx) y `/var/cache/nginx`, `cap_drop: [ALL]` y `no-new-privileges`.
- **Variables**: Vite incrusta `VITE_*` en el JS al construir. En dev llegan por `env_file: .env`. En prod `.dockerignore` deja fuera todo `.env*`, así que `compose.prod.yaml` pasa `VITE_API_URL` como build arg (Compose la lee de `.env.prod` por `--env-file`). Cambiarla exige `make prod-up` (reconstruye).

En dev, `node_modules` va en un **volumen con nombre** para que el bind mount no lo oculte; `make install` vuelve a ejecutar `npm ci` en el volumen. `CHOKIDAR_USEPOLLING` activa el hot reload en Docker Desktop y WSL.

`make new-app` (si no hay `package.json`; si existe, no hace nada ni llama a Docker):
1. Instala `create-vite@9.3.1` fijado y lo ejecuta con `npx --no-install` (plantilla `react-ts`, ESLint, sin preguntas) dentro de `node:22-alpine` como root; al final devuelve los archivos a tu uid.
   Todas las dependencias se resuelven con `npm_config_before` = hace 14 días. La regla también vale para versiones exactas: si subes `CREATE_VITE_VERSION` a una versión de hace menos de 14 días, falla con `ETARGET`.
2. Copia el resultado sin pisar archivos del kit (el `README.md` y el `.gitignore` del kit se conservan).
3. Instala `zod`, Vitest, jsdom y Testing Library (`react`, `jest-dom`, `user-event`).
4. Copia, si faltan, `vitest.config.ts`, `tests/setup.ts`, `src/lib/api.ts` y `public/health` desde `react-scaffold/assets/app/`.
5. Agrega `node_modules/`, `dist/` y `coverage/` al `.gitignore`, fuera del bloque gestionado.

## Base de datos

No hay. `init` rechaza `--db` (salvo `none`/`auto`) y `--redis` para stacks frontend. No hay servicio `migrate` en compose: ningún archivo del core ni test lo exige para este stack.

Los objetivos de BD del Makefile común siguen en `make help` (siguen siendo ≥ 25), pero solo imprimen "Este stack no usa base de datos (frontend React): nada que hacer" y salen con 0, sin Docker:
- `migrate` y `prod-migrate`.
- `migration NAME=x` (valida `NAME` antes).
- `db-shell`.

`stack.mk` lo logra con un `DC` específico de esos objetivos.

## Auth (detalle en `react-patterns/references/auth.md`)

La SPA no autentica: el backend pone una cookie `HttpOnly` y valida cada endpoint. `apiFetch` envía `credentials: "include"`. Nunca hay tokens en `localStorage` ni secretos en `VITE_*`. Con API en otro origen, CORS con el origen exacto y credenciales, más CSRF en el backend.

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
- **HTML**: prohibido `dangerouslySetInnerHTML` con datos de la API o del usuario.
- **Respuestas**: validadas con Zod antes de usarlas.
- **Autorización**: ocultar una ruta en la SPA es UX; el backend decide.

## Errores comunes

- `fetch` directo en un componente en vez de `apiFetch` en `api.ts`.
- Importar archivos internos de otra feature.
- Poner un secreto en `VITE_*` o un token en `localStorage`.
- Cambiar `VITE_API_URL` en `.env.prod` sin reconstruir la imagen.
- `npx tsc` sin `--no-install`.
