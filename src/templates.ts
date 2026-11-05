import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Root of the bundled templates. Everything stack-specific lives there, never in this code. */
export const TEMPLATES = fileURLToPath(new URL("../../plantillas/", import.meta.url));

export const VERSION: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

export interface Stack {
  id: string;
  name: string;
  port: number;
  detect: { files?: string[]; manifest?: string; contains?: string };
  appMarker?: string;
  roles: string[];
  skills: [string, string][];
  defaultAuth?: string;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

export class UsageError extends Error {}

/** Reads every `plantillas/stacks/<id>/stack.json`, sorted by id (detection order). */
export function loadStacks(): Stack[] {
  const dir = join(TEMPLATES, "stacks");
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const file = join(dir, name, "stack.json");
      const s = JSON.parse(readFileSync(file, "utf8")) as Stack;
      const valid =
        s.id === name &&
        ID.test(s.id) &&
        typeof s.name === "string" &&
        Number.isInteger(s.port) &&
        typeof s.detect === "object" &&
        Array.isArray(s.roles) &&
        Array.isArray(s.skills) &&
        s.skills.every((r) => Array.isArray(r) && r.length === 2);
      if (!valid) throw new Error(`stack.json inválido: stacks/${name}/stack.json`);
      return s;
    });
}

export function stackDir(stack: Stack): string {
  return join(TEMPLATES, "stacks", stack.id);
}

/** Spec 02 §6: any of detect.files exists, or detect.manifest exists and contains detect.contains. First match wins. */
export function detectStack(stacks: Stack[], root: string): Stack | undefined {
  return stacks.find((s) => {
    if ((s.detect.files ?? []).some((f) => existsSync(join(root, f)))) return true;
    const { manifest, contains } = s.detect;
    if (!manifest || !contains) return false;
    const file = join(root, manifest);
    return isFile(file) && readFileSync(file, "utf8").includes(contains);
  });
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Regular files under `dir`, as sorted POSIX-style relative paths. Symlinks are skipped. */
export function walk(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  // Code-point order, not localeCompare: the result must not depend on the system locale.
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** Mode a copied template file gets: scripts and executables 755, the rest 644. */
export function modeOf(src: string): number {
  return src.endsWith(".sh") || (statSync(src).mode & 0o111) !== 0 ? 0o755 : 0o644;
}

export function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => vars[key] ?? m);
}
