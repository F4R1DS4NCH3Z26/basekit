# basekit: reglas para agentes

CLI en Node + TypeScript (cero dependencias de runtime) que prepara proyectos para agentes de IA. Especificación del producto: `docs/spec/` (00–05) y `docs/stacks/`. Lo que genera en otros proyectos sale de `plantillas/`.

**Los agentes se reparten territorio, no tareas. La especificación manda y los tests verifican.**

## Arquitectura (`tests/architecture.test.ts` la hace cumplir)
`cli.ts` → `commands/` → `kit/` → `infra/`; `ui/` está al lado de `commands/` y solo importa `kit/`.
- `infra/`: puertos `FileSystem` y `Runner` (todo `spawn` vive aquí). No importa nada de `src/`.
- `kit/`: dominio. `Project` es la única puerta de escritura (marcas `+` `~` `=` `!`). Plantillas, stacks, manifest, adaptadores por herramienta y skills externas.
- `commands/<cmd>/`: un comando por carpeta. Fuera de su carpeta solo es público su `index.ts`; un comando nunca importa a otro.
- `ui/`: preguntas interactivas (menú con flechas y respaldo numerado sin TTY).
- `dist/src` se commitea: tras cambiar `src/`, `npm run compile`.

## Zonas (`.agents/zones/<rol>.txt`)
| Rol | Zona |
|---|---|
| orquestador (sesión principal) | `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/**` (salvo `docs/stacks/`), `.agents/**`, `.claude/**`, `odd/**`, `package*.json`, `tsconfig.json`, `.github/**`, `.gitattributes`, `.gitignore` |
| kit-writer | `src/kit/**` |
| infra-writer | `src/infra/**` |
| commands-writer | `src/cli.ts`, `src/commands/**`, `src/ui/**` |
| templates-writer | `plantillas/**`, `docs/stacks/**` |
| qa-writer | `tests/**`, `scripts/**` |

Cada writer de `src/` también es dueño de su salida compilada en `dist/src/`.

## Flujo de una feature
1. El orquestador fija la especificación (`odd/tasks/<feature>.md`, o un contrato en `docs/specs/`) citando `docs/spec/`.
2. `zone-check --snapshot` → writers en orden de dependencia: infra → kit → commands. templates-writer en paralelo si la feature lo incluye.
3. qa-writer al final; `zone-check <rol>` después de cada uno.
4. Cierre: `bash .agents/skills/cli-verify/scripts/verify.sh` y `zone-check --owners`. Si cambió `plantillas/`, también `scripts/e2e.sh <stack>`.

## Reglas
- Nunca se lee `.env`. Toda escritura de `kit/` pasa por `Project` (guarda de rutas con realpath).
- Sin ids de stack en `src/`: los stacks son datos de `plantillas/stacks/*/stack.json`.
- Texto generado: `npx --no-install basekit` (el nombre `basekit` en npm es de otro paquete).
- Scripts de `package.json`: nunca `build`, `prepare`, `install` ni `prepack` (rompen la instalación desde git). El build es `compile`.
- Dependencias con al menos 14 días de antigüedad y versión exacta.
- Commits: Conventional Commits, sin atribución a IA, solo con aprobación del usuario.

## Verificación
`bash .agents/skills/cli-verify/scripts/verify.sh [patrón]`: compila, comprueba que `dist/src` esté al día y corre los tests (todos o los que coincidan con el patrón).

## Reporte de cada subagente (5 líneas)
```
ESTADO: OK | BLOQUEADO | FALLO
ARCHIVOS: rutas tocadas
VERIFY: salida de verify.sh
ESPEC: puntos cubiertos (S# o sección del contrato)
NOTAS: ≤ 2 líneas
```
