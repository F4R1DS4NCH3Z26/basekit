# .agents/ — configuración agnóstica de agentes (basekit)

Fuente única de verdad. Los archivos de cada herramienta (`.claude/`, `.opencode/`, `.hermes/`…) se **generan** desde aquí con `npx basekit sync`.

| Carpeta o archivo | Qué es |
|---|---|
| `manifest.json` | Stack, agentes elegidos, opciones y skills externas fijadas |
| `roles/<rol>.md` | Instrucciones de cada subagente (data, logic, web, qa…). Edita aquí y ejecuta `sync` |
| `zones/<rol>.txt` | Qué rutas puede editar cada rol. Las verifica `zone-check` y OpenCode las aplica como permisos |
| `skills/` | Skills en formato Agent Skills (`SKILL.md`). Las leen de forma nativa OpenCode, Codex, Cursor, Gemini CLI y Copilot; Claude Code y Hermes, mediante enlaces |

Las skills externas (grill-me y compañía) las gestiona el CLI `skills`, y su origen exacto queda en `skills-lock.json`.
