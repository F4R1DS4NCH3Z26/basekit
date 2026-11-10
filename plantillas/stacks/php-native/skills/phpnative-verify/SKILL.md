---
name: phpnative-verify
description: "Ejecuta php -l, PHP-CS-Fixer, PHPStan, el arranque del Kernel (carga de rutas) y PHPUnit con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código PHP de la API nativa en lugar de correr esas herramientas o vendor/bin/phpunit directamente."
allowed-tools: Bash(bash .agents/skills/phpnative-verify/scripts/verify.sh:*)
---

# phpnative-verify

```bash
bash .agents/skills/phpnative-verify/scripts/verify.sh                        # todo src/
bash .agents/skills/phpnative-verify/scripts/verify.sh src/Modules/Invoices   # módulo + tests/Modules/Invoices
```

- Usa solo `vendor/bin/*` y `php`; no instala nada ni usa red. `make verify` lo corre en Docker sin levantar la BD.
- `boot` arranca el Kernel y carga todos los `Http/routes.php`: detecta rutas duplicadas o archivos de rutas rotos. No toca la BD.
- Los tests usan SQLite en memoria con todas las migraciones: una migración sin variante para SQLite falla aquí.
- Tests con `--stop-on-failure`. Herramientas ausentes = `SKIP`.
- Si el error está fuera de tu zona, repórtalo; no lo corrijas.
