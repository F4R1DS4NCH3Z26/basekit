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

new-app: ## Crea la app Laravel en Docker (solo si no existe composer.json) y mapea src/Modules
	@[ ! -f composer.json ] || { echo "Ya existe composer.json; nada que hacer"; exit 0; }
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e COMPOSER_HOME=/tmp/composer \
	  -v "$$PWD":/work -w /tmp composer:2 sh -c '\
	  composer create-project laravel/laravel:"$(LARAVEL_VERSION)" app --prefer-dist --no-interaction --no-scripts --no-install && \
	  rm -f app/.env.example app/.env && cp -Rn app/. /work/ && cd /work && \
	  composer config platform.php $(PHP_PLATFORM) && \
	  php /work/.make/laravel-autoload.php composer.json && \
	  composer update --no-interaction --no-scripts'
	@mkdir -p src/Modules
	@echo "App creada. Siguiente: make env && make dev && make sh → php artisan install:api (Sanctum)"
