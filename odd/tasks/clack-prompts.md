# Interactive menus with @clack/prompts (Node)

Objective: the Node CLI's terminal questions use `@clack/prompts` instead of the hand-made raw-mode menu, keeping every question, answer and result the same. Branch: `dev/farid`. Delivery: ask-on-risk. Test runner: `bash .agents/skills/cli-verify/scripts/verify.sh`.

## Specs

- **S1** Dependency. User: "quiero usar la deependecia de menu intectivo en Node". `@clack/prompts` 1.8.1, exact version, the only runtime dependency (1.9.0 is under 14 days old). `engines.node` becomes `>=20.12` (clack requires it). Recorded in `docs/adr/0002-menu-interactivo-con-clack.md` and `AGENTS.md`. Done by the parent.
- **S2** Menus. In a terminal with raw mode, every question in `src/ui/prompt.ts` (stack steps tipo → lenguaje → framework including combinar, agents multi-select, external skills multi-select, yes/no confirms, context text, install choices) is shown with clack (`select`, `multiselect` with `required: false` and `initialValues`, `confirm`, `text`). Same question texts, same option labels and hints (e.g. `(por defecto)`), same defaults, same returned values. Single-option steps are still auto-picked and announced. An empty multi-select still means none (S2 of optional-choices). Ctrl+C/Esc (clack `isCancel`) throws `CancelledError` (exit 130), as today.
- **S3** Fallback. The numbered line mode (no raw mode, and unit tests) is unchanged, byte for byte.
- **S4** Architecture. Only `src/ui/` imports `@clack/prompts`; `tests/architecture.test.ts` keeps passing (extend it if it checks imports of external packages). The hand-made raw-mode menu code is removed when nothing uses it.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1 | inline (parent) | done | |
| T2 | S2, S3, S4 | delegated writer (context backstop: long parent session) | done | this commit |

## Log

- **L1** (2026-11-10) User: "quiero usar la deependecia de menu intectivo en Node" (after the parent recommended `@clack/prompts` as the closest to Go's huh).
- **L2** Verified: clack 1.8.1 exposes `input`/`output` streams (testable), `multiselect` `required`/`initialValues`, `isCancel`; all six installed runtime packages are older than 14 days.
- **L3** T2 done: every terminal question goes through clack via one `ask()` helper; line mode untouched (tests/ui/prompt.test.ts unchanged and green); raw-mode code removed; tests/architecture.test.ts now fails if anything outside src/ui/ imports a non-`node:` package. Ctrl+D and end of input cancel through an AbortSignal (clack does not). Visible differences: clack layout and English key help line, digit jumps gone (arrows and j/k stay), confirm answers with arrows or y/n ("s"/"sí" no longer typed in a terminal), hints show in parentheses added by clack. `verify: OK`.
