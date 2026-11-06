# Guías para construir el CLI de bases de proyecto (v3)

Objetivo del CLI: que en cualquier proyecto baste con instalarlo y decirle al agente **de qué trata**. Con eso, el agente debe:

- Decidir contigo si hace falta base de datos (y cuál) y qué autenticación usar.
- Dejar todo dockerizado con `Makefile` para dev y prod.
- Escribir documentación clara.
- Trabajar con cualquier herramienta: Claude Code, OpenCode, Codex, Cursor, Gemini CLI, Copilot, Hermes. Convive también con configuradores globales como Gentle AI.
- Instalar siempre las skills `grill-me` y `grill-with-docs`.

## Contenido

| Archivo | Para qué |
|---|---|
| `01_principios.md` | Qué cambió frente a la v2; reglas de tokens, seguridad y flujo |
| `02_especificacion_cli.md` | **La especificación del CLI**: comandos, algoritmo paso a paso, mapeo plantilla → proyecto, manifest, skills externas, seguridad y criterios de aceptación |
| `03_agentes_agnosticos.md` | Cómo lee cada herramienta y el formato exacto de cada adaptador que genera el CLI |
| `04_docker_make.md` | Contrato del `Makefile`, de compose y de los overlays, el servicio `migrate`, endurecimiento y cómo añadir un stack |
| `05_bootstrap_bd_auth.md` | Flujo del agente: entrevista → decisiones de BD y auth → documentación → infraestructura |
| `../stacks/*.md` (en `docs/stacks/`) | Next.js, FastAPI, Laravel y Spring: arquitectura, roles, Docker y auth |
| `plantillas/` (en la raíz del repo) | **Los archivos que el CLI copia**, tal cual. El CLI no debe contener nada específico de un stack: todo sale de aquí |

## Estructura de `plantillas/`

```text
plantillas/
├── core/                   # AGENTS.block.md, Makefile, README.tpl.md, docs/, zonas comunes, bloque .gitignore
├── skills/                 # project-bootstrap, infra-setup (+ overlays), zone-check
└── stacks/<id>/            # stack.json, AGENTS.section.md, roles/, zones/, skills/, files/ (Docker + .make), starter/
```

## Orden sugerido para construir el CLI

1. **Lectura de `stack.json` y detección del stack** (guía 02, sección 6).
2. **`init` sin adaptadores**: núcleo `.agents/`, bloque de `AGENTS.md`, Docker y Make, documentación (guía 02, secciones 3–7). Valida con las pruebas 1–8.
3. **Adaptadores** de Claude Code y OpenCode, y después Gemini y Hermes (guía 03). Pruebas 10–11.
4. **Skills externas** con versión fijada (guía 02, sección 9).
5. **`sync`** y **`doctor`**.
6. **CI con Docker**: pruebas 9 y 12 para los cuatro stacks. Son las que yo no pude ejecutar.

## Qué está verificado y qué no

- **Verificado**:
  - `make help`, `make env` (secretos únicos, permisos 600) y `make -n` de todos los objetivos en los cuatro stacks.
  - Las validaciones de `NAME`, `SCOPE`, `ENV` y `clean`.
  - La fusión de compose (base + entorno + overlay de BD) en los cuatro stacks.
  - `zone-check --owners` con 0 archivos sin dueño.
  - Los scripts de scaffold y verify (heredados de la v2).
  - La instalación real de las skills externas para 4 agentes, con enlaces y `skills-lock.json`.
  - El frontmatter de los subagentes de OpenCode.
- **No verificado** (sin Docker en mi entorno):
  - La construcción de imágenes y `docker compose up`.
  - `make new-app` en los cuatro stacks.
  - Los healthchecks.
- **Versiones a confirmar al adoptar**:
  - `create-next-app@16.4.3` (la versión fijada en `.make/stack.mk`).
  - `flyway/flyway:11`.
  - La clave `context.fileName` de Gemini CLI.
  - Los tags de FrankenPHP y uv (ver guía 04, sección 8).
