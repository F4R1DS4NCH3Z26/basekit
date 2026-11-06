import { spawnSync } from "node:child_process";
/** On Windows npm and npx are `.cmd` shims, which only start through a shell. */
const SHIMS = new Set(["npm", "npx"]);
const resolve = (cmd) => {
    const win = process.platform === "win32" && SHIMS.has(cmd);
    return { file: win ? `${cmd}.cmd` : cmd, shell: win };
};
/**
 * Real processes: fixed commands with argument arrays, never a shell with user data.
 * The Windows shims need a shell, so every argument that reaches them is whitelisted or validated.
 */
export const processRunner = {
    run(log, cmd, args, cwd, env) {
        const { file, shell } = resolve(cmd);
        const r = spawnSync(file, args, {
            cwd,
            env: env ? { ...process.env, ...env } : process.env,
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
            shell,
        });
        for (const line of `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n"))
            if (line.trim())
                log(`  ${line}`);
        if (r.error)
            log(`  ${cmd}: ${r.error.message}`);
        return r.status === 0;
    },
    interactive(cmd, args, cwd) {
        const { file, shell } = resolve(cmd);
        return spawnSync(file, args, { cwd, stdio: "inherit", shell }).status === 0;
    },
    works(cmd, args) {
        return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
    },
};
