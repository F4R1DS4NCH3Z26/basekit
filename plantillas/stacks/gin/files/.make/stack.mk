# Variables del stack Go · Gin para el Makefile común
APP         := app
PORT        := 8080
SHELL_CMD   := bash
INSTALL      = $(DC) build $(APP)
TEST_CMD    := go test ./...
LINT_CMD    := bash -c 'f=$$(gofmt -l cmd internal migrations); [ -z "$$f" ] || { echo "gofmt: $$f"; exit 1; }; go vet ./... && go tool staticcheck ./...'
MAKE_MIGRATION_CMD = go run ./cmd/api migration "$$NAME"
VERIFY_CMD  = bash .agents/skills/gin-verify/scripts/verify.sh "$${SCOPE:-.}"
# The MongoDB overlay (compose.db.yaml with DB_DRIVER: mongodb): one exact match, shared with gin-scaffold's mongo-setup.sh
# and scaffold.sh ($$ is make's escape for $).
DB_IS_MONGO := $(shell grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$$' compose.db.yaml && echo mongo)
# MongoDB has no migrations: the indexes live in the models and `make migrate` creates them (api migrate). make migration
# only says so: no NAME check and no container. There is no migrations/ to lint.
ifneq ($(DB_IS_MONGO),)
MONGO_MIGRATION_MSG := MongoDB no tiene migraciones: los índices se declaran en los modelos (internal/<m>/model.go) y make migrate los crea
# Target-specific overrides, for make migration only: the Makefile's NAME check becomes `:` and DC just prints the message.
migration: MIGRATION_NAME_CHECK = :
migration: DC = @echo "$(MONGO_MIGRATION_MSG)"; :
LINT_CMD    := bash -c 'f=$$(gofmt -l cmd internal); [ -z "$$f" ] || { echo "gofmt: $$f"; exit 1; }; go vet ./... && go tool staticcheck ./...'
endif
GO_IMAGE    ?= golang:1.27.3-trixie
GO_RUN       = docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e GOPATH=/tmp/go -e GOCACHE=/tmp/go-build -e GOTOOLCHAIN=local -v "$$PWD":/app -w /app
export PKGS

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Genera go.sum en Docker con go mod tidy (el esqueleto lo dejó basekit)
	@if [ ! -f go.mod ]; then echo "Falta go.mod (ejecuta npx --no-install basekit init en la raíz del proyecto)"; exit 1; \
	elif [ -f go.sum ]; then echo "Ya existe go.sum; nada que hacer"; \
	else $(MAKE) --no-print-directory _new-app; fi

# mongo-setup.sh first writes the mongo-driver variant over the untouched starter when the overlay is MongoDB (silent
# otherwise). Without the script, a SQL project goes straight to go mod tidy and a MongoDB one stops: tidy would keep GORM.
MONGO_SETUP := .agents/skills/gin-scaffold/scripts/mongo-setup.sh
_new-app:
	@if [ -f $(MONGO_SETUP) ]; then bash $(MONGO_SETUP); \
	elif [ -n "$(DB_IS_MONGO)" ]; then echo "ERROR: falta $(MONGO_SETUP) (skill gin-scaffold): con MongoDB cambia el esqueleto a mongo-driver antes de go mod tidy"; exit 1; fi
	$(GO_RUN) $(GO_IMAGE) go mod tidy
	@echo "go.sum creado. Siguiente: make env && make dev"

# PKGS reaches the shell as an environment variable (export PKGS): make never interpolates it into the command.
deps-add: ## Agrega dependencias con versión exacta: make deps-add PKGS="github.com/golang-jwt/jwt/v5@v5.3.1"
	@[[ -n "$${PKGS:-}" ]] || { echo 'Uso: make deps-add PKGS="modulo@vX.Y.Z ..."'; exit 2; }; \
	for p in $$PKGS; do [[ $$p =~ ^[A-Za-z0-9._~/-]+@v[0-9][A-Za-z0-9.+-]*$$ ]] || { echo "Versión exacta obligatoria: $$p (modulo@vX.Y.Z)"; exit 2; }; done
	$(GO_RUN) -e PKGS $(GO_IMAGE) sh -c 'go get $$PKGS && go mod tidy'
	$(DC) build $(APP)
