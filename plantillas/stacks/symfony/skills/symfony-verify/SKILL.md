---
name: symfony-verify
description: "Ejecuta php -l, PHP-CS-Fixer, PHPStan, lint:container de Symfony y PHPUnit con salida mínima (solo OK/FAIL y las primeras líneas de error). Úsala para verificar cualquier cambio en código PHP de la API Symfony en lugar de correr esas herramientas o bin/phpunit directamente."
allowed-tools: Bash(bash .agents/skills/symfony-verify/scripts/verify.sh:*)
---

# symfony-verify

```bash
bash .agents/skills/symfony-verify/scripts/verify.sh                        # todo src/
bash .agents/skills/symfony-verify/scripts/verify.sh src/Modules/Invoices   # módulo + tests/Modules/Invoices
```

- Usa solo `vendor/bin/*`, `bin/console` y `php`; no instala nada ni usa red. `make verify` lo corre en Docker sin levantar la BD.
- `lint:container` compila el contenedor y detecta servicios o autowiring rotos; no toca la BD. No uses `cache:clear` como verificación.
- Tests con `--stop-on-failure`. Herramientas ausentes = `SKIP`.
- Si el error está fuera de tu zona, repórtalo; no lo corrijas.
