import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, readdirSync, readFileSync, renameSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, gitCommitAll, scratch, sh } from "../helpers.js";

after(cleanup);

const INFRA = ".agents/skills/infra-setup/scripts/infra.sh";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const init = (dir: string, ...extra: string[]) =>
  basekit(["init", dir, "--yes", "--no-external-skills", "--stack", "nextjs", ...extra]);
const infra = (dir: string, ...args: string[]) => sh("bash", [INFRA, ...args], dir);
const infraWith = (dir: string, env: NodeJS.ProcessEnv, ...args: string[]) => sh("bash", [INFRA, ...args], dir, env);

describe("infra.sh", () => {
  it("reports = and changes nothing when rerun with the same database", () => {
    const d = scratch();
    assert.equal(init(d, "--db", "postgres").code, 0);
    gitCommitAll(d);
    const r = infra(d, "--db", "postgres");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /^\s*[+~] /m, "nothing was created or changed");
    assert.match(r.stdout, /^\s*= compose\.db\.yaml$/m);
    assert.match(r.stdout, /^\s*= \.env\.example \[db\]$/m);
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, "");
  });

  it("reports + and ~ when it activates a database", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    const r = infra(d, "--db", "mysql");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^\s*\+ compose\.db\.yaml$/m);
    assert.match(r.stdout, /^\s*~ \.env\.example \[db\]$/m);
    assert.match(read(d, ".env.example"), /^DB_ROOT_PASSWORD=__GENERATE__$/m);
  });

  it("keeps the mode of .env.example when it updates the block", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    // The initial mode depends on the developer's umask: only "unchanged" is asserted.
    const before = statSync(join(d, ".env.example")).mode & 0o777;
    const r = infra(d, "--db", "mysql");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(statSync(join(d, ".env.example")).mode & 0o777, before);
  });

  it("prints the usage and exits 2 when --db has no value", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    const r = infra(d, "--db");
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /Uso: infra\.sh --db postgres\|mysql\|sqlite\|none/);
  });

  it("replaces a different overlay only with --force", () => {
    const d = scratch();
    assert.equal(init(d, "--db", "postgres").code, 0);
    const overlay = read(d, "compose.db.yaml");
    const refused = infra(d, "--db", "mysql");
    assert.equal(refused.code, 1);
    assert.match(refused.stdout, /compose\.db\.yaml ya existe con otro contenido/);
    assert.equal(read(d, "compose.db.yaml"), overlay);

    const forced = infra(d, "--db", "mysql", "--force");
    assert.equal(forced.code, 0, forced.stdout + forced.stderr);
    assert.match(forced.stdout, /^\s*~ compose\.db\.yaml$/m);
    assert.notEqual(read(d, "compose.db.yaml"), overlay);
  });
});

describe("infra.sh: .env.example replacement", () => {
  it("writes through a symlinked .env.example instead of replacing the link", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    renameSync(join(d, ".env.example"), join(d, "shared.env.example"));
    symlinkSync("shared.env.example", join(d, ".env.example"));
    const r = infra(d, "--db", "postgres");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(lstatSync(join(d, ".env.example")).isSymbolicLink(), "the link was replaced by a regular file");
    assert.match(read(d, "shared.env.example"), /^DB_PASSWORD=__GENERATE__$/m);
  });

  it("updates the target of an in-project symlink atomically", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    renameSync(join(d, ".env.example"), join(d, "shared.env.example"));
    symlinkSync("shared.env.example", join(d, ".env.example"));
    const before = read(d, "shared.env.example");
    const bin = scratch();
    writeFileSync(join(bin, "mv"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${bin}/mv.log"\nexit 1\n`, { mode: 0o755 });
    const r = infraWith(d, { PATH: `${bin}:${process.env.PATH}` }, "--db", "postgres");
    assert.notEqual(r.code, 0, "the failing mv must stop the script");
    // The only mv that ran is the one replacing the link's target: the failure happened in that step.
    assert.match(readFileSync(join(bin, "mv.log"), "utf8"), /^\S*\/\.env\.example\.\w+ \S*\/shared\.env\.example\n$/);
    assert.equal(read(d, "shared.env.example"), before, "the shared file was left half written");
    assert.deepEqual(readdirSync(d).filter((f) => f.startsWith(".env.example.")), []);
  });

  it("refuses a symlinked .env.example that points outside the project and changes nothing", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    gitCommitAll(d);
    const outside = join(scratch(), "team.env.example");
    writeFileSync(outside, "SHARED=1\n");
    sh("git", ["rm", "-q", ".env.example"], d);
    symlinkSync(outside, join(d, ".env.example"));
    const status = sh("git", ["status", "--porcelain"], d).stdout;
    const r = infra(d, "--db", "postgres");
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /ERROR: \.env\.example apunta fuera del proyecto/);
    assert.equal(readFileSync(outside, "utf8"), "SHARED=1\n", "a file outside the project was modified");
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, status, "the project was changed");
  });

  it("a failure while replacing it leaves no temporary copy behind", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    const bin = scratch();
    writeFileSync(join(bin, "mv"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const r = infraWith(d, { PATH: `${bin}:${process.env.PATH}` }, "--db", "postgres");
    assert.notEqual(r.code, 0, "the failing mv must stop the script");
    assert.deepEqual(readdirSync(d).filter((f) => f.startsWith(".env.example.")), []);
  });
});

describe(".gitignore block", () => {
  it("ignores every env file by default and keeps only the secret-free templates tracked", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    // Deny by default: any env variant can hold secrets (staging, backups, direnv...).
    for (const f of [".env", ".env.local", ".env.development.local", ".env.production", ".env.production.bak", ".env.prod",
      ".env.prod.bak", ".env.staging", ".env.dev", ".env.bak", ".env.test", ".env.development", ".envrc", "x.pem", "x.key"]) {
      assert.equal(sh("git", ["check-ignore", "-q", f], d).code, 0, `${f} must be ignored`);
    }
    for (const f of [".env.example", ".env.sample", ".env.template"]) {
      assert.equal(sh("git", ["check-ignore", "-q", f], d).code, 1, `${f} must stay tracked`);
    }
  });
});

describe("infra.sh: block placement", () => {
  it("replaces an existing block where it is, keeping the order of .env.example", () => {
    const d = scratch();
    assert.equal(init(d, "--db", "postgres").code, 0);
    writeFileSync(join(d, ".env.example"), `${read(d, ".env.example")}AFTER=1\n`);
    const r = infra(d, "--db", "mysql", "--force");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const text = read(d, ".env.example");
    assert.match(text, /DB_ROOT_PASSWORD=__GENERATE__/);
    assert.ok(text.indexOf("# <<< db") < text.indexOf("AFTER=1"), "the db block moved below later lines");
  });
});
