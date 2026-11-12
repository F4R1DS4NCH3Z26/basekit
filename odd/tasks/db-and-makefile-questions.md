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
- The questions come right after the Docker and Makefile questions (S3). They are asked only when every one of these holds (assumption): there is a prompt (not `-y`); Docker is on; the stack, or the backend part of a combined stack, accepts a database (a frontend stack does not); `--db` was not passed; it is the first run (no manifest). A rerun keeps the saved engine, even `auto` (see L7).
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

### S4 · Mongo healthcheck without the first-boot race (review R4)
User decision Q1: "db + usuario real", Q8: "30s".
- The `db` healthcheck in `compose.mongo.yaml` runs `mongosh` against the service host `db` (port 27017) authenticating with the root user (`MONGO_INITDB_ROOT_USERNAME`/`MONGO_INITDB_ROOT_PASSWORD`, `--authenticationDatabase admin`), so it only passes once the real mongod (not the init-time localhost one) is up and the user exists.
- `start_period: 30s`.

### S5 · One makefile rule; legacy manifests are not asked (review R3/R4)
User decision Q2: "Asumir sí + 1 función".
- With Docker and no `options.makefile` key in the manifest, `init` assumes `makefile = true` without asking (same as sync and doctor).
- A single shared function resolves `makefile` for init, sync and doctor. The S3 order becomes:
  1. No Docker → false.
  2. Combined → true.
  3. `--no-makefile` → false.
  4. Manifest boolean → that value.
  5. Manifest exists (legacy, no key) → true.
  6. First run with a prompt → the answer.
  7. Otherwise → true.

### S6 · Engines per stack (review R2/R3)
User decisions: Q3 "Campo dbs en stack.json"; Q4 "Sí, error de uso"; Q6 the error text below; Q7 "Respetarlo".
- `stack.json` accepts an optional `dbs` array of engines (`postgres`, `mysql`, `sqlite`, `mongo`). When it is missing, all four are accepted. Spring: `"dbs": ["postgres", "mysql", "mongo"]`.
- The database question only offers the stack's engines, in the S1 order. The default stays PostgreSQL.
- An explicit `--db` with an engine the stack does not accept is a usage error (exit 2, before writing anything): `--db 'sqlite' no aplica a spring: motores admitidos: postgres, mysql, mongo (o auto, none)`.
- An engine already saved in the manifest is kept as is and is not re-validated.
- In a combined stack, the rule applies to the backend stack.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S2 (templates: compose.mongo.yaml, infra.sh, SKILL.md, template tests in Node), copied byte-identical to basekit-go/plantillas | inline | done (RED 4 fail → GREEN 17/17 infra.test; compose config OK; Go copy identical) | uncommitted |
| T2 | S1, S2 (CLI side), S3 in Node: cli.ts, options, init, prompt, manifest, sync, doctor, dist/src, tests, README, docs/spec | delegated (writer trigger a: parallel with T3) | done (RED→GREEN; verify.sh OK incl. 15 mongo compose tests; differential clean; parent spot check 29/29) | uncommitted |
| T3 | S1, S2 (CLI side + Go template tests), S3 in Go, same strings | delegated (writer trigger a: parallel with T2) | done (RED 12 fail → GREEN; go vet/test/gofmt OK incl. 15 mongo compose tests; parent fixed doctor appMarker hint parity RED→GREEN and ported docs/guias/02) | uncommitted |
| T4 | S1 (rerun no longer asks the database question) in Node and Go | inline | done | see Log L7 |
| T5 | S4 + S6 template data (compose.mongo.yaml healthcheck; spring stack.json `dbs`), copied to basekit-go | inline | done (RED→GREEN infra.test; real Docker first boot healthy ~9s; Go copy identical) | see git log |
| T6 | S5, S6 in Node (+ tests, docs) | delegated (writer trigger a: parallel with T7; context backstop) | done (RED 6 → GREEN; verify.sh OK incl. compose engines per stack; differential identical except requested help line; parent spot check 7/7; parent added spec 05 MongoDB row and hardened the S4 $$ assertion after review R3-001) | see git log |
| T7 | S5, S6 in Go (+ tests, parity tree, docs) | delegated (writer trigger a: parallel with T6) | pending | |

## Log
- L1 (2026-11-12) user: "en los dos proyectos agrega una pregunta si se quiere integrar base de datos y si acepta de las opciones de Mysql, SQLlITE, PosgreSql y MongoDB. Tambien Divide las preguntas de DOCKERfILE y MakeFile."
- L2 (2026-11-12) user on Mongo scope: "Recuerda que lo que hace con sql es la conexion a BD no subes" → Mongo = connection only, like SQL.
- L3 (2026-11-12) user on combinations: "Makefile exige Docker".
- L4 Route: T1 inline (about 100 lines of shared templates). T2 and T3 are independent units in separate repos with disjoint surfaces, each several hundred lines, so writer trigger (a) fires and they run in parallel after T1.
- L5 (2026-11-12) user: "puede haber Docker sin base de datos y Docker puede tener frontend" → already covered: DB "no" → none; Docker/Makefile questions apply to every stack, DB question skipped for frontend.
- L6 Seam check: Node verify.sh OK; Go go vet + go test ./... OK; feature strings byte-identical in both repos. Parity fix: Go doctor suggested `make new-app` without a Makefile; now uses `makefile` like Node. Go spec doc is docs/guias/02 (not docs/spec), ported by parent, including the missing --no-docker row. Next: user approval for commits.
- L7 (2026-11-12) review finding R1/R3 (rerun with db auto re-asks; if the agent already ran infra.sh, infra fails with `compose.db.yaml ya existe con otro contenido`). User: "si, arreglá eso". S1 rewritten: the database question is asked only on the first run (no manifest). T4 reopened for this fix in both repos.
- L8 (2026-11-12) Grill on review follow-ups 1-3: Q1 "db + usuario real", Q2 "Asumir sí + 1 función", Q3 "Campo dbs en stack.json", Q4 "Sí, error de uso", Q5 "Sumar a los PR #12", Q6 "Ese texto", Q7 "Respetarlo", Q8 "30s". User: "si, arrancá".
