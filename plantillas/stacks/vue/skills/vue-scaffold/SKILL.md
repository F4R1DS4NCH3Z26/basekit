---
name: vue-scaffold
description: Crea la estructura de una feature nueva de la SPA Vue (src/features/<feature>/ con schemas, api, composables, components, pages e index) y su contrato vacío en docs/specs/. Úsala SIEMPRE que haya que empezar una feature, pantalla o módulo nuevo en un proyecto Vue + Vite, antes de escribir código o contrato a mano.
allowed-tools: Bash(bash .agents/skills/vue-scaffold/scripts/scaffold.sh:*)
---

# vue-scaffold

Genera el boilerplate con un script para que ningún agente gaste tokens escribiéndolo.

```bash
bash .agents/skills/vue-scaffold/scripts/scaffold.sh <feature>   # kebab-case: products, user-profile
```

Crea `src/features/<feature>/` (`schemas.ts`, `api.ts`, `index.ts`, `composables/`, `components/`, `pages/`), `tests/features/<feature>/` y `docs/specs/<feature>_contract.md` a partir de `assets/contract.md`. No sobrescribe nada: si la feature existe, falla.

`assets/app/` guarda los archivos base que copia `make new-app` si faltan (`eslint.config.js`, `vitest.config.ts`, `tests/setup.ts`, `src/main.ts`, `src/App.vue`, `src/router/index.ts`, `src/lib/api.ts`, `public/health`). No los edites aquí: edita la copia del proyecto.

Después del scaffold:
1. Llena el contrato con el usuario. Cada sección `## <agente>` es lo único que leerá ese agente: escribe firmas y tablas, no prosa.
2. Cambia `Estado: borrador` a `Estado: cerrado` antes de delegar.
3. Sigue el flujo de AGENTS.md (zone-check --snapshot → logic-writer → ui-writer → qa-writer).
4. El orquestador registra la página en `src/router/index.ts`, importándola desde el `index.ts` de la feature.
