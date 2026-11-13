# Variables del stack Laravel para el Makefile común
APP         := app
PORT        := 8000
SHELL_CMD   := sh
INSTALL_CMD := composer install --no-interaction
TEST_CMD    := php artisan test
LINT_CMD    := vendor/bin/pint --test
MAKE_MIGRATION_CMD = php artisan make:migration "$$NAME"
VERIFY_CMD  = bash .agents/skills/php-verify/scripts/verify.sh "$${SCOPE:-src}"
LARAVEL_VERSION ?= ^12.0
# Must match the PHP of the runtime image (dunglas/frankenphp:1-php8.3): the composer:2 image runs a newer
# PHP, and without this the lock would pick packages that require it.
PHP_PLATFORM    ?= 8.3.0
# MongoDB (compose.db.yaml with DB_DRIVER: mongodb): after creating the app, new-app runs php-scaffold's mongo-setup.sh
# (mongodb/laravel-mongodb, the extension in the Dockerfile, the connection and the migration stubs). Same exact match
# as that script and scaffold.sh. Migrations stay: in MongoDB they create the indexes (make migrate).
MONGO := $(shell [ "$$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml 2>/dev/null | head -1)" = mongodb ] && echo 1)

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea la app Laravel en Docker (solo si no existe composer.json) y mapea src/Modules
	@if [ -f composer.json ]; then echo "Ya existe composer.json; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

# COMPOSER_AUTH is forwarded by name, so a GitHub token never shows up on the command line: composer then
# downloads package zips from api.github.com authenticated (anonymous requests get rate limits and 504s).
_new-app:
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e COMPOSER_HOME=/tmp/composer -e COMPOSER_AUTH \
	  -v "$$PWD":/work -w /tmp composer:2 sh -c '\
	  composer create-project laravel/laravel:"$(LARAVEL_VERSION)" app --prefer-dist --no-interaction --no-scripts --no-install && \
	  rm -f app/.env.example app/.env && cp -Rn app/. /work/ && cd /work && \
	  composer config platform.php $(PHP_PLATFORM) && \
	  php /work/.make/laravel-autoload.php composer.json && \
	  composer update --no-interaction --no-scripts'
	@mkdir -p src/Modules
	$(if $(MONGO),@bash .agents/skills/php-scaffold/scripts/mongo-setup.sh || { echo "ERROR: falló el paso de MongoDB; corrige y vuelve a ejecutar: bash .agents/skills/php-scaffold/scripts/mongo-setup.sh"; exit 1; })
	@echo "App creada. Siguiente: make env && make dev && make sh → php artisan install:api (Sanctum)"
