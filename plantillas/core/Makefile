# Makefile — interfaz única del proyecto (generado por basekit). `make help` lista los comandos.
# Desarrollo:  make env && make dev
# Producción:  make env ENV=prod   (edita .env.prod)   &&   make prod-up
SHELL := /usr/bin/env bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help
export NAME SCOPE

ENV ?= dev
ifeq ($(filter $(ENV),dev prod),)
$(error ENV debe ser dev o prod)
endif
include .make/stack.mk
-include .make/db.mk

ENV_FILE := $(if $(filter prod,$(ENV)),.env.prod,.env)
OVERLAYS := $(wildcard compose.db.yaml compose.redis.yaml)
DC = docker compose --env-file $(ENV_FILE) -f compose.yaml -f compose.$(ENV).yaml $(foreach f,$(OVERLAYS),-f $(f))

# Valores por defecto; .make/stack.mk puede sobrescribirlos.
INSTALL      ?= $(DC) run --rm $(APP) $(INSTALL_CMD)
VERIFY_ENV   ?=
DB_SHELL_CMD ?=

.PHONY: help env doctor dev up down restart logs ps sh build install test lint verify migrate migration \
        db-shell prod-build prod-up prod-down prod-logs prod-migrate clean fix-perms _env-check

help: ## Lista los comandos disponibles
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

env: ## Crea .env (o .env.prod con ENV=prod) desde .env.example con secretos aleatorios
	@if [ -f $(ENV_FILE) ]; then echo "$(ENV_FILE) ya existe; no se sobrescribe"; exit 0; fi; \
	command -v openssl >/dev/null || { echo "Falta openssl"; exit 1; }; \
	umask 077; \
	while IFS= read -r line || [ -n "$$line" ]; do \
	  if [[ $$line == *__GENERATE_B64__* ]]; then line="$${line//__GENERATE_B64__/$$(openssl rand -base64 32)}"; fi; \
	  if [[ $$line == *__GENERATE__* ]]; then line="$${line//__GENERATE__/$$(openssl rand -hex 32)}"; fi; \
	  echo "$$line"; \
	done < .env.example > $(ENV_FILE); \
	echo "$(ENV_FILE) creado (permisos 600). Revisa los valores marcados con CAMBIAR."

doctor: ## Revisa docker, compose, archivos de entorno y overlays activos
	@for c in docker git openssl; do command -v $$c >/dev/null && echo "OK    $$c" || echo "FALTA $$c"; done; \
	docker compose version >/dev/null 2>&1 && echo "OK    docker compose v2" || echo "FALTA docker compose v2"; \
	[ -f $(ENV_FILE) ] && echo "OK    $(ENV_FILE)" || echo "FALTA $(ENV_FILE) → make env$(if $(filter prod,$(ENV)), ENV=prod,)"; \
	echo "overlays: $(or $(OVERLAYS),ninguno)"

dev: _env-check ## Construye y levanta el entorno de desarrollo
	$(DC) up -d --build
	@echo "→ http://localhost:$(PORT)   (logs: make logs)"

up: _env-check ## Levanta los servicios sin reconstruir
	$(DC) up -d

down: ## Detiene los servicios (conserva los datos)
	$(DC) down

restart: _env-check ## Reinicia la app
	$(DC) restart $(APP)

logs: ## Sigue los logs (S=servicio para filtrar)
	$(DC) logs -f --tail=100 $(S)

ps: ## Estado de los servicios
	$(DC) ps

sh: _env-check ## Abre una shell dentro del contenedor de la app
	$(DC) exec $(APP) $(SHELL_CMD)

build: _env-check ## Construye las imágenes del ENV actual
	$(DC) build

install: _env-check ## Instala o actualiza dependencias dentro del contenedor
	$(INSTALL)

test: _env-check ## Corre los tests dentro del contenedor
	$(DC) run --rm $(APP) $(TEST_CMD)

lint: _env-check ## Corre el linter dentro del contenedor
	$(DC) run --rm $(APP) $(LINT_CMD)

verify: _env-check ## Verificación con salida mínima para agentes (SCOPE=ruta o dominio, opcional)
	@[[ -z "$${SCOPE:-}" || "$$SCOPE" =~ ^[][A-Za-z0-9_./@()-]+$$ ]] || { echo "SCOPE inválido"; exit 2; }
	$(DC) run --rm --no-deps $(VERIFY_ENV) $(APP) $(VERIFY_CMD)

migrate: _env-check ## Aplica las migraciones (servicio migrate; también en prod con ENV=prod)
	$(DC) --profile tools run --rm migrate

migration: _env-check ## Crea una migración: make migration NAME=create_orders
	@[[ "$${NAME:-}" =~ ^[a-z0-9_]{3,60}$$ ]] || { echo "Uso: make migration NAME=snake_case"; exit 2; }
	$(DC) run --rm -e NAME $(APP) $(MAKE_MIGRATION_CMD)

db-shell: _env-check ## Consola de la base de datos
	@[ -n "$(DB_SHELL_CMD)" ] || { echo "No hay base de datos configurada (skill infra-setup)"; exit 1; }
	$(DC) exec db $(DB_SHELL_CMD)

prod-build: ## Construye las imágenes de producción
	@$(MAKE) --no-print-directory build ENV=prod

prod-up: ## Construye y levanta producción (requiere .env.prod)
	@$(MAKE) --no-print-directory build up ENV=prod

prod-down: ## Detiene producción
	@$(MAKE) --no-print-directory down ENV=prod

prod-logs: ## Logs de producción
	@$(MAKE) --no-print-directory logs ENV=prod

prod-migrate: ## Aplica las migraciones en producción
	@$(MAKE) --no-print-directory migrate ENV=prod

clean: ## Borra contenedores Y volúmenes (datos locales). Requiere CONFIRM=1; nunca en prod
	@[ "$(ENV)" != prod ] || { echo "clean no está permitido con ENV=prod"; exit 1; }
	@[ "$(CONFIRM)" = 1 ] || { echo "Borra los datos locales. Repite con: make clean CONFIRM=1"; exit 1; }
	$(DC) down -v --remove-orphans

fix-perms: ## Devuelve a tu usuario los archivos creados por contenedores (Linux)
	docker run --rm -v "$$PWD":/w alpine:3.20 chown -R "$$(id -u):$$(id -g)" /w

_env-check:
	@[ -f $(ENV_FILE) ] || { echo "Falta $(ENV_FILE). Ejecuta: make env$(if $(filter prod,$(ENV)), ENV=prod,)"; exit 1; }

