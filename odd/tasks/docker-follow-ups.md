# docker-follow-ups

Objective: fix the 5 open review follow-ups of the Docker option (`--no-docker`) in basekit (Node) and basekit-go, with identical behavior and strings.
Branch: `dev/farid` in both repos. Commits only with the user's approval (they would join the open PR #13s). Runners: `bash .agents/skills/cli-verify/scripts/verify.sh` (Node), `make verify` (Go).

## Specs

User: "arreglá las 5 advertencias de Docker en los dos". The 5 follow-ups (native review, 2026-11-11), one spec each. The mechanics were decided by the parent, following existing precedents (marked).

### S1 · One Docker rule for init, sync and doctor (follow-up 1)
Follow-up: "A manifest without `docker` makes an interactive `init` ask the question, while sync and doctor assume yes. Answering no does not delete the existing Docker files."
- **S1a**: one shared function (like `resolveMakefile`), used by init, sync and doctor. In order:
  1. a combined project → yes;
  2. `--no-docker` → no;
  3. `--docker` (S2) → yes;
  4. a manifest exists → its `options.docker !== false` (a manifest without the key, written before the option existed, is yes and is **never asked**);
  5. a first run (no manifest) with a TTY → the question `¿Usar Docker? Todo corre en contenedores (Dockerfile y compose)` (yes by default);
  6. otherwise yes.
  sync and doctor have no flags, so for them it reduces to steps 1, 4 and 6.
- **S1b** (precedent: the "queda del stack anterior" warnings for overlays): when the previous manifest has Docker on (`options.docker !== false`) and this run resolves Docker off, init deletes nothing. For each of these that exists in the project it prints a warning:
  - the files basekit wrote for Docker and Make that the previous manifest lists in `files`: the `Makefile` (or `Makefile.basekit`), everything under `.make/`, and the stack's `files/` (`Dockerfile`, `compose*.yaml`, `.env.example`, `.dockerignore`);
  - the infra-setup overlays `compose.db.yaml`, `compose.redis.yaml` and `.make/db.mk` (not in `files`).
  The warning, one per path, in path order:
  `! <ruta>  (queda de cuando el proyecto usaba Docker: sin Docker no se usa; bórralo si ya no lo necesitas)`
  A user's own `Makefile` (not in `files`) gets no warning. A run that keeps Docker off (previous manifest already `docker: false`) prints none of them.

### S2 · `--docker` re-enables Docker (follow-up 2)
Follow-up: "Once `docker: false` is stored, there is no flag to re-enable Docker."
- New init flag `--docker`, project-only (like `--no-docker`: not with `--global`, not in sync).
- Help line, right before `--no-docker`:
  `  --docker                Vuelve a usar Docker en un proyecto creado sin Docker`
- `--docker` with `--no-docker` is a usage error (exit 2, before any question or write): `Usa --docker o --no-docker, no los dos`
- When Docker goes from off (previous manifest `docker: false`) to on, the stored `makefile: false` does not count, because it was derived from "no Docker", not chosen. The Makefile resolves as on a first run: `--no-makefile` → no; a TTY → the question `¿Usar Makefile? Es la interfaz para correr los comandos en los contenedores`; otherwise yes.
- The stack's Docker files and the Makefile are then written as on any run with Docker (create without overwriting). The database question is not asked (it stays first-run only); the saved engine is kept, and `--db` still changes it.
- On a project that already uses Docker, `--docker` changes nothing.

### S3 · The `--db`/`--redis` check never comes after a question (follow-up 3)
Follow-up: "The `--db`/`--redis` check runs after the question."
- Docker off by flag or manifest: `--db` other than `auto`/`none`, or `--redis`, with `--no-docker`, or with a manifest `docker: false` and no `--docker`, is the existing usage error, unchanged:
  `--db y --redis necesitan Docker: no se pueden usar con --no-docker ni sin Docker en el manifest`
  It is raised before **any** question (including the stack and agents questions) and before any write.
- Docker still undecided (no flag, no manifest): when `--db` other than `auto`/`none`, or `--redis`, is passed, the Docker question is not asked and Docker is yes, since those flags need it. The Makefile question still follows as today.

### S4 · Accurate `--no-docker` help (follow-up 4)
Follow-up: "The help text 'no compatible con --db' overstates the conflict: `--db auto` and `--db none` are allowed."
- The help line becomes:
  `  --no-docker             Sin Docker ni Makefile (no compatible con --redis, un combinado ni --db distinto de auto/none)`

### S5 · A saved database is checked against no Docker (follow-up 5)
Follow-up: "A database saved in the manifest is not checked against no-Docker: the guard only reads the `--db` and `--redis` flags."
- Precedent: a project switched to a frontend stack drops the saved database and Redis, and the overlays stay with a warning.
- When Docker resolves off and the database or Redis comes from the manifest (no `--db`/`--redis` flags; a saved `db` other than `auto`/`none`, or `redis: true`), init does not fail. It records `db: "none"` and `redis: false`, and prints once:
  `! .agents/manifest.json  (sin Docker no se usan la base de datos ni Redis guardados: quedan db none y redis false)`
  The overlays get the S1b warnings when they exist. infra-setup does not run.
- A saved `auto` or `none` with Docker off is kept as is, without a warning.

### S6 · Docs
- CLI spec (Node `docs/spec/02_especificacion_cli.md`, Go `docs/guias/02_especificacion_cli.md`): the flag table (`--docker`, the `--no-docker` row), the Docker step (the S1a order), the S1b/S5 warnings, the S3 check order, and the S2 Makefile rule.
- README, wherever it lists the init flags.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1–S6 in Node | delegated (writer trigger a: parallel with T2) | done (RED per rule → GREEN; verify.sh OK, parent re-ran: OK; owners 0 unowned; differential identical) | uncommitted |
| T2 | S1–S6 in Go | delegated (writer trigger a: parallel with T1) | done (RED per rule → GREEN; make verify OK; GOOS=windows vet OK; differential identical; parent re-ran the Docker tests: ok) | uncommitted |

## Log
- L1 (2026-11-12) user: "arreglá las 5 advertencias de Docker en los dos" (after "que advertencias hay?", where the 5 Docker follow-ups were listed from the 2026-11-11 review).
- L2 Parent decisions (technical, following precedents): never delete user files, warn with `!` (S1b, S5); `--docker` as the counterpart of `--no-docker` (S2); `--db`/`--redis` imply Docker instead of asking a question whose "no" is an error (S3); the existing error message stays unchanged. Out of scope, reported only: `makefile: false` still has no flag to turn it back on (a PR #12 follow-up).
- L4 T2 done. Resolved ambiguities:
  - S1b: the stack's `files/` are created without being recorded in the manifest `files` (only the Makefile is). So only `Makefile`/`Makefile.basekit` are checked against `files`; the previous stack's `files/` and the root overlays are warned whenever they exist.
  - S3: the Docker-off check also runs after the existing stack/db checks when the stack comes from a flag or the manifest, so the earlier error precedence is unchanged (react + `--no-docker` + `--db postgres` still gives the stack error).
  - S5: it fires on the resolved values. With `--db auto` and a saved `redis: true`, both drop.
  - A frontend switch with `--no-docker` may warn an overlay twice, once for each reason.
- L5 T1 done. Cross-implementation run of the same scenarios on both CLIs (S1b/S5 warnings, `--docker` re-enable, the S2/S3 errors, a legacy manifest with sync, and the help lines). Go printed the S1b/S5 warnings before the file report, Node right after `! Makefile  (sin Docker: …)`. The parent moved Go's to Node's place (make verify OK). After that the outputs are identical, except two differences that already existed: the manifest key order and the AGENTS.md block length (`npx --no-install`).
- L6 Native review, granted by the user in both repos, lenses readability + reliability, on the uncommitted working trees:
  - Node: assessed high, approved and acknowledged (review-711579fb6df5802f, burned). The untracked feature doc was excluded. Advisories: R2-ambiguous-S5-label, R2-duplicated-docker-off-rule, R2-misleading-stack-flag, R2-overlay-list-duplicated, R3-dropped-overrides-auto (a saved `auto` becomes `none` when Redis is dropped, as S5 says).
  - Go: assessed medium, approved and acknowledged (review-dc352df5a6db5806, burned). The new test file was included. Advisories: R2-dup-manifest-docker-rule, R2-dup-overlay-list, R3-combined-leftovers-untested, R3-makefile-double-warning (`Makefile` gets both the "sin Docker" line and the S1b line; Node does the same).
  - None of them block. Commits are pending the user's approval.
- L3 Engram mirror `odd/docker-follow-ups/tasks`: PENDING. Auto mode cannot review `mem_save` because a hook rewrites its input.
