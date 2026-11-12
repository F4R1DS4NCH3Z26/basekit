import { basename, dirname, isAbsolute, join, sep } from "node:path";
import { UsageError } from "../../kit/errors.js";
import { findGlobalSkills, removeGlobalSkills } from "../../kit/global-skills.js";
import { Project } from "../../kit/project.js";
import type { Context } from "../context.js";
import type { UninstallMode, UninstallOptions } from "./options.js";

/** Where the running basekit lives and what surrounds it. The CLI passes the real values; tests pass temp ones. */
export interface UninstallEnv {
  home: string;
  /** The PATH variable, scanned for other copies of basekit. */
  path: string;
  /** Root of the running basekit package. */
  packageRoot: string;
  /** Working directory: where npm runs for a global uninstall, and the project for a forced --project. */
  cwd: string;
  platform: NodeJS.Platform;
}

interface Target {
  mode: UninstallMode;
  /** Where npm runs. */
  dir: string;
  args: string[];
  /** How the plan and the retry line show the npm call. */
  shown: string;
}

const isUnder = (p: string, root: string) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** The folder that holds the `node_modules` the package lives in, if any. */
function projectOf(root: string): string | undefined {
  for (let d = root; dirname(d) !== d; d = dirname(d)) if (basename(d) === "node_modules") return dirname(d);
  return undefined;
}

/** True when npm's global root holds this very package (a copy or an `npm link`). */
function isGlobal(ctx: Context, env: UninstallEnv, root: string): boolean {
  const out: string[] = [];
  if (!ctx.runner.run((l) => out.push(l.trim()), "npm", ["root", "-g"], env.cwd)) return false;
  const globalRoot = out.find((l) => isAbsolute(l));
  if (!globalRoot) return false;
  const candidate = join(globalRoot, "basekit");
  return ctx.fs.exists(candidate) && ctx.fs.realpath(candidate) === root;
}

/**
 * The npm call. A detected project install runs npm in the folder that holds its node_modules; a forced
 * --project runs it in the working directory, like `install --project`.
 */
function target(o: UninstallOptions, ctx: Context, env: UninstallEnv, root: string): Target {
  const project = (dir: string): Target => ({ mode: "project", dir, args: ["uninstall", "basekit"], shown: `npm uninstall basekit (en ${dir})` });
  if (o.mode === "project") return project(env.cwd);
  if (o.mode === "global" || isGlobal(ctx, env, root)) {
    return { mode: "global", dir: env.cwd, args: ["uninstall", "-g", "basekit"], shown: "npm uninstall -g basekit" };
  }
  const dir = projectOf(root);
  if (dir) return project(dir);
  throw new UsageError(`basekit uninstall: no se sabe si este basekit (${root}) es global o de un proyecto; usa --global o --project`);
}

/** Every other `basekit` in PATH, once per real path, skipping the package that was just removed. */
function otherCopies(ctx: Context, env: UninstallEnv, root: string): string[] {
  const win = env.platform === "win32";
  const names = win ? ["basekit.exe", "basekit.cmd", "basekit"] : ["basekit"];
  const seen = new Set<string>();
  const found: string[] = [];
  for (const dir of env.path.split(win ? ";" : ":").filter(Boolean)) {
    const hit = names.map((n) => join(dir, n)).find((p) => ["file", "symlink"].includes(ctx.fs.kind(p) ?? "") && ctx.fs.exists(p));
    if (!hit) continue;
    const real = ctx.fs.realpath(hit);
    if (seen.has(real) || isUnder(real, root)) continue;
    seen.add(real);
    found.push(hit);
  }
  return found;
}

/**
 * Uninstalls the running basekit with npm (global or the project's devDependency) and, with --skills,
 * the global skills listed in ~/.agents/basekit.json. Shows the plan first and asks (default no) unless -y.
 * Projects created with basekit are never touched.
 */
export async function uninstall(o: UninstallOptions, ctx: Context, env: UninstallEnv): Promise<number> {
  if (!o.yes && !o.dryRun && !ctx.prompt) {
    throw new UsageError("basekit uninstall necesita confirmación: usa -y (o --dry-run para ver qué borraría)");
  }
  const root = ctx.fs.exists(env.packageRoot) ? ctx.fs.realpath(env.packageRoot) : env.packageRoot;
  const npm = target(o, ctx, env, root);
  const home = new Project(env.home, o.dryRun, ctx.log, ctx.fs);
  const skills = o.skills ? findGlobalSkills(home) : undefined;

  ctx.log("Se va a desinstalar:");
  ctx.log(`  - ${npm.shown}`);
  if (skills) for (const rel of [...skills.dirs, ...skills.links, skills.manifest]) ctx.log(`  - ${home.path(rel)}`);
  else if (o.skills) ctx.log("= skills globales  (no hay instalación global)");

  if (o.dryRun) {
    ctx.log("(dry-run: no se borra nada)");
    return 0;
  }
  if (!o.yes && !(await ctx.prompt!.confirm("¿Desinstalar basekit?", false))) {
    ctx.log("No se desinstaló nada.");
    return 0;
  }
  if (!ctx.runner.run(ctx.log, "npm", npm.args, npm.dir)) {
    ctx.log(`! npm uninstall falló; reinténtalo con: ${npm.shown}`);
    return 1;
  }
  if (skills) removeGlobalSkills(home, skills);
  for (const p of otherCopies(ctx, env, root)) ctx.log(`! otra copia de basekit en el PATH: ${p} (no se borra)`);
  ctx.log("basekit desinstalado. Los proyectos que ya creaste no cambian.");
  return 0;
}
