# 02 · Especificación del CLI

Esta guía define **qué debe hacer** el CLI, en qué orden y con qué reglas. Las plantillas que copia están en `plantillas/`. En los ejemplos se usa el nombre provisional `basekit`.

## 1. Objetivo y límites

El CLI **prepara**; el agente **decide**.

- **Determinista.** El CLI copia plantillas, genera adaptadores por herramienta e instala skills. No decide la base de datos ni la autenticación: eso lo hace el agente con la skill `project-bootstrap`, conversando con el usuario. La única excepción es que el usuario pase `--db`.
- **Idempotente.** Ejecutarlo dos veces no cambia nada la segunda vez. Antes de escribir un archivo generado, compara su contenido y no lo toques si es igual. `manifest.updatedAt` solo cambia si cambió algo más.
- **Nunca sobrescribe archivos del usuario.** Solo actualiza bloques gestionados (marcados) y archivos generados (con cabecera "Generado por…").
- **Opera solo dentro del directorio del proyecto.**
- **Recomendación técnica**: Node ≥ 20 sin dependencias. El CLI `skills`, que es obligatorio, ya necesita Node/npx, así que no añades requisitos, y sin dependencias no añades riesgo de cadena de suministro. Si eliges Go o Rust, el comportamiento es el mismo.

## 2. Comandos

| Comando | Qué hace |
|---|---|
| `init [dir]` | Crea la base completa en un proyecto nuevo o existente |
| `sync [dir] [--agents a,b]` | Regenera el bloque de `AGENTS.md`, los adaptadores y los enlaces desde `.agents/`; con `--agents`, también añade herramientas |
| `doctor [dir]` | Diagnóstico del entorno y del proyecto (sección 11) |
| `stacks` | Lista los stacks (leídos de `plantillas/stacks/*/stack.json`) y los agentes soportados |

Flags de `init`:

| Flag | Valores | Por defecto |
|---|---|---|
| `--stack` | backend: `django`, `express`, `fastapi`, `flask`, `gin`, `go-native`, `nestjs`, `node-native`, `php-native`, `python-native`, `spring`, `symfony` · frontend: `react`, `vanilla-ts`, `vue` · fullstack: `django-htmx`, `laravel`, `nextjs` (la lista sale de `plantillas/stacks/`; `basekit stacks` la imprime). **Combinado** (sección 14): `<backend>+<frontend>`, por ejemplo `fastapi+react`; solo un stack `kind: backend` seguido de uno `kind: frontend` | manifest; si no, detectado; si no, se pregunta |
| `--agents` | lista separada por comas (ver guía 03) | detectados; si no, se pregunta (sugerencia: `claude-code,opencode`) |
| `--context` | texto libre: "de qué trata el proyecto" | se pregunta (puede ir vacío) |
| `--db` | `auto`, `postgres`, `mysql`, `sqlite`, `none`. Un stack frontend solo admite `auto` o `none`; en un combinado se aplica al backend | `auto` (lo decide el bootstrap; en un stack frontend, `none`) |
| `--redis` | booleano. Error en un stack frontend; en un combinado, va al backend | no |
| `--no-external-skills` | omite `npx skills add` (CI o sin red) | no |
| `--force` | reemplaza las skills del kit modificadas localmente | no |
| `--dry-run` | muestra lo que haría sin escribir | no |
| `--yes`, `-y` | no interactivo; usa flags y valores por defecto | no |

## 3. Algoritmo de `init` (orden exacto)

1. **Directorio**: resolverlo (expandir `~`) y crearlo si no existe.
2. **Stack**: flag → `manifest.json` → detección (sección 6) → pregunta → error si sigue sin definirse. La pregunta tiene tres pasos, cada uno filtrado por los anteriores:
   1. **Tipo**: Backend, Frontend o Fullstack (`stack.json → kind`).
   2. **Lenguaje**: los lenguajes de ese tipo (`stack.json → language`), en orden alfabético.
   3. **Framework**: los stacks de ese tipo y lenguaje; la etiqueta es `stack.json → name`, que nombra el framework y el tipo de app.

   En **Fullstack**, el paso Lenguaje ofrece los lenguajes de los stacks integrados y, al final, **«Combinar backend + frontend»** (si hay stacks de los dos tipos). Elegirla pregunta Lenguaje → Framework del backend (`¿En qué lenguaje es el backend?`, `¿Con qué framework de backend?`) y luego del frontend, y el resultado es `<backend>+<frontend>` (sección 14). En esos pasos solo se acepta un id de stack de ese lado.

   Un paso con una sola opción no se pregunta: se elige solo y se anuncia (`Lenguaje: TypeScript (única opción)`). En una terminal cada paso es un menú con flechas; sin TTY con modo raw, una lista numerada que acepta el número o el nombre (y, en cualquier paso, un id de stack), vuelve a preguntar ante una respuesta inválida y, si la entrada termina, falla con un error de uso que sugiere `--stack <id>`.
3. **Agentes**: flag → detección (guía 03, sección 1) → pregunta. Valida contra la lista blanca.
4. **Contexto** (texto) y **BD** (`auto` por defecto). Un stack frontend no tiene base de datos: `--db` distinto de `auto`/`none` o `--redis` es un error de uso (exit 2) antes de escribir nada, y `auto` se guarda como `none`.
5. **Git**: si no hay `.git`, ejecutar `git init` (zone-check lo necesita).
6. **Núcleo `.agents/`**, siguiendo la tabla de la sección 4: README, roles, zonas, skills del kit (scripts con permisos 755) y `manifest.json`.
7. **`AGENTS.md`**: bloque gestionado (sección 7) con los placeholders resueltos (sección 5). Si supera 18.000 caracteres, avisar: Hermes trunca a partir de 20.000.
8. **Docker y Make**:
   - `Makefile`: si existe sin la marca `generado por basekit`, escribir `Makefile.basekit` y avisar.
   - Copiar `files/` del stack sin sobrescribir.
   - Copiar el `starter/` si falta el `appMarker`.
   - Agregar el bloque de `.gitignore`.
9. **Documentación**: `README.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `docs/AUTH.md` y `docs/specs/.gitkeep`, solo si no existen. **No crear** `GLOSSARY.md` ni `docs/adr/`: los crea `domain-modeling` cuando hay contenido real.
10. **Adaptadores** para cada agente elegido (guía 03, sección 3).
11. **Enlaces de skills** para los agentes que no leen `.agents/skills/`: enlace relativo y, si falla (Windows sin permisos), copia.
12. **Skills externas** (sección 9), salvo con `--no-external-skills`.
13. **Infraestructura**: si `--db ≠ auto`, ejecutar `bash .agents/skills/infra-setup/scripts/infra.sh --db <db> [--redis]`. Es el **mismo script** que usa el agente, así que la lógica vive en un solo lugar. El script trabaja en el proyecto que lo contiene (`$(dirname "$0")/../../../..`, nunca `git rev-parse --show-toplevel`): en un combinado se ejecuta, desde la raíz, la copia del backend (`bash backend/.agents/skills/infra-setup/scripts/infra.sh …`). También se ejecuta, sin `--db`, cuando un proyecto de un solo stack pasa a combinado y la base de datos (o Redis) del manifest pasa al backend: el lado nuevo aún no tiene overlays. `--dry-run` solo lo muestra.
14. **Resumen y próximo paso.** Imprimir el prompt sugerido:
    > «Lee AGENTS.md y ejecuta el bootstrap. El proyecto trata de: `<contexto>`»

    Si falta la app del framework, indicar también `make new-app` (en un combinado, `make -C <lado> new-app` por cada lado al que le falte).

Cada acción se reporta con `+` (creado), `~` (actualizado), `=` (existía, se conserva) o `!` (aviso).

## 4. Mapeo plantilla → proyecto

| Origen (`plantillas/`) | Destino | Política |
|---|---|---|
| `core/AGENTS.block.md` | `AGENTS.md` | Bloque gestionado |
| `core/Makefile` | `Makefile` | Crear; si existe sin marca → `Makefile.basekit` |
| `core/README.tpl.md` | `README.md` | Crear (con render) |
| `core/docs/*.md` | `docs/*.md` | Crear (con render) |
| `core/agents-README.md` | `.agents/README.md` | Crear |
| `core/zones.orchestrator.common.txt` + `stacks/<s>/zones/orchestrator.stack.txt` | `.agents/zones/orchestrator.txt` | Crear (concatenados) |
| `core/gitignore.block` | `.gitignore` | Bloque gestionado (`# >>> basekit` … `# <<< basekit`) |
| `skills/{project-bootstrap,infra-setup,zone-check}/` | `.agents/skills/<nombre>/` | Copiar; las modificadas solo se reemplazan con `--force` |
| `stacks/<s>/roles/*.md` | `.agents/roles/` | Crear |
| `stacks/<s>/zones/*.txt` (menos `orchestrator.stack.txt`) | `.agents/zones/` | Crear |
| `stacks/<s>/skills/*/` | `.agents/skills/` | Igual que las skills core |
| `stacks/<s>/files/**` (incluye `.make/`, `.dockerignore`, `.env.example`) | raíz | Crear sin sobrescribir |
| `stacks/<s>/starter/**` | raíz | Solo si falta `appMarker` (hoy: `django`, `django-htmx`, `express`, `fastapi`, `flask`, `gin`, `go-native`, `node-native`, `php-native`, `python-native`) |
| `stacks/<s>/AGENTS.section.md` | dentro del bloque de `AGENTS.md` | Placeholder `{{STACK_SECTION}}` |

## 5. Placeholders

| Placeholder | Valor |
|---|---|
| `{{VERSION}}` | Versión del CLI |
| `{{STACK_NAME}}` | `stack.json → name` |
| `{{STACK_SKILLS}}` | Filas de tabla desde `stack.json → skills`: `` | `nombre` | cuándo | `` |
| `{{STACK_SECTION}}` | Contenido de `AGENTS.section.md` |
| `{{PROJECT_NAME}}` | Nombre de la carpeta |
| `{{ONE_LINER}}` | Contexto, o "Descripción pendiente: la completa el bootstrap." |
| `{{CONTEXT}}` | Contexto, o "_(sin contexto inicial: el bootstrap lo pedirá)_" |
| `{{PORT}}` | `stack.json → port` |

**No renderices** `__NAME__`, `__PASCAL__`, `__KEBAB__`, `__SNAKE__`, `__PKG__` (los usan los scripts de scaffold) ni `__GENERATE__` / `__GENERATE_B64__` (los usa `make env`).

## 6. `stack.json` y detección

```json
{
  "id": "nextjs",
  "name": "TypeScript · Next.js (App Router, fullstack)",
  "language": "TypeScript",
  "kind": "fullstack",
  "port": 3000,
  "health": "/api/health",
  "detect": { "files": ["next.config.ts"], "manifest": "package.json", "contains": "\"next\"" },
  "appMarker": "package.json",
  "roles": ["data-writer", "logic-writer", "ui-writer", "qa-writer"],
  "skills": [["nextjs-scaffold", "Feature nueva: estructura + contrato"]],
  "defaultAuth": "better-auth"
}
```

- `name` empieza por `<language> · ` y nombra el framework y el tipo de app: es la etiqueta del paso Framework.
- `language` (texto no vacío), `kind` (`backend` | `frontend` | `fullstack`) y `health` (ruta del healthcheck, empieza por `/`) son obligatorios: un `stack.json` sin ellos o con otro `kind` es inválido.

**Detección**: los stacks se recorren por `detect.priority` (menor primero; 50 si falta) y, a igual prioridad, por id en orden alfabético. Para cada uno, se detecta si existe alguno de `detect.files`, o si `detect.manifest` existe y contiene `detect.contains`. Gana el primero que coincida. Con `detect: {}` un stack nunca se detecta (solo por pregunta o `--stack`): así están `express` (su dependencia aparece en NestJS y Next.js), `django-htmx` (`manage.py` ya es de `django`) y los nativos (`go-native`, `node-native`, `php-native`, `python-native`, `vanilla-ts`). `react` exige `"@vitejs/plugin-react` en `package.json`.

Prioridades: **10** para los stacks originales (`fastapi`, `laravel`, `nextjs`, `spring`), así lo que ya se detectaba se sigue detectando igual; **20** para los que tienen una señal propia del framework: un archivo que solo él crea (`django` con `manage.py`, `symfony` con `symfony.lock`, `nestjs` con `nest-cli.json`) o un módulo que solo ese framework declara (`gin`: `github.com/gin-gonic/gin` en `go.mod`); **30** para los que buscan un nombre corto en un manifest que comparten muchos stacks (`flask` en `pyproject.toml`, `react` y `vue` en `package.json`), donde una coincidencia es una señal débil. Ejemplo: un proyecto Spring Boot con un `package.json` de Vite + React es `spring`, no `react`. Un stack nuevo elige su prioridad según qué tan fuerte es su señal.

**Agregar un stack** = una carpeta nueva en `plantillas/stacks/` con esta estructura. El CLI no debe tener nada específico de un stack en su código.

## 7. Bloques gestionados

- Marcadores: `<!-- basekit:start …` / `<!-- basekit:end -->` en Markdown, y `# >>> basekit` / `# <<< basekit` en `.gitignore` y `.env.example`.
- Si el bloque existe, se reemplaza lo que hay entre los marcadores. Si no existe, se agrega al final, con una línea en blanco de separación.
- Todo lo que está fuera del bloque es del usuario y no se toca. Así el kit funciona en proyectos que ya tienen `AGENTS.md`.

## 8. `.agents/manifest.json`

```json
{
  "kit": "basekit",
  "version": "0.1.0",
  "stack": "nextjs",
  "agents": ["claude-code", "opencode", "hermes-agent"],
  "options": { "db": "auto", "redis": false },
  "externalSkills": {
    "cli": "skills@1.7.4",
    "source": "https://github.com/mattpocock/skills",
    "ref": "5beb35b040e3de97e54fa9e386d7e42d15c295c2",
    "skills": ["grill-me", "grill-with-docs", "grilling", "domain-modeling"]
  },
  "createdAt": "…",
  "updatedAt": "…"
}
```

Al reescribirlo, conserva `createdAt` y cualquier campo desconocido; así un `upgrade` futuro podrá migrar.

Un proyecto combinado guarda los dos ids en el mismo campo y con la misma gramática que `--stack`: `"stack": "fastapi+react"`. El resto del formato no cambia; las claves de `files` de cada lado llevan su carpeta (`backend/.agents/skills/…`). Un manifest de un solo stack sigue igual, y una versión anterior de basekit rechaza un combinado con «stack no existe» en vez de tratarlo como un solo stack.

## 9. Skills externas (obligatorias)

```bash
DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx -y skills@1.7.4 add \
  https://github.com/mattpocock/skills/tree/5beb35b040e3de97e54fa9e386d7e42d15c295c2 \
  -s grill-me grill-with-docs grilling domain-modeling \
  -a <agentes elegidos> -y
```

- **Son cuatro, no dos.** `grill-me` y `grill-with-docs` son envoltorios de una línea:
  - `grill-me` = "Call the Skill tool with grilling".
  - `grill-with-docs` = "grilling + domain-modeling".

  Sin esas dos dependencias quedan rotas.
- `grill-me` y `grill-with-docs` tienen `disable-model-invocation: true`, así que **las invoca el usuario** (`/grill-with-docs`). El agente usa directamente `grilling` y `domain-modeling`; por eso `project-bootstrap` las nombra a ellas.
- El CLI `skills` deja la copia canónica en `.agents/skills/`, enlaza `.claude/skills/` y `.hermes/skills/`, y escribe `skills-lock.json` con el commit y el hash. **Commitea `skills-lock.json`.**
- Después de instalar, comprueba que existan los cuatro `.agents/skills/<s>/SKILL.md`. Si falla, imprime el comando para reintentarlo; no abortes el `init`.
- **Auditoría (19 de octubre de 2026)**: solo contienen markdown y `agents/openai.yaml`, sin scripts, URLs ni comandos. Licencia MIT.
- **Para actualizar los pines**:
  1. Elige un commit o versión con al menos 14 días de antigüedad.
  2. Revisa el diff de las cuatro carpetas: `git diff <viejo> <nuevo> -- skills/productivity/grill* skills/productivity/grilling skills/engineering/grill-with-docs skills/engineering/domain-modeling`.
  3. Busca contenido ejecutable (`curl`, `http`, `eval`, `npx`, scripts nuevos).
  4. Cambia la constante y publica.

## 10. `sync`

1. Lee el manifest (error si no existe). Con `--agents`, reemplaza la lista y la valida.
2. Re-renderiza el bloque de `AGENTS.md`.
3. Regenera los archivos **generados**: `.claude/agents/*.md` y `.opencode/agents/*.md`, desde `.agents/roles/` y `.agents/zones/`.
4. Crea solo si faltan: `CLAUDE.md`, `.claude/settings.json`, `opencode.json` y `.gemini/settings.json`. Son del usuario una vez creados.
5. Rehace los enlaces de skills que falten. Si se añadieron agentes, reinstala las skills externas para ellos.

## 11. `doctor`

Imprime `OK` o `FALTA` con una sugerencia:
- Node ≥ 20, git, docker y `docker compose` v2, make, openssl.
- El manifest, y el bloque de `AGENTS.md` (y su tamaño).
- `Makefile`, `.make/stack.mk`, `Dockerfile`, los tres `compose*.yaml` y `.env.example`. En un combinado: `Makefile (raíz)` y esos archivos dentro de `backend/` y de `frontend/`.
- El `appMarker` (si falta → `make new-app`; en un combinado, `<lado>/<appMarker>` → `make -C <lado> new-app`).
- Cada `SKILL.md` esperado (core, stack y las cuatro externas). En un combinado, también la copia de las skills del stack en `<lado>/.agents/skills/`.
- Los enlaces de skills por agente.
- Hermes: que no exista `.hermes.md` ni `HERMES.md`.
- `.env` (en un combinado, `backend/.env` y `frontend/.env`).

## 12. Requisitos de seguridad del CLI

- **Listas blancas** para stack, agentes y BD. Nunca construyas rutas con texto del usuario sin normalizarlas; comprueba que el destino resuelto empiece por el directorio del proyecto.
- **Sin shell con datos del usuario.** Usa `spawn` con un array de argumentos. El `--context` solo se escribe en archivos; nunca se pasa a un comando.
- **Nunca leer** `.env` ni `.env.prod`.
- **Enlaces simbólicos relativos** (el repo sigue funcionando si se mueve); copia como respaldo.
- **Telemetría desactivada** al llamar a `skills`. Versiones exactas (nunca `@latest`) y con al menos 14 días.
- **`--dry-run` real**: cero escrituras y cero procesos externos.

## 13. Criterios de aceptación (tests del CLI)

| # | Prueba | Esperado |
|---|---|---|
| 1 | `init` en carpeta vacía, por cada stack | Sin errores; `make help` lista ≥ 25 objetivos |
| 2 | `init` dos veces seguidas | La segunda solo muestra `=` y "al día"; `git status` queda vacío |
| 3 | Proyecto con `AGENTS.md` y `Makefile` propios | Contenido original intacto; bloque añadido; `Makefile.basekit` |
| 4 | `--dry-run` | `git status` vacío después |
| 5 | `--stack foo`, `--agents x`, `--db mongo` | Error claro, exit ≠ 0 |
| 6 | `bash .agents/skills/zone-check/scripts/check_zones.sh --owners` justo después de `init` | `0 sin dueño` |
| 7 | `make env` | Sin `__GENERATE__` restantes; permisos 600; secretos distintos entre sí |
| 8 | `make -n dev`, `make -n verify SCOPE=…`, `make -n migrate`, `make -n prod-up` | Incluye los overlays existentes |
| 9 | `docker compose -f compose.yaml -f compose.dev.yaml -f compose.db.yaml config` | Válido, y `migrate` recibe `DATABASE_URL` |
| 10 | Frontmatter de `.opencode/agents/*.md` | YAML válido; `edit` con `"*": deny` y las zonas en `allow` |
| 11 | Enlaces en `.claude/skills/` y `.hermes/skills/` | Resuelven a `.agents/skills/*` |
| 12 | `make dev` real (con Docker) por stack, después de `make new-app` | Responde en el healthcheck del stack |

**Estado verificado con un prototipo y estas plantillas:**
- Pasaron la 1, 3, 4, 5, 6, 7, 8, 10 y 11.
- La 2 falló en el prototipo: reescribía los archivos generados y el `updatedAt`. Por eso la regla de comparar contenido está arriba.
- **La 9 y la 12 no las pude ejecutar** porque no tenía Docker: son las primeras que debe correr tu CI.

## 14. Proyecto combinado: `backend/` + `frontend/`

`--stack <backend>+<frontend>` (o «Combinar backend + frontend» en la pregunta) crea un monorepo con un stack `kind: backend` y uno `kind: frontend`. Cualquier otro par es un error de uso (exit 2) antes de escribir nada: el orden invertido (`react+fastapi`), dos backends (`fastapi+django`), un fullstack (`nextjs+react`), un id que no existe o más de dos partes.

| Dónde | Qué |
|---|---|
| raíz | Lo común una sola vez: `AGENTS.md` (con las secciones de los dos stacks dentro de `core/combo/AGENTS.section.md`), `.agents/` (skills core y de los dos stacks, roles, zonas, manifest), adaptadores, `README.md`, `docs/`, bloque de `.gitignore`, `.gitattributes`, y `Makefile` desde `core/combo/Makefile`, que delega en los dos lados |
| `backend/`, `frontend/` | Un proyecto completo de su stack: `Makefile` (el core), `files/` del stack (`.make/stack.mk`, `Dockerfile`, `compose*.yaml`, `.env.example`, `.dockerignore`), su `starter/` si falta el `appMarker` y una copia de las skills de su stack en `<lado>/.agents/skills/` (Docker solo monta la carpeta del lado, y `make verify` y `make new-app` leen de ahí); el backend recibe además `infra-setup`. Un script de skill resuelve su proyecto desde su ubicación (`<proyecto>/.agents/skills/<skill>/scripts/` → `$(dirname "$0")/../../../..`), así que se corre la copia del lado: `bash backend/.agents/skills/<skill>/scripts/scaffold.sh`. Es también la invocación que permite `.claude/settings.json`. Cada uno funciona solo: `make -C backend dev`, `make -C frontend new-app` |

- **Roles y zonas**: cada rol del stack se escribe como `<lado>-<rol>` (`backend-data-writer`, `frontend-ui-writer`), con `name:` cambiado, una nota inicial (`core/combo/role.note.md`) y la referencia a su zona actualizada. Cada glob de las zonas de un lado lleva el prefijo de su carpeta. `orchestrator.txt` es lo común más, por cada lado, lo común y `orchestrator.stack.txt` con el prefijo del lado. Así, `zone-check --owners` da 0 archivos sin dueño justo después de `init`.
- **API**: el navegador llama a la API por el host. `frontend/.env.example` recibe `VITE_API_URL=http://127.0.0.1:<puerto del backend>` y `backend/.env.example`, `CORS_ORIGINS=http://127.0.0.1:<puerto del frontend>,http://localhost:<puerto del frontend>`. Si el `.env.example` del stack no tiene esa variable, `init` avisa con `!` y no inventa una. Los dos lados son proyectos de Compose distintos: no comparten red, así que los servicios `app` no chocan.
- **Base de datos**: `--db` y `--redis` van al backend; infra-setup escribe sus overlays en `backend/`. Al cambiar un proyecto existente a un stack frontend, la base de datos y Redis del manifest no se arrastran: quedan `none` y `false`. Al cambiar un proyecto de un solo stack con base de datos a combinado, sí se arrastran al backend, `infra.sh` crea sus overlays en `backend/` y cada overlay que quede en la raíz (`compose.db.yaml`, `compose.redis.yaml`, `.make/db.mk`) se avisa con `!` ("la base de datos ahora vive en backend/"); nunca se borra.
- **`sync`** regenera el bloque de `AGENTS.md`, los adaptadores (con los roles prefijados) y los enlaces de los dos stacks. **`doctor`** revisa la raíz y cada lado (sección 11).
