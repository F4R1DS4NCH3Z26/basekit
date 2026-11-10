# Install scripts for the Node CLI

Objective: one-line install of Node's `basekit` on macOS, Linux, WSL, Git Bash and native Windows, doing what `basekit install --global` does (npm from the GitHub repository, never the npm name `basekit`). Branch: `dev/farid` (the user merges PRs). Delivery: ask-on-risk. Test runner: `bash .agents/skills/cli-verify/scripts/verify.sh` plus the install tests below. Sibling: basekit-go/odd/tasks/install-scripts.md (Go installers, same conventions).

## Specs

- **S1** `install.sh` at the repo root. User: "que implementar un install.sh para la instalcion de los CLI en cualquier SO" … "sigue con las mejoras y luego sigue con node".
  - POSIX `sh`, `set -eu`, passes `shellcheck`; all steps in functions with a single final `main "$@"` (truncation-safe under `curl | sh`, like Go's S5). Usage: `curl -fsSL https://raw.githubusercontent.com/F4R1DS4NCH3Z26/basekit/main/install.sh | sh`, and `sh -s -- --version <ref>`.
  - Checks `node` (>= 20.12, the `engines` floor; read the version with `node -p process.versions.node`) and `npm`. Missing or too old: a clear Spanish error pointing to https://nodejs.org (or nvm/fnm) and exit 1, before running npm.
  - Installs with exactly the same command as `basekit install --global`: `npm install -g --install-links --no-audit --no-fund github:F4R1DS4NCH3Z26/basekit[#<ref>]` (see src/commands/install/install.ts and `INSTALL_SOURCE` in src/kit/templates.ts). `--version <ref>` or env `BASEKIT_VERSION` picks a git ref (tag, branch or commit); default: no ref (the default branch). The ref must match `^[A-Za-z0-9._/-]+$`, otherwise a usage error (exit 2) before npm runs. Env `BASEKIT_SOURCE` overrides the `github:…` spec (tests and forks), validated the same way as `basekit install --from` (no spaces or shell characters).
  - npm failure: exit 1 and print the retry command; if the output mentions `EACCES`, also explain the no-sudo fix (`npm config set prefix ~/.local` and add `~/.local/bin` to PATH, or use nvm/fnm). Never run sudo.
  - Finish with `basekit --version` (resolved through npm's global bin, `npm prefix -g`), and if that bin dir is not in PATH, print the line to add.
- **S2** `install.ps1` at the repo root for Windows PowerShell 5.1+ and pwsh: the same checks, the same npm command (`npm.cmd`), `-Version` and the same env overrides, ASCII-only file, error handling under `irm … | iex` like Go's install.ps1 (prints the error, does not close an interactive session, and still fails `powershell -Command "irm … | iex"`).
- **S3** Tests without network: fake `node` and `npm` on PATH (shims that log their arguments, report a chosen version, simulate success, EACCES and other failures, and create a fake global `basekit` so `--version` runs). Cases: default install (exact npm args), `--version <ref>` and `BASEKIT_VERSION`, invalid ref (exit 2, npm not run), node missing, node too old, npm missing, npm failure with and without EACCES, PATH hint, truncated script runs nothing. `shellcheck install.sh` in CI; CI runs the sh tests on ubuntu and macos and the PowerShell test on windows.
- **S4** Docs: README install section with both one-liners and the note that `basekit install --global` does the same once basekit is available; mention Go's installer for a single binary without Node.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1–S4 | delegated writer (parallel with Go's T2, separate repo) | done | this commit |

Risk: item 5 (installer and CI) → independent verifier after the writer.

## Log

- **L1** (2026-11-10) User: "que implementar un install.sh para la instalcion de los CLI en cualquier SO, como podria hacerlo?" → Go first (basekit-go PR #9), then "sigue con las mejoras y luego sigue con node".
- **L2** Node has no git tags or GitHub releases, so `--version` takes any git ref; default is the default branch. Zones: install.sh and install.ps1 added to the orchestrator zone (tests/agents.test.ts requires one owner per file); scripts/** is qa-writer's.
- **L3** T1 done: install.sh (functions + final `main "$@"`, node >= 20.12 and npm checks, the exact `basekit install --global` npm command, ref/source validation with exit 2, EACCES hint without sudo, PATH hint) and install.ps1 (same, iex failure visible to non-interactive hosts like Go's S8). sh suite 103 checks OK under sh, dash and bash; real RED with install.sh absent: 80 failures. CI jobs `install-sh` (ubuntu + macos, shellcheck) and `install-ps1` (windows). Not run locally: install.ps1 tests, shellcheck, real npm. Parent: README requirement line updated to Node >= 20.12 with one runtime dependency.
