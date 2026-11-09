# Variables del stack React + Vite (SPA frontend) para el Makefile común
APP         := app
PORT        := 5173
SHELL_CMD   := sh
INSTALL_CMD := npm ci
TEST_CMD    := npx --no-install vitest run
LINT_CMD    := npx --no-install eslint .
VERIFY_CMD  = bash .agents/skills/react-verify/scripts/verify.sh "$${SCOPE:-src}"
# 9.3.1: newest create-vite release that is at least 14 days old (2026-10-20). Bump it only to a release at least
# 14 days old: npm_config_before (below) applies to exact versions too, so a newer one fails with ETARGET.
CREATE_VITE_VERSION ?= 9.3.1

# Frontend without a database: the core DB targets (migrate, prod-migrate, migration, db-shell) only print this and
# exit 0. Target-specific DC replaces their docker compose call with the message, so they never start a container.
NO_DB_MSG := Este stack no usa base de datos (frontend React): nada que hacer
MAKE_MIGRATION_CMD = echo "$(NO_DB_MSG)"
migrate migration db-shell: DC = @echo "$(NO_DB_MSG)"; :
db-shell: DB_SHELL_CMD = none

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea la app React + Vite en Docker (solo si no existe package.json)
	@if [ -f package.json ]; then echo "Ya existe package.json; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

# _new-app runs as root and hands the files back at the end. create-vite is installed pinned and then run with
# `npx --no-install`, so nothing is downloaded on the fly. GNU cp because busybox `cp -Rn` skips the whole tree when
# /work already exists. npm_config_before resolves every dependency as of 14 days ago (guide 04 §8): a release
# published minutes ago, broken or hijacked, never reaches a new project.
_new-app:
	docker run --rm -e UID_GID="$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm \
	  -v "$$PWD":/work -w /tmp node:22-alpine sh -c '\
	  export npm_config_before="$$(node -p "new Date(Date.now() - 14 * 864e5).toISOString()")" && \
	  apk add --no-cache coreutils >/dev/null && \
	  npm install --no-audit --no-fund --no-save create-vite@$(CREATE_VITE_VERSION) >/dev/null && \
	  npx --no-install create-vite app --template react-ts --eslint --no-interactive --no-immediate && \
	  cp -R --update=none /tmp/app/. /work/ && test -f /work/package.json && cd /work && npm install --no-audit --no-fund && \
	  npm install --no-audit --no-fund zod && \
	  npm install --no-audit --no-fund -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event && \
	  chown -R "$$UID_GID" /work'
	@a=.agents/skills/react-scaffold/assets/app; \
	for f in vitest.config.ts tests/setup.ts src/lib/api.ts public/health; do \
	  if [ ! -e "$$f" ]; then mkdir -p "$$(dirname "$$f")" && cp "$$a/$$f.tpl" "$$f" && echo "  + $$f"; fi; \
	done
	@touch .gitignore; for l in node_modules/ dist/ coverage/; do grep -qxF "$$l" .gitignore || echo "$$l" >> .gitignore; done
	@echo "App creada. Siguiente: make env && make dev"
