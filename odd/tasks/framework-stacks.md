# framework-stacks

Objective: `init` asks the language and then the framework, with 5 new stacks (django, flask, nestjs, express, symfony). Branch: `dev/farid` (no commits without user approval). Delivery: `ask-on-risk`. Runner: `npm test` (node:test via `dist/`).

## Specs

- **S1** Preguntas de `init`: "quiero que las qpreguntas que haga especifique si tambine se va a ser en un framework eb especifico? ejemplo: python; (apirest, django o flask)". Node asks Lenguaje → Template (framework), like Go. Each template label names the framework and the kind of app (for example "API REST").
- **S2** Stack `django` (Python): complete per the stack contract (stack.json, AGENTS.section.md, roles/, zones/, 3 skills, files/, starter or `new-app`, docs/stacks/django.md).
- **S3** Stack `flask` (Python): same contract.
- **S4** Stack `nestjs` (TypeScript): same contract.
- **S5** Stack `express` (TypeScript): same contract. No automatic detection (chosen by question or `--stack`), so it never takes over NestJS or Next.js projects.
- **S6** Stack `symfony` (PHP): same contract.
- **S7** Existing projects keep being detected as before (fastapi, nextjs, laravel, spring).
- **S8** Tests, docs, help and CI that list stacks are updated in Node.
- **S1b** "algo que quiero que haga es que esto no es estrictamente backend, debe ser backend, frontend y fullstack". Each stack.json declares `kind`: `backend` | `frontend` | `fullstack`. Node init asks Tipo → Lenguaje → Template; a step with one option is picked automatically, as Go does today. Classification:
  - backend: fastapi, django, flask, nestjs, express, spring, symfony
  - fullstack: nextjs, laravel
  - frontend: react
  A frontend stack has no database: init rejects `--db` other than `auto`/`none` and `--redis` for it.
- **S10** Stack `react` (TypeScript, frontend): React + Vite, an SPA served by nginx (non-root) in prod. User choice: "React + Vite (Recommended)".
- **S11** "en frontend agrega tambien Vue". Stack `vue` (TypeScript, frontend): Vue 3 + Vite, an SPA, mirroring `react`.
- **S12** "t akinea los prisma segun sea convientes para cada uno". Decision: express moves to Prisma 7, pinned exactly like nestjs (7.10.1), with one driver adapter per database chosen from `DB_DRIVER`. Reason: Prisma 7 is the current major, nestjs already uses it with the three databases, and express's `prisma@6` was not pinned exactly (repo rule). nextjs pins no Prisma version.
- **S13** "en backend agre Go". Stack `gin` (language Go, kind backend): Gin, an API REST. Gin was picked by the orchestrator as the most used Go web framework. It is the first Go language stack.
- **S14** "Tambien pùedes estructurar el proyecto nativo, sin framwork". User choice: "Go: net/http (Recommended), TypeScript: node:http (Recommended), Frontend: TypeScript + Vite, PHP y Python nativos". Native means no web framework; DB libraries, migration tools and a production app server are allowed. Native stacks have empty `detect` (they cannot be told apart reliably). Stacks:
  - `go-native` (backend, net/http)
  - `node-native` (backend, node:http + TypeScript)
  - `vanilla-ts` (frontend, DOM + Vite)
  - `php-native` (backend, PDO)
  - `python-native` (backend, WSGI)
- **S15** "sí, agrega Django + HTMX como fullstack integrado". Stack `django-htmx` (Python, kind fullstack): Django server-rendered templates + HTMX, with no SPA, no Node and no JS build. It has `detect: {}`: `django` (manage.py) is tried first in id order, so auto-detection would never be reached, and narrowing django would change existing projects (S7).
- **S9** Go parity: basekit-go (`~/Documents/project-guiade`) gets the same feature once Node is done (L31): byte-identical `plantillas/` (except the CLI text), the Tipo → Lenguaje → Framework question, frontend without DB, Combine, tests, docs and CI.

Selected scope (user choice): "Set base (Recommended)": Python: Django + Flask · TypeScript: NestJS + Express · PHP: Symfony.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S2 | delegated (parallel writer, `plantillas/stacks/django/`) | done (no Docker e2e yet) | init with postgres, mysql and sqlite + redis OK; make help 28 targets; zone-check 0 unowned; venv: ruff, mypy, django check, pytest OK; commit 5fb6f42 |
| T2 | S3 | delegated (parallel writer, `plantillas/stacks/flask/`) | done (no Docker e2e yet) | init with postgres, mysql and sqlite + redis OK; make help 27 targets; compose config OK; zone-check 0 unowned; fastapi/flask detection OK; commit dc07af5 |
| T3 | S4 | delegated (parallel writer, `plantillas/stacks/nestjs/`) | done (no Docker e2e yet) | init with the 3 databases + redis OK; make help 26 targets; zone-check 0 unowned; nest new + /health + Prisma sqlite replayed on the host; commit a03b165 |
| T4 | S5 | delegated (parallel writer, `plantillas/stacks/express/`) | done (no Docker e2e yet) | init with postgres, mysql and sqlite + redis OK; make help 27 targets; zone-check 0 unowned; `detect: {}` never matches (stacks.ts:58-60); real npm build + /health OK; commit 7464c0f |
| T5 | S6 | delegated (parallel writer, `plantillas/stacks/symfony/`) | done (static checks only; no PHP or Docker here) | init with the 3 databases OK; make help 26 targets; zone-check 0 unowned; PHP code never run; commit b342291 |
| T9 | S10 | delegated (parallel writer, `plantillas/stacks/react/`) | done (no Docker e2e yet) | init --db none OK; make help 26 targets; migrate prints no-db message and exits 0; zone-check 0 unowned; commit 4443467 |
| T10 | S11 | delegated (parallel writer, `plantillas/stacks/vue/`) | done (no Docker e2e yet) | init --db none OK; make help 26 targets; zone-check 0 unowned; host replay: vue-tsc + eslint + vitest OK, /health 200; commit 4fb394d |
| T11 | S12 | delegated (parallel writer, `plantillas/stacks/express/`) | done (no Docker e2e yet) | Prisma 7.10.1 + one adapter per DB_DRIVER; host replay of sqlite/postgres/mysql/no-DB passes verify; no `prisma@6` left; commit 7464c0f |
| T12 | S13 | delegated (parallel writer, `plantillas/stacks/gin/`) | done (no Docker e2e yet) | init with the 3 databases + redis OK; make help 27 targets; zone-check 0 unowned; go1.27.3: build, vet, verify, /health, healthcheck, sqlite migration + query OK; commit 721172e |
| T13 | S14 | delegated (parallel writer, `plantillas/stacks/python-native/`) | done (no Docker e2e yet) | init with the 3 databases + redis OK; make help 27 targets; zone-check 0 unowned; venv: verify + alembic + gunicorn /health OK, example module 4/4; commit 0864bd9 |
| T14 | S14 | delegated (parallel writer, `plantillas/stacks/php-native/`) | done (static checks only; no PHP on host) | init with the 3 databases + redis OK; make help 28 targets; zone-check 0 unowned; deps-add rejects injection; PHP code never run (T7); commit f941b33 |
| T15 | S14 | delegated (parallel writer, `plantillas/stacks/vanilla-ts/`) | done (no Docker e2e yet) | init --db none OK; make help 26 targets; zone-check 0 unowned; host replay: tsc + eslint + vitest OK, /health 200, SPA fallback OK; commit 5c7701d |
| T16 | S14 | delegated after T12 (gin), `plantillas/stacks/go-native/` | done (no Docker e2e yet) | init with the 3 databases + redis OK; make help 27 targets; zone-check 0 unowned; go1.27.3: build, vet, verify, static binary, /health, 404/405 as JSON, sqlite migrate, example module OK; commit 8644b48 |
| T17 | S14 | delegated after T11 (express Prisma 7), `plantillas/stacks/node-native/` | done (no Docker e2e yet) | init with postgres/mysql/sqlite/none OK; make help 27 targets; zone-check 0 unowned; host replay of all 4 passes verify (11 tests); /health, 404, 405, 400, 413, 415 and SIGTERM OK; commit bccc9c1 |
| T18 | S15 | delegated (parallel writer, `plantillas/stacks/django-htmx/`) | done (no Docker e2e yet) | init with the 3 databases + redis OK; make help 28 targets; zone-check 0 unowned; venv: verify OK, 17 tests (partial vs full, CSRF, OOB, login); gunicorn prod /health + SRI + CSP OK; commit adb74c6 |
| T6a | S1, S1b, S7, S8 | delegated (context backstop) | done | verify.sh OK (parent rerun); owners 579/0; differential vs HEAD: only the requested differences; integration commit |
| T6b | S1b (Combine, L11) | delegated after T6a | pending | |
| T7 | S2-S6 | per-action worker (Docker e2e per stack, run one at a time) | pending | |
| T8 | S9 | after T6b: implement in basekit-go (route decided when it starts) | pending | |

## Log

- **L1** (2026-11-09) User: "quiero que las qpreguntas que haga especifique si tambine se va a ser en un framework eb especifico? ejemplo: python; (apirest, django o flask)"
- **L2** (2026-11-09) User: "agrega otras opcioones y otros framwork segun el lenguaje". Choice: "Set base (Recommended)".
- **L3** Map:
  - Detection takes stacks in id order and the first match wins, with no specificity rule.
  - Only Go asks for the language; Node shows a flat list.
  - Go embeds `plantillas/` with `go:embed all:stacks`, so new stacks need no Go code change, but the Go wizard tests assume one template per language.
  - `defaultAuth` and the stack.json `roles` field are not read by any code.
- **L4** Decision: express has an empty `detect`. With `contains: "express"` it would match NestJS (`@nestjs/platform-express`) and Next.js projects that use Express, which breaks S7.
- **L5** T1-T5 launched in parallel (zone-check snapshot taken first). T6 waits for them, because recompiling `dist/` while writers run `dist/src/cli.js` is a race.
- **L7** (2026-11-09) User: "algo que quiero que haga es que esto no es estrictamente backend, debe ser backend, frontend y fullstack". S1 reopens: init must also ask for the kind of app. Today's stacks are all backend or fullstack, and no frontend stack exists. Pending: the user's choice of frontend frameworks.
- **L8** T2 flask OK. Possible fastapi bug: fastapi's `tests/conftest.py` is not visible to tests under `src/modules/*/tests/`, so flask uses a root `conftest.py`. Review in T6. Gunicorn 25+ in a read_only prod image needs `--no-control-socket`.
- **L9** (2026-11-09) User: "en full stack, has las diferentes combinaciones segun lo necesite el usuaios". S1b reopens: fullstack combines a backend stack with a frontend stack. Today init supports exactly one stack per project (one stack.mk, one `app` service, one set of zones). Pending: the user's confirmation of the layout.
- **L10** T4 express OK, with Prisma 6, the same ORM as nextjs. In T6: spec 02 §4 "hoy solo FastAPI" is out of date (express and flask also use starter/); add express to the makefile.test markers and to the compose.test loop.
- **L11** (2026-11-09) User choice for fullstack: "Combinar + integrados (Recommended)". Fullstack offers Integrado (Next.js, Laravel) and "Combinar backend + frontend" as a monorepo `backend/` + `frontend/` (compose services api + web + db; `make dev` starts both). User note: "que otra integracion con frontend me recomiendas?"
- **L12** Writer findings for T6:
  - django and flask use `uv.lock` as appMarker; fastapi's marker is pyproject.toml, and its new-app calls docker when uv.lock is missing.
  - The fastapi conftest bug.
  - react detection on `vite.config.ts` also matches Vue/Svelte Vite projects and Symfony projects that use Vite. Narrow it to package.json containing `@vitejs/plugin-react`.
  - `--db` is not yet rejected for react.
  - `loadStacks()` throws ENOENT for a stack folder without stack.json.
- **L13** T3 nestjs OK, with Prisma 7 (one driver adapter per database, picked by `DB_DRIVER`). Express uses Prisma 6: align them in T6, or document why they differ.
- **L14** (2026-11-09) User: "en frontend agrega tambien Vue t akinea los prisma segun sea convientes para cada uno". Django + HTMX (suggested in reply to L11) is still unanswered.
- **L15** (2026-11-09) User: "en backend agre Go". Framework: Gin (orchestrator's default; the user can change it). New language: the basekit-go tests that check languages (`stacks_test.go:16`) go in the Go handoff.
- **L16** (2026-11-09) User: "Tambien pùedes estructurar el proyecto nativo, sin framwork". Pending: the user's choice of which languages get a "native, no framework" option.
- **L17** User picked all 4 native options. go-native and node-native wait for gin and express, so they reuse those stacks' data and migration decisions.
- **L18** T10 vue OK. The orchestrator narrowed react's detect to package.json containing `"@vitejs/plugin-react`. Checked with dry-run init: a react+vite project is detected as react, a vue+vite project as vue. Leftover: `make migration NAME=x` exits 2 on the core NAME regex before the frontend no-db override runs (react and vue).
- **L19** T11 OK. Prisma 7's `migrate dev` no longer runs `generate`. Express already chains `prisma generate`; the orchestrator added the same to nestjs's `MAKE_MIGRATION_CMD`. Unverified: the prod migrate as uid 1001 (T7 e2e). ESLint 9 is end of life: a follow-up, outside the scope.
- **L20** T15 vanilla-ts OK. A package.json with only `"react"` (no plugin-react) is no longer detected: intended, since only the official plugin identifies a Vite React app.
- **L21** T13 python-native OK. Its own WSGI layer lives in src/core, and `load_models()` avoids NoReferencedTableError with foreign keys between modules. Check in T6 whether flask/fastapi have the same latent bug. Correction to L12: appMarker is not the same across the Python stacks (see the grep in T6). Scratch under /tmp/pynative-*.
- **L22** (2026-11-09) User: "sí, agrega Django + HTMX como fullstack integrado".
- **L23** T17 node-native OK. Express answers a non-JSON body with 422 and node-native with 415: a deliberate difference, documented. T6: add `kind` to the stacks written before S1b (django, flask, nestjs, express, symfony and the 4 original ones).
- **L24** T12 gin OK: GORM + goose, pure-Go drivers (CGO-free), prod on `scratch` with uid 1001, appMarker `go.sum`. T6: spec 04 §5/§8 do not list Go (golang:1.27.3-trixie, air v1.67.4, `api migrate`); add `go.sum` for gin to the makefile.test markers and gin to the compose.test loop.
- **L25** T14 php-native OK: FrankenPHP (one process, non-root, read_only), its own migrator with per-engine SQL variants, PHP 8.5, appMarker `composer.lock`. Not yet run with PHP: T7 e2e is its first real test (like symfony).
- **L26** T16 go-native OK. Repositories write `?` and `db.Querier` rebinds to `$n` only on postgres. Driver pins are the ones goose 3.29.0 requires.
- **L27** T18 django-htmx OK (htmx 2.0.11 vendored with SRI, CSP 'self'). All 18 stacks are written. Writer scratch was removed by the orchestrator.
- **L28** Findings in existing stacks:
  - In this feature: django's Dockerfile lacks gunicorn `--no-control-socket --worker-tmp-dir /tmp` (L8).
  - Outside the scope, follow-ups to report:
    - fastapi: conftest and foreign keys between modules (L8, L21).
    - fastapi/django use `>=` ranges in pyproject (uv.lock pins them).
    - The zone glob `tests/**/test_*.py` does not cover `tests/test_x.py`.
    - core gitignore.block does not ignore `__pycache__/`.
    - The core `migration` NAME regex runs before the frontend no-database override.
- **L29** `verify.sh` before T6: 1 failure, `tests/ui/prompt.test.ts` "asks again after an invalid or empty answer" ("9" is now a valid id). Expected: T6a rewrites the question. T6 split into T6a (kind + 3-step question + frontend without DB + tests/docs/CI) and T6b (Combine). One writer covers the src/kit, src/ui/commands, tests and docs zones (repo flow deviation, for parent context); zone-check `--owners` at the end.
- **L30** (2026-11-09) User: "sí, commitea cuando pase la suite". Authorized: commits on `dev/farid` once verify.sh passes (one per stack + integration). Conventional Commits, no AI attribution (CLAUDE.md). Push is not authorized.
- **L31** (2026-11-09) User: "sí, actualiza también basekit-go al terminar Node". This replaces the handoff to the other Go session for this feature. Commits in basekit-go: see L32.
- **L32** (2026-11-09) User: "sí, también commitea en Go cuando pase la suite". Authorized: commits in basekit-go (branch dev/farid) once `make verify` passes. No push.
- **L33** (2026-11-09) User: "ok, unifica create-next-app con el patrón de NestJS". nextjs `_new-app` now runs `npm install --prefix /tmp/cli create-next-app@$(CREATE_NEXT_VERSION)` + `/tmp/cli/node_modules/.bin/create-next-app` instead of `npx --yes`; docs/stacks/nextjs.md is updated. Checked with `make -n new-app` on a generated project: no `npx --yes` left in any `plantillas/`. Not run with Docker (T7).
- **L34** T6a OK. Parent spot check: `verify.sh` → OK; `check_zones --owners` → 579 checked, 0 without an owner.
  - Risk: item 3 (stack.json now requires kind/language/health; the nextjs name changes generated text) and item 5 (CI matrix of 36 e2e jobs; COMPOSER_AUTH for symfony/php-native).
  - The independent verifier runs at the end of the feature (verification timing rule).
  - Commits (L30): 14 stacks + the nextjs fix (d8caa8f) + integration. Base fc1e268.
  - The intermediate stack commits do not pass `prompt.test` "9" until the integration commit.
- **L6** Engram mirror `odd/framework-stacks/tasks`: PENDING. Auto mode blocks `mem_save` because a hook rewrites its input.
