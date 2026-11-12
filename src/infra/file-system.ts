import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type EntryKind = "file" | "dir" | "symlink" | "other";

/** Port for everything basekit does on the target project's disk. Paths are absolute. */
export interface FileSystem {
  /** True if the path exists, following symlinks. */
  exists(path: string): boolean;
  /** Kind of the entry itself (a symlink is reported as such), or undefined if there is none. */
  kind(path: string): EntryKind | undefined;
  read(path: string): string;
  /** Writes the file, creating its parent directories; `mode` is applied even if the file existed. */
  write(path: string, content: string, mode?: number): void;
  mkdirp(path: string): void;
  /** Entries of a directory sorted by code point, or [] when it does not exist. */
  list(path: string): { name: string; kind: EntryKind }[];
  realpath(path: string): string;
  /** Creates the symlink `path` → `target` (relative targets stay relative). */
  symlink(target: string, path: string): void;
  copyDir(from: string, to: string): void;
  /** Removes a file, a symlink (never its target) or an empty directory; a non-empty directory throws. */
  remove(path: string): void;
}

const kindOf = (e: { isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }): EntryKind =>
  e.isSymbolicLink() ? "symlink" : e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";

/** The real disk. */
export const nodeFileSystem: FileSystem = {
  exists: (path) => existsSync(path),
  kind(path) {
    try {
      return kindOf(lstatSync(path));
    } catch {
      return undefined;
    }
  },
  read: (path) => readFileSync(path, "utf8"),
  write(path, content, mode) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, mode === undefined ? undefined : { mode });
    if (mode !== undefined) chmodSync(path, mode);
  },
  mkdirp(path) {
    mkdirSync(path, { recursive: true });
  },
  list(path) {
    if (!existsSync(path)) return [];
    // Code-point order, not localeCompare: the result must not depend on the system locale.
    return readdirSync(path, { withFileTypes: true })
      .map((e) => ({ name: e.name, kind: kindOf(e) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  },
  realpath: (path) => realpathSync(path),
  symlink(target, path) {
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path, "dir");
  },
  copyDir(from, to) {
    cpSync(from, to, { recursive: true });
  },
  remove(path) {
    if (lstatSync(path).isDirectory()) rmdirSync(path);
    else unlinkSync(path);
  },
};
