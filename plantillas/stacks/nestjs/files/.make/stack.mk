# Variables del stack NestJS para el Makefile común
APP         := app
PORT        := 3000
SHELL_CMD   := sh
INSTALL_CMD := npm ci
TEST_CMD    := npx --no-install vitest run
LINT_CMD    := npx --no-install oxlint --ignore-pattern 'src/generated/**' src test
# Prisma 7's migrate dev no longer regenerates the client: generate runs right after, so tsc sees the new models.
MAKE_MIGRATION_CMD = sh -c 'npx --no-install prisma migrate dev --name "$$NAME" && npx --no-install prisma generate'
VERIFY_CMD  = bash .agents/skills/nest-verify/scripts/verify.sh "$${SCOPE:-src}"
# MongoDB (compose.db.yaml with DB_DRIVER: mongodb) has no migrations: the indexes live in the models and `make migrate`
# syncs them (src/mongo/sync-indexes.ts). make migration only says so: no NAME check and no container.
ifneq ($(shell grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb' compose.db.yaml && echo mongo),)
NO_DB_MSG := MongoDB no tiene migraciones: los índices se declaran en los modelos (src/modules/<m>/<m>.model.ts) y make migrate los sincroniza
migration: DC = @echo "$(NO_DB_MSG)"; :
endif
# 12.0.10: newest @nestjs/cli release that is at least 14 days old (2026-10-20). 7.10.1: same rule for Prisma (2026-10-15).
# Bump them only to releases at least 14 days old: npm_config_before (below) applies to exact versions too,
# so a newer one makes `make new-app` fail with ETARGET until it is 14 days old.
NEST_CLI_VERSION ?= 12.0.10
PRISMA_VERSION   ?= 7.10.1

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea la app NestJS en Docker (solo si no existe package.json)
	@if [ -f package.json ]; then echo "Ya existe package.json; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

# _new-app runs as root and hands the files back at the end (also when a step fails), so a host uid without a
# passwd entry in the image never breaks npm. GNU cp because busybox `cp -Rn` skips the whole tree when /work
# already exists. npm_config_before resolves every dependency as of 14 days ago (guide 04 §8): a release published
# minutes ago, broken or hijacked, never reaches a new project. Node 24 (npm 11), like the Dockerfile: npm 10 fails on
# Nest 12's peer set with "Cannot read properties of null (reading 'edgesOut')". app-setup.sh adds /health, Zod and, when
# compose.db.yaml exists, Prisma with the driver adapter of that database (or Mongoose for MongoDB). On failure,
# package.json goes away so a second `make new-app` runs again instead of saying there is nothing to do.
_new-app:
	docker run --rm -e UID_GID="$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e PRISMA_VERSION="$(PRISMA_VERSION)" \
	  -v "$$PWD":/work -w /tmp node:24-alpine sh -c '\
	  export npm_config_before="$$(node -p "new Date(Date.now() - 14 * 864e5).toISOString()")"; \
	  ( apk add --no-cache coreutils bash >/dev/null && \
	    npm install --prefix /tmp/cli --no-audit --no-fund @nestjs/cli@$(NEST_CLI_VERSION) && \
	    /tmp/cli/node_modules/.bin/nest new app --package-manager npm --skip-git --skip-install --no-observe && \
	    cp -R --update=none /tmp/app/. /work/ && test -f /work/package.json && cd /work && \
	    npm install --no-audit --no-fund && bash .agents/skills/nest-scaffold/scripts/app-setup.sh ); \
	  status=$$?; chown -R "$$UID_GID" /work; exit $$status' \
	  || { rm -f package.json package-lock.json; echo "ERROR: make new-app falló; se quitó package.json para reintentar"; exit 1; }
	@echo "App creada. Siguiente: make env && make dev"
