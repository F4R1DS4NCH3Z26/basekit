# Variables del stack Node nativo (node:http, sin framework) para el Makefile común
APP         := app
PORT        := 3000
SHELL_CMD   := sh
INSTALL_CMD := npm ci
TEST_CMD    := npx --no-install vitest run
LINT_CMD    := npx --no-install eslint .
# Prisma 7's migrate dev no longer regenerates the client: generate runs right after, so tsc sees the new models.
MAKE_MIGRATION_CMD = sh -c 'npx --no-install prisma migrate dev --name "$$NAME" && npx --no-install prisma generate'
VERIFY_CMD  = bash .agents/skills/nodenative-verify/scripts/verify.sh "$${SCOPE:-src}"
NODE_IMAGE  ?= node:22-alpine
# Exact versions: each one the newest release of its major that was at least 14 days old (2026-10-26). Bump them
# only to releases at least 14 days old: npm_config_before (below) applies to exact versions too, so a newer one
# makes `make new-app` fail with ETARGET until it is 14 days old. PRISMA_VERSION is the one of the express and
# nestjs stacks; app-setup.sh installs it (with the driver adapter of the database) only when compose.db.yaml exists.
# No web framework: the HTTP layer is node:http (src/lib/router.ts, src/lib/http.ts). Zod is the only runtime dependency.
DEPS        ?= zod@4.6.7
DEV_DEPS    ?= typescript@5.9.3 tsx@4.23.15 @types/node@22.20.5 vitest@3.2.7 supertest@7.3.1 \
               @types/supertest@6.0.3 eslint@9.39.5 @eslint/js@9.39.5 typescript-eslint@8.72.0
PRISMA_VERSION ?= 7.10.1
# User data (PKGS) reaches the shell as an environment variable, never interpolated by make into the command.
export PKGS

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea package.json e instala Zod y TypeScript (+ Prisma si hay BD) en Docker (solo si no existe package.json)
	@if [ -f package.json ]; then echo "Ya existe package.json; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

# The skeleton (src/, tests/, configs) comes from basekit init and package.json from the nodenative-scaffold template.
# _new-app runs as root (it adds bash for app-setup.sh) and hands the files back to your uid at the end, also when a
# step fails. npm_config_before resolves every dependency as of 14 days ago (guide 04 §8). app-setup.sh adds, when
# compose.db.yaml exists, Prisma with the driver adapter of that database, and the build paths to .gitignore.
# If a step fails, package.json is removed again so `make new-app` can be retried.
_new-app:
	@[ -f src/app.ts ] || { echo "Falta src/app.ts: ejecuta npx --no-install basekit init en un proyecto sin package.json"; exit 1; }
	@cp .agents/skills/nodenative-scaffold/assets/package.json.tpl package.json && echo "  + package.json"
	@docker run --rm -e UID_GID="$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e npm_config_update_notifier=false \
	  -e PRISMA_VERSION="$(PRISMA_VERSION)" -v "$$PWD":/app -w /app $(NODE_IMAGE) sh -c '\
	  export npm_config_before="$$(node -p "new Date(Date.now() - 14 * 864e5).toISOString()")"; \
	  ( apk add --no-cache bash >/dev/null && \
	    npm install --no-audit --no-fund --save-exact $(DEPS) && \
	    npm install --no-audit --no-fund --save-exact -D $(DEV_DEPS) && \
	    bash .agents/skills/nodenative-scaffold/scripts/app-setup.sh ); \
	  status=$$?; chown -R "$$UID_GID" /app; exit $$status' \
	  || { rm -f package.json package-lock.json; echo "ERROR: make new-app falló; se quitó package.json para reintentar"; exit 1; }
	@echo "App creada. Siguiente: make env && make dev"

deps-add: ## Agrega dependencias exactas (≥ 14 días) en Docker: make deps-add PKGS="jose@6" [DEV=1]
	@re='^[A-Za-z0-9@._/^~ -]+$$'; [[ "$${PKGS:-}" =~ $$re ]] || { echo 'Uso: make deps-add PKGS="paquete@mayor otro@mayor" [DEV=1]'; exit 2; }
	@[ -f package.json ] || { echo "Falta package.json: ejecuta make new-app"; exit 2; }
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e npm_config_update_notifier=false -e PKGS \
	  -v "$$PWD":/app -w /app $(NODE_IMAGE) sh -c '\
	  export npm_config_before="$$(node -p "new Date(Date.now() - 14 * 864e5).toISOString()")" && \
	  npm install --no-audit --no-fund --save-exact $(if $(DEV),-D,) $$PKGS'
	@echo "Siguiente: make install (actualiza el volumen node_modules de dev) y make build"
