# Variables del stack FastAPI para el Makefile común
APP         := app
PORT        := 8000
SHELL_CMD   := bash
INSTALL      = $(DC) build $(APP)
TEST_CMD    := pytest -q
LINT_CMD    := ruff check .
MAKE_MIGRATION_CMD = alembic revision --autogenerate -m "$$NAME"
VERIFY_CMD  = bash .agents/skills/py-verify/scripts/verify.sh "$${SCOPE:-src}"
# The MongoDB overlay (compose.db.yaml with DB_DRIVER: mongodb): one exact match, shared with py-scaffold's mongo-setup.sh
# and scaffold.sh ($$ is make's escape for $).
DB_IS_MONGO := $(shell grep -Eqs '^[[:space:]]*DB_DRIVER:[[:space:]]*mongodb[[:space:]]*$$' compose.db.yaml && echo mongo)
# MongoDB has no migrations: the indexes live in the models and `make migrate` creates them (src/core/create_indexes.py).
# make migration only says so: no NAME check and no container.
ifneq ($(DB_IS_MONGO),)
MONGO_MIGRATION_MSG := MongoDB no tiene migraciones: los índices se declaran en los modelos (src/modules/<m>/models.py) y make migrate los crea
# Target-specific overrides, for make migration only: the Makefile's NAME check becomes `:` and DC just prints the message.
migration: MIGRATION_NAME_CHECK = :
migration: DC = @echo "$(MONGO_MIGRATION_MSG)"; :
endif
UV_IMAGE    ?= ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim

# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Genera uv.lock en Docker (el esqueleto lo dejó basekit)
	@if [ ! -f pyproject.toml ]; then echo "Falta pyproject.toml (ejecuta npx --no-install basekit init en la raíz del proyecto)"; exit 1; \
	elif [ -f uv.lock ]; then echo "Ya existe uv.lock; nada que hacer"; \
	else $(MAKE) --no-print-directory _new-app; fi

# mongo-setup.sh first writes the Beanie variant over the untouched starter when the overlay is MongoDB (silent otherwise).
# Without the script, a SQL project goes straight to uv lock and a MongoDB one stops: uv lock would lock SQLAlchemy.
MONGO_SETUP := .agents/skills/py-scaffold/scripts/mongo-setup.sh
_new-app:
	@if [ -f $(MONGO_SETUP) ]; then bash $(MONGO_SETUP); \
	elif [ -n "$(DB_IS_MONGO)" ]; then echo "ERROR: falta $(MONGO_SETUP) (skill py-scaffold): con MongoDB cambia el esqueleto a Beanie antes de uv lock"; exit 1; fi
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e UV_CACHE_DIR=/tmp/uv -v "$$PWD":/app -w /app $(UV_IMAGE) uv lock
	@echo "uv.lock creado. Siguiente: make env && make dev"

deps-add: ## Agrega dependencias: make deps-add PKGS="sqlalchemy psycopg[binary]" [DEV=1]
	@[ -n "$(PKGS)" ] || { echo 'Uso: make deps-add PKGS="paquete1 paquete2" [DEV=1]'; exit 2; }
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e UV_CACHE_DIR=/tmp/uv -v "$$PWD":/app -w /app $(UV_IMAGE) \
	  uv add $(if $(DEV),--dev,) --no-sync $(PKGS)
	$(DC) build $(APP)
