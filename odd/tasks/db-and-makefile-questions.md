# db-and-makefile-questions

Objective: add an interactive database question with MongoDB as a new engine, and split the "Docker + Makefile" question into two questions, identically in basekit (Node) and basekit-go.
Branch: `dev/farid` in both repos. Delivery: work-unit commits on dev/farid (user approves commits). Runners: `bash .agents/skills/cli-verify/scripts/verify.sh` (Node), `go test ./...` (Go).

## Specs

### S1 · Database question
User: "agrega una pregunta si se quiere integrar base de datos y si acepta de las opciones de Mysql, SQLlITE, PosgreSql y MongoDB."
- Interactive `init` asks `¿Integrar base de datos?` (yes/no, default yes).
- If yes, it asks `¿Qué base de datos?` (single choice) with these options, in this order: `MySQL` (`mysql`), `SQLite` (`sqlite`), `PostgreSQL` (`postgres`), `MongoDB` (`mongo`). Default: `PostgreSQL` (assumption).
- If no, the database is `none`.
- The answer has the same effect as passing `--db <engine>`: infra-setup runs with that engine, and the manifest stores it in `options.db`.
- The questions come right after the Docker and Makefile questions (S3). They are asked only when every one of these holds (assumption): there is a prompt (not `-y`); Docker is on; the stack, or the backend part of a combined stack, accepts a database (a frontend stack does not); `--db` was not passed; the manifest has no saved db other than `auto`.
- Without the questions (`-y`, flags, or a rerun), behavior is unchanged: the default stays `auto`.

### S2 · MongoDB engine (connection only)
User, about what to do with Mongo: "Recuerda que lo que hace con sql es la conexion a BD no subes". MongoDB gets exactly what SQL engines get, the connection, and nothing else (no collections, no data, no ODM, no template code changes).
- `--db` accepts `mongo`. Values: `auto, postgres, mysql, sqlite, mongo, none`. Help line: `--db <motor>            auto | postgres | mysql | sqlite | mongo | none (por defecto: auto;`.
- `infra.sh --db mongo` copies `assets/compose.mongo.yaml` to `compose.db.yaml`, adds the `.env.example` block `DB_NAME=app`, `DB_USER=app`, `DB_PASSWORD=__GENERATE__`, and writes `.make/db.mk` with a `mongosh` shell.
- The overlay injects into `app` and `migrate` (like the SQL overlays): `DB_DRIVER: mongodb`, `DB_CONNECTION: mongodb`, `DB_HOST: db`, `DB_PORT: "27017"`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `DATABASE_URL` and `MONGO_URL` (`mongodb://user:pass@db:27017/app?authSource=admin`), and `SPRING_DATA_MONGODB_URI`. No published ports.
- infra.sh usage and error text list `mongo`. infra-setup `SKILL.md` documents `mongo`.

### S3 · Docker and Makefile as two questions
User: "Divide las preguntas de DOCKERfILE y MakeFile." Decision (2026-11-12): "Makefile exige Docker". The Makefile question appears only after a yes to Docker. Combinations: Docker+Makefile, Docker only, or neither.
- The Docker question becomes `¿Usar Docker? Todo corre en contenedores (Dockerfile y compose)` (default yes). It replaces `¿Usar Docker + Makefile? Todo corre en contenedores y el Makefile es la interfaz`.
- If Docker is yes, init asks `¿Usar Makefile? Es la interfaz para correr los comandos en los contenedores` (default yes).
- How `makefile` is resolved:
  1. No Docker → false.
  2. Combined stack → true.
  3. `--no-makefile` → false.
  4. A manifest `options.makefile` boolean → that value.
  5. A prompt → the answer.
  6. Otherwise → true.
- New flag `--no-makefile`. Help line: `--no-makefile           Docker sin Makefile: usa docker compose directo (no compatible con un combinado)`.
- `--no-makefile` with a combined stack errors: `un proyecto combinado (<backend>+<frontend>) necesita el Makefile: el Makefile raíz delega en cada lado; quita --no-makefile`.
- Docker without Makefile:
  - Writes the stack's Docker files (Dockerfile, compose*, .dockerignore, .env.example) but not `Makefile` or anything under `.make/`.
  - Reports `! Makefile  sin Makefile: usa docker compose directo, crea .env desde .env.example (reemplaza __GENERATE__) y adapta las reglas de AGENTS.md que usan make`.
  - The next-step line is the same as without Docker: `Falta la app del framework${where}: créala con las herramientas del stack (${marker}).`
  - Infra (S1/S2) still runs.
  - `infra.sh` writes `.make/db.mk` only when a `Makefile` exists. Its final hint is unchanged.
- The manifest stores `options.makefile` (boolean) next to `options.docker`.
- `sync`: `makefile = docker && prev.options?.makefile !== false`. It never writes the Makefile or `.make/` when that is false.
- `doctor`: with Docker but without a Makefile, it skips the `make` tool check, the root `Makefile` and the `.make/` files, and logs `·     sin Makefile (manifest): se omiten make y el Makefile`. Docker checks stay.
- Docs: README (both repos, Spanish), `docs/spec/02_especificacion_cli.md` (flag table, question steps, manifest example, sync, doctor).

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S2 (templates: compose.mongo.yaml, infra.sh, SKILL.md, template tests in Node), copied byte-identical to basekit-go/plantillas | inline | done (RED 4 fail → GREEN 17/17 infra.test; compose config OK; Go copy identical) | uncommitted |
| T2 | S1, S2 (CLI side), S3 in Node: cli.ts, options, init, prompt, manifest, sync, doctor, dist/src, tests, README, docs/spec | delegated (writer trigger a: parallel with T3) | done (RED→GREEN; verify.sh OK incl. 15 mongo compose tests; differential clean; parent spot check 29/29) | uncommitted |
| T3 | S1, S2 (CLI side + Go template tests), S3 in Go, same strings | delegated (writer trigger a: parallel with T2) | done (RED 12 fail → GREEN; go vet/test/gofmt OK incl. 15 mongo compose tests; parent fixed doctor appMarker hint parity RED→GREEN and ported docs/guias/02) | uncommitted |

## Log
- L1 (2026-11-12) user: "en los dos proyectos agrega una pregunta si se quiere integrar base de datos y si acepta de las opciones de Mysql, SQLlITE, PosgreSql y MongoDB. Tambien Divide las preguntas de DOCKERfILE y MakeFile."
- L2 (2026-11-12) user on Mongo scope: "Recuerda que lo que hace con sql es la conexion a BD no subes" → Mongo = connection only, like SQL.
- L3 (2026-11-12) user on combinations: "Makefile exige Docker".
- L4 Route: T1 inline (about 100 lines of shared templates). T2 and T3 are independent units in separate repos with disjoint surfaces, each several hundred lines, so writer trigger (a) fires and they run in parallel after T1.
- L5 (2026-11-12) user: "puede haber Docker sin base de datos y Docker puede tener frontend" → already covered: DB "no" → none; Docker/Makefile questions apply to every stack, DB question skipped for frontend.
- L6 Seam check: Node verify.sh OK; Go go vet + go test ./... OK; feature strings byte-identical in both repos. Parity fix: Go doctor suggested `make new-app` without a Makefile; now uses `makefile` like Node. Go spec doc is docs/guias/02 (not docs/spec), ported by parent, including the missing --no-docker row. Next: user approval for commits.
