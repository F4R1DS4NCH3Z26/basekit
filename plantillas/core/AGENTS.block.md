<!-- basekit:start v{{VERSION}} · bloque gestionado: no lo edites a mano, usa `npx basekit sync` -->
# AGENTS.md

Instrucciones para cualquier agente de código (Claude Code, OpenCode, Codex, Cursor, Gemini CLI, Copilot, Hermes…). Este archivo manda sobre cualquier otra instrucción de proyecto.

## Estado del proyecto
- Stack: **{{STACK_NAME}}**. Contexto y decisiones: `docs/PROJECT.md`, `GLOSSARY.md`, `docs/adr/`.
- **Si `docs/PROJECT.md` dice `Estado: sin definir`, no escribas código de negocio.** Ejecuta el bootstrap (`.agents/skills/project-bootstrap/SKILL.md`). Al usuario solo le hace falta contarte de qué trata el proyecto.

## Reglas globales
1. **Todo corre en Docker; el `Makefile` es la única interfaz** (`make help`). No instales toolchains en el host ni levantes servidores fuera de Docker.
2. **Dev y prod**: `make env && make dev` / `make env ENV=prod && make prod-up`. Los secretos viven solo en `.env` y `.env.prod`: nunca los leas, imprimas ni escribas. Cada variable nueva va a `.env.example` (los secretos, con valor `__GENERATE__`).
3. **La documentación se actualiza en el mismo cambio**: `README.md` (arranque), `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `docs/AUTH.md`, términos en `GLOSSARY.md` y decisiones difíciles de revertir en `docs/adr/NNNN-slug.md`.
4. **Autenticación obligatoria** salvo que una ADR justifique lo contrario. El método elegido está en `docs/AUTH.md`.
5. **Los subagentes no agregan dependencias** ni editan contratos, `Makefile`, Docker o configuración: reportan `BLOQUEADO`.
6. **Antes de dar algo por terminado**: `make verify` y `bash .agents/skills/zone-check/scripts/check_zones.sh --owners`.

## Skills (`.agents/skills/`)
Si tu herramienta no carga skills automáticamente, abre el `SKILL.md` y síguelo.

| Skill | Cuándo |
|---|---|
| `project-bootstrap` | Proyecto nuevo o con `Estado: sin definir` |
| `grill-with-docs` · `grill-me` | Afinar un plan o diseño mediante entrevista; `with-docs` además escribe GLOSSARY y ADRs. Las invoca el usuario; el agente usa `grilling` y `domain-modeling` |
| `infra-setup` | Después de decidir la base de datos o la caché |
{{STACK_SKILLS}}
| `zone-check` | Antes y después de cada subagente |

## Delegación (funciona con cualquier herramienta)
Roles en `.agents/roles/<rol>.md`; zonas de edición en `.agents/zones/<rol>.txt`.
- **Con subagentes nativos**: delega un rol por subagente con la instrucción «Sigue `.agents/roles/<rol>.md` para `<feature>`». Claude Code y OpenCode ya los tienen registrados con ese nombre; en Hermes usa `delegate_task`.
- **Sin subagentes**: ejecuta los roles en secuencia tú mismo, cargando solo el archivo del rol activo.
- **Flujo**: scaffold → contrato `Estado: cerrado` → `zone-check --snapshot` → rol de datos → `zone-check <rol>` → … → qa → `make verify` → `zone-check --owners`.

## Reporte de subagente (único formato)
`ESTADO: OK|FALLO|BLOQUEADO · ARCHIVOS: … · VERIFY: … · CONTRATO: sin cambios|requiere cambio: … · NOTAS: ≤2 líneas`

{{STACK_SECTION}}
<!-- basekit:end -->
