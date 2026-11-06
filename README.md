# basekit

CLI que prepara la base de un proyecto para trabajar con agentes de código (Claude Code, OpenCode, Codex, Cursor, Gemini CLI, Copilot, Hermes): `AGENTS.md`, roles y zonas en `.agents/`, Docker + `Makefile` para dev y prod, y la documentación inicial. El CLI **prepara**; el agente **decide** (base de datos, auth) con la skill `project-bootstrap`.

La especificación completa está en `00_LEEME.md` … `05_bootstrap_bd_auth.md`, y las guías por stack en `docs/stacks/`. Las plantillas que copia el CLI están en `plantillas/`: el código no tiene nada específico de un stack.

## Requisitos

Node ≥ 20 (sin dependencias en tiempo de ejecución) y git. Para usar el proyecto generado: Docker con Compose v2, GNU Make y OpenSSL.

## Instalación

Se instala desde este repositorio (todavía no está publicado en npm). El repositorio incluye el CLI ya compilado (`dist/src`), así que instalar no compila nada.

**Con el instalador** (recomendado): ejecútalo una vez sin instalarlo y te pregunta dónde lo quieres.

```bash
npx github:F4R1DS4NCH3Z26/basekit
# basekit — ¿cómo quieres instalarlo?
#   1) Global         un `basekit` para todos tus proyectos (npm install -g)
#   2) Este proyecto  devDependency del package.json de este directorio (npm install -D)
```

Si eliges "Este proyecto" y no hay `package.json`, pregunta antes de crearlo (en un proyecto Python, PHP o Java suele convenir la instalación global). Después ofrece preparar el proyecto con `init`. Sin terminal (CI, scripts) usa `basekit install --global` o `basekit install --project`. `--from` instala otro origen: un fork, una etiqueta o un `.tgz`.

A mano también funciona:

**Global**: un `basekit` para todos tus proyectos.

```bash
npm install -g github:F4R1DS4NCH3Z26/basekit
basekit init mi-proyecto --stack nextjs --context "Reservas de canchas de pádel"
```

**Por proyecto**: queda fijado en las `devDependencies` del proyecto y cada equipo usa la misma versión.

```bash
npm install -D github:F4R1DS4NCH3Z26/basekit
npx --no-install basekit init . --stack nextjs
```

> **Nunca uses `npx basekit` a secas.** El nombre `basekit` en npm es de otro paquete, y `npx` sin instalación local lo descargaría y lo ejecutaría. `npx --no-install basekit` usa solo la instalación local o la global, y si no encuentra ninguna falla sin descargar nada. Es lo que escriben `AGENTS.md` y los adaptadores generados.

## Uso

```bash
basekit init mi-proyecto --stack nextjs --context "Reservas de canchas de pádel"
basekit stacks        # stacks y agentes soportados
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
| Prueba 12 (`make new-app` + `make dev` reales) | `scripts/e2e.sh <stack> [db]`; pasa en los 4 stacks (Spring con `postgres`) |

## Comandos

- `init [dir]`: crea la base. Sin flags reutiliza lo guardado en `.agents/manifest.json`; `infra.sh` solo corre si pasas `--db`. En una terminal (sin `-y`) pregunta solo lo que no resolvió con flags, manifest o detección: el stack (lista numerada; acepta número o id y vuelve a preguntar si no es válido), los agentes (varios separados por comas; Enter usa `claude-code,opencode`) y, en la primera corrida, de qué trata el proyecto.
- `sync [dir] [--agents a,b] [--no-external-skills] [--dry-run]`: regenera el bloque de `AGENTS.md`, los subagentes de `.claude/agents/` y `.opencode/agents/` desde `.agents/roles/` y `.agents/zones/`, y los enlaces de skills. Con `--agents`, los agentes nuevos reciben adaptadores, enlaces y skills externas.
- `doctor [dir]`: imprime `OK` o `FALTA` con la sugerencia; sale con código 1 si falta algo. Nunca lee `.env`.

## Estructura

```text
src/
├── cli.ts          solo enruta: flags → comando
├── commands/       un slice por comando (init, sync, doctor, stacks); afuera solo se importa su index.ts
├── kit/            reglas del kit compartidas: stacks, adaptadores, manifest, AGENTS.md, skills externas, Project
├── infra/          puertos de I/O con su implementación real: FileSystem (disco) y Runner (procesos)
└── ui/             preguntas interactivas
tests/              espejo de src/ (commands/, kit/, ui/), más plantillas/ (Makefile y compose) y architecture.test.ts
```

Las dependencias van en un solo sentido: `cli → commands → kit → infra`. Un comando nunca importa a otro, y `kit` nunca importa `commands`. `tests/architecture.test.ts` lo hace cumplir, y también que `src/` no nombre ningún stack. Todo lo que se escribe en el proyecto destino pasa por `kit/project.ts`: no sale del proyecto, no reescribe lo que no cambió, `--dry-run` no escribe nada y nunca lee `.env`.

## Desarrollo

```bash
npm install
npm test                    # compila con tsc y corre node --test (las pruebas de compose se ejecutan si hay Docker)
npm run build && bash scripts/e2e.sh nextjs            # prueba 12 real (necesita Docker; la usa el CI)
bash scripts/e2e.sh spring postgres                     # con base de datos (Spring la necesita para arrancar)
```

`dist/src` se commitea: después de cambiar `src/`, ejecuta `npm run build` y commitea `dist/src` junto con el cambio. El CI falla si no coinciden.
