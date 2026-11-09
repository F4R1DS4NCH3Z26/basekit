---
name: phpnative-scaffold
description: "Crea la estructura de un módulo nuevo de la API PHP nativa (src/Modules/<Modulo>/ con Domain, Application, Http, Migrations y routes.php) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo de la API, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/phpnative-scaffold/scripts/scaffold.sh:*)
---

# phpnative-scaffold

```bash
bash .agents/skills/phpnative-scaffold/scripts/scaffold.sh <Modulo>   # PascalCase plural: Invoices, Customers
```

- Crea las carpetas de capa (`Domain/{Entity,Repository,Enum}`, `Application/{DTO,Handler,Security}`, `Http/{Controller,Input,Resource}`, `Migrations/`), `Http/routes.php` vacío y `tests/Modules/<Modulo>/`, más `docs/specs/<modulo>_contract.md` desde `assets/contract.md`.
- No hay registro: el Kernel carga `src/Modules/*/Http/routes.php`, el Container autowirea repositorios, handlers y controladores, y el migrador lee `src/Modules/*/Migrations/*.sql`.
- Las rutas exigen autenticación salvo `public: true`: seguro por omisión.
- No sobrescribe nada.

Después del scaffold (orquestador):
1. Llena el contrato con el usuario y márcalo `Estado: cerrado`.
2. Tras el data-writer: revisa las migraciones de `src/Modules/<Modulo>/Migrations/` y `make migrate`.
