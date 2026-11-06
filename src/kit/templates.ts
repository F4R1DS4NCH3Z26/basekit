import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The bundled templates. They are read-only package assets, so they are read straight from disk;
 * the target project is only ever touched through `Project`.
 */
export const TEMPLATES = fileURLToPath(new URL("../../../plantillas/", import.meta.url));

export const VERSION: string = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
).version;

/** Text of a template file, `rel` being relative to `plantillas/`. */
export const template = (rel: string) => readFileSync(join(TEMPLATES, rel), "utf8");

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

/** Replaces the known `{{KEY}}` placeholders (spec 02 §5); unknown ones are left as they are. */
export function render(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (m, key: string) => vars[key] ?? m);
}
