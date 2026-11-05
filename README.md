# basekit

CLI que prepara la base de un proyecto para trabajar con agentes de código (Claude Code, OpenCode, Codex, Cursor, Gemini CLI, Copilot, Hermes): `AGENTS.md`, roles y zonas en `.agents/`, Docker + `Makefile` para dev y prod, y la documentación inicial. El CLI **prepara**; el agente **decide** (base de datos, auth) con la skill `project-bootstrap`.

La especificación completa está en `00_LEEME.md` … `05_bootstrap_bd_auth.md`, y las guías por stack en `docs/stacks/`. Las plantillas que copia el CLI están en `plantillas/`: el código no tiene nada específico de un stack.

## Requisitos

Node ≥ 20 (sin dependencias en tiempo de ejecución) y git. Para usar el proyecto generado: Docker con Compose v2, GNU Make y OpenSSL.

## Uso

```bash
npx basekit init mi-proyecto --stack nextjs --context "Reservas de canchas de pádel"
npx basekit stacks        # stacks y agentes soportados
```

Opciones de `init`: `--stack`, `--agents a,b`, `--context`, `--db auto|postgres|mysql|sqlite|none`, `--redis`, `--no-external-skills`, `--force`, `--dry-run`, `-y/--yes`. Detalle en `basekit help`.

Cada acción se reporta con `+` (creado), `~` (actualizado), `=` (existía, se conserva) o `!` (aviso). Ejecutarlo dos veces no cambia nada la segunda vez.

## Estado

| Parte | Estado |
|---|---|
| `stacks`, `init`, `sync`, `doctor` | Hecho (pruebas de aceptación 1–11) |
| Adaptadores (Claude Code, OpenCode, Gemini CLI, Hermes) y enlaces de skills | Hecho |
| Skills externas fijadas (`grill-me`, `grill-with-docs`, `grilling`, `domain-modeling`) | Hecho |
| Prueba 9 (`docker compose config` con overlays) | Pasa en `npm test` si hay Docker |
| Prueba 12 (`make new-app` + `make dev` reales) | `scripts/e2e.sh <stack>`; hoy falla en Next.js por un bug de la plantilla (`make new-app`) |

## Comandos

- `init [dir]`: crea la base. Sin flags reutiliza lo guardado en `.agents/manifest.json`; `infra.sh` solo corre si pasas `--db`. En una terminal (sin `-y`) pregunta solo lo que no resolvió con flags, manifest o detección: el stack (lista numerada; acepta número o id y vuelve a preguntar si no es válido), los agentes (varios separados por comas; Enter usa `claude-code,opencode`) y, en la primera corrida, de qué trata el proyecto.
- `sync [dir] [--agents a,b] [--no-external-skills] [--dry-run]`: regenera el bloque de `AGENTS.md`, los subagentes de `.claude/agents/` y `.opencode/agents/` desde `.agents/roles/` y `.agents/zones/`, y los enlaces de skills. Con `--agents`, los agentes nuevos reciben adaptadores, enlaces y skills externas.
- `doctor [dir]`: imprime `OK` o `FALTA` con la sugerencia; sale con código 1 si falta algo. Nunca lee `.env`.

## Desarrollo

```bash
npm install
npm test                    # compila con tsc y corre node --test (las pruebas de compose se ejecutan si hay Docker)
npm run build && bash scripts/e2e.sh nextjs   # prueba 12 real (necesita Docker; la usa el CI)
```
