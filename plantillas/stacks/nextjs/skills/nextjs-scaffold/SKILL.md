---
name: nextjs-scaffold
description: Crea la estructura de una feature nueva de Next.js (src/features/<feature>/ con schemas, services, actions, server, index) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar una feature, entidad o módulo nuevo en un proyecto Next.js, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/nextjs-scaffold/scripts/scaffold.sh:*)
---

# nextjs-scaffold

Genera el boilerplate con un script para que ningún agente gaste tokens escribiéndolo.

```bash
bash .agents/skills/nextjs-scaffold/scripts/scaffold.sh <feature>   # kebab-case: products, user-profile
```

Crea `src/features/<feature>/` (`schemas.ts`, `services.ts`, `actions.ts`, `server.ts`, `index.ts`, `components/`), `tests/features/<feature>/` y `docs/specs/<feature>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada: si la feature existe, falla.

Después del scaffold:
1. Llena el contrato con el usuario. Cada sección `## <agente>` es lo único que leerá ese agente: escribe firmas y tablas, no prosa.
2. Cambia `Estado: borrador` a `Estado: cerrado` antes de delegar.
3. Sigue el flujo de AGENTS.md (zone-check --snapshot → data-writer → …).
