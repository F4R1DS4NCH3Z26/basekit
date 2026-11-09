# Variables del stack Go · Gin para el Makefile común
APP         := app
PORT        := 8080
SHELL_CMD   := bash
INSTALL      = $(DC) build $(APP)
TEST_CMD    := go test ./...
LINT_CMD    := bash -c 'f=$$(gofmt -l cmd internal migrations); [ -z "$$f" ] || { echo "gofmt: $$f"; exit 1; }; go vet ./... && go tool staticcheck ./...'
MAKE_MIGRATION_CMD = go run ./cmd/api migration "$$NAME"
VERIFY_CMD  = bash .agents/skills/gin-verify/scripts/verify.sh "$${SCOPE:-.}"
GO_IMAGE    ?= golang:1.27.3-trixie
GO_RUN       = docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e GOPATH=/tmp/go -e GOCACHE=/tmp/go-build -e GOTOOLCHAIN=local -v "$$PWD":/app -w /app
export PKGS

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Genera go.sum en Docker con go mod tidy (el esqueleto lo dejó basekit)
	@if [ ! -f go.mod ]; then echo "Falta go.mod (ejecuta npx --no-install basekit init)"; exit 1; \
	elif [ -f go.sum ]; then echo "Ya existe go.sum; nada que hacer"; \
	else $(MAKE) --no-print-directory _new-app; fi

_new-app:
	$(GO_RUN) $(GO_IMAGE) go mod tidy
	@echo "go.sum creado. Siguiente: make env && make dev"

# PKGS reaches the shell as an environment variable (export PKGS): make never interpolates it into the command.
deps-add: ## Agrega dependencias con versión exacta: make deps-add PKGS="github.com/golang-jwt/jwt/v5@v5.3.1"
	@[[ -n "$${PKGS:-}" ]] || { echo 'Uso: make deps-add PKGS="modulo@vX.Y.Z ..."'; exit 2; }; \
	for p in $$PKGS; do [[ $$p =~ ^[A-Za-z0-9._~/-]+@v[0-9][A-Za-z0-9.+-]*$$ ]] || { echo "Versión exacta obligatoria: $$p (modulo@vX.Y.Z)"; exit 2; }; done
	$(GO_RUN) -e PKGS $(GO_IMAGE) sh -c 'go get $$PKGS && go mod tidy'
	$(DC) build $(APP)
