import { spawnSync } from "node:child_process";

/**
 * Runs a fixed command with an argument array, never through a shell with user data.
 * On Windows, `.cmd` shims (npx) need a shell; callers only pass whitelisted arguments.
 */
export function run(log: (line: string) => void, cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): boolean {
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
}

/** True when `cmd args` exits 0. Output is discarded. */
export function works(cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
}
