import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync, } from "node:fs";
import { dirname } from "node:path";
const kindOf = (e) => e.isSymbolicLink() ? "symlink" : e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";
/** The real disk. */
export const nodeFileSystem = {
    exists: (path) => existsSync(path),
    kind(path) {
        try {
            return kindOf(lstatSync(path));
        }
        catch {
            return undefined;
        }
    },
    read: (path) => readFileSync(path, "utf8"),
    write(path, content, mode) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content, mode === undefined ? undefined : { mode });
        if (mode !== undefined)
            chmodSync(path, mode);
    },
    mkdirp(path) {
        mkdirSync(path, { recursive: true });
    },
    list(path) {
        if (!existsSync(path))
            return [];
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
};
