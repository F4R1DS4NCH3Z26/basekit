---
name: django-verify
description: "Ejecuta ruff, mypy (con django-stubs), `manage.py check`, la comprobación de migraciones pendientes y pytest de un proyecto Django con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código Django en lugar de correr esas herramientas directamente."
allowed-tools: Bash(bash .agents/skills/django-verify/scripts/verify.sh:*)
---

# django-verify

```bash
bash .agents/skills/django-verify/scripts/verify.sh                       # todo src/
bash .agents/skills/django-verify/scripts/verify.sh src/modules/orders    # solo esa app
MAX_LINES=60 bash .agents/skills/django-verify/scripts/verify.sh …       # más detalle
```

- Usa `.venv/bin/` si existe (o `VENV=ruta`); si no, las herramientas del PATH. No instala nada ni usa la red (no llama a `uv run`, que puede sincronizar dependencias).
- `manage.py check` y `makemigrations --check --dry-run` corren con `src.config.settings_test` (SQLite en memoria): un modelo cambiado sin su migración es FAIL; la migración la genera el orquestador con `make migration NAME=x`.
- pytest corre con `-x -q --tb=short`: se detiene en el primer fallo y no imprime cabecera. "Sin tests" no cuenta como fallo.
- Las herramientas no instaladas se marcan `SKIP`. Si el error está fuera de tu zona, repórtalo; no lo corrijas.
