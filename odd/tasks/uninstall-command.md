# uninstall-command

Objective: add `basekit uninstall` to basekit (Node) and basekit-go, with the same flags and the same user-visible strings where the installs match.
Branch: `dev/farid` in both repos (the user's branch policy); while the PR #12s are open, the commits join them. Runners: `bash .agents/skills/cli-verify/scripts/verify.sh` (Node), `go test ./...` (Go).

## Specs

### S1 · What it removes
User: "si, agregá el comando uninstall en los dos". Decision: "CLI + --skills opcional".
- By default it removes only the CLI that is running:
  - **Go**: the running executable (`os.Executable`, symlinks resolved).
    - When it runs from a `go run` build cache or temp dir, it refuses with `UsageError`: `basekit uninstall: este basekit corre desde una compilación temporal (go run); no hay nada que desinstalar`.
    - On Windows, when its folder is the installer's (`%LOCALAPPDATA%\Programs\basekit`, or `BASEKIT_INSTALL_DIR`), it also removes that folder from the user PATH, and the folder is deleted right after the process exits (a detached `cmd /c` that waits and then runs `rmdir /s /q`). A running `.exe` cannot delete itself. Safety (L3): the whole folder is removed only when it holds nothing but basekit.exe (and install.ps1's temp files); otherwise only the .exe is deleted after exit, so a shared `BASEKIT_INSTALL_DIR` such as C:\tools is safe.
  - **Node**: the npm package. See S3.
- With `--skills`, it also removes the global skills that `init --global` installed:
  - every path listed in the global manifest `~/.agents/basekit.json` (`files`);
  - the skill links that basekit created in each agent's global skills folder for those skills;
  - then the manifest itself.
  
  It never removes anything that the manifest does not list, so the user's other skills in `~/.agents/skills` are untouched. Without a global manifest it reports `= skills globales  (no hay instalación global)`. Node reads the same manifest (format written by basekit-go `manifest.Write` with `Global: true`).
- Projects created with basekit are never touched.

### S2 · Confirmation, -y, --dry-run
Decision: "Sí, con -y y --dry-run".
- It first prints the plan:
  - the header `Se va a desinstalar:`;
  - one line per item, `  - <ruta o comando>`. Go: the executable path. Node: `npm uninstall -g basekit` or `npm uninstall basekit (en <dir>)`. With `--skills`: each skill folder, each link, and the manifest.
- Then it asks `¿Desinstalar basekit?` (yes/no, default **no**). A no prints `No se desinstaló nada.` and exits 0.
- `-y`/`--yes` skips the question. `--dry-run` prints the plan plus `(dry-run: no se borra nada)` and changes nothing.
- Without a terminal and without `-y` or `--dry-run`, it is a usage error (exit 2, nothing removed): `basekit uninstall necesita confirmación: usa -y (o --dry-run para ver qué borraría)`.
- On success: `basekit desinstalado. Los proyectos que ya creaste no cambian.`

### S3 · Node: global or project
Decision: "Detecta dónde corre".
- If the running basekit is the global npm one, it runs `npm uninstall -g basekit`.
- If it is the one under a project's `node_modules`, it runs `npm uninstall basekit` in that project (the folder that holds `node_modules`).
- `--global` or `--project` forces the mode, as in `install`. Both together are a usage error: `Usa --global o --project, no los dos`.
- npm runs with fixed argument arrays through the existing Runner.
- If npm fails, it reports `! npm uninstall falló; reinténtalo con: <comando>` and exits 1.
- Go has no `--global`/`--project` (its install is a single binary).

### S4 · Other copies in PATH
Decision: "Borra el que corre y avisa".
- After removing, it lists every other `basekit` executable found in `PATH` (by real path, without duplicates, excluding the one it removed): `! otra copia de basekit en el PATH: <ruta> (no se borra)`.
- It never deletes them.

### S5 · Help and docs
- Help line, under Uso: `  basekit uninstall [--skills] [-y] [--dry-run]   Desinstala este basekit (con --skills, también las skills globales)`.
  - Node adds `[--global|--project]` after `uninstall`.
- README in both repos: in the "Usa una sola implementación" note and the install section, the manual steps are replaced by `basekit uninstall` (keep one line with the manual fallback).
- CLI spec: Node `docs/spec/02_especificacion_cli.md`, Go `docs/guias/02_especificacion_cli.md`.

### S6 · Review follow-ups (user: "si, arreglá esas advertencias", 2026-11-12)
- **S6a, Go Windows PATH and folder:**
  - The user PATH entry is removed only when the whole installer folder is removed (it holds nothing but basekit). With a shared folder only the `.exe` goes, and the PATH entry stays.
  - The detached command deletes `basekit.exe` and then runs a non-recursive `rmdir` on the folder (no `/s`). It never removes anything written into the folder after the plan was shown.
- **S6b, Go links:** when the `basekit` that was invoked (the `PATH` lookup of `os.Args[0]`) is a symlink that resolves to the running binary, only the link is removed and its target is kept. The plan line is `  - <link>  (enlace; se conserva <destino>)`.
- **S6c, Go `--skills` failures:** if any link or skill file cannot be removed, the global manifest is NOT removed. The command prints `! no se pudo borrar <ruta>: <error>` for each failure, keeps the CLI, and exits 1. A retry then finds what is still listed.
- **S6d, Node detection:**
  - A failed or empty `npm root -g` never falls back to "project" silently.
  - The project mode is detected only when the folder that holds `node_modules` has a `package.json` that lists `basekit` in `dependencies` or `devDependencies`.
  - Otherwise it is the existing usage error: `basekit uninstall: no se sabe si este basekit (<root>) es global o de un proyecto; usa --global o --project`.
- **S6e, Both, the plan matches what happens:**
  - A skill folder that will be empty after its listed files are removed is shown as `  - <carpeta>`.
  - A folder that keeps files the manifest does not list is shown as `  - <carpeta>  (solo los archivos de basekit; se conservan los tuyos)`.
  - Listed files that no longer exist are not shown.
- **S6f, Both, a link goes only with its folder** (user: "Si", 2026-11-12, after the commit review flagged R3-links-of-untouched-skill-removed and R4-links-removed-for-untouched-folder):
  - A tool's link to a skill is planned and removed only when that skill folder is removed whole.
  - A folder that stays, untouched (none of its listed files left) or keeping the user's files, keeps its links.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1–S5 in Node | delegated (writer trigger a: parallel with T2) | done (RED→GREEN; verify.sh OK; 20 uninstall tests; parent: no-TTY exit 2, dry-run output matches Go) | uncommitted |
| T2 | S1–S5 in Go | delegated (writer trigger a: parallel with T1) | done (RED→GREEN; go vet incl. GOOS=windows, go test OK; parent: real -y removal in scratch + PATH copy warning) | uncommitted |
| T3 | S6d, S6e in Node | delegated (parallel with T4; context backstop) | done (RED 6 → GREEN; verify.sh OK; 28 uninstall tests) | uncommitted |
| T4 | S6a, S6b, S6c, S6e in Go | delegated (parallel with T3) | done (RED per rule → GREEN; go vet incl. windows, go test OK) | uncommitted |

## Log
- L1 (2026-11-12) user: "hay una forma de desintalar basekit ?" then "si, agregá el comando uninstall en los dos".
- L2 decisions:
  - Scope: "CLI + --skills opcional (Recommended)".
  - Confirmation: "Sí, con -y y --dry-run (Recommended)".
  - Node mode: "Detecta dónde corre (Recommended)".
  - Duplicates: "Borra el que corre y avisa (Recommended)".
  - The Windows self-delete mechanism and Node reading the shared global manifest were decided by the parent (technical).
- L3 Parent accepted the Go writer's Windows safety rule (rmdir only for a folder that holds just basekit). Node-only string for an undetectable install: `basekit uninstall: no se sabe si este basekit (<root>) es global o de un proyecto; usa --global o --project`. Pre-existing Go issue kept: stdin from /dev/null counts as a TTY (ModeCharDevice).
- L4 (2026-11-12) native review advisories on uninstall; user: "si, arreglá esas advertencias". S6 added. The exact strings and mechanics were decided by the parent.
- L5 T3/T4 done. Shared choice: a skill folder with none of its listed files left is neither shown nor touched. Go-only: a path with `%` refuses with `basekit uninstall: no se puede programar el borrado de <ruta>: cmd expandiría el '%' de la ruta; bórralo a mano` (exit 1, before the plan); an S6c failure exits 1 with only the `!` lines. Known minor divergence: Go also removes empty user subfolders inside a plain folder; Node may leave them.
