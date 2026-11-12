import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname } from "node:path";
import type { EntryKind, FileSystem } from "../../src/infra/file-system.js";
import { Project, sha256 } from "../../src/kit/project.js";

/** An in-memory FileSystem (no symlinks): enough to test Project's write policies without a disk. */
class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, { content: string; mode?: number }>();
  readonly dirs = new Set<string>(["/"]);
  writes = 0;

  private addDirs(path: string): void {
    for (let d = path; !this.dirs.has(d); d = dirname(d)) this.dirs.add(d);
  }
  exists(path: string) {
    return this.files.has(path) || this.dirs.has(path);
  }
  kind(path: string): EntryKind | undefined {
    return this.files.has(path) ? "file" : this.dirs.has(path) ? "dir" : undefined;
  }
  read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error(`ENOENT ${path}`);
    return f.content;
  }
  write(path: string, content: string, mode?: number) {
    this.addDirs(dirname(path));
    this.files.set(path, { content, mode });
    this.writes++;
  }
  mkdirp(path: string) {
    this.addDirs(path);
  }
  list(path: string) {
    const children = (set: Iterable<string>, kind: EntryKind) =>
      [...set].filter((p) => p !== path && dirname(p) === path).map((p) => ({ name: p.slice(path.length + 1), kind }));
    return [...children(this.dirs, "dir"), ...children(this.files.keys(), "file")].sort((a, b) => (a.name < b.name ? -1 : 1));
  }
  realpath(path: string) {
    return path;
  }
  symlink(): void {
    throw new Error("symlinks are not supported in memory");
  }
  copyDir(): void {
    throw new Error("not supported in memory");
  }
  remove(path: string): void {
    if (!this.files.delete(path)) this.dirs.delete(path);
  }
}

function project(dryRun = false) {
  const fs = new MemoryFileSystem();
  fs.mkdirp("/p");
  const lines: string[] = [];
  return { fs, lines, p: new Project("/p", dryRun, (l) => lines.push(l), fs) };
}

const isStart = (l: string) => l.startsWith("<!-- basekit:start");
const END = "<!-- basekit:end -->";

describe("Project write policies (in memory)", () => {
  it("create never overwrites, and reports + then =", () => {
    const { fs, lines, p } = project();
    assert.equal(p.create("a.txt", "one\n"), "+");
    assert.equal(p.create("a.txt", "two\n"), "=");
    assert.equal(fs.read("/p/a.txt"), "one\n");
    assert.deepEqual(lines, ["+ a.txt", "= a.txt"]);
  });

  it("generated rewrites only when the content differs", () => {
    const { fs, p } = project();
    p.generated("g.md", "x\n");
    p.generated("g.md", "x\n");
    assert.equal(fs.writes, 1);
    assert.equal(p.generated("g.md", "y\n"), "~");
    assert.equal(fs.read("/p/g.md"), "y\n");
  });

  it("block replaces only the managed block and keeps the user's text around it", () => {
    const { fs, p } = project();
    fs.write("/p/AGENTS.md", `# Mío\n\n<!-- basekit:start v0\nviejo\n${END}\n\n## Abajo\n`);
    p.block("AGENTS.md", `<!-- basekit:start v1\nnuevo\n${END}\n`, isStart, END);
    assert.equal(fs.read("/p/AGENTS.md"), `# Mío\n\n<!-- basekit:start v1\nnuevo\n${END}\n\n## Abajo\n`);
  });

  it("block appends after a blank line when there is no block yet", () => {
    const { fs, p } = project();
    fs.write("/p/.gitignore", "node_modules/\n");
    p.block(".gitignore", "# >>> basekit\n.env\n# <<< basekit\n", (l) => l === "# >>> basekit", "# <<< basekit");
    assert.equal(fs.read("/p/.gitignore"), "node_modules/\n\n# >>> basekit\n.env\n# <<< basekit\n");
  });

  it("tracked keeps a local edit unless --force, and updates an untouched file", () => {
    const { fs, lines, p } = project();
    const next: Record<string, string> = {};
    fs.write("/p/s.md", "mine\n");
    assert.equal(p.tracked("s.md", "kit v2\n", 0o644, { "s.md": sha256("kit v1\n") }, next, false), "!");
    assert.equal(fs.read("/p/s.md"), "mine\n");
    assert.match(lines.at(-1)!, /--force/);

    fs.write("/p/t.md", "kit v1\n");
    assert.equal(p.tracked("t.md", "kit v2\n", 0o644, { "t.md": sha256("kit v1\n") }, next, false), "~");
    assert.equal(fs.read("/p/t.md"), "kit v2\n");
    assert.equal(next["t.md"], sha256("kit v2\n"));
  });

  it("dry-run reports the same marks and writes nothing", () => {
    const { fs, lines, p } = project(true);
    const before = fs.writes;
    p.create("a.txt", "x");
    p.generated("b.txt", "y");
    p.block("AGENTS.md", `<!-- basekit:start\n${END}\n`, isStart, END);
    assert.equal(fs.writes, before);
    assert.deepEqual(lines, ["+ a.txt", "+ b.txt", "+ AGENTS.md"]);
  });

  it("refuses paths outside the root and never reads .env", () => {
    const { p } = project();
    assert.throws(() => p.create("../fuera.txt", "x"), /fuera del proyecto/);
    assert.throws(() => p.read(".env"), /nunca lee/);
    assert.throws(() => p.read("config/.env.prod"), /nunca lee/);
  });
});
