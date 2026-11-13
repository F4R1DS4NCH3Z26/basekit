---
name: py-verify
description: Ejecuta ruff, mypy y pytest de un proyecto Python con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código Python en lugar de correr ruff, mypy o pytest directamente.
allowed-tools: Bash(bash .agents/skills/py-verify/scripts/verify.sh:*)
---

# py-verify

```bash
bash .agents/skills/py-verify/scripts/verify.sh                     # todo src/
bash .agents/skills/py-verify/scripts/verify.sh src/modules/orders  # solo ese módulo
MAX_LINES=60 bash .agents/skills/py-verify/scripts/verify.sh …     # más detalle
```

- Usa `.venv/bin/` si existe (o `VENV=ruta`); si no, las herramientas del PATH. No instala nada ni usa la red (no llama a `uv run`, que puede sincronizar dependencias).
- pytest corre con `-x -q --tb=short`: se detiene en el primer fallo y no imprime cabecera. "Sin tests" no cuenta como fallo.
- Con MongoDB (Beanie) los tests usan la base de datos en memoria del `conftest.py` (mongomock): `make verify` corre sin el contenedor de la BD.
- Las herramientas no instaladas se marcan `SKIP`. Si el error está fuera de tu zona, repórtalo; no lo corrijas.
