# Optional choices: external skills list and optional agents

Objective: the external skills question becomes a multi-select list, and choosing agents (tools) becomes optional, identically in Node (`~/Documents/basekit`) and Go (`~/Documents/basekit-go`). Branch: `dev/farid` in both repos. Delivery: ask-on-risk. Test runners: Node `bash .agents/skills/cli-verify/scripts/verify.sh`; Go `make verify`.

## Specs

- **S1** External skills as a list. User: "sí, una lista para elegir las skills externas (ambos repos)".
  - The yes/no question `¿Instalar también las skills externas (…)? Usan npx y red` is replaced by a multi-select question titled `¿Qué skills externas instalo? (usan npx y red)` listing `grill-me`, `grill-with-docs`, `grilling`, `domain-modeling` (the pinned list, in that order), all selected by default. It is asked under the same conditions as today: interactive, no `--no-external-skills`, and at least one chosen skill missing. The `Skills incluidas: …` line stays right before it.
  - Line-based mode: numbered list; numbers or names separated by commas; empty answer keeps the defaults (all); `ninguna` or `ninguno` (case-insensitive) chooses none.
  - Only the chosen skills are installed: `npx … -s <chosen…>`. Choosing none installs nothing and reports `= skills externas  (ninguna elegida)` (mark `=`).
  - The choice is persisted in the manifest as `options.externalSkills` (array of names, possibly empty). Reruns of `init` and `sync` use it: the missing check and `-s` only consider the persisted names, and the question is not asked again. A manifest without the key means all four (backward compatible).
  - `--no-external-skills` keeps its meaning (skip for this run) and does not change the persisted choice.
- **S2** Agents optional. User: "si no escojo el modelo para adaptar los agentes saegun el modelo, la idea es que no se obligatorio".
  - The agents question accepts an empty selection. Menu mode (Node arrows, Go huh): no "elige al menos uno" validation; an empty selection means none. Line-based mode: empty answer keeps the defaults as today; `ninguno` or `ninguna` (case-insensitive) chooses none. The title stays `¿Con qué herramientas vas a trabajar?`.
  - Flag: `--agents none` means no agents (in `init` and `sync`); `none` mixed with ids is a usage error (exit 2).
  - With no agents: `AGENTS.md`, `.agents/` (roles, zones, skills, manifest), docs, Docker/Make files are written as usual; no tool adapters and no skill links are created. The manifest stores `agents: []`, and a rerun treats it as decided (no detection, no question).
  - External skills with no agents are not installed (the skills CLI needs `-a`): report `! skills externas  (sin agentes: se instalan cuando agregues uno con basekit sync --agents <a,b>)`. `sync --agents <a,b>` later installs them for the new agents, honoring S1's persisted choice.
- **S3** Parity and docs: identical question texts, marks and messages in both repos (except the known CLI command text `npx --no-install basekit` vs `basekit`). Help text, README and the CLI spec doc of each repo document `--agents none`, the list question and `ninguna`/`ninguno`.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S2, S3 (Node) | delegated writer (parallel units in separate repos) | done | 90bf759 |
| T2 | S1, S2, S3 (Go) | delegated writer (parallel units in separate repos) | done | basekit-go d6ff5fe |

## Log

- **L1** (2026-11-10) User: "- sí, una lista para elegir las skills externas (ambos repos)\n- si no escojo el modelo para adaptar los agentes saegun el modelo, la idea es que no se obligatorio"
- **L2** Design decisions taken by the parent (not asked): `options.externalSkills` persistence; `ninguna`/`ninguno` for none in line mode; `--agents none`; no external skills without agents, because `npx skills add` needs `-a`. Route: two parallel writers, one per repo (disjoint edit surfaces, several minutes each).
- **L3** T1 (Node) and T2 (Go) done, RED before GREEN, full suites green (`verify: OK` in both). Writer decisions kept in both repos: usage error `--agents none no se combina con otros agentes`; line prompt `Números o nombres [...]`; `options.externalSkills` written only when the question was answered; doctor checks only the chosen external skills. Parent fix: Go now names every unknown answer part like Node. Go-only: `init --global` hints `basekit init --global --agents <a,b>` (no sync there) and persists no choice (the global manifest has no options). Differential checks against the base showed no unrequested output changes.
