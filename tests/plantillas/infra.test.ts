import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
    assert.match(r.stdout + r.stderr, /Uso: infra\.sh --db postgres\|mysql\|sqlite\|mongo\|none/);
  });

  it("activates MongoDB: the connection only (overlay, .env.example block and a mongosh db-shell)", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    const r = infra(d, "--db", "mongo");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^\s*\+ compose\.db\.yaml$/m);
    assert.match(r.stdout, /^\s*~ \.env\.example \[db\]$/m);
    const overlay = read(d, "compose.db.yaml");
    assert.match(overlay, /image: mongo:/);
    assert.doesNotMatch(overlay, /^\s*ports:/m, "the database publishes no ports");
    assert.match(overlay, /^\s*start_period: 30s$/m);
    assert.match(r.stdout, /infra OK: db=mongo redis=0/);
  });

  it("MongoDB (S2): root is root/DB_ROOT_PASSWORD and the app connects as DB_USER with readWrite on DB_NAME only", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    assert.equal(infra(d, "--db", "mongo").code, 0);
    const overlay = read(d, "compose.db.yaml");
    // Every app URL authenticates the app user against its own database.
    const url = "mongodb://${DB_USER:-app}:${DB_PASSWORD}@db:27017/${DB_NAME:-app}?authSource=${DB_NAME:-app}";
    for (const key of ["DATABASE_URL", "MONGO_URL", "SPRING_DATA_MONGODB_URI"]) {
      assert.ok(overlay.includes(`  ${key}: ${url}\n`), `${key} does not use the app user with authSource=<db>`);
    }
    assert.doesNotMatch(overlay, /authSource=admin/);
    assert.match(overlay, /^\s*MONGO_INITDB_ROOT_USERNAME: root$/m);
    assert.match(overlay, /^\s*MONGO_INITDB_ROOT_PASSWORD: \$\{DB_ROOT_PASSWORD:\?/m);
    // The init script travels inside the overlay (one file for infra.sh) and is mounted where the image runs it.
    assert.match(overlay, /^\s*target: \/docker-entrypoint-initdb\.d\/[\w-]+\.js$/m);
    assert.match(overlay, /^configs:\n\s+[\w-]+:\n\s+content: \|/m);
    assert.match(overlay, /createUser\(/);
    assert.match(overlay, /role: "readWrite"/);
    // Healthy only when the app user exists: through the service host (not the init-time localhost-only mongod),
    // as the app user against the app database. $$ leaves the variables to the container.
    assert.match(overlay, /test: \[.*mongosh.*--host db.*-u \\"\$\$\{MONGO_APP_USERNAME\}\\" -p \\"\$\$\{MONGO_APP_PASSWORD\}\\" --authenticationDatabase \\"\$\$\{MONGO_INITDB_DATABASE\}\\"/);
    assert.match(read(d, ".env.example"),
      /^# >>> db\nDB_NAME=app\nDB_USER=app\nDB_PASSWORD=__GENERATE__\nDB_ROOT_PASSWORD=__GENERATE__\n# <<< db$/m);
    assert.equal(read(d, ".make/db.mk"),
      `DB_SHELL_CMD = sh -c 'mongosh -u "$$MONGO_APP_USERNAME" -p "$$MONGO_APP_PASSWORD" --authenticationDatabase "$$MONGO_INITDB_DATABASE" "$$MONGO_INITDB_DATABASE"'\n`);
  });

  it("rejects an unknown engine and lists mongo among the valid ones", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    const r = infra(d, "--db", "oracle");
    assert.equal(r.code, 2);
    assert.match(r.stdout, /ERROR: --db debe ser postgres, mysql, sqlite, mongo o none/);
  });

  it("without a Makefile (Docker only) it writes no .make/ but still activates the database", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    rmSync(join(d, "Makefile"));
    rmSync(join(d, ".make"), { recursive: true, force: true });
    const r = infra(d, "--db", "postgres");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(d, "compose.db.yaml")));
    assert.equal(existsSync(join(d, ".make")), false, ".make/ was created without a Makefile");
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

  it("ignores Python's __pycache__/ folders anywhere (S17)", () => {
    const d = scratch();
    assert.equal(init(d).code, 0);
    for (const f of ["__pycache__/x.pyc", "src/modules/a/__pycache__/m.cpython-312.pyc"]) {
      assert.equal(sh("git", ["check-ignore", "-q", f], d).code, 0, `${f} must be ignored`);
    }
    assert.equal(sh("git", ["check-ignore", "-q", "src/pycache.py"], d).code, 1);
  });
});

describe("infra.sh resolves its project from its own location (S17)", () => {
  it("writes into the project it belongs to, whatever the working directory or git top level", () => {
    const outer = scratch();
    assert.equal(sh("git", ["init", "-q"], outer).code, 0);
    const d = join(outer, "app");
    assert.equal(init(d).code, 0);
    // A project inside another repository's tree: with its .git removed, git's top level is `outer`.
    rmSync(join(d, ".git"), { recursive: true, force: true });
    const r = sh("bash", [join(d, INFRA), "--db", "mysql"], scratch());
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(d, "compose.db.yaml")), "the overlay goes into the project");
    assert.ok(!existsSync(join(outer, "compose.db.yaml")) && !existsSync(join(outer, ".make")), "nothing in the outer repository");
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

  it("collapses a block that appears twice into one, without duplicating keys", () => {
    const d = scratch();
    assert.equal(init(d, "--db", "postgres").code, 0);
    const block = /# >>> db\n[\s\S]*?# <<< db\n/.exec(read(d, ".env.example"))![0];
    writeFileSync(join(d, ".env.example"), `${read(d, ".env.example")}${block}`);
    const r = infra(d, "--db", "mysql", "--force");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const text = read(d, ".env.example");
    assert.equal(text.match(/^# >>> db$/gm)?.length, 1, text);
    assert.equal(text.match(/^DB_PASSWORD=/gm)?.length, 1, text);
  });
});
