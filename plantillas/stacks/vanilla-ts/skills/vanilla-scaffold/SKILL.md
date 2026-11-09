---
name: vanilla-scaffold
description: "Crea la estructura de una feature nueva de la SPA TypeScript sin framework (src/features/<feature>/ con schemas, api, components, pages e index) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar una feature, pantalla o módulo nuevo en un proyecto TypeScript + Vite nativo, antes de escribir código o contrato a mano."
allowed-tools: Bash(bash .agents/skills/vanilla-scaffold/scripts/scaffold.sh:*)
---

# vanilla-scaffold

Genera el boilerplate con un script para que ningún agente gaste tokens escribiéndolo.

```bash
bash .agents/skills/vanilla-scaffold/scripts/scaffold.sh <feature>   # kebab-case: products, user-profile
```

Crea `src/features/<feature>/` (`schemas.ts`, `api.ts`, `index.ts`, `components/`, `pages/`), `tests/features/<feature>/` y `docs/specs/<feature>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada: si la feature existe, falla.

`assets/app/` guarda los archivos base que copia `make new-app` si faltan: `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `src/main.ts`, `src/routes.ts`, `src/lib/` (`api.ts`, `dom.ts`, `router.ts`, `store.ts`), `src/pages/` (`home.ts`, `not-found.ts`) y `public/health`. No los edites aquí: edita la copia del proyecto.

Después del scaffold:
1. Llena el contrato con el usuario. Cada sección `## <agente>` es lo único que leerá ese agente: escribe firmas y tablas, no prosa.
2. Cambia `Estado: borrador` a `Estado: cerrado` antes de delegar.
3. Sigue el flujo de AGENTS.md (zone-check --snapshot → logic-writer → ui-writer → qa-writer). Al final, el orquestador registra las páginas en `src/routes.ts`.
