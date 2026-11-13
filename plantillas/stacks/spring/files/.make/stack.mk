# Variables del stack Spring Boot para el Makefile común
APP         := app
PORT        := 8080
SHELL_CMD   := bash
INSTALL      = $(DC) build $(APP)
TEST_CMD    := ./mvnw -q -B test
LINT_CMD    := ./mvnw -q -B -DskipTests verify
MAKE_MIGRATION_CMD = sh -c 'n=$$(ls src/main/resources/db/migration 2>/dev/null | sed -n "s/^V\([0-9]*\)__.*/\1/p" | sort -n | tail -1); f="src/main/resources/db/migration/V$$((n+1))__$$NAME.sql"; mkdir -p "$$(dirname "$$f")"; printf -- "-- %s\n" "$$NAME" > "$$f"; echo "+ $$f"'
VERIFY_CMD  = bash .agents/skills/java-verify/scripts/verify.sh $${SCOPE:-}
VERIFY_ENV  := -e OFFLINE=0
# Engine chosen by the bootstrap (infra-setup writes compose.db.yaml); without a DB the app gets no JPA.
# The first active `image:` line (quotes, registry, tag and digest stripped) gives the engine; a commented
# line has `#` as its first field, so it never matches. mariadb uses the mysql driver.
DB_IMAGE    := $(shell tr -d "\"'" 2>/dev/null < compose.db.yaml | awk '$$1 == "image:" { print $$2; exit }')
DB_ENGINE   := $(firstword $(subst :, ,$(subst @, ,$(notdir $(DB_IMAGE)))))
# MongoDB: the overlay's DB_DRIVER, with the same exact match as java-scaffold's mongo-setup.sh and scaffold.sh.
DB_MONGO    := $(shell grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$$' compose.db.yaml && echo mongo)
SPRING_DB   ?= $(if $(DB_MONGO),mongodb,$(if $(filter postgres,$(DB_ENGINE)),postgresql,$(if $(filter mysql mariadb,$(DB_ENGINE)),mysql,none)))
SPRING_PKG  ?= com.app
# MongoDB (Spring Data MongoDB) has no migrations: the indexes live in the entities (@Indexed) and `make migrate` creates
# them with the app's CreateIndexes step. make migration only says so: no NAME check and no container.
ifneq ($(DB_MONGO),)
MONGO_MIGRATION_MSG := MongoDB no tiene migraciones: los índices se declaran en las entidades (@Indexed en modules/<m>/domain) y make migrate los crea
# Target-specific overrides, for make migration only: the Makefile's NAME check becomes `:` and DC just prints the message.
migration: MIGRATION_NAME_CHECK = :
migration: DC = @echo "$(MONGO_MIGRATION_MSG)"; :
# make migrate (and prod-migrate): compose.mongo-migrate.yaml, written by mongo-setup.sh on make new-app, replaces the
# Flyway service with the app's prod image running CreateIndexes. Without that file, Compose fails (never a silent 0).
migrate: OVERLAYS += compose.mongo-migrate.yaml
endif

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea la app Spring Boot con Initializr en Docker (SPRING_DB=postgresql|mysql|mongodb|none, SPRING_PKG=com.app)
	@if [ -f pom.xml ]; then echo "Ya existe pom.xml; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

_new-app:
	@[[ "$(SPRING_PKG)" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$$ ]] || { echo "SPRING_PKG inválido"; exit 2; }
	@deps="web,validation,security,oauth2-resource-server,actuator,devtools"; \
	case "$(SPRING_DB)" in postgresql|mysql) deps="$$deps,data-jpa,flyway,$(SPRING_DB)";; none) ;; \
	  mongodb) [ -n "$(DB_MONGO)" ] || { echo "SPRING_DB=mongodb necesita el overlay de MongoDB (skill infra-setup, --db mongo)"; exit 2; }; \
	    deps="$$deps,data-mongodb";; \
	  *) echo "SPRING_DB inválido"; exit 2;; esac; \
	docker run --rm -e UID_GID="$$(id -u):$$(id -g)" -v "$$PWD":/work -w /tmp alpine:3.20 sh -c "\
	  apk add --no-cache curl unzip >/dev/null && \
	  curl -fsSL 'https://start.spring.io/starter.zip?type=maven-project&language=java&javaVersion=21&groupId=$(SPRING_PKG)&artifactId=app&name=app&packageName=$(SPRING_PKG)&dependencies='$$deps -o app.zip && \
	  unzip -q -n app.zip -x HELP.md -d /work && chown -R \$$UID_GID /work"
	@[ -f pom.xml ] || { echo "ERROR: Initializr no dejó pom.xml"; exit 1; }
	@$(if $(DB_MONGO),bash .agents/skills/java-scaffold/scripts/mongo-setup.sh || { echo "ERROR: mongo-setup.sh falló; corrige el motivo y vuelve a ejecutarlo: bash .agents/skills/java-scaffold/scripts/mongo-setup.sh"; exit 1; },:)
	@echo "App creada. Siguiente: make env && make dev"
