# Makefile — raíz de un proyecto combinado backend/ + frontend/ (generado por basekit). `make help` lista los comandos.
# Cada carpeta es un proyecto completo con su propio Makefile: este solo delega (make -C backend … / make -C frontend …).
# Desarrollo:  make env && make dev
# Producción:  make env ENV=prod   (edita backend/.env.prod y frontend/.env.prod)   &&   make prod-up
# Las variables de la línea de comandos (ENV=prod, SCOPE=…, NAME=…, CONFIRM=1) llegan a los dos Makefiles.
# Logs de un solo lado: make logs SIDE=backend; de un servicio: make logs SIDE=backend S=db (S solo existe en un lado).
SHELL := /usr/bin/env bash
.SHELLFLAGS := -euo pipefail -c
.DEFAULT_GOAL := help

SIDES := backend frontend
# One side after the other; the first failure stops (verify, test…). `-` is not used: a failure must be seen.
both = $(foreach s,$(SIDES),$(MAKE) --no-print-directory -C $(s) $(1) &&) true
# Both sides at once (dev, build, logs -f): -j2 runs the two sub-makes in parallel.
# Recipes that use them start with `+`: make cannot see $(MAKE) inside $(call), and `make -n` must still recurse.
parallel = $(MAKE) --no-print-directory -j2 $(foreach s,$(SIDES),_$(s)-$(1))

.PHONY: help env doctor dev up down restart logs ps build install test lint verify migrate migration db-shell new-app \
        prod-build prod-up prod-down prod-logs prod-migrate clean fix-perms

help: ## Lista los comandos (cada lado: make -C backend help / make -C frontend help)
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(firstword $(MAKEFILE_LIST)) | awk 'BEGIN{FS=":.*## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

env: ## Crea backend/.env y frontend/.env (o .env.prod con ENV=prod) desde su .env.example
	+@$(call both,env)

doctor: ## Revisa docker, compose, archivos de entorno y overlays de los dos lados
	+@$(call both,doctor)

dev: ## Construye y levanta backend y frontend en desarrollo (en paralelo)
	+@$(call parallel,dev)

up: ## Levanta los dos lados sin reconstruir
	+@$(call parallel,up)

down: ## Detiene los dos lados (conserva los datos)
	+@$(call both,down)

restart: ## Reinicia la app de los dos lados
	+@$(call both,restart)

# A service lives on one side only (db and redis are the backend's), so S=<service> needs SIDE: sent to both sides,
# the one without that service would fail. Both are checked by make itself, before any recipe runs (make -n too).
logs_side = $(if $(SIDE),$(if $(filter $(SIDE),$(SIDES)),$(SIDE),$(error SIDE debe ser backend o frontend)),$(if $(S),$(error S=$(S) filtra un servicio de un solo lado: agrega SIDE=backend o SIDE=frontend)))
# $(1): logs or prod-logs. With SIDE, only that side; otherwise both at once.
side_logs = $(if $(logs_side),$(MAKE) --no-print-directory -C $(SIDE) $(1),$(call parallel,$(1)))

logs: ## Sigue los logs de los dos lados a la vez (SIDE=backend|frontend para uno; S=servicio requiere SIDE)
	+@$(call side_logs,logs)

ps: ## Estado de los servicios de los dos lados
	+@$(call both,ps)

build: ## Construye las imágenes de los dos lados (en paralelo)
	+@$(call parallel,build)

install: ## Instala o actualiza dependencias en los dos lados
	+@$(call both,install)

test: ## Corre los tests del backend y luego los del frontend
	+@$(call both,test)

lint: ## Corre el linter de los dos lados
	+@$(call both,lint)

verify: ## Verificación de los dos lados (SCOPE=ruta relativa a cada lado, opcional)
	+@$(call both,verify)

migrate: ## Aplica las migraciones del backend (el frontend no tiene base de datos)
	@$(MAKE) --no-print-directory -C backend migrate

migration: ## Crea una migración en el backend: make migration NAME=create_orders
	@$(MAKE) --no-print-directory -C backend migration

db-shell: ## Consola de la base de datos del backend
	@$(MAKE) --no-print-directory -C backend db-shell

new-app: ## Crea la app del framework que falte en cada lado (dentro de Docker)
	+@$(call both,new-app)

prod-build: ## Construye las imágenes de producción de los dos lados (en paralelo)
	+@$(call parallel,prod-build)

prod-up: ## Construye y levanta producción en los dos lados (requiere sus .env.prod)
	+@$(call both,prod-up)

prod-down: ## Detiene producción en los dos lados
	+@$(call both,prod-down)

prod-logs: ## Logs de producción de los dos lados (SIDE=backend|frontend para uno; S=servicio requiere SIDE)
	+@$(call side_logs,prod-logs)

prod-migrate: ## Aplica las migraciones del backend en producción
	@$(MAKE) --no-print-directory -C backend prod-migrate

clean: ## Borra contenedores Y volúmenes de los dos lados. Requiere CONFIRM=1; nunca en prod
	+@$(call both,clean)

fix-perms: ## Devuelve a tu usuario los archivos creados por contenedores en los dos lados (Linux)
	+@$(call both,fix-perms)

# Targets for the parallel runs: _backend-dev, _frontend-logs… (never files, so they always run).
_backend-%:
	@$(MAKE) --no-print-directory -C backend $*

_frontend-%:
	@$(MAKE) --no-print-directory -C frontend $*
