---
name: php-verify
description: Ejecuta php -l, Pint (o PHP-CS-Fixer), PHPStan y Pest/PHPUnit de un proyecto PHP con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código PHP en lugar de correr esas herramientas o php artisan test directamente.
allowed-tools: Bash(bash .agents/skills/php-verify/scripts/verify.sh:*)
---

# php-verify

```bash
bash .agents/skills/php-verify/scripts/verify.sh                        # todo src/
bash .agents/skills/php-verify/scripts/verify.sh src/Modules/Invoices   # módulo + tests/Modules/Invoices
```

- Usa solo `vendor/bin/*` y `php`; no instala nada ni usa red.
- Reemplaza a `php artisan optimize` / `cache:clear` de la v1: esos comandos cachean configuración y rutas, no verifican nada, y en desarrollo pueden dejar configuración obsoleta.
- Tests con `--stop-on-failure` (Pest además `--compact`). Herramientas ausentes = `SKIP`.
- Si el error está fuera de tu zona, repórtalo; no lo corrijas.
