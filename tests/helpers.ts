import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The compiled CLI (dist/src/cli.js), the TypeScript sources and the repository root. */
export const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
export const SRC_DIR = fileURLToPath(new URL("../../src/", import.meta.url));
export const REPO = fileURLToPath(new URL("../../", import.meta.url));

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function result(r: SpawnSyncReturns<string>): Run {
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Runs the compiled CLI as a user would. stdin is not a TTY, so it never prompts. */
export function basekit(args: string[], cwd?: string, env: NodeJS.ProcessEnv = {}): Run {
  return result(spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, ...env } }));
}

/**
 * A fake `npx` placed first in PATH. It logs its arguments and the telemetry variables,
 * then creates `.agents/skills/<s>/SKILL.md` for every `-s` value (like `skills add` does).
 * Set FAKE_NPX_FAIL=1 to make it fail without installing anything.
 */
export function fakeNpx(): { env: NodeJS.ProcessEnv; log: () => string[] } {
  const bin = mkdtempSync(join(tmpdir(), "basekit-test-bin-"));
  dirs.push(bin);
  const logFile = join(bin, "calls.log");
  writeFileSync(
    join(bin, "npx"),
    `#!/bin/sh
printf 'ARGS %s\\n' "$*" >> "$FAKE_NPX_LOG"
printf 'ENV DISABLE_TELEMETRY=%s DO_NOT_TRACK=%s\\n' "$DISABLE_TELEMETRY" "$DO_NOT_TRACK" >> "$FAKE_NPX_LOG"
[ "\${FAKE_NPX_FAIL:-0}" = 1 ] && exit 1
collect=0
for a in "$@"; do
  case "$a" in -s) collect=1; continue ;; -*) collect=0; continue ;; esac
  if [ "$collect" = 1 ]; then mkdir -p ".agents/skills/$a" && printf -- '---\\nname: %s\\n---\\n' "$a" > ".agents/skills/$a/SKILL.md"; fi
done
echo '{}' > skills-lock.json
`,
    { mode: 0o755 },
  );
  return {
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, FAKE_NPX_LOG: logFile },
    log: () => (existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean) : []),
  };
}

export function hasDocker(): boolean {
  return spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;
}

export function sh(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): Run {
  return result(spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } }));
}

const dirs: string[] = [];

/** Scratch directory outside the worktree; removed by cleanup(). */
export function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "basekit-test-"));
  dirs.push(d);
  return d;
}

export function cleanup(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

export function gitCommitAll(cwd: string): void {
  sh("git", ["add", "-A"], cwd);
  const r = sh("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init"], cwd);
  if (r.code !== 0) throw new Error(`git commit failed: ${r.stderr}`);
}
