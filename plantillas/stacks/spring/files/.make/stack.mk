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
SPRING_DB   ?= postgresql
SPRING_PKG  ?= com.app

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Crea la app Spring Boot con Initializr en Docker (SPRING_DB=postgresql|mysql|none, SPRING_PKG=com.app)
	@if [ -f pom.xml ]; then echo "Ya existe pom.xml; nada que hacer"; else $(MAKE) --no-print-directory _new-app; fi

_new-app:
	@[[ "$(SPRING_PKG)" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$$ ]] || { echo "SPRING_PKG inválido"; exit 2; }
	@deps="web,validation,security,oauth2-resource-server,actuator,devtools"; \
	case "$(SPRING_DB)" in postgresql|mysql) deps="$$deps,data-jpa,flyway,$(SPRING_DB)";; none) ;; *) echo "SPRING_DB inválido"; exit 2;; esac; \
	docker run --rm -e UID_GID="$$(id -u):$$(id -g)" -v "$$PWD":/work -w /tmp alpine:3.20 sh -c "\
	  apk add --no-cache curl unzip >/dev/null && \
	  curl -fsSL 'https://start.spring.io/starter.zip?type=maven-project&language=java&javaVersion=21&groupId=$(SPRING_PKG)&artifactId=app&name=app&packageName=$(SPRING_PKG)&dependencies='$$deps -o app.zip && \
	  unzip -q -n app.zip -x HELP.md -d /work && chown -R \$$UID_GID /work"
	@[ -f pom.xml ] || { echo "ERROR: Initializr no dejó pom.xml"; exit 1; }
	@echo "App creada. Siguiente: make env && make dev"
