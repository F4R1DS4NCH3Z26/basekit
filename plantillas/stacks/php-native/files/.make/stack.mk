# Variables del stack PHP nativo (sin framework) para el Makefile común
APP         := app
PORT        := 8000
SHELL_CMD   := sh
INSTALL_CMD := composer install --no-interaction
TEST_CMD    := vendor/bin/phpunit
LINT_CMD    := vendor/bin/php-cs-fixer fix --dry-run --diff
# Global migration (migrations/). A module's migration: make module-migration M=Products NAME=create_products
MAKE_MIGRATION_CMD = php bin/migrate.php new "$$NAME"
VERIFY_CMD  = bash .agents/skills/phpnative-verify/scripts/verify.sh "$${SCOPE:-src}"
# Same Composer as the one copied into the image (Dockerfile). The lock is resolved for platform php 8.5.0
# (composer.json config.platform), the PHP of dunglas/frankenphp:1.13.2-php8.5-alpine.
COMPOSER_IMAGE ?= composer:2.10.2
# User data is read from the environment inside the recipe, never interpolated by make.
export M PKGS

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Genera composer.lock en Docker (el esqueleto PHP nativo lo dejó basekit)
	@if [ -f composer.lock ]; then echo "Ya existe composer.lock; nada que hacer"; \
	elif [ ! -f composer.json ] || [ ! -f public/index.php ]; then echo "Falta composer.json o public/index.php (ejecuta npx --no-install basekit init)"; exit 1; \
	else $(MAKE) --no-print-directory _new-app; fi

# COMPOSER_AUTH is forwarded by name, so a GitHub token never shows up on the command line.
_new-app:
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e COMPOSER_HOME=/tmp/composer -e COMPOSER_AUTH \
	  -v "$$PWD":/app -w /app $(COMPOSER_IMAGE) \
	  composer update --no-install --no-interaction --no-scripts '--ignore-platform-req=ext-*'
	@for p in /vendor/ /data/ /.phpunit.cache/ /.php-cs-fixer.cache; do grep -qxF "$$p" .gitignore 2>/dev/null || printf '%s\n' "$$p" >> .gitignore; done
	@echo "composer.lock creado. Siguiente: make env && make dev && make migrate (health en http://localhost:$(PORT)/health)"

# set -f: PKGS is split into words (one per package) but never globbed (`^1.2` or `*` stay literal).
deps-add: ## Agrega dependencias con versión exacta: make deps-add PKGS="vendor/paquete:1.2.3" [DEV=1]
	@set -euf; [[ "$${PKGS:-}" =~ ^[A-Za-z0-9_./:@^~\ -]+$$ ]] || { echo 'Uso: make deps-add PKGS="vendor/paquete:1.2.3" [DEV=1]'; exit 2; }; \
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e COMPOSER_HOME=/tmp/composer -e COMPOSER_AUTH \
	  -v "$$PWD":/app -w /app $(COMPOSER_IMAGE) \
	  composer require $(if $(DEV),--dev,) --no-install --no-interaction --no-scripts '--ignore-platform-req=ext-*' $$PKGS; \
	echo "composer.json y composer.lock actualizados. Siguiente: make install (dev) o make build"

module-migration: _env-check ## Migración SQL de un módulo: make module-migration M=Products NAME=create_products
	@[[ "$${M:-}" =~ ^[A-Z][A-Za-z0-9]{1,40}$$ && "$${NAME:-}" =~ ^[a-z0-9_]{3,60}$$ ]] || { echo "Uso: make module-migration M=Products NAME=create_products"; exit 2; }
	$(DC) run --rm --no-deps -e M -e NAME $(APP) php bin/migrate.php new "$$NAME" "$$M"
