# Variables del stack Django para el Makefile común
APP         := app
PORT        := 8000
SHELL_CMD   := bash
INSTALL      = $(DC) build $(APP)
TEST_CMD    := pytest -q
LINT_CMD    := ruff check .
MAKE_MIGRATION_CMD = python manage.py makemigrations --name "$$NAME"
VERIFY_CMD  = bash .agents/skills/django-verify/scripts/verify.sh "$${SCOPE:-src}"
UV_IMAGE    ?= ghcr.io/astral-sh/uv:0.13.4-python3.12-trixie-slim

# The app marker is uv.lock: the Django skeleton (manage.py, pyproject.toml, src/config) comes from basekit init,
# and this target only resolves the dependencies. With uv.lock present it does nothing and never calls Docker.
# The guard and the work live in one shell decision: an `exit 0` on its own recipe line would only end that line.
new-app: ## Genera uv.lock en Docker (el esqueleto Django lo dejó basekit)
	@if [ -f uv.lock ]; then echo "Ya existe uv.lock; nada que hacer"; \
	elif [ ! -f pyproject.toml ] || [ ! -f manage.py ]; then echo "Falta pyproject.toml o manage.py (ejecuta npx --no-install basekit init en la raíz del proyecto)"; exit 1; \
	else $(MAKE) --no-print-directory _new-app; fi

_new-app:
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e UV_CACHE_DIR=/tmp/uv -v "$$PWD":/app -w /app $(UV_IMAGE) uv lock
	@echo "uv.lock creado. Siguiente: make env && make dev && make migrate"

deps-add: ## Agrega dependencias: make deps-add PKGS="djangorestframework-simplejwt" [DEV=1]
	@[ -n "$(PKGS)" ] || { echo 'Uso: make deps-add PKGS="paquete1 paquete2" [DEV=1]'; exit 2; }
	docker run --rm --user "$$(id -u):$$(id -g)" -e HOME=/tmp -e UV_CACHE_DIR=/tmp/uv -v "$$PWD":/app -w /app $(UV_IMAGE) \
	  uv add $(if $(DEV),--dev,) --no-sync $(PKGS)
	$(DC) build $(APP)

superuser: _env-check ## Crea un superusuario del admin (pide los datos de forma interactiva)
	$(DC) run --rm $(APP) python manage.py createsuperuser
