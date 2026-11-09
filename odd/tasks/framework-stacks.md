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
- **S16** Combinar (L9, L11): "en full stack, has las diferentes combinaciones segun lo necesite el usuaios". User choice: "Combinar + integrados (Recommended)". The fullstack step offers the integrated stacks plus "Combinar backend + frontend". The layout is a monorepo `backend/` + `frontend/`; `make dev` starts both. Orchestrator design decisions (assumptions; the user can change them):
  - Flag `--stack <backend>+<frontend>` (for example `fastapi+react`). Only a kind backend + kind frontend pair is valid. The manifest records both ids. `sync` and `doctor` support it.
  - Each subfolder is a complete project of its stack (its `files/`, `starter/`, `.make/stack.mk`, Makefile and compose) that works alone with `make -C backend dev`. The root has the shared core (AGENTS.md, .agents/, adapters, docs) and a root Makefile that delegates (dev, down, logs, test, lint, verify, env, new-app) to both.
  - The browser frontend calls the API through the host (`VITE_API_URL=http://127.0.0.1:<backend port>`), and the backend allows that origin in CORS. There is no shared Docker network, so `app` service names do not collide.
  - `--db`/`--redis` apply only to the backend.
  - Zones and roles are prefixed by side (`backend-<role>`, `frontend-<role>`) with paths under `backend/` and `frontend/`; zone-check gives 0 files without an owner.
- **S17** "sí, arregla también los pendientes fuera del alcance". Fix the follow-ups listed in L28 and L35:
  - fastapi: conftest visible to module tests, and models loaded so foreign keys between modules work;
  - zone glob `tests/**/test_*.py` does not cover `tests/test_x.py`, in every stack that has it;
  - `__pycache__/` added to the core gitignore block;
  - stale manifest db when switching to a frontend stack (R3);
  - CI frontend prod args (R3);
  - R2 readability suggestions;
  - ESLint 9 end of life: verify it, then move the TS stacks to a supported ESLint;
  - CORS in express, node-native, php-native and symfony: they have no CORS_ORIGINS, so combined init warns (T6b);
  - `infra.sh` and the stacks' scaffold/app-setup scripts use `git rev-parse --show-toplevel`, which climbs to the root in a combined project; they should use the nearest Makefile folder;
  - the `migration` NAME regex runs before the frontend no-database override;
  - d08eda1 review warnings:
    - R3-claude-scaffold-allowlist-root-relative
    - R3-combo-logs-service-filter (`make logs S=db` from the root breaks the frontend side)
    - R3-side-env-ignore-unproved (the parent checked that `.env*` ignores backend/.env and frontend/.env.prod; it needs a test)
    - R2 suggestions
  - Rule shared by the scripts: a script under `<project>/.agents/skills/<skill>/scripts/` resolves its project as `$(dirname "$0")/../../../..`, never with `git rev-parse --show-toplevel`. This works for single-stack projects and for each side of a combined one.
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
| T6b | S16 | delegated (context backstop) | done | verify.sh OK (parent rerun); fastapi+react init + root make help + VITE_API_URL/CORS checked by the parent; owners 125/0; differential vs b259216: only the requested help lines differ |
| T19a | S17 (src, core, skills/infra-setup, CI, tests, docs/spec) | delegated (parallel writer A) | done | verify.sh 260 pass / 1 visible skip; owners 127/0; RED observed for the stale db, frontend migration, logs S=db and side infra.sh; differential vs d08eda1: only the expected differences |
| T19b | S17 (plantillas/stacks/**, docs/stacks/**) | delegated (parallel writer B) | done | init 18 stacks + 2 combined OK; owners 0 in all; host: fastapi FK + root fixtures OK, flask FK fix, django pins verify OK, express/node-native ESLint 10 + CORS OK; PHP not run (no PHP/Docker) |
| T19c | S17 (OpenCode allowlist for side scripts) | inline | done | RED then GREEN in combo.test; single-stack opencode.json unchanged; verify.sh OK; owners 128/0 |
| T7 | S2-S6, S10-S16 | per-action worker + inline e2e.sh fix | done | 18/18 dev + 18/18 prod + 7/7 mysql PASS; combined fastapi+react PASS (health on both sides, CORS allowed/denied); gin/go-native rerun with the fixed e2e.sh: dev, prod sqlite and mysql PASS |
| V1 | S1-S17 | delegated independent verifier (Risk items 1, 3 and 5 named), read-only, baseline fc1e268 | done | all S# PASS except S7: blocker B1 (Spring + Vite React package.json became react). One correction batch: detect.priority; recheck of B1 with the verifier's repro gives spring |
| T8a | S9 (plantillas parity, kind, 3-step question, frontend db guard, tests/docs/CI in Go) | delegated (context backstop), repo project-guiade | running | |
| T8b | S9 (Combine in Go: S16 + S17 CLI follow-ups) | delegated after T8a | pending | |

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
- **L35** Native review of the Node range fc1e268..b259216: the full candidate (577 files, 22,623 lines) was refused with `lens_context_budget_exceeded`. No authority was created. User choice: "Solo integración (Recommended)". The review of b259216 (risk, readability, reliability) was approved and acknowledged (`gentle-ai.review-acknowledged/v1`, lineage review-81f111f33b1caca7).
  - Non-blocking advisories, as follow-ups:
    - R3-stale-manifest-db-on-frontend-switch (init.ts:44-45)
    - R3-ci-frontend-prod-args (ci.yml:168-170)
    - R2-001 (init.ts:44-45)
    - SUGGESTIONs R2-002..005 and R3-typed-id-case.
  - The 14 stack commits get T7 (Docker e2e) and the independent verifier at the end.
- **L36** (2026-11-09) User: "sí, arregla también los pendientes fuera del alcance". It becomes S17 / T19, after T6b to avoid touching the same files.
- **L37** (2026-11-09) User: "ok, déjalo así hasta cerrar T6b y T19". The Go port (T8) happens all at once after T6b and T19. The two repos stay out of sync until then.
- **L38** T6b OK. Decisions beyond S16:
  - manifest `"stack": "a+b"`;
  - per-side skill copies;
  - compose `name: <project>-<side>` to avoid prod collisions;
  - the root Makefile runs dev/up/build/logs in parallel (-j2) and sends migrate/db-shell to the backend only;
  - delegating recipes use a `+` prefix;
  - combined projects are not auto-detected without a manifest.
  - Risk: item 1/3 (the persisted manifest format adds `a+b`; an older basekit rejects it as an unknown stack).
- **L39** T6b committed as d08eda1. Review of d08eda1 (risk, readability, reliability) approved and acknowledged (review-3dac7d013e86d9ff), 3 WARNINGs added to S17. T19 is split into two writers with disjoint surfaces.
- **L40** T19a OK.
  - `make logs S=x` in a combined project now requires SIDE=backend|frontend (exit 2): a deliberate behavior change.
  - infra.sh resolves the project from its own location; the combined backend gets its own copy of infra-setup.
  - Risk: item 3 (new invocations and allowlist entries in combined projects).
  - Gap left open: the OpenCode bash allowlist (`bash .agents/skills/*`) does not cover `backend/.agents/...`. It goes in T19c, with what T19b leaves.
- **L41** T19b OK.
  - ESLint 9 is EOL (eslint.org/version-support: EOL 2026-08-06). express and node-native move to ESLint 10.13.0; react/vue/vanilla-ts already resolve 10.
  - nextjs stays on 9: eslint-config-next 16.4.x has plugins with peer `^9`. This is documented, and blocked upstream.
  - symfony CORS without nelmio (its own subscriber).
  - fastapi pinned exactly.
  - T19c inline: OpenCode allowlist `bash <side>/.agents/skills/*` in combined projects.
- **L42** T19 committed: f63c351 (stacks) + 5214b9e (CLI). Native review of d08eda1..HEAD refused for budget (126 files, 2,027 lines). Following the user's earlier criterion (L35), only 5214b9e was reviewed: approved and acknowledged (review-0e3dbd9619ebeaa0).
  - The scaffold-from-root WARNINGs are false positives: f63c351, outside the candidate, already removed `show-toplevel` from every stack script (grep: 0).
  - R3-combo-logs-shared-service-regression is valid: `S=app` exists on both sides. Fixed inline: RED, then GREEN in combo.test; help text and spec 04 updated.
- **L43** 0e5ec1d (logs S=app): assess medium, `review_due` false, `under_budget` (22 lines). It stays pending in the slice.
- **L44** (2026-11-09) User: "hazlo ya esta activo" (Docker running: 29.9.2, 10 CPU, 8 GB). T7 launched.
- **L45** T7 fixes in the stacks:
  - nestjs on Node 24: npm 10 fails on Nest 12 with "edgesOut".
  - symfony `setup.php` decodes composer.json as objects ("require-dev": {}).
  - php-native: phpunit 13.3.6, because 13.4.0–13.4.3 has advisory PKSA-qhjm-rpqc-qkn6 and 13.4.4 is only 13 days old. It can move to 13.4.4 from 2026-11-10.
- **L46** e2e.sh fixed inline (qa-writer zone):
  - The health path falls back to stack.json `health` when the HEALTHCHECK has no URL (`|| true` under pipefail).
  - The SQLite write check runs in a throwaway alpine container with the app's volumes and uid (named users resolved with `docker exec id`), because `scratch` images have no shell.
  - Regression checked: fastapi, django, gin and go-native prod sqlite, react prod.
  - One transient network EOF from proxy.golang.org, which passed on retry.
  - Docker build cache: 27 GB, not pruned.
- **L47** Review of 5214b9e..7d7778a (risk, resilience, reliability) approved and acknowledged (review-b01e2482c7e82424).
  - WARNINGs R3-001 and R4 were valid: the write check no longer used the real process, and a failed pull looked like a permission error.
  - Fix: `compose exec` first (as before); a throwaway container only when the image has no `sh`; a failed pull gets its own message.
  - e2e PASS: fastapi, gin, go-native and express on prod sqlite; fastapi dev postgres.
- **L48** Node closed at 3b45fed. V1 (independent verifier) and T8a (Go) were launched in parallel; they work on different repos.
- **L49** V1 found blocker B1 (S7): detection by id lets a new stack take over projects that also carry its marker. Correction (one batch):
  - `detect.priority` in stack.json: 10 for the original stacks (fastapi, laravel, nextjs, spring), 20 for stacks with their own marker file (django, symfony, nestjs, gin), 30 for generic manifest matches (flask, react, vue); then id order.
  - 5 regression tests (RED → GREEN). Spec 02 §6 and docs/stacks updated.
  - Recheck with the verifier's repro: Spring.
  - Also covers A1 (nextjs + nest-cli → nextjs) and A2 (symfony + Vite React → symfony).
  - Cheap advisories fixed: A3 (project-bootstrap points to the backend's infra.sh in a combined project) and A6 (`basekit init` hints say "en la raíz del proyecto").
  - Left as advisories:
    - A4: `--stack ' fastapi '` is accepted by trim;
    - A5: the mermaid parentheses were already in the baseline;
    - A7: the labels repeat the language.
- **L50** Review of 7d7778a..f20c2b6 (reliability, resilience, readability) approved and acknowledged (review-0ff13a4d70564d6f). Its WARNINGs were fixed in a small commit:
  - django.md claimed django goes before fastapi; with the priorities, fastapi (10) goes first.
  - Spec 02 tiers: 20 means a signal unique to the framework (its own file or module), 30 a short name in a shared manifest.
  - e2e: a named user without a shell gives a clear message.
  - e2e PASS: gin and fastapi prod sqlite; verify OK.
- **L6** Engram mirror `odd/framework-stacks/tasks`: PENDING. Auto mode blocks `mem_save` because a hook rewrites its input.
