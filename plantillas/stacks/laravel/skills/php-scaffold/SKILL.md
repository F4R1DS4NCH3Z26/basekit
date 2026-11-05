---
name: php-scaffold
description: Crea la estructura de un módulo nuevo de PHP (src/Modules/<Modulo>/ con Domain, Database, Application, Http, Providers; en Laravel también el ServiceProvider y routes.php) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo en Laravel, Symfony o PHP nativo, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/php-scaffold/scripts/scaffold.sh:*)
---

# php-scaffold

```bash
bash .agents/skills/php-scaffold/scripts/scaffold.sh <Modulo>   # PascalCase plural: Invoices, Customers
```

- Crea las carpetas de capa y `tests/Modules/<Modulo>/`, más `docs/specs/<modulo>_contract.md` desde `assets/contract.md`.
- Si hay `artisan` (Laravel), también genera `Providers/<Modulo>ServiceProvider.php` (carga rutas y migraciones) y `Http/routes.php` con `auth:sanctum` por defecto: seguro por omisión; cambia el guard si usas otro.
- No sobrescribe nada.

Después del scaffold (orquestador):
1. Registra el provider en `bootstrap/providers.php` (Laravel 11+); el script imprime la línea.
2. Llena el contrato con el usuario y márcalo `Estado: cerrado`.
3. Tras el app-writer, registra la Policy en el provider (`Gate::policy(...)`).
