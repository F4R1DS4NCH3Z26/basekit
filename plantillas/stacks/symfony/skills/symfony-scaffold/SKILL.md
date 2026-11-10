---
name: symfony-scaffold
description: "Crea la estructura de un módulo nuevo de Symfony (src/Modules/<Modulo>/ con Domain, Application, Http) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar un módulo, entidad o recurso nuevo de la API, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/symfony-scaffold/scripts/scaffold.sh:*)
---

# symfony-scaffold

```bash
bash .agents/skills/symfony-scaffold/scripts/scaffold.sh <Modulo>   # PascalCase plural: Invoices, Customers
```

- Crea las carpetas de capa (`Domain/{Entity,Repository,Enum}`, `Application/{DTO,Handler,Security}`, `Http/{Controller,Request,Resource}`) y `tests/Modules/<Modulo>/`, más `docs/specs/<modulo>_contract.md` desde `assets/contract.md`.
- No hay provider ni registro: `config/services.yaml` registra `src/` con autowiring, `config/routes.yaml` carga los `#[Route]` de `src/Modules/` y Doctrine mapea las entidades de `src/Modules/`.
- Las rutas bajo `/api` ya exigen autenticación (`config/packages/security.yaml`): seguro por omisión.
- No sobrescribe nada.

Después del scaffold (orquestador):
1. Llena el contrato con el usuario y márcalo `Estado: cerrado`.
2. Tras el data-writer: `make migration NAME=<x>` (Doctrine diff), revisa la migración en `migrations/` y `make migrate`.
