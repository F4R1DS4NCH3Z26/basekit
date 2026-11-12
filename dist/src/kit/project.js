import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
/** Secrets basekit must never read (spec 02 §12). */
const SECRET = /^\.env(\.prod|\..+\.local)?$/;
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const outside = (p, root) => p !== root && !p.startsWith(root + sep);
/** Absolute project root from the `[dir]` argument (`~` expanded, default: the current directory). */
export function resolveRoot(dir) {
    const raw = dir ?? ".";
    if (raw === "~")
        return homedir();
    return resolve(raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}
/**
 * The target project. Every read and write goes through here: paths are confined to the
 * project root (symlinks included), unchanged content is never rewritten, and --dry-run writes nothing.
 */
export class Project {
    root;
    dryRun;
    log;
    fs;
    /** True once anything was created or updated. */
    changed = false;
    constructor(root, dryRun, log, fs) {
        this.root = root;
        this.dryRun = dryRun;
        this.log = log;
        this.fs = fs;
    }
    path(rel) {
        const abs = resolve(this.root, rel);
        if (outside(abs, this.root))
            throw new Error(`Ruta fuera del proyecto: ${rel}`);
        return abs;
    }
    /** True once the project directory exists. */
    existsRoot() {
        return this.fs.exists(this.root);
    }
    /** True when `rel` really lives outside the project because a directory on its way is a symlink (02 §12). */
    escapes(rel) {
        if (!this.fs.exists(this.root))
            return false;
        let probe = this.path(rel);
        while (probe !== this.root && !this.fs.exists(probe))
            probe = dirname(probe);
        return outside(this.fs.realpath(probe), this.fs.realpath(this.root));
    }
    /** Reports and returns true when writing `rel` would leave the project. */
    refuse(rel) {
        if (!this.escapes(rel))
            return false;
        this.report("!", rel, "fuera del proyecto por un enlace simbólico; no se escribe");
        return true;
    }
    exists(rel) {
        return this.fs.exists(this.path(rel));
    }
    isFile(rel) {
        return this.fs.kind(this.path(rel)) === "file";
    }
    read(rel) {
        if (SECRET.test(basename(rel)))
            throw new Error(`basekit nunca lee ${rel}`);
        const p = this.path(rel);
        return this.fs.exists(p) && !this.escapes(rel) ? this.fs.read(p) : undefined;
    }
    /** Names of the sub-directories of `rel` (empty if it does not exist). */
    dirs(rel) {
        return this.fs.list(this.path(rel)).filter((e) => e.kind === "dir").map((e) => e.name);
    }
    /** Names of the files of `rel` (empty if it does not exist). */
    files(rel) {
        return this.fs.list(this.path(rel)).filter((e) => e.kind === "file").map((e) => e.name);
    }
    report(mark, rel, note) {
        if (mark === "+" || mark === "~")
            this.changed = true;
        this.log(`${mark} ${rel}${note ? `  (${note})` : ""}`);
    }
    /** Creates the project directory. No-op in dry-run. */
    createRoot() {
        if (!this.dryRun)
            this.fs.mkdirp(this.root);
    }
    write(rel, content, mode) {
        if (!this.dryRun)
            this.fs.write(this.path(rel), content, mode);
    }
    /** Relative symlink `rel` → `targetRel`; copies the target when links are not allowed. Never replaces an existing entry. */
    link(rel, targetRel) {
        if (this.refuse(rel))
            return;
        const abs = this.path(rel);
        const target = this.path(targetRel);
        if (this.fs.kind(abs) !== undefined) {
            this.report("=", rel);
            return;
        }
        if (!this.dryRun) {
            try {
                this.fs.symlink(relative(dirname(abs), target), abs);
            }
            catch {
                this.fs.copyDir(target, abs);
                this.report("+", rel, "copia: no se pudo crear el enlace");
                return;
            }
        }
        this.report("+", rel);
    }
    /** True when `rel` is a symlink that resolves to the same real path as `targetRel`. */
    linksTo(rel, targetRel) {
        const abs = this.path(rel);
        const target = this.path(targetRel);
        if (this.fs.kind(abs) !== "symlink" || !this.fs.exists(abs) || !this.fs.exists(target))
            return false;
        return this.fs.realpath(abs) === this.fs.realpath(target);
    }
    /** Removes a file or a symlink (never its target). Missing entries are skipped; no-op in dry-run. */
    remove(rel) {
        const abs = this.path(rel);
        const kind = this.fs.kind(abs);
        if (kind === undefined || kind === "dir" || this.refuse(rel))
            return;
        if (!this.dryRun)
            this.fs.remove(abs);
    }
    /**
     * Removes the directory `rel` and its sub-directories when they hold nothing else, so a file that
     * basekit did not write keeps its folder. Returns true when `rel` is gone. No-op in dry-run.
     */
    removeEmptyDirs(rel) {
        const abs = this.path(rel);
        if (this.fs.kind(abs) !== "dir" || this.escapes(rel))
            return false;
        let empty = true;
        for (const e of this.fs.list(abs)) {
            if (e.kind !== "dir" || !this.removeEmptyDirs(`${rel}/${e.name}`))
                empty = false;
        }
        if (empty && !this.dryRun)
            this.fs.remove(abs);
        return empty;
    }
    /** Creates the file only if it does not exist. */
    create(rel, content, mode) {
        if (this.refuse(rel))
            return "!";
        if (this.exists(rel)) {
            this.report("=", rel);
            return "=";
        }
        this.write(rel, content, mode);
        this.report("+", rel);
        return "+";
    }
    /** Creates or updates a file basekit owns; rewrites it only when the content differs. */
    generated(rel, content, mode) {
        if (this.refuse(rel))
            return "!";
        const cur = this.read(rel);
        const mark = cur === undefined ? "+" : cur === content ? "=" : "~";
        if (mark !== "=")
            this.write(rel, content, mode);
        this.report(mark, rel);
        return mark;
    }
    /** Rewrites a file the user owns with `content`, reporting `~` and why; unchanged content is not rewritten. */
    update(rel, content, note) {
        if (this.refuse(rel))
            return "!";
        if (this.read(rel) === content) {
            this.report("=", rel);
            return "=";
        }
        this.write(rel, content);
        this.report("~", rel, note);
        return "~";
    }
    /**
     * A kit file the user may edit. It is updated only if it still matches what basekit wrote
     * last time (`prev` hash), or with --force. `next` receives the hash to remember.
     */
    tracked(rel, content, mode, prev, next, force) {
        if (this.refuse(rel))
            return "!";
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
        if (prev[rel])
            next[rel] = prev[rel];
        this.report("!", rel, "modificado localmente; se conserva (usa --force para reemplazarlo)");
        return "!";
    }
    /**
     * Replaces the managed block between its markers, or appends it after a blank line.
     * Everything outside the block belongs to the user. Returns the resulting file content.
     */
    block(rel, block, isStart, endLine) {
        const body = block.replace(/\n*$/, "\n");
        if (this.refuse(rel))
            return "";
        const cur = this.read(rel);
        let next;
        if (cur === undefined) {
            next = body;
        }
        else {
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
            }
            else {
                const kept = cur.replace(/\n*$/, "");
                next = kept ? `${kept}\n\n${body}` : body;
            }
        }
        this.generated(rel, next);
        return next;
    }
}
