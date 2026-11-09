---
name: djhtmx-verify
description: "Ejecuta ruff, mypy (con django-stubs), la revisión de plantillas (sin |safe, compilan), `manage.py check`, la comprobación de migraciones pendientes y pytest de un proyecto Django + HTMX con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código o plantillas en lugar de correr esas herramientas directamente."
allowed-tools: Bash(bash .agents/skills/djhtmx-verify/scripts/verify.sh:*)
---

# djhtmx-verify

```bash
bash .agents/skills/djhtmx-verify/scripts/verify.sh                       # todo src/ (+ templates/)
bash .agents/skills/djhtmx-verify/scripts/verify.sh src/modules/products  # solo esa app
MAX_LINES=60 bash .agents/skills/djhtmx-verify/scripts/verify.sh …       # más detalle
```

- Usa `.venv/bin/` si existe (o `VENV=ruta`); si no, las herramientas del PATH. No instala nada ni usa la red (no llama a `uv run`, que puede sincronizar dependencias).
- Plantillas: cada `.html` del alcance (y `templates/` cuando el alcance es `src`) debe compilar, y ninguna puede usar `|safe`, `|safeseq` ni `{% autoescape off %}`. `mark_safe` en Python lo marca ruff (regla `S308`).
- `manage.py check` y `makemigrations --check --dry-run` corren con `src.config.settings_test` (SQLite en memoria): un modelo cambiado sin su migración es FAIL; la migración la genera el orquestador con `make migration NAME=x`.
- pytest corre con `-x -q --tb=short`: se detiene en el primer fallo y no imprime cabecera. "Sin tests" no cuenta como fallo.
- Las herramientas no instaladas se marcan `SKIP`. Si el error está fuera de tu zona, repórtalo; no lo corrijas.
