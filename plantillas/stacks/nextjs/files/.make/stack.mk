# Variables del stack Next.js para el Makefile común
APP         := app
PORT        := 3000
SHELL_CMD   := sh
INSTALL_CMD := npm ci
TEST_CMD    := npx --no-install vitest run
LINT_CMD    := npx --no-install eslint .
MAKE_MIGRATION_CMD = npx --no-install prisma migrate dev --name "$$NAME"
VERIFY_CMD  = bash .agents/skills/nextjs-verify/scripts/verify.sh "$${SCOPE:-src}"
# 16.4.3: newest release that is at least 14 days old (2026-10-23); 16.0.x lacks the RSC security fixes.
# Bump it only to a release at least 14 days old: npm_config_before (below) applies to exact versions too,
# so a newer one makes `make new-app` fail with ETARGET until it is 14 days old.
CREATE_NEXT_VERSION ?= 16.4.3

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea la app Next.js en Docker (solo si no existe package.json)
	@if [ -f package.json ]; then echo "Ya existe package.json; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

# _new-app runs as root and hands the files back at the end: create-next-app calls os.userInfo(), which
# fails for a host uid that has no passwd entry in the image. GNU cp because busybox `cp -Rn` skips the
# whole tree when /work already exists. npm_config_before resolves every dependency as of 14 days ago
# (guide 04 §8): a release published minutes ago, broken or hijacked, never reaches a new project.
_new-app:
	docker run --rm -e UID_GID="$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e NEXT_TELEMETRY_DISABLED=1 \
	  -v "$$PWD":/work -w /tmp node:22-alpine sh -c '\
	  export npm_config_before="$$(node -p "new Date(Date.now() - 14 * 864e5).toISOString()")" && \
	  apk add --no-cache coreutils >/dev/null && \
	  npm install --prefix /tmp/cli --no-audit --no-fund create-next-app@$(CREATE_NEXT_VERSION) && \
	  /tmp/cli/node_modules/.bin/create-next-app app --ts --eslint --app --src-dir --tailwind \
	    --import-alias "@/*" --use-npm --yes --skip-install && \
	  cp -R --update=none /tmp/app/. /work/ && test -f /work/package.json && cd /work && npm install --no-audit --no-fund && \
	  npm install --no-audit --no-fund zod server-only && \
	  npm install --no-audit --no-fund -D vitest @testing-library/react @testing-library/jest-dom jsdom @types/node@^22 && \
	  chown -R "$$UID_GID" /work'
	@f=$$(ls next.config.* 2>/dev/null | head -1); \
	if [ -n "$$f" ] && ! grep -q standalone "$$f"; then \
	  sed -i.bak 's|/\* config options here \*/|output: "standalone",|' "$$f" && rm -f "$$f.bak"; \
	  grep -q standalone "$$f" && echo "  ~ $$f: output standalone" || echo "AVISO: agrega output: \"standalone\" a $$f"; fi
	@mkdir -p src/app/api/health && [ -f src/app/api/health/route.ts ] || \
	  printf 'export function GET() {\n  return Response.json({ status: "ok" });\n}\n' > src/app/api/health/route.ts
	@echo "App creada. Siguiente: make env && make dev"
