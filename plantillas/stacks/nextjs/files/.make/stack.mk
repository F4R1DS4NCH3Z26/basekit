# Variables del stack Next.js para el Makefile común
APP         := app
PORT        := 3000
SHELL_CMD   := sh
INSTALL_CMD := npm ci
TEST_CMD    := npx --no-install vitest run
LINT_CMD    := npx --no-install eslint .
MAKE_MIGRATION_CMD = npx --no-install prisma migrate dev --name "$$NAME"
VERIFY_CMD  = bash .agents/skills/nextjs-verify/scripts/verify.sh "$${SCOPE:-src}"
CREATE_NEXT_VERSION ?= 16.0.0

# new-app runs as root and hands the files back at the end: create-next-app calls os.userInfo(), which
# fails for a host uid that has no passwd entry in the image. GNU cp because busybox `cp -Rn` skips the
# whole tree when /work already exists.
new-app: ## Crea la app Next.js en Docker (solo si no existe package.json)
	@[ ! -f package.json ] || { echo "Ya existe package.json; nada que hacer"; exit 0; }
	docker run --rm -e UID_GID="$$(id -u):$$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e NEXT_TELEMETRY_DISABLED=1 \
	  -v "$$PWD":/work -w /tmp node:22-alpine sh -c '\
	  apk add --no-cache coreutils >/dev/null && \
	  npx --yes create-next-app@$(CREATE_NEXT_VERSION) app --ts --eslint --app --src-dir --tailwind \
	    --import-alias "@/*" --use-npm --yes --skip-install && \
	  cp -R --update=none /tmp/app/. /work/ && cd /work && npm install --no-audit --no-fund && \
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
