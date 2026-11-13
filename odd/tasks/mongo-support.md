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

### S6 · Review advisories on ffbc157, eb4164c and 62922c3
User: "sigue con las advertencias".
- S6.1 Upgrade path for old Mongo volumes (R4-mongo-overlay-existing-volume, R3-003). A `db-data` volume created by the old overlay (root = `DB_USER` in `admin`, no app user in `DB_NAME`) never turns healthy with the new overlay, and the init script does not rerun. The infra-setup `SKILL.md` gives an exact, copy-pasteable procedure (and the overlay a short comment pointing to it): it creates the app user in `DB_NAME` with the OLD root credentials through `docker compose exec db mongosh …`, using the container's env vars, and says it applies to projects whose volume was created before this change. No new machinery in `infra.sh`. Proved with real Docker: old overlay → new overlay (healthcheck fails) → procedure → healthy, app user reads and writes.
- S6.2 `syncIndexes()` drops undeclared indexes in prod (R4-syncindexes-drops-prod-indexes, R1-001). The generated `src/mongo/sync-indexes.ts` only creates the declared indexes (`Model.createIndexes()`), never drops; its output says how many models were synced. nest-patterns, data-writer and the stack doc say that removing an index from a schema does not drop it, and how to drop it by hand.
- S6.3 Stale texts. `docs/spec/05_bootstrap_bd_auth.md` (MongoDB row) and infra-setup `SKILL.md` say NestJS ships the Mongoose wiring and other stacks offer mongo only when their stack.json lists it. The compose.yaml migrate fallback names both sources: `Sin prisma/schema.prisma ni src/mongo/sync-indexes.ts: nada que migrar`. `docs/stacks/nestjs.md` stays consistent.
- S6.4 Missing tests (R3-001, R3-002): the `make new-app` failure path (exits non-zero, no package.json or package-lock.json, a retry runs again), and the contract marker stripping in scaffold.sh (mongo keeps the Mongoose section and drops the Prisma one and every marker; postgres the reverse).
- S6.5 Readability (R2-mongo-migration-dc-override): the Mongo `make migration` message gets its own variable (`MONGO_MIGRATION_MSG`) and a one-line comment on the target-specific override. Output byte-identical.
- Risk: item 1 is touched only by documentation (a manual procedure on existing data, proved with Docker); S6.2 removes an automatic drop, which reduces risk.

### S7 · Phase 3: FastAPI with Beanie
User: "Siguiente stack con Mongo", then "FastAPI + Beanie (Recommended)" (2026-11-13).
- Same shape as S4. The starter stays SQL (SQLAlchemy + Alembic): basekit copies it before `infra.sh` sets the database. The Mongo variant is applied on `make new-app` (before `uv lock`), like NestJS's `app-setup.sh`, when the overlay that infra-setup activated is MongoDB (`DB_DRIVER=mongodb`). The CLI code does not change.
- The Mongo variant:
  - dependencies: `beanie` (exact version, at least 14 days old) instead of `sqlalchemy`, `alembic`, `psycopg` and `pymysql`; no `alembic/` nor `alembic.ini`;
  - `src/core/config.py` reads `MONGO_URL` (required at startup with a clear message, like `DATABASE_URL`);
  - `src/core/db.py` initializes Beanie in the FastAPI lifespan with the document models of `src/modules/*/models.py`. Index creation follows S6.2: create only, never drop. Indexes are created at startup in dev and by `make migrate` in prod;
  - `conftest.py` and the tests stay deterministic under `make test` / `make verify`.
- `scaffold.sh` (per module) writes, for Mongo, a Beanie `Document` in `models.py` instead of the SQLAlchemy model. The id is a UUID string, as in NestJS.
- Migrations:
  - `make migrate` (the `migrate` service) creates the declared indexes instead of `alembic upgrade head`;
  - `make migration` prints that Mongo has no migrations, the same way as NestJS's `MONGO_MIGRATION_MSG`.
- Agent docs: py-patterns, py-scaffold (`SKILL.md`, `contract.md`), py-verify, the roles, `AGENTS.section.md`, the zones and `docs/stacks/fastapi.md` describe the Beanie variant next to SQLAlchemy.
- fastapi's `dbs` becomes `["postgres", "mysql", "sqlite", "mongo"]` **only after** `scripts/e2e.sh fastapi mongo` passes for real. It joins the CI matrix (S3), and the stack name says Beanie is available.
- Risk: item 5 (new dependency versions). The SQL path must stay byte-identical.

### S8 · Review advisories on 4e6cdbc (FastAPI + Beanie)
User: "arreglá las advertencias en los dos".
- S8.1 `mongo-setup.sh` never overwrites a file the user changed: it replaces a starter file only while it is still the untouched starter (or keeps a backup and says so); otherwise it stops with a clear message and changes nothing. The docs describe the real behavior.
- S8.2 `make migrate` never reports success when there is nothing it can run: with neither `alembic.ini` nor the index script, the migrate service fails with a clear message.
- S8.3 One Mongo detection: stack.mk, mongo-setup.sh and scaffold.sh read `DB_DRIVER` with the same exact match.
- S8.4 The Alembic guard does not depend on `find | grep -q` under `pipefail`.
- S8.5 Readability and robustness: the Mongo `pyproject.toml` is derived from the starter instead of a full hand copy (or the duplication is removed another way); the `DC` override's coupling to the core Makefile recipe is pinned by a test; `_new-app` does not fail on a SQL project whose skills folder is missing.
- The SQL path's generated files stay byte-identical.

### S9 · The remaining stacks, with the recommended libraries
User: "sigue con los demas stack", then "Usar las recomendadas (Recommended)" (2026-11-13).
- Flask and python-native: PyMongo. Express, Next.js and node-native: Mongoose. Spring: Spring Data MongoDB. Gin and go-native: `mongo-driver` v2. Laravel: `mongodb/laravel-mongodb`. Symfony: Doctrine MongoDB ODM. php-native: `mongodb/mongodb`. Django and django-htmx stay on SQL.
- Each stack follows S4/S7's shape and S6.2/S8 (create-only indexes, no silent overwrite, `make migrate` and `make migration` with Mongo, agent docs, a template test). Its `dbs` lists `mongo` and it gets a CI row only after its real `scripts/e2e.sh <stack> mongo` passes and `scripts/e2e.sh <stack> postgres` still passes. Exact dependency versions, each at least 14 days old.
- `scripts/e2e.sh` accepts `BASEKIT_E2E_PORT=<port>`, like basekit-go, so parallel runs and a busy default port work.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1n | S1 + S3 (e2e.sh accepts mongo) in Node | delegated (writer trigger a: parallel with T1g and T2) | done. RED→GREEN per rule (13 RED). verify OK; the parent's seam check with T2 together is also OK. Differential: only `--db mongo` and the help lines change. | uncommitted |
| T1g | S1 + S3 (e2eDB accepts mongo) in Go | delegated (writer trigger a: parallel with T1n and T2) | done. RED→GREEN per rule. make verify OK except the expected parity test (the manifest is regenerated in T5). Windows vet OK. Differential: only `--db mongo` and the help lines change. Extra: e2eDB skips an engine the stack does not accept. | uncommitted |
| T2 | S2 in Node `plantillas/skills/infra-setup` (copied to Go by the parent) | delegated (writer trigger a: parallel with T1n and T1g) | done. RED→GREEN in infra.test. Real Docker proof: healthy on first start; the app user reads and writes `app`; `other`/`admin` are Unauthorized; root logs in; restart healthy and the init script does not rerun. Compose ≥ 2.23.1. | uncommitted |
| T4 | S4 NestJS (templates; real e2e with Docker), then the CI entry (S3) in both repos | delegated, after T1n/T1g/T2 | done. RED→GREEN in tests/plantillas/nestjs-mongo.test.ts and ci.test. Real Docker: `e2e.sh nestjs mongo` OK; a module writes and reads through the API; `make migrate` creates the indexes in dev and in prod (uid 1001); `e2e.sh nestjs postgres` OK. `e2e.sh --prod` hit the user's own server on port 3000, so it was reproduced by hand on 3999 and passed. @nestjs/mongoose 12.0.0, mongoose 9.11.4. | uncommitted |
| T5 | Parent: copy plantillas to Go, regenerate the parity manifest, seam check, cross-implementation run | inline | done. 20 template files copied; parity manifest regenerated from the Node working tree (it must be regenerated from the commit). Go make verify OK, windows vet OK. Node verify OK. Same 6 scenarios on both CLIs: identical. Go real e2e: see L5. | uncommitted |
| T6 | S6 (Node `plantillas/`, docs and tests; the parent ports the templates to Go) | delegated (review-advisory batch) | done. RED→GREEN: createIndexes test, fallback-message test, MONGO_MIGRATION_MSG test (byte part green before and after). The new-app failure test and both contract-marker tests already passed on 62922c3. verify OK. Real Docker: the upgrade procedure, run verbatim from SKILL.md in zsh, took an old-overlay volume from failing auth to healthy; manual dev flow on APP_PORT=3998 (3000 busy): `make migrate` recreated a declared index and kept a hand-made one. | uncommitted |
| T7 | S7 FastAPI + Beanie (Node templates, tests, docs, real e2e, CI row); the parent ports to Go | delegated (context backstop: the parent session is past ~150k) | done. RED→GREEN: tests/plantillas/fastapi-mongo.test.ts (15 RED, then GREEN; the SQL guards passed before and after) and ci.test (fastapi lists mongo). verify OK. Real Docker: `e2e.sh fastapi mongo` OK (scratch copy with dbs, then the real repo); `e2e.sh fastapi postgres` OK; a module writes and reads through the API against MongoDB; `make test`/`make verify` OK with the in-memory DB; `make migrate` dev recreates a declared index and keeps a hand-made one; prod: migrate runs as uid 1001 and creates the index, prod startup does not; SQL `make migrate` still runs Alembic. Differential: SQL app code identical; only agent docs, stack name, stack.mk, compose.yaml and the new script change. beanie 2.2.0, pymongo 4.19.0, pymongo-async-mock 0.1.3, mongomock 4.3.0. | feat(fastapi): support MongoDB with Beanie |
| T8 | S8 FastAPI advisories (Node; parent ports to Go) | delegated (parallel with T9–T13, disjoint surfaces) | done. RED: 15 tests (the S8.4 RED exposed a real bug in 4e6cdbc: with many revisions `find | grep -q` hit SIGPIPE and the script deleted alembic/). GREEN 34/34. Differential: SQL app files byte-identical and make/scaffold output identical. e2e fastapi mongo and postgres on 8101 OK; API write/read, dev migrate keeps a hand-made index, prod migrate as uid 1001. Ported to Go by the parent. | 145a8ce |
| T9 | S9 Flask + python-native (PyMongo) | delegated (parallel) | done. PyMongo 4.19.0 (2026-10-14), mongomock 4.3.0 (dev). RED 29/30 → GREEN 33/34. e2e flask and python-native, mongo and postgres, on 8102: OK. API write/read dev and prod; dev indexes on first use; prod migrate as uid 1001. SQL app files byte-identical. | 0522875 |
| T10 | S9 Express + node-native + Next.js (Mongoose) | delegated (parallel) | done. mongoose 9.11.4 (2026-10-23), tsx 4.23.15. RED 12/12/11 → GREEN 16/16/14. e2e express, node-native, nextjs, mongo and postgres, on 8103: OK. API write/read, dev autoIndex, prod migrate as uid 1001. Starter code byte-identical. express/node-native `make migrate` with no database now fails (S8.2). | cc19a97 |
| T11 | S9 Gin + go-native (mongo-driver v2) | delegated (parallel) | done. mongo-driver v2.9.2 (2026-10-06). RED 16/18 → GREEN 42. e2e gin and go-native, mongo and postgres, on 8104: OK. API write/read dev and prod; `api migrate` creates, never drops; prod as 1001:1001. SQL app code byte-identical. | a88d236 |
| T12 | S9 Laravel + Symfony + php-native | delegated (parallel) | done. laravel-mongodb 5.12.0, mongodb/mongodb 2.5.0, doctrine/mongodb-odm 2.17.4, odm-bundle 5.6.1, PECL mongodb 2.5.5 (Mongo images only). RED 14/15/18 → GREEN 19/19/21. e2e laravel, symfony, php-native, mongo and postgres, on 8105: OK. Laravel keeps migrations (index-only stubs); RefreshDatabase cannot drop the database as the app user, so tests truncate. Fixed php-native scaffold.sh writing 0600 files (prod uid 1001 got 500). | 1605ae4 |
| T13 | S9 Spring (Spring Data MongoDB) | delegated (parallel) | done. Spring Boot 4.1.2 BOM (Spring Data MongoDB 5.1.2, driver 5.8.1). RED 14 → GREEN 18. e2e spring mongo and postgres on 8106: OK. Boot 4 needs spring.mongodb.uri mapped from SPRING_DATA_MONGODB_URI; prod migrate via compose.mongo-migrate.yaml (Compose 2.24+). | 290c214 |
| T14 | Parent: e2e.sh BASEKIT_E2E_PORT, shared files (ci.yml, ci.test, README, docs/spec, infra-setup SKILL.md), Go port, parity, commits per stack | inline | done. e2e.sh BASEKIT_E2E_PORT with a test (RED on the base script). Shared files: 13 CI mongo rows in both repos, ci.test list, prompt/init/stacks tests moved off flask and spring, README, docs/spec 02/04/05, infra-setup SKILL.md. Go: templates and guides ported, Go tests moved to django and the new spring engines, flask/python-native missing-script message aligned (no CLI name) so parity holds. Node verify OK (seam). | 3c49a68 + docs commit |
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
- L7 (2026-11-13) User: "sigue con las advertencias". T6 decisions (writer):
  - The upgrade procedure also creates `root` with `DB_ROOT_PASSWORD` and then drops the old root (`DB_USER` in `admin`), because the old root shares the app's password. If `DB_USER` is `root`, the first step fails on the root creation and the drop step fails on auth, so nothing is lost.
  - The procedure's bash block has no inline comments: zsh without `interactivecomments` would pass them as arguments.
  - `make migration` with Mongo overrides `MIGRATION_NAME_CHECK = :` for that target, since the core Makefile skips the NAME check only when `NO_DB_MSG` is set.
  - `e2e.sh nestjs mongo` was not run: the user's server holds port 3000. The dev flow was reproduced by hand on APP_PORT=3998.
- L8 (2026-11-13) PR #16 merged to main in both repos; dev/farid fast-forwarded to it. User: "Siguiente stack con Mongo", then "FastAPI + Beanie (Recommended)".
- L9 (2026-11-13) T7 decisions (writer):
  - `py-scaffold/scripts/mongo-setup.sh` runs on the host as the first line of `_new-app` (silent unless `DB_DRIVER: mongodb`, so the SQL `make new-app` output is unchanged). It replaces a starter file only if it lacks the Beanie marker, removes `alembic/` and `alembic.ini`, and stops (exit 2, nothing touched) if `alembic/versions` has revisions.
  - Versions: `beanie==2.2.0` (2026-08-07) and `pymongo==4.19.0` (2026-10-14), pinned because uv would otherwise resolve pymongo 4.20.0 (2026-11-12, one day old).
  - Tests: mongomock-motor 0.0.36 does not work with Beanie 2 (it calls `list_collection_names(authorizedCollections=…)`). The dev group uses `pymongo-async-mock==0.1.3` (2026-03-05, MIT, small and audited: no network or exec) and `mongomock==4.3.0` (2024-11-16), plus a 4-line shim in conftest.py for that call. `make verify` runs with `--no-deps` and the app user can only write `DB_NAME`, so a real MongoDB for tests would clobber dev data. Open question for the user: a less known dev dependency vs. a separate test database (which needs an overlay change).
  - `id: str` (UUID text `_id`, like NestJS). `Decimal` fields need `beanie.DecimalAnnotation` (Decimal128 round trip), documented in py-patterns and the stack doc.
  - Indexes: `init_beanie(..., allow_index_dropping=False)`; dev creates them at startup, prod skips them (`skip_indexes`) and `make migrate` runs `python -m src.core.create_indexes`. An index whose options changed fails at startup and in migrate with `OperationFailure` (verified with mongo:8.0); the docs say to drop it by hand first.
  - Stack name: "Python · FastAPI + SQLAlchemy 2 o Beanie (MongoDB) + Pydantic v2". Zones unchanged: `src/core/**` already covers `create_indexes.py`.
- L10 (2026-11-13) User, on the in-memory test database: "Mantener el mock (Recommended)" (pymongo-async-mock 0.1.3, dev only).
- L11 (2026-11-13) Parent Go port: templates copied (stack.mk keeps the Go CLI text `basekit init`), CI row added, docs/guias 04, 05 and stacks/fastapi.md synced, parity manifest regenerated from the Node working tree (regenerate from the commit). Two Go tests used fastapi as the stack without mongo; they now use flask (TestE2EDBPrecedence, TestDBQuestionYesChoosesEngine). Go `make verify`: OK. Go real e2e `BASEKIT_E2E_STACK=fastapi BASEKIT_E2E_DB=mongo`: PASS (21s). Node and Go `init fastapi --db mongo|postgres`: same output apart from the CLI text and a pre-existing `.gitattributes` line order (also on flask).
- L12 (2026-11-13) Review of 4e6cdbc/decd8a3 approved and acknowledged (review-94fb26f5c8469d19, review-233916e276624558); advisories become S8. User: "uninstall --skills dejalo como esta", then "arreglá las advertencias en los dos y sigue con los demas stack", then "Usar las recomendadas (Recommended)".
- L13 (2026-11-13) All six writers returned OK. Open choices kept as reported: Laravel creates indexes through migrations (its native way) instead of the migration message; the php-native 0600→0644 fix stays in the PHP unit.
