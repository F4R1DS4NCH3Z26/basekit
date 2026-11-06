# 03 · Configuración agnóstica de agentes

Principio: **una sola fuente de verdad (`AGENTS.md` + `.agents/`) y adaptadores finos y generados** para cada herramienta. Nadie edita a mano los adaptadores generados: se cambia `.agents/` y se ejecuta `sync`.

## 1. Cómo lee cada herramienta (verificado en noviembre de 2026)

| Herramienta | id (CLI `skills`) | Instrucciones | Skills de proyecto | Subagentes | Detección |
|---|---|---|---|---|---|
| Claude Code | `claude-code` | `CLAUDE.md` (con `@AGENTS.md`) | `.claude/skills/` → enlace | `.claude/agents/*.md` | `.claude/`, `CLAUDE.md` |
| OpenCode | `opencode` | `AGENTS.md` nativo | `.agents/skills/` nativo | `.opencode/agents/*.md`, con permisos por patrón | `.opencode/`, `opencode.json` |
| Codex | `codex` | `AGENTS.md` nativo | `.agents/skills/` nativo | Según versión; si no, en secuencia | — |
| Cursor | `cursor` | `AGENTS.md` nativo | `.agents/skills/` nativo | Nativos (configuración global) | `.cursor/` |
| Gemini CLI | `gemini-cli` | `AGENTS.md` si se configura `context.fileName` | `.agents/skills/` nativo | Experimentales | `.gemini/` |
| GitHub Copilot | `github-copilot` | `AGENTS.md` nativo | `.agents/skills/` nativo | `runSubagent` | — |
| Hermes Agent | `hermes-agent` | `AGENTS.md` **solo en el cwd**, y si **no** existe `.hermes.md` | `.hermes/skills/` → enlace | `delegate_task` (efímeros, sin archivos) | `.hermes/` |

Fuentes: la tabla de agentes del CLI `skills` 1.7.4 (`docs/agents.md`, que cubre más de 75 herramientas), la documentación de agentes y permisos de OpenCode y la referencia `project-context-files.md` del repositorio de Hermes Agent. Revisa estas fuentes al subir de versión: es lo que más cambia.

## 2. Gentle AI (y otros configuradores globales)

Gentle AI **no es un agente**: configura los que ya tienes (Claude Code, OpenCode, Hermes, Cursor…) instalando guía, flujo, memoria (Engram) y skills, principalmente **a nivel de usuario** (`~/.claude`, `~/.gemini`, `~/.cursor/agents`…).

Por eso conviven sin chocar:
- El kit escribe **solo en el proyecto** y nunca toca `~/`.
- `AGENTS.md` contiene hechos del proyecto (estructura, zonas, comandos, seguridad), no personalidad ni flujo de trabajo, que es lo que aporta Gentle AI.
- Si ambos dan reglas de delegación, `AGENTS.md` dice: "Este archivo manda sobre cualquier otra instrucción **de proyecto**".

El CLI no necesita un adaptador para Gentle AI: solo debe detectar las herramientas que configura (las de la tabla).

## 3. Adaptadores que genera el CLI

### Claude Code

**`CLAUDE.md`**: si no existe, créalo con una sola línea: `@AGENTS.md`. Si existe y no la tiene, antepónla.

**`.claude/agents/<rol>.md`** (generado; se regenera en `sync`):

```markdown
---
name: data-writer
description: <description del rol>
tools: Read, Edit, Write, Grep, Glob, Bash
model: sonnet
---
<!-- Generado por basekit desde .agents/roles/data-writer.md — edita ese archivo y ejecuta `npx --no-install basekit sync` -->
<cuerpo del rol>
```

**`.claude/settings.json`** (solo si no existe):

```json
{
  "permissions": {
    "allow": ["Bash(make help:*)", "Bash(make verify:*)", "Bash(make test:*)", "Bash(make lint:*)", "Bash(make ps:*)",
              "Bash(make logs:*)", "Bash(make doctor:*)", "Bash(git status:*)", "Bash(git diff:*)",
              "Bash(bash .agents/skills/zone-check/scripts/check_zones.sh:*)",
              "Bash(bash .agents/skills/<stack>-scaffold/scripts/scaffold.sh:*)"],
    "ask":   ["Bash(make dev:*)", "Bash(make up:*)", "Bash(make migrate:*)", "Bash(make migration:*)", "Bash(make install:*)",
              "Bash(make new-app:*)", "Bash(make deps-add:*)", "Bash(make prod-build:*)", "Bash(make prod-up:*)",
              "Bash(make prod-migrate:*)", "Bash(bash .agents/skills/infra-setup/scripts/infra.sh:*)",
              "Bash(docker:*)", "Bash(npx:*)", "Bash(git commit:*)", "Bash(git checkout:*)"],
    "deny":  ["Read(./.env)", "Read(./.env.prod)", "Read(./.env.local)", "Read(./.env.production)", "Read(./.env.*.local)",
              "Edit(./.env)", "Edit(./.env.prod)", "Edit(./.env.local)", "Edit(./.env.production)",
              "Read(./**/*.pem)", "Read(./**/*.key)", "Bash(make clean:*)", "Bash(git push:*)", "Bash(rm -rf:*)",
              "Bash(curl:*)", "Bash(wget:*)", "Bash(sudo:*)", "Bash(cat .env:*)"]
  }
}
```

> Ojo: **no uses `Read(./.env.*)`**. En Claude Code, `deny` gana sobre `allow`, y esa regla bloquearía `.env.example`, que los agentes deben leer y editar. Enumera los archivos secretos explícitamente.

### OpenCode

**`.opencode/agents/<rol>.md`** (generado). Las zonas se convierten en permisos reales de edición; gana la última regla que coincide:

```markdown
---
description: "<description del rol>"
mode: subagent
permission:
  edit:
    "*": deny
    "src/features/*/schemas.ts": allow
    "src/features/*/services.ts": allow
  bash:
    "*": ask
    "make verify*": allow
    "make test*": allow
    "make lint*": allow
    "git status*": allow
    "git diff*": allow
    "bash .agents/skills/*": allow
  webfetch: deny
---
<!-- Generado por basekit … -->
<cuerpo del rol>
```

Escribe cada patrón como string JSON (que es YAML válido); así `*` y `/` no rompen el YAML.

**`opencode.json`** (solo si no existe):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "read": { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
    "edit": { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
    "bash": { "*": "ask", "make help*": "allow", "make verify*": "allow", "make test*": "allow", "make lint*": "allow",
              "git status*": "allow", "git diff*": "allow", "bash .agents/skills/*": "allow",
              "make clean*": "deny", "git push*": "deny", "rm -rf*": "deny", "curl *": "deny", "wget *": "deny", "sudo *": "deny" }
  }
}
```

Aquí `*.env.*` sí es seguro: en OpenCode gana la **última** coincidencia, así que `*.env.example: allow` la reabre.

### Gemini CLI

`.gemini/settings.json` (solo si no existe): `{ "context": { "fileName": ["AGENTS.md"] } }`. Verifica el nombre de la clave en tu versión: versiones antiguas usaban `contextFileName`.

### Hermes Agent

- Sin archivo de instrucciones propio. **Nunca crees `.hermes.md` ni `HERMES.md`**: Hermes los cargaría en lugar de `AGENTS.md`. Si existen, `init` y `doctor` deben avisar.
- Las skills se enlazan en `.hermes/skills/`.
- Hermes ejecuta un escáner contra prompt injection sobre los archivos de contexto. No escribas en `AGENTS.md` frases que parezcan "ignora instrucciones anteriores" o similares.

### Codex, Cursor, Copilot (y el resto de lectores de `.agents/skills/`)

No necesitan adaptador: `AGENTS.md` y `.agents/skills/` ya funcionan.

## 4. Delegación agnóstica (el texto ya está en `AGENTS.md`)

- **Con subagentes nativos**: un rol por subagente, con la instrucción «Sigue `.agents/roles/<rol>.md` para `<feature>`». En Claude Code y OpenCode los subagentes ya están registrados con el nombre del rol. En Hermes se usa `delegate_task` con esa misma instrucción.
- **Sin subagentes**: el agente principal ejecuta los roles en secuencia, cargando solo el archivo del rol activo.
- **En todos los casos**: `zone-check` antes y después de cada rol, y el reporte de 5 líneas.

## 5. Skills y su carga

- **Formato Agent Skills** (`SKILL.md` con `name` y `description`). Todas las herramientas de la tabla lo soportan.
- `allowed-tools` lo soportan la mayoría. `context: fork` y los hooks son exclusivos de algunas herramientas: no los uses en skills del kit.
- **Si una herramienta no carga skills**, `AGENTS.md` dice "abre el `SKILL.md` y síguelo". Por eso las rutas de los scripts siempre son `.agents/skills/<skill>/scripts/…`, iguales para todas las herramientas.

## 6. Ampliar a una herramienta nueva

1. Busca su id y su carpeta en `docs/agents.md` del CLI `skills`.
2. Si lee `.agents/skills/` y `AGENTS.md`: agrégala a la lista blanca y listo.
3. Si usa otra carpeta de skills: añade `skillsDir` para que el CLI cree los enlaces.
4. Si necesita archivo de instrucciones o subagentes propios: escribe un adaptador que **derive** de `.agents/roles` y `.agents/zones`, nunca contenido nuevo.
