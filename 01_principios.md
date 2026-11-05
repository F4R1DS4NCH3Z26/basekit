# 01 · Principios (v3)

Reemplaza a `00_principios_comunes.md` de la v2.

Idea central: **los agentes se reparten territorio, no tareas. El contrato es la única fuente de verdad. Todo lo repetible lo hace un script. Todo corre en Docker y se maneja con `make`.**

## 1. Qué cambió respecto a la v2

| v2 | v3 |
|---|---|
| Configuración en `.claude/` (solo Claude Code) | Fuente única en `AGENTS.md` + `.agents/`; adaptadores generados para cada herramienta (guía 03) |
| Verificación con herramientas del host | `make verify` dentro de Docker; ningún toolchain en el host |
| Sin infraestructura | Docker multi-stage dev/prod, overlays de BD y Redis, `Makefile` común (guía 04) |
| La BD se asumía | El bootstrap decide si hace falta y cuál, con ADR (guía 05) |
| Auth como regla genérica | Auth obligatoria, con método por stack y su patrón implementado (`references/auth.md`) |
| Documentación opcional | `README`, `PROJECT`, `ARCHITECTURE`, `AUTH`, `RUNBOOK`, `GLOSSARY` y ADRs como parte de cada cambio |
| Zonas solo verificadas después | Verificadas con `zone-check` y, en OpenCode, **impuestas** como permisos de edición |
| Lista negra `Read(./.env.*)` que bloqueaba `.env.example` | Secretos enumerados explícitamente; `.env.example` legible y editable |
| Skills solo propias | + `grill-me` y `grill-with-docs` (con sus dependencias), fijadas por commit |

## 2. Economía de tokens

1. **El scaffold y el boilerplate los hace un script** (`<stack>-scaffold`, `make new-app`, `infra.sh`).
2. **Subagentes con contexto limpio** que devuelven solo un reporte de 5 líneas.
3. **`AGENTS.md` corto.** Se carga en cada turno; Hermes además lo recorta a partir de 20.000 caracteres. El detalle va a skills, que solo cargan su `description` hasta que se usan.
4. **Contrato por secciones**: cada rol lee `## Común` + la suya.
5. **Lectura dirigida**: Grep/Glob antes de leer, y lectura por rangos.
6. **`make verify` silencioso**: `OK`/`FAIL` y como máximo 30 líneas de error.
7. **Secuencia antes que paralelo** mientras el contrato esté abierto.
8. **La entrevista (grilling) va por rondas con respuesta recomendada.** El usuario contesta "sí" a la mayoría, lo que ahorra idas y vueltas.

Formato de reporte (igual que en la v2):

```text
ESTADO: OK | FALLO | BLOQUEADO
ARCHIVOS: …
VERIFY: …
CONTRATO: sin cambios | requiere cambio: …
NOTAS: ≤ 2 líneas
```

## 3. Seguridad

- **Secretos**:
  - Solo en `.env` y `.env.prod` (permisos 600, en `.gitignore`), generados por `make env`.
  - Los agentes no los leen: lo impiden los permisos de Claude Code y de OpenCode.
  - Cada variable nueva va a `.env.example` con el marcador `__GENERATE__`.
- **Dependencias**: solo las agrega el orquestador, con aprobación del usuario.
- **Versiones**:
  - Exactas y con al menos 14 días de antigüedad.
  - Nunca `@latest`.
  - Siempre `npx --no-install`.
- **Skills de terceros**:
  - Fijadas por commit.
  - Auditadas: solo markdown, sin scripts.
  - Registradas en `skills-lock.json`.
  - El CLI `skills` se ejecuta sin telemetría.
- **Contenedores**:
  - No root en producción.
  - `no-new-privileges` y `cap_drop`.
  - BD sin puertos expuestos.
  - Dev publicado solo en `127.0.0.1`.
- **Comandos destructivos**:
  - `make clean` exige `CONFIRM=1` y no existe en producción.
  - `git push`, `rm -rf`, `curl` y `wget` están denegados a los agentes.
- **Los permisos son barreras, no un sandbox.** Para aislamiento real, ejecuta el agente en un contenedor o devcontainer.

## 4. Flujo estándar (todos los stacks)

```text
npx basekit init  →  agente: bootstrap (entrevista → ADR → infra → make new-app → make dev → auth)
por módulo:  <stack>-scaffold → contrato cerrado → zone-check --snapshot
             → rol de datos → zone-check <rol> → --snapshot → lógica/web → … → qa
             → make verify → zone-check --owners
```
