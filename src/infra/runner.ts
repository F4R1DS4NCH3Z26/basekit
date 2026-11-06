import { spawnSync } from "node:child_process";

/** Port for the external processes basekit starts (git, bash, npx and the doctor checks). */
export interface Runner {
  /** Runs `cmd args` in `cwd`, forwarding its output to `log`; true when it exits 0. */
  run(log: (line: string) => void, cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): boolean;
  /** True when `cmd args` exits 0. Output is discarded. */
  works(cmd: string, args: string[]): boolean;
}

/**
 * Real processes: fixed commands with argument arrays, never a shell with user data.
 * On Windows, `.cmd` shims (npx) need a shell; callers only pass whitelisted arguments.
 */
export const processRunner: Runner = {
  run(log, cmd, args, cwd, env) {
    const win = process.platform === "win32" && cmd === "npx";
    const r = spawnSync(win ? "npx.cmd" : cmd, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: win,
    });
    for (const line of `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n")) if (line.trim()) log(`  ${line}`);
    if (r.error) log(`  ${cmd}: ${r.error.message}`);
    return r.status === 0;
  },
  works(cmd, args) {
    return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  },
};
