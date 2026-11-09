## Proyecto combinado: `backend/` + `frontend/`
- `backend/` ({{BACKEND_NAME}}) y `frontend/` ({{FRONTEND_NAME}}) son cada uno un proyecto completo de su stack: su `Makefile`, `.make/stack.mk`, `Dockerfile`, `compose*.yaml` y `.env.example`. Cada uno funciona solo: `make -C backend dev`, `make -C frontend new-app`.
- La raíz tiene lo común una sola vez (este `AGENTS.md`, `.agents/`, `docs/`) y un `Makefile` que delega en los dos: `make env`, `make dev` (levanta ambos), `make test`, `make verify`, `make logs`, `make down`. La base de datos (`make migrate`, `make migration NAME=x`, `make db-shell`) es solo del backend.
- El navegador llama a la API por el host: `frontend/.env.example` trae `VITE_API_URL=http://127.0.0.1:{{BACKEND_PORT}}`, y el backend permite el origen `http://127.0.0.1:{{FRONTEND_PORT}}` en CORS. Son dos proyectos de Compose distintos: no comparten red.
- Roles con prefijo de lado: `backend-<rol>` y `frontend-<rol>` (`.agents/roles/`), con zonas bajo `backend/` y `frontend/`. Las tablas de cada stack, abajo, nombran los roles sin el prefijo y las rutas relativas a su carpeta.
- Las skills de cada stack están en `.agents/skills/`; su copia en `backend/.agents/skills/` y `frontend/.agents/skills/` es la que leen `make verify` y `make new-app` dentro de Docker. Los scripts de las skills buscan la raíz del proyecto con git: córrelos desde la carpeta del lado sin dejar que git suba a la raíz del repositorio:
  - `cd backend && GIT_CEILING_DIRECTORIES="$PWD/.." bash .agents/skills/<skill>/scripts/scaffold.sh <nombre>`
  - `cd backend && GIT_CEILING_DIRECTORIES="$PWD/.." bash ../.agents/skills/infra-setup/scripts/infra.sh --db postgres`

**`backend/`:**

{{BACKEND_SECTION}}

**`frontend/`:**

{{FRONTEND_SECTION}}
