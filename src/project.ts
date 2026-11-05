import { createHash } from "node:crypto";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";

export type Mark = "+" | "~" | "=" | "!";

/** Secrets basekit must never read (spec 02 §12). */
const SECRET = /^\.env(\.prod|\..+\.local)?$/;

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const outside = (p: string, root: string) => p !== root && !p.startsWith(root + sep);

/**
 * Every write to the target project goes through here: paths are confined to the
 * project root, unchanged content is never rewritten, and --dry-run writes nothing.
 */
export class Project {
  /** True once anything was created or updated. */
  changed = false;

  constructor(
    readonly root: string,
    readonly dryRun: boolean,
    private readonly log: (line: string) => void,
  ) {}

  path(rel: string): string {
    const abs = resolve(this.root, rel);
    if (outside(abs, this.root)) throw new Error(`Ruta fuera del proyecto: ${rel}`);
    return abs;
  }

  /** True when `rel` really lives outside the project because a directory on its way is a symlink (02 §12). */
  escapes(rel: string): boolean {
    if (!existsSync(this.root)) return false;
    let probe = this.path(rel);
    while (probe !== this.root && !existsSync(probe)) probe = dirname(probe);
    return outside(realpathSync(probe), realpathSync(this.root));
  }

  /** Reports and returns true when writing `rel` would leave the project. */
  private refuse(rel: string): boolean {
    if (!this.escapes(rel)) return false;
    this.report("!", rel, "fuera del proyecto por un enlace simbólico; no se escribe");
    return true;
  }

  exists(rel: string): boolean {
    return existsSync(this.path(rel));
  }

  read(rel: string): string | undefined {
    if (SECRET.test(basename(rel))) throw new Error(`basekit nunca lee ${rel}`);
    const p = this.path(rel);
    return existsSync(p) && !this.escapes(rel) ? readFileSync(p, "utf8") : undefined;
  }

  /** Names of the sub-directories of `rel` (empty if it does not exist). */
  dirs(rel: string): string[] {
    const p = this.path(rel);
    if (!existsSync(p)) return [];
    return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  }

  /** Names of the files of `rel` (empty if it does not exist). */
  files(rel: string): string[] {
    const p = this.path(rel);
    if (!existsSync(p)) return [];
    return readdirSync(p, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
  }

  /** Relative symlink `rel` → `targetRel`; copies the target when links are not allowed. Never replaces an existing entry. */
  link(rel: string, targetRel: string): void {
    if (this.refuse(rel)) return;
    const abs = this.path(rel);
    const target = this.path(targetRel);
    let current: Stats | undefined;
    try {
      current = lstatSync(abs);
    } catch {
      current = undefined;
    }
    if (current) {
      this.report("=", rel);
      return;
    }
    if (!this.dryRun) {
      mkdirSync(dirname(abs), { recursive: true });
      try {
        symlinkSync(relative(dirname(abs), target), abs, "dir");
      } catch {
        cpSync(target, abs, { recursive: true });
        this.report("+", rel, "copia: no se pudo crear el enlace");
        return;
      }
    }
    this.report("+", rel);
  }

  report(mark: Mark, rel: string, note?: string): void {
    if (mark === "+" || mark === "~") this.changed = true;
    this.log(`${mark} ${rel}${note ? `  (${note})` : ""}`);
  }

  private write(rel: string, content: string, mode?: number): void {
    if (this.dryRun) return;
    const p = this.path(rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, mode === undefined ? undefined : { mode });
    if (mode !== undefined) chmodSync(p, mode);
  }

  /** Creates the file only if it does not exist. */
  create(rel: string, content: string, mode?: number): Mark {
    if (this.refuse(rel)) return "!";
    if (this.exists(rel)) {
      this.report("=", rel);
      return "=";
    }
    this.write(rel, content, mode);
    this.report("+", rel);
    return "+";
  }

  /** Creates or updates a file basekit owns; rewrites it only when the content differs. */
  generated(rel: string, content: string, mode?: number): Mark {
    if (this.refuse(rel)) return "!";
    const cur = this.read(rel);
    const mark: Mark = cur === undefined ? "+" : cur === content ? "=" : "~";
    if (mark !== "=") this.write(rel, content, mode);
    this.report(mark, rel);
    return mark;
  }

  /**
   * A kit file the user may edit. It is updated only if it still matches what basekit wrote
   * last time (`prev` hash), or with --force. `next` receives the hash to remember.
   */
  tracked(rel: string, content: string, mode: number, prev: Record<string, string>, next: Record<string, string>, force: boolean): Mark {
    if (this.refuse(rel)) return "!";
    const cur = this.read(rel);
    if (cur === undefined || cur === content) {
      next[rel] = sha256(content);
      return this.generated(rel, content, mode);
    }
    const untouched = prev[rel] === sha256(cur);
    if (untouched || force) {
      this.write(rel, content, mode);
      next[rel] = sha256(content);
      this.report("~", rel, untouched ? undefined : "reemplazado con --force");
      return "~";
    }
    if (prev[rel]) next[rel] = prev[rel];
    this.report("!", rel, "modificado localmente; se conserva (usa --force para reemplazarlo)");
    return "!";
  }

  /**
   * Replaces the managed block between its markers, or appends it after a blank line.
   * Everything outside the block belongs to the user. Returns the resulting file content.
   */
  block(rel: string, block: string, isStart: (line: string) => boolean, endLine: string): string {
    const body = block.replace(/\n*$/, "\n");
    if (this.refuse(rel)) return "";
    const cur = this.read(rel);
    let next: string;
    if (cur === undefined) {
      next = body;
    } else {
      const lines = cur.split("\n");
      const s = lines.findIndex(isStart);
      const e = s < 0 ? -1 : lines.findIndex((l, i) => i > s && l.trim() === endLine);
      if (s >= 0 && e < 0) {
        // Without the end marker we cannot tell where the user's text starts again: touch nothing.
        this.report("!", rel, `tiene el marcador de inicio sin «${endLine}»; corrígelo a mano`);
        return cur;
      }
      if (s >= 0 && e > s) {
        next = [...lines.slice(0, s), ...body.slice(0, -1).split("\n"), ...lines.slice(e + 1)].join("\n");
      } else {
        const kept = cur.replace(/\n*$/, "");
        next = kept ? `${kept}\n\n${body}` : body;
      }
    }
    this.generated(rel, next);
    return next;
  }
}
