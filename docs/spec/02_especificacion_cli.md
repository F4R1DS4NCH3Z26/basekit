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
| `sync [dir] [--agents a,b] [--external-skills a,b]` | Regenera el bloque de `AGENTS.md`, los adaptadores y los enlaces desde `.agents/`; con `--agents`, también añade herramientas; con `--external-skills`, cambia las skills externas elegidas |
| `doctor [dir]` | Diagnóstico del entorno y del proyecto (sección 11) |
| `stacks` | Lista los stacks (leídos de `plantillas/stacks/*/stack.json`) y los agentes soportados |
| `uninstall [--global\|--project] [--skills] [-y] [--dry-run]` | Desinstala el basekit que corre (con `--skills`, también las skills globales); ver abajo |

`uninstall`:

- **Qué borra.** El paquete de npm que corre: si es el global (`npm root -g` contiene este mismo paquete), `npm uninstall -g basekit`; si está bajo el `node_modules` de un proyecto cuyo `package.json` lista `basekit` en `dependencies` o `devDependencies`, `npm uninstall basekit` en la carpeta que tiene ese `node_modules`. Si `npm root -g` falla o no imprime una ruta, no se supone que es de un proyecto: hace falta ese `package.json`. `--global` o `--project` fuerzan el modo (`--project` corre npm en el directorio actual); los dos juntos son un error de uso (exit 2): `Usa --global o --project, no los dos`. Si no es ninguno de los dos, es un error de uso (exit 2, sin correr npm): `basekit uninstall: no se sabe si este basekit (<root>) es global o de un proyecto; usa --global o --project`. npm corre con argumentos fijos a través del `Runner`.
- **`--skills`.** También borra las skills globales de `init --global` (basekit-go): cada ruta que lista `~/.agents/basekit.json` (`files`) bajo `~/.agents/skills`, las carpetas de esas skills que queden vacías, los enlaces de la carpeta global de skills de cada agente que apuntan a esas skills, y el manifest. Nunca borra lo que el manifest no lista. En el plan, una carpeta de skill que queda vacía aparece como `  - <carpeta>`; una que conserva archivos que el manifest no lista, como `  - <carpeta>  (solo los archivos de basekit; se conservan los tuyos)`. Los archivos listados que ya no existen no aparecen, y una carpeta sin ninguno de ellos ni aparece ni se toca. Un enlace solo se borra con su carpeta: si la carpeta se queda (no se toca o conserva archivos tuyos), sus enlaces también, para que ninguna herramienta pierda acceso a algo que sigue existiendo. Sin manifest global: `= skills globales  (no hay instalación global)`.
- **Confirmación.** Primero imprime el plan (`Se va a desinstalar:` y una línea `  - <ruta o comando>` por elemento) y pregunta `¿Desinstalar basekit?` (por defecto, no). Un no imprime `No se desinstaló nada.` y sale con 0. `-y`/`--yes` no pregunta; `--dry-run` imprime el plan y `(dry-run: no se borra nada)`. Sin terminal y sin `-y` ni `--dry-run`: error de uso (exit 2, sin borrar nada) `basekit uninstall necesita confirmación: usa -y (o --dry-run para ver qué borraría)`.
- **Resultado.** Si npm falla: `! npm uninstall falló; reinténtalo con: <comando>` y exit 1, sin tocar las skills. Si no, avisa de cada otra copia de `basekit` en el `PATH` (por ruta real, sin repetir, sin la que borró; en Windows también `basekit.cmd` y `basekit.exe`) con `! otra copia de basekit en el PATH: <ruta> (no se borra)`, y termina con `basekit desinstalado. Los proyectos que ya creaste no cambian.` Los proyectos creados con basekit nunca se tocan.

Flags de `init`:

| Flag | Valores | Por defecto |
|---|---|---|
| `--stack` | backend: `django`, `express`, `fastapi`, `flask`, `gin`, `go-native`, `nestjs`, `node-native`, `php-native`, `python-native`, `spring`, `symfony` · frontend: `react`, `vanilla-ts`, `vue` · fullstack: `django-htmx`, `laravel`, `nextjs` (la lista sale de `plantillas/stacks/`; `basekit stacks` la imprime). **Combinado** (sección 14): `<backend>+<frontend>`, por ejemplo `fastapi+react`; solo un stack `kind: backend` seguido de uno `kind: frontend` | manifest; si no, detectado; si no, se pregunta |
| `--agents` | lista separada por comas (ver guía 03), o `none` para ninguna herramienta (`none` junto a otros ids es un error de uso, exit 2) | manifest; si no, detectados; si no, se pregunta (marcados: `claude-code,opencode`) |
| `--context` | texto libre: "de qué trata el proyecto" | se pregunta (puede ir vacío) |
| `--db` | `auto`, `postgres`, `mysql`, `sqlite`, `mongo`, `none`. Un stack frontend solo admite `auto` o `none`; los demás, `auto`, `none` y los motores de su `stack.json → dbs` (todos si falta). En un combinado se aplica al backend. Un motor que el stack no admite es un error de uso (exit 2, antes de escribir nada): `--db 'sqlite' no aplica a spring: motores admitidos: postgres, mysql, mongo (o auto, none)`; un motor ya guardado en el manifest se conserva sin revalidar. `mongo` es solo la conexión, como los motores SQL | manifest; si no, se pregunta (paso 3); si no, `auto` (lo decide el bootstrap; en un stack frontend, `none`) |
| `--redis` | booleano. Error en un stack frontend; en un combinado, va al backend | no |
| `--docker` | vuelve a usar Docker en un proyecto creado sin Docker (`options.docker: false`): escribe los archivos de Docker del stack y el `Makefile` como cualquier corrida con Docker (crear sin sobrescribir). El `makefile: false` guardado no cuenta (se derivó de «sin Docker»): el Makefile se resuelve como en una primera corrida. En un proyecto que ya usa Docker no cambia nada. Con `--no-docker` es un error de uso (exit 2, antes de cualquier pregunta o escritura): `Usa --docker o --no-docker, no los dos` | manifest (`options.docker`); si no, se pregunta |
| `--no-docker` | sin Docker ni Makefile: no escribe el `Makefile` ni `files/` del stack (`.make/stack.mk`, `Dockerfile`, `compose*.yaml`, `.env.example`, `.dockerignore`) ni ejecuta infra-setup; no borra los que ya existían (paso 8). Error de uso (exit 2, antes de cualquier pregunta o escritura) con `--redis`, en un combinado o con `--db` distinto de `auto`/`none` | manifest (`options.docker`); si no, se pregunta |
| `--no-makefile` | Docker sin Makefile: escribe los archivos de Docker del stack (`Dockerfile`, `compose*.yaml`, `.dockerignore`, `.env.example`) pero no el `Makefile` ni nada de `.make/`; infra-setup se ejecuta igual. Error de uso (exit 2, antes de escribir nada) en un combinado. Sin Docker no aplica | manifest (`options.makefile`); si no, se pregunta tras un sí a Docker |
| `--no-git` | omite `git init` (zone-check lo necesita) | no; si falta `.git`, se pregunta |
| `--external-skills` | lista separada por comas de `grill-me`, `grill-with-docs`, `grilling`, `domain-modeling` (sección 9), o `none` para ninguna. Reemplaza `options.externalSkills` (guardada en el orden fijado), no pregunta e instala las elegidas que falten; las ya instaladas que se quiten se quedan. Errores de uso (exit 2, antes de escribir nada): `--external-skills '<x>' no es una skill externa. Disponibles: grill-me, grill-with-docs, grilling, domain-modeling`, `--external-skills none no se combina con otras skills` y `--external-skills y --no-external-skills no se combinan`. Vale igual en `sync` | manifest; si no, se pregunta |
| `--no-external-skills` | omite `npx skills add` en esta corrida (CI o sin red); no cambia la elección guardada | no; si faltan y no hay elección guardada, se pregunta cuáles |
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
3. **Skills externas y agentes**: si no se pasó `--no-external-skills` ni `--external-skills`, el manifest no guarda una elección (`options.externalSkills`) y falta alguna de las externas, se muestran las skills incluidas (`Skills incluidas: …`) y se pregunta cuáles instalar: `¿Qué skills externas instalo? (usan npx y red)`, con `grill-me`, `grill-with-docs`, `grilling` y `domain-modeling` en ese orden y todas marcadas. En una terminal son casillas (espacio marca, Enter confirma; ninguna marcada es ninguna); sin TTY, una lista numerada que acepta números o nombres separados por comas, Enter conserva todas y `ninguna`/`ninguno` (sin importar mayúsculas) no elige ninguna; una respuesta solo de comas o espacios no es «ninguna»: se rechaza con `  No reconozco: <respuesta>. Usa los números o los nombres de la lista.` y se vuelve a preguntar. La elección se guarda en el manifest (sección 8) y no se vuelve a preguntar; `--external-skills` la reemplaza sin preguntar.

   Agentes: flag → manifest → detección (guía 03, sección 1) → pregunta `¿Con qué herramientas vas a trabajar?`. La pregunta acepta no elegir ninguna (en el menú, Enter sin casillas marcadas; sin TTY, `ninguno`/`ninguna`; Enter vacío conserva las marcadas). Valida contra la lista blanca. Sin agentes (`--agents none` o ninguna elegida) se escriben igual `AGENTS.md`, `.agents/`, la documentación y Docker/Make, pero ningún adaptador ni enlace de skills, y el manifest guarda `"agents": []`, que en una nueva corrida cuenta como respuesta (sin detección ni pregunta).

   Docker (una sola función, la misma que usan `sync` y `doctor`, que no tienen flags): 1) combinado → sí (sección 14); 2) `--no-docker` → no; 3) `--docker` → sí; 4) hay manifest → `options.docker !== false` (un manifest sin la clave, anterior a la opción, es sí y **nunca** se pregunta); 5) primera corrida (sin manifest) con TTY → pregunta `¿Usar Docker? Todo corre en contenedores (Dockerfile y compose)` (sí por defecto; después de los agentes y antes de git); 6) si no, sí. Con `--db` distinto de `auto`/`none` o `--redis` en una primera corrida no se pregunta: Docker es sí, porque esos flags lo necesitan (la pregunta del Makefile sigue igual).

   Cuando Docker vuelve (`--docker` sobre un manifest con `docker: false`), el `makefile: false` guardado no cuenta: `--no-makefile` → no; con TTY, la pregunta del Makefile; si no, sí. La pregunta de base de datos no se hace (sigue siendo solo de la primera corrida): se conserva el motor guardado, y `--db` lo cambia.

   Makefile (exige Docker; solo se pregunta tras un sí a Docker): 1) sin Docker → no; 2) combinado → sí; 3) `--no-makefile` → no; 4) manifest (`options.makefile`, booleano) → ese valor; 5) manifest sin la clave (anterior a la opción) → sí, sin preguntar; 6) primera corrida con TTY → pregunta `¿Usar Makefile? Es la interfaz para correr los comandos en los contenedores` (sí por defecto); 7) si no, sí. Es la misma regla (una sola función) que usan `sync` y `doctor`. `--no-makefile` en un combinado es un error de uso (exit 2) antes de escribir nada: `un proyecto combinado (<backend>+<frontend>) necesita el Makefile: el Makefile raíz delega en cada lado; quita --no-makefile`.

   Base de datos: justo después de Docker y Makefile se pregunta `¿Integrar base de datos?` (sí por defecto) y, si la respuesta es sí, `¿Qué base de datos?` con `MySQL` (`mysql`), `SQLite` (`sqlite`), `PostgreSQL` (`postgres`) y `MongoDB` (`mongo`), en ese orden y `PostgreSQL` por defecto, aunque solo los que admite el stack (`stack.json → dbs`; Spring no ofrece `SQLite`); si es no, la base de datos es `none`. La respuesta tiene el mismo efecto que `--db <motor>`: infra-setup se ejecuta con ese motor (paso 13) y el manifest lo guarda en `options.db`. Solo se pregunta si hay TTY (no con `-y`), con Docker, si el stack (o el backend de un combinado) admite base de datos (un stack frontend no), sin `--db` y solo en la primera corrida (sin manifest): en una nueva corrida se conserva el motor guardado, aunque sea `auto` (el agente pudo activar la base con `infra.sh`); para cambiarlo, `--db`. Sin la pregunta (`-y`, flags o una nueva corrida) nada cambia: el valor por defecto sigue siendo `auto`. Sin Docker por flag o por manifest (`--no-docker`, o un manifest con `docker: false` sin `--docker`), `--db` distinto de `auto`/`none` o `--redis` es un error de uso (exit 2) antes de **cualquier** pregunta (también las del stack y los agentes) y de escribir nada: `--db y --redis necesitan Docker: no se pueden usar con --no-docker ni sin Docker en el manifest`. Si en cambio la base de datos o Redis vienen del manifest (sin `--db`/`--redis`; un `db` guardado distinto de `auto`/`none`, o `redis: true`) y Docker queda en no, no falla: se guardan `db: "none"` y `redis: false`, se avisa una vez `! .agents/manifest.json  (sin Docker no se usan la base de datos ni Redis guardados: quedan db none y redis false)`, los overlays reciben los avisos del paso 8 si existen e infra-setup no se ejecuta. Un `auto` o `none` guardado se conserva tal cual, sin aviso.
4. **Contexto** (texto) y **BD** (`auto` por defecto). Un stack frontend no tiene base de datos: `--db` distinto de `auto`/`none` o `--redis` es un error de uso (exit 2) antes de escribir nada, y `auto` se guarda como `none`.
5. **Git**: si no hay `.git` y no se pasó `--no-git`, se pregunta `¿Inicializar git (git init)? zone-check lo necesita` (sí por defecto; se pregunta antes del contexto) y se ejecuta `git init`. Sin git se avisa `!` (zone-check no funciona) y no se crea `.gitattributes`.
6. **Núcleo `.agents/`**, siguiendo la tabla de la sección 4: README, roles, zonas, skills del kit (scripts con permisos 755) y `manifest.json`.
7. **`AGENTS.md`**: bloque gestionado (sección 7) con los placeholders resueltos (sección 5). Si supera 18.000 caracteres, avisar: Hermes trunca a partir de 20.000.
8. **Docker y Make**:
   - Docker sin Makefile (`options.makefile: false`): se escriben los archivos de Docker del stack (`Dockerfile`, `compose*.yaml`, `.dockerignore`, `.env.example`) pero no el `Makefile` ni nada de `.make/`, y se avisa `! Makefile  (sin Makefile: usa docker compose directo, crea .env desde .env.example (reemplaza __GENERATE__) y adapta las reglas de AGENTS.md que usan make)`. El próximo paso es el mismo que sin Docker: `Falta la app del framework: créala con las herramientas del stack (<appMarker>).` (en un lado de un combinado, `Falta la app del framework en <lado>/: …`) Infra-setup (paso 13) se ejecuta igual; `infra.sh` solo escribe `.make/db.mk` si existe un `Makefile`.
   - Sin Docker (`options.docker: false`) no se escriben el `Makefile` ni `files/` y se avisa `! Makefile  (sin Docker: no se crean Makefile, Dockerfile ni compose; las reglas de AGENTS.md asumen Docker y make, adáptalas)`. El `starter/` y el bloque de `.gitignore` se escriben igual, y el próximo paso dice `Falta la app del framework: créala con las herramientas del stack (<appMarker>).` en lugar del comando de `make new-app`.
   - Al pasar de Docker a sin Docker (el manifest anterior tiene `options.docker !== false`) no se borra nada. Por cada uno de estos que exista se avisa, uno por ruta y en orden de ruta, `! <ruta>  (queda de cuando el proyecto usaba Docker: sin Docker no se usa; bórralo si ya no lo necesitas)`: el `Makefile` (o `Makefile.basekit`) y lo de `.make/` que lista `files` del manifest anterior, los `files/` del stack (`.make/stack.mk`, `Dockerfile`, `compose*.yaml`, `.env.example`, `.dockerignore`) y los overlays de infra-setup `compose.db.yaml`, `compose.redis.yaml` y `.make/db.mk`. Un `Makefile` propio del usuario (no está en `files`) no recibe aviso. Una corrida que sigue sin Docker (el manifest anterior ya tenía `docker: false`) no imprime ninguno, salvo los de los overlays cuando se descarta una base de datos guardada (paso 3).
   - `Makefile`: si existe sin la marca `generado por basekit`, escribir `Makefile.basekit` y avisar.
   - Copiar `files/` del stack sin sobrescribir.
   - Copiar el `starter/` si falta el `appMarker`.
   - Agregar el bloque de `.gitignore`.
9. **Documentación**: `README.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`, `docs/AUTH.md` y `docs/specs/.gitkeep`, solo si no existen. **No crear** `GLOSSARY.md` ni `docs/adr/`: los crea `domain-modeling` cuando hay contenido real.
10. **Adaptadores** para cada agente elegido (guía 03, sección 3). En un proyecto combinado, un `.claude/settings.json` que ya existe recibe al final de `permissions.deny` solo los bloqueos de secretos de `backend/` y `frontend/` que le falten (`~`); si no es JSON válido o `deny` no es una lista, se conserva con un aviso `!`.
11. **Enlaces de skills** para los agentes que no leen `.agents/skills/`: enlace relativo y, si falla (Windows sin permisos), copia.
12. **Skills externas** (sección 9): solo las elegidas, salvo con `--no-external-skills`. Sin ninguna elegida se informa `= skills externas  (ninguna elegida)`; sin agentes no se instalan (el CLI `skills` necesita `-a`) y se avisa `! skills externas  (sin agentes: se instalan cuando agregues uno con basekit sync --agents <a,b>)`.
13. **Infraestructura** (solo con Docker): si `--db ≠ auto` (o la respuesta a la pregunta de base de datos, paso 3), ejecutar `bash .agents/skills/infra-setup/scripts/infra.sh --db <db> [--redis]`. Es el **mismo script** que usa el agente, así que la lógica vive en un solo lugar. El script trabaja en el proyecto que lo contiene (`$(dirname "$0")/../../../..`, nunca `git rev-parse --show-toplevel`): en un combinado se ejecuta, desde la raíz, la copia del backend (`bash backend/.agents/skills/infra-setup/scripts/infra.sh …`). También se ejecuta, sin `--db`, cuando un proyecto de un solo stack pasa a combinado y la base de datos (o Redis) del manifest pasa al backend: el lado nuevo aún no tiene overlays. `--dry-run` solo lo muestra.
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
- `dbs` (opcional): los motores que admite el stack, una lista no vacía de `postgres`, `mysql`, `sqlite` y `mongo`; sin él, los cuatro. Spring: `"dbs": ["postgres", "mysql", "mongo"]`. Limita la pregunta de base de datos y `--db` (paso 3); otro valor hace inválido el `stack.json`.

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
  "options": { "db": "auto", "redis": false, "docker": true, "makefile": true, "externalSkills": ["grill-me", "grill-with-docs", "grilling", "domain-modeling"] },
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

`options.externalSkills` es la elección de la pregunta de skills externas o de `--external-skills` (puede ser `[]`); `init` y `sync` solo comprueban e instalan esas. Sin la clave (un `init -y` o un manifest anterior) valen las cuatro. `externalSkills` en la raíz es el pin, no la elección.

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
- Se instalan las elegidas (sección 3, paso 3): `-s` lleva solo esas. Después de instalar, comprueba que existan sus `.agents/skills/<s>/SKILL.md`. Si falla, imprime el comando para reintentarlo; no abortes el `init`.
- **Auditoría (19 de octubre de 2026)**: solo contienen markdown y `agents/openai.yaml`, sin scripts, URLs ni comandos. Licencia MIT.
- **Para actualizar los pines**:
  1. Elige un commit o versión con al menos 14 días de antigüedad.
  2. Revisa el diff de las cuatro carpetas: `git diff <viejo> <nuevo> -- skills/productivity/grill* skills/productivity/grilling skills/engineering/grill-with-docs skills/engineering/domain-modeling`.
  3. Busca contenido ejecutable (`curl`, `http`, `eval`, `npx`, scripts nuevos).
  4. Cambia la constante y publica.

## 10. `sync`

1. Lee el manifest (error si no existe). Con `--agents`, reemplaza la lista y la valida; `--agents none` deja la lista vacía.
2. Re-renderiza el bloque de `AGENTS.md`.
3. Regenera los archivos **generados**: `.claude/agents/*.md` y `.opencode/agents/*.md`, desde `.agents/roles/` y `.agents/zones/`.
4. Crea solo si faltan: `CLAUDE.md`, `.claude/settings.json`, `opencode.json` y `.gemini/settings.json`. Son del usuario una vez creados; la única excepción es que, en un proyecto combinado, a `.claude/settings.json` se le agregan los bloqueos de secretos de `backend/` y `frontend/` que le falten (guía 03, sección 3).
5. Rehace los enlaces de skills que falten. Si se añadieron agentes, reinstala las skills externas elegidas (`options.externalSkills`) para ellos: así se instalan las de un proyecto creado sin agentes. Con `--external-skills`, reemplaza `options.externalSkills` e instala las elegidas que falten (las ya instaladas que se quiten se quedan); sin agentes no las instala y lo avisa con `!`.
6. Conserva `options.docker` con la regla de `init` (paso 3, sin flags): en un combinado, sí; si no, `options.docker !== false`, así que un manifest sin esa clave queda con `"docker": true`. Conserva también `options.makefile` con la regla de `init` (paso 3): sin Docker, no; en un combinado, sí; si no, el booleano del manifest, y un manifest sin la clave queda con `"makefile": true`. `sync` nunca escribe el `Makefile` ni `.make/`.

## 11. `doctor`

Imprime `OK` o `FALTA` con una sugerencia:
- Node ≥ 20, git, docker y `docker compose` v2, make, openssl.
- El manifest, y el bloque de `AGENTS.md` (y su tamaño).
- `Makefile`, `.make/stack.mk`, `Dockerfile`, los tres `compose*.yaml` y `.env.example`. En un combinado: `Makefile (raíz)` y esos archivos dentro de `backend/` y de `frontend/`.
- El `appMarker` (si falta → `make new-app`; en un combinado, `<lado>/<appMarker>` → `make -C <lado> new-app`).
- Cada `SKILL.md` esperado (core, stack y las externas elegidas; ninguna externa si el proyecto no tiene agentes). En un combinado, también la copia de las skills del stack en `<lado>/.agents/skills/`.
- Los enlaces de skills por agente.
- Hermes: que no exista `.hermes.md` ni `HERMES.md`.
- `.env` (en un combinado, `backend/.env` y `frontend/.env`).

Sin Docker (`options.docker: false`, resuelto con la regla de `init`, paso 3) no se revisan docker, `docker compose`, make ni openssl, ni los archivos de Docker y Make, ni `.env`: se imprime `·     sin Docker (manifest): se omiten Docker, Makefile y .env`, y la sugerencia del `appMarker` es `crea la app con las herramientas del framework`.

Con Docker pero sin Makefile (`options.makefile: false`, resuelto con la regla de `init`, paso 3) no se revisan make, el `Makefile` raíz, el `Makefile` ni los archivos de `.make/`: se imprime `·     sin Makefile (manifest): se omiten make y el Makefile`. Las revisiones de Docker (docker, `docker compose`, openssl, `Dockerfile`, `compose*.yaml`, `.env.example` y `.env`) se mantienen, y la sugerencia del `appMarker` es `crea la app con las herramientas del framework`.

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
| 5 | `--stack foo`, `--agents x`, `--db oracle`, `--stack spring --db sqlite` | Error claro, exit ≠ 0 |
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
- **Docker**: un combinado siempre usa Docker y el Makefile: `init` no pregunta «Docker» ni «Makefile», `--no-docker` es un error de uso (exit 2): `un proyecto combinado (<backend>+<frontend>) necesita Docker: cada lado corre con su Makefile y compose; quita --no-docker`, y `--no-makefile` también: `un proyecto combinado (<backend>+<frontend>) necesita el Makefile: el Makefile raíz delega en cada lado; quita --no-makefile`.
- **`sync`** regenera el bloque de `AGENTS.md`, los adaptadores (con los roles prefijados) y los enlaces de los dos stacks. **`doctor`** revisa la raíz y cada lado (sección 11).
