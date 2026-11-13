# mongo-support

Objective: make `--db mongo` produce a project that works, stack by stack, in basekit (Node) and basekit-go (identical `plantillas/`). Mongo is offered only where it is proven by an e2e.
Branch: `dev/farid` in both repos. Commits and pushes only with the user's approval. Runners: `bash .agents/skills/cli-verify/scripts/verify.sh` (Node), `make verify` (Go), `scripts/e2e.sh <stack> mongo` / `make e2e STACK=<id> DB=mongo` (real Docker).
Status: user go-ahead for T1–T4: "si" (2026-11-12).

## Specs

### S1 · Phase 0: Mongo is opt-in per stack
User: "arranquemos como ibamos" (after the plan: phase 0, phase 1, then one stack at a time, NestJS first).
- A stack.json without `dbs` accepts `postgres`, `mysql` and `sqlite`. `mongo` is accepted only when a stack lists it in `dbs`. Today the default is all four (Node `src/kit/stacks.ts:66-71`, Go `internal/stack/stack.go:141-146`).
- Spring loses `mongo` from its `dbs` (it uses JPA/Flyway, so Mongo does not work there today). Its `dbs` becomes `["postgres", "mysql"]`.
- Effect: until S4 lands, no stack offers MongoDB in the `¿Qué base de datos?` menu. `--db mongo` is the existing usage error, for example `--db 'mongo' no aplica a flask: motores admitidos: postgres, mysql, sqlite (o auto, none)`.
- `infra.sh --db mongo` and `compose.mongo.yaml` stay: they are the shared groundwork.
- Help, README and CLI spec say Mongo is available only on the stacks that list it. The `--db` help lines become, identical in both CLIs:
  ```
    --db <motor>            auto | postgres | mysql | sqlite | mongo | none (por defecto: auto;
                            un stack frontend solo admite auto o none; los demás, los motores de su
                            stack.json (dbs; si falta, postgres, mysql y sqlite: mongo solo si el
                            stack lo lista); en un combinado, va al backend)
  ```
- Risk: item 3. This changes an accepted value of a released CLI (v0.3.0). It is requested.

### S2 · Phase 1: Mongo app user with least privilege
- `compose.mongo.yaml` creates two users:
  - a root user `root` with `DB_ROOT_PASSWORD`;
  - the app user `DB_USER`/`DB_PASSWORD` with `readWrite` only on `DB_NAME`, created by an init script on the first start.
- The app URLs (`DATABASE_URL`, `MONGO_URL`, `SPRING_DATA_MONGODB_URI`) use the app user with `authSource=${DB_NAME}`.
- The init script lives inside the same overlay file (a Compose `configs` entry with inline `content`, mounted at `/docker-entrypoint-initdb.d/`), so `infra.sh` still places one file. This needs Docker Compose 2.23.1 or newer; local is v5.6.1.
- The `.env.example` block adds `DB_ROOT_PASSWORD=__GENERATE__`.
- The healthcheck authenticates as the app user, so it passes only when that user exists (it keeps the first-boot race fix).
- `make db-shell` keeps working, with the app user.

### S3 · Phase 1: e2e with Mongo
- `scripts/e2e.sh` accepts `mongo`, and Go's `e2eDB` accepts `BASEKIT_E2E_DB=mongo`.
- The CI matrix gets `<stack> + mongo` (dev) for each stack whose `dbs` lists `mongo`. The CI tests (`tests/ci.test.ts`, Go `ci_test.go`) enforce it.

### S4 · Phase 2: NestJS with @nestjs/mongoose
User: "@nestjs/mongoose (Recommended)".
- `app-setup.sh` gets a `mongodb` branch, with no Prisma:
  - it installs `@nestjs/mongoose` and `mongoose` (exact versions; `npm_config_before` already enforces 14 days);
  - `src/app.module.ts` imports `MongooseModule.forRootAsync` with `MONGO_URL` (required, like `requireEnv`);
  - Mongoose `autoIndex` is on in dev and off in prod.
- `scaffold.sh` (per module) generates, for Mongo, a `@Schema` class plus `SchemaFactory` and a repository on the injected Model, instead of the Prisma repository.
- Migrations:
  - `make migrate` runs a script that syncs the declared indexes (`syncIndexes`) instead of `prisma migrate deploy`;
  - `make migration` explains that Mongo has no migrations: indexes are declared in the schemas.
- Agent docs: nest-patterns, nest-scaffold (`SKILL.md`, `contract.md`), nest-verify (`prisma generate` only when there is a Prisma schema), the roles (data-writer, web-writer, logic-writer, qa-writer), `AGENTS.section.md` and the zones describe the Mongo variant next to Prisma.
- nestjs's `dbs` becomes `["postgres", "mysql", "sqlite", "mongo"]` **only after** `scripts/e2e.sh nestjs mongo` passes for real. It joins the CI matrix (S3).
- The health endpoint does not touch the database. Nest waits for `MongooseModule` to connect before it listens, so a passing healthcheck proves the connection.

### S5 · Later stacks (each one asked first)
User: "dame mas opciones ... y preguntame antes de hacerlo".
- The option per stack is chosen by the user before work starts. Recommendations given on 2026-11-12:
  - FastAPI: Beanie
  - Flask and python-native: PyMongo
  - Express, Next.js and node-native: Mongoose or the `mongodb` driver
  - Spring: Spring Data MongoDB
  - Gin and go-native: `mongo-driver` v2
  - Laravel: `mongodb/laravel-mongodb`
  - Symfony: Doctrine MongoDB ODM
  - php-native: `mongodb/mongodb`
  - Django and django-htmx: stay on SQL
- Each stack follows S4's shape: scaffold branch, index sync, agent docs, `dbs` plus CI only after its e2e passes.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1n | S1 + S3 (e2e.sh accepts mongo) in Node | delegated (writer trigger a: parallel with T1g and T2) | done. RED→GREEN per rule (13 RED). verify OK; the parent's seam check with T2 together is also OK. Differential: only `--db mongo` and the help lines change. | uncommitted |
| T1g | S1 + S3 (e2eDB accepts mongo) in Go | delegated (writer trigger a: parallel with T1n and T2) | done. RED→GREEN per rule. make verify OK except the expected parity test (the manifest is regenerated in T5). Windows vet OK. Differential: only `--db mongo` and the help lines change. Extra: e2eDB skips an engine the stack does not accept. | uncommitted |
| T2 | S2 in Node `plantillas/skills/infra-setup` (copied to Go by the parent) | delegated (writer trigger a: parallel with T1n and T1g) | done. RED→GREEN in infra.test. Real Docker proof: healthy on first start; the app user reads and writes `app`; `other`/`admin` are Unauthorized; root logs in; restart healthy and the init script does not rerun. Compose ≥ 2.23.1. | uncommitted |
| T4 | S4 NestJS (templates; real e2e with Docker), then the CI entry (S3) in both repos | delegated, after T1n/T1g/T2 | done. RED→GREEN in tests/plantillas/nestjs-mongo.test.ts and ci.test. Real Docker: `e2e.sh nestjs mongo` OK; a module writes and reads through the API; `make migrate` creates the indexes in dev and in prod (uid 1001); `e2e.sh nestjs postgres` OK. `e2e.sh --prod` hit the user's own server on port 3000, so it was reproduced by hand on 3999 and passed. @nestjs/mongoose 12.0.0, mongoose 9.11.4. | uncommitted |
| T5 | Parent: copy plantillas to Go, regenerate the parity manifest, seam check, cross-implementation run | inline | done. 20 template files copied; parity manifest regenerated from the Node working tree (it must be regenerated from the commit). Go make verify OK, windows vet OK. Node verify OK. Same 6 scenarios on both CLIs: identical. Go real e2e: see L5. | uncommitted |

## Log
- L1 (2026-11-12) User: "si decido usar bd en un proyecto, estan son sus opciones, qu debo hacer con mongo para funcione?", then "cual es la mejor forma de implementarlo?", "y con flask?", and "arranquemos como ibamos y dame mas opcopnes par mantener con mongo segun el lenguaje y framer y preguntame antes de hacerlo". NestJS choice: "@nestjs/mongoose (Recommended)".
- L2 Map (explorer):
  - nestjs `app-setup.sh:31-37` has no `mongodb` case and exits 2 inside `make new-app`, leaving Nest's files behind.
  - Express has its own copy of the same pattern (`express-scaffold/scripts/app-setup.sh:24-32`).
  - Only spring declares `dbs`, and it includes mongo.
  - `e2e.sh:16` and Go `docker_test.go:87-88` reject mongo.
  - The Go parity test compares against `internal/stack/testdata/node-plantillas.tree`, which must be regenerated after template changes.
- L3 Parent decisions (technical):
  - S1 changes the default instead of adding `dbs` to every stack.json, so a future stack cannot offer Mongo by accident.
  - S2 keeps one overlay file through Compose `configs.content`.
- L4 T4 decisions (writer, accepted by the parent):
  - `autoIndex` is `NODE_ENV !== 'production'`.
  - New files: `src/mongo/mongo.module.ts` and `src/mongo/sync-indexes.ts` (built to `dist/mongo/sync-indexes.js`, which calls `syncIndexes` on every model).
  - Per module: `<m>.model.ts` with `<Pascal>Entity`, using UUID string `_id`s, so the contract and ParseUUIDPipe stay the same.
  - With Mongo, `make migration` prints the message without a NAME check.
  - A failed `make new-app` removes package.json so it can be retried.
  - The stack's name was not changed (it would change `stacks` and the menu output).
- L5 Go real e2e (`BASEKIT_E2E_STACK=nestjs BASEKIT_E2E_DB=mongo`, TestDevAnswersHealthcheck) failed twice with `http://localhost:3000/health no respondió 200 en 5 minutos (último error: <nil>)`. The cause is environmental, not the change:
  - The app logs show Nest booted and mapped `GET /health`.
  - The container publishes `127.0.0.1:3000`, while the user's own `next-server` (PID 18676) listens on `*:3000` and answers `/health` with 404 on both `localhost` and `127.0.0.1`. So the test reached the wrong server; "último error: <nil>" means it got a non-200 HTTP reply.
  - Pending: rerun with port 3000 free.
- L6 (2026-11-13) User: "ponlo en otro puerto".
  - Added the test-only `BASEKIT_E2E_PORT` to Go's dev and prod e2e. It exports `APP_PORT`, which Compose prefers over the `--env-file` value, and polls that port. `TestE2EPortOverride` covers it, and the README documents it. stack.json and the templates are unchanged.
  - Rerun with `BASEKIT_E2E_PORT=3999`: `--- PASS: TestDevAnswersHealthcheck/nestjs (50.30s)`.
