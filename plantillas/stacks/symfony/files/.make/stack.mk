# Variables del stack Symfony para el Makefile común
APP         := app
PORT        := 8000
SHELL_CMD   := sh
INSTALL_CMD := composer install --no-interaction
TEST_CMD    := vendor/bin/phpunit
LINT_CMD    := vendor/bin/php-cs-fixer fix --dry-run --diff
# Doctrine names the class VersionYYYYMMDDHHMMSS: NAME is validated by the Makefile but Doctrine does not use it.
MAKE_MIGRATION_CMD = php bin/console doctrine:migrations:diff --no-interaction --allow-empty-diff
VERIFY_CMD  = bash .agents/skills/symfony-verify/scripts/verify.sh "$${SCOPE:-src}"
SYMFONY_VERSION ?= 7.4.*
# Must match the PHP of the runtime image (dunglas/frankenphp:1-php8.3): the composer:2 image runs a newer
# PHP, and without this the lock would pick packages that require it.
PHP_PLATFORM    ?= 8.3.0
SYMFONY_REQUIRE ?= doctrine/doctrine-bundle:^2.13 doctrine/doctrine-migrations-bundle:^3.4 doctrine/orm:^3.3 \
  symfony/security-bundle:7.4.* symfony/serializer:7.4.* symfony/property-access:7.4.* \
  symfony/property-info:7.4.* symfony/validator:7.4.* symfony/uid:7.4.* symfony/rate-limiter:7.4.*
SYMFONY_REQUIRE_DEV ?= phpunit/phpunit:^12.0 symfony/browser-kit:7.4.* symfony/css-selector:7.4.* \
  phpstan/phpstan:^2.1 friendsofphp/php-cs-fixer:^3.75
# MongoDB (compose.db.yaml with DB_DRIVER: mongodb; same exact match as symfony-scaffold's scripts): Doctrine MongoDB ODM
# instead of the ORM and Migrations, at exact versions at least 14 days old (mongodb/mongodb pinned so the lock never takes a
# younger driver). new-app first adds the mongodb extension to the Dockerfile (mongo-setup.sh), then setup.php config-mongo
# writes the ODM config. There are no migrations: the indexes live in the documents and `make migrate` creates them.
MONGO := $(shell [ "$$(sed -n 's/^[[:space:]]*DB_DRIVER:[[:space:]]*\([a-z]*\).*/\1/p' compose.db.yaml 2>/dev/null | head -1)" = mongodb ] && echo 1)
ifneq ($(MONGO),)
SYMFONY_REQUIRE := doctrine/mongodb-odm-bundle:5.6.1 doctrine/mongodb-odm:2.17.4 mongodb/mongodb:2.5.0 \
  $(filter-out doctrine/%,$(SYMFONY_REQUIRE))
MONGO_MIGRATION_MSG := MongoDB no tiene migraciones: los índices se declaran en los documentos (src/Modules/<M>/Domain/Entity/) y make migrate los crea
# Target-specific overrides, for make migration only: the Makefile's NAME check becomes `:` and DC just prints the message.
migration: MIGRATION_NAME_CHECK = :
migration: DC = @echo "$(MONGO_MIGRATION_MSG)"; :
endif

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea la API Symfony en Docker (solo si no existe composer.json) con Doctrine, Security y /health
	@if [ -f composer.json ]; then echo "Ya existe composer.json; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

# COMPOSER_AUTH is forwarded by name, so a GitHub token never shows up on the command line.
# Flex applies the recipes (bin/console, public/index.php, config/) in /tmp/app; then the kit files in
# .make/symfony/app replace routes, services, security and tests, and setup.php points Doctrine at src/Modules
# and DATABASE_URL (with MongoDB, the ODM at MONGO_URL). The skeleton .env files are dropped: the environment comes from compose, and .env.example
# is the only source of variables. cp -n never overwrites a file the kit already left in the project.
_new-app:
	$(if $(MONGO),@bash .agents/skills/symfony-scaffold/scripts/mongo-setup.sh)
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e COMPOSER_HOME=/tmp/composer -e COMPOSER_AUTH \
	  -v "$$PWD":/work -w /tmp composer:2 sh -c 'set -euf; \
	  composer create-project symfony/skeleton:"$(SYMFONY_VERSION)" app --no-interaction --no-install --no-scripts; \
	  cd /tmp/app; \
	  php /work/.make/symfony/setup.php composer $(PHP_PLATFORM); \
	  composer require --no-interaction --no-scripts --ignore-platform-req=ext-* $(SYMFONY_REQUIRE); \
	  composer require --dev --no-interaction --no-scripts --ignore-platform-req=ext-* $(SYMFONY_REQUIRE_DEV); \
	  cp -R /work/.make/symfony/app/. /tmp/app/; \
	  php /work/.make/symfony/setup.php $(if $(MONGO),config-mongo,config) /work/.env.example; \
	  rm -rf /tmp/app/vendor /tmp/app/var /tmp/app/src/Controller /tmp/app/src/Entity /tmp/app/src/Repository$(if $(MONGO), /tmp/app/src/Document); \
	  rm -f /tmp/app/.env /tmp/app/.env.* /tmp/app/compose.yaml /tmp/app/compose.override.yaml; \
	  cp -Rn /tmp/app/. /work/'
	@for p in /vendor/ /var/ /.phpunit.cache/ /.php-cs-fixer.cache; do grep -qxF "$$p" .gitignore 2>/dev/null || printf '%s\n' "$$p" >> .gitignore; done
	@echo "App creada. Siguiente: make env && make dev (health en http://localhost:$(PORT)/health)"
