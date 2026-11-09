import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadStacks } from "../../../src/kit/stacks.js";
import { basekit, cleanup, gitCommitAll, REPO, scratch, sh } from "../../helpers.js";

after(cleanup);

const STACKS = loadStacks();
const byId = (id: string) => STACKS.find((s) => s.id === id)!;
const BACKENDS = STACKS.filter((s) => s.kind === "backend").map((s) => s.id);
const FRONTENDS = STACKS.filter((s) => s.kind === "frontend").map((s) => s.id);
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const init = (dir: string, ...extra: string[]) => basekit(["init", dir, "--yes", "--no-external-skills", ...extra]);
const lineFor = (out: string, label: RegExp) => out.split("\n").find((l) => label.test(l)) ?? "";

/** The targets `make help` lists (one indented row per target). */
const targetsOf = (help: string) =>
  help.replace(/\x1b\[[0-9;]*m/g, "").split("\n").filter((l) => /^\s+\S/.test(l)).map((l) => l.trim().split(/\s+/)[0]!);
const COMMON = ["help", "env", "doctor", "dev", "up", "down", "restart", "logs", "ps", "build", "install", "test", "lint",
  "verify", "migrate", "migration", "db-shell", "new-app", "prod-build", "prod-up", "prod-down", "prod-logs", "prod-migrate", "clean"];

describe("combined backend + frontend (S16): --stack <backend>+<frontend>", () => {
  it("fastapi+react: shared core at the root, a complete project in backend/ and frontend/", () => {
    const d = scratch();
    const r = init(d, "--stack", "fastapi+react", "--context", "Reservas");
    assert.equal(r.code, 0, r.stderr);

    // Root: the shared core once, and no stack files of its own.
    for (const f of [
      ".git", "AGENTS.md", "CLAUDE.md", "README.md", "Makefile", ".gitignore", ".gitattributes", "docs/PROJECT.md",
      ".agents/README.md", ".agents/manifest.json", ".agents/zones/orchestrator.txt",
      ".agents/skills/zone-check/SKILL.md", ".agents/skills/infra-setup/scripts/infra.sh",
      ".agents/skills/py-verify/SKILL.md", ".agents/skills/react-verify/SKILL.md",
      ".agents/roles/backend-data-writer.md", ".agents/roles/frontend-ui-writer.md",
      ".agents/zones/backend-data-writer.txt", ".agents/zones/frontend-ui-writer.txt",
      ".claude/agents/backend-data-writer.md", ".claude/agents/frontend-ui-writer.md",
      ".opencode/agents/backend-web-writer.md", ".opencode/agents/frontend-qa-writer.md",
      ".claude/skills/py-verify", ".claude/skills/react-verify",
    ]) assert.ok(existsSync(join(d, f)), `missing ${f}`);
    for (const f of ["Dockerfile", "compose.yaml", ".make", ".env.example", "src", ".agents/roles/data-writer.md", ".claude/agents/ui-writer.md"]) {
      assert.ok(!existsSync(join(d, f)), `${f} must not be at the root`);
    }
    assert.match(read(d, "Makefile"), /generado por basekit/);
    assert.match(read(d, "Makefile"), /-C backend/);

    // Each side: its stack files, the core Makefile, the starter and the skills its Makefile reads.
    const core = read(REPO, "plantillas/core/Makefile");
    for (const [side, stack, skill] of [["backend", "fastapi", "py-verify"], ["frontend", "react", "react-verify"]] as const) {
      assert.equal(read(d, `${side}/Makefile`), core, `${side}/Makefile is the core Makefile`);
      for (const f of [".make/stack.mk", "Dockerfile", "compose.yaml", "compose.dev.yaml", "compose.prod.yaml", ".env.example", ".dockerignore",
        `.agents/skills/${skill}/scripts/verify.sh`]) {
        assert.ok(existsSync(join(d, side, f)), `missing ${side}/${f}`);
      }
      assert.equal(read(d, `${side}/.make/stack.mk`), read(REPO, `plantillas/stacks/${stack}/files/.make/stack.mk`));
      assert.ok(!existsSync(join(d, side, "AGENTS.md")), `${side}/AGENTS.md: the core lives at the root`);
    }
    assert.ok(existsSync(join(d, "backend/src/main.py")), "the fastapi starter goes into backend/");
    assert.ok(existsSync(join(d, "frontend/.agents/skills/react-scaffold/assets/app/src/lib/api.ts.tpl")), "frontend new-app reads its scaffold assets");
    assert.ok(!existsSync(join(d, "frontend/package.json")), "react has no starter: make new-app creates the app");

    // AGENTS.md: both stack sections and both skill tables, in one block.
    const agents = read(d, "AGENTS.md");
    assert.ok(agents.includes(read(REPO, "plantillas/stacks/fastapi/AGENTS.section.md").trimEnd()), "backend section");
    assert.ok(agents.includes(read(REPO, "plantillas/stacks/react/AGENTS.section.md").trimEnd()), "frontend section");
    assert.match(agents, /\| `py-scaffold` \|/);
    assert.match(agents, /\| `react-scaffold` \|/);
    assert.match(agents, /backend\//);
    assert.doesNotMatch(agents, /\{\{[A-Z_]+\}\}/);
    assert.equal(agents.match(/<!-- basekit:start/g)?.length, 1);

    // Roles and adapters: prefixed by side, with their zones under the side folder.
    const role = read(d, ".agents/roles/backend-data-writer.md");
    assert.match(role, /^name: backend-data-writer$/m);
    assert.match(role, /\.agents\/zones\/backend-data-writer\.txt/);
    assert.match(role, /`backend\/`/);
    assert.equal(read(d, ".agents/zones/backend-data-writer.txt"), "backend/src/modules/*/models.py\nbackend/src/modules/*/schemas.py\n");
    assert.match(read(d, ".agents/zones/frontend-ui-writer.txt"), /^frontend\/src\/features\/\*\/components\/\*\*$/m);
    assert.match(read(d, ".claude/agents/frontend-ui-writer.md"), /^name: frontend-ui-writer$/m);
    assert.match(read(d, ".opencode/agents/backend-data-writer.md"), /^ {4}"backend\/src\/modules\/\*\/models\.py": allow$/m);
    const orch = read(d, ".agents/zones/orchestrator.txt");
    assert.ok(orch.startsWith(read(REPO, "plantillas/core/zones.orchestrator.common.txt")));
    assert.match(orch, /^backend\/src\/core\/\*\*$/m);
    assert.match(orch, /^frontend\/src\/lib\/\*\*$/m);

    const m = JSON.parse(read(d, ".agents/manifest.json"));
    assert.equal(m.stack, "fastapi+react");
    assert.deepEqual(m.options, { db: "auto", redis: false });
    assert.ok(m.files["backend/.agents/skills/py-verify/SKILL.md"], "side skills are tracked");

    assert.match(r.stdout, /make -C frontend new-app/);
    assert.doesNotMatch(r.stdout, /make -C backend new-app/, "fastapi got its starter");
  });

  it("the root Makefile lists the common targets and delegates them to both sides", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi+react").code, 0);
    const help = sh("make", ["help"], d);
    assert.equal(help.code, 0, help.stderr);
    const targets = targetsOf(help.stdout);
    for (const t of COMMON) assert.ok(targets.includes(t), `make help lacks ${t}`);

    const dev = sh("make", ["-n", "dev"], d);
    assert.equal(dev.code, 0, dev.stderr);
    assert.match(dev.stdout, /-p backend-dev-\d+ .*up -d --build/);
    assert.match(dev.stdout, /-p frontend-dev-\d+ .*up -d --build/);
    for (const side of ["backend", "frontend"]) {
      const alone = sh("make", ["-C", side, "-n", "dev"], d);
      assert.equal(alone.code, 0, alone.stderr);
      assert.match(alone.stdout, new RegExp(`-p ${side}-dev-\\d+ .*up -d --build`));
      assert.ok(targetsOf(sh("make", ["-C", side, "help"], d).stdout).length >= 25, `${side} make help`);
    }
    const test = sh("make", ["-n", "test"], d);
    assert.match(test.stdout, /pytest -q/);
    assert.match(test.stdout, /vitest run/);
    const migrate = sh("make", ["-n", "migrate"], d);
    assert.match(migrate.stdout, /backend-dev-\d+/);
    assert.doesNotMatch(migrate.stdout, /frontend-dev-\d+/, "the database belongs to the backend only");
    const newApp = sh("make", ["-n", "new-app"], d);
    assert.equal(newApp.code, 0, newApp.stderr);
    assert.match(newApp.stdout, /create-vite/);
  });

  it("each side's compose.yaml gets its own project name, so prod never shares `backend` with another project", () => {
    const d = join(scratch(), "Mi.Tienda");
    assert.equal(init(d, "--stack", "fastapi+react").code, 0);
    assert.match(read(d, "backend/compose.yaml"), /^name: mitienda-backend$/m);
    assert.match(read(d, "frontend/compose.yaml"), /^name: mitienda-frontend$/m);
    const prod = sh("make", ["-C", "backend", "-n", "prod-up"], d);
    assert.doesNotMatch(prod.stdout, / -p /, "prod keeps the name from compose.yaml");
    const single = scratch();
    assert.equal(init(single, "--stack", "fastapi").code, 0);
    assert.equal(read(single, "compose.yaml"), read(REPO, "plantillas/stacks/fastapi/files/compose.yaml"), "a single stack is copied as is");
  });

  it("--db postgres --redis land only in backend/", () => {
    const d = scratch();
    const r = init(d, "--stack", "fastapi+react", "--db", "postgres", "--redis");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /infra OK: db=postgres redis=1/);
    for (const f of ["compose.db.yaml", "compose.redis.yaml", ".make/db.mk"]) {
      assert.ok(existsSync(join(d, "backend", f)), `missing backend/${f}`);
      assert.ok(!existsSync(join(d, "frontend", f)), `frontend/${f}`);
      assert.ok(!existsSync(join(d, f)), `root ${f}`);
    }
    assert.match(read(d, "backend/.env.example"), /^DB_PASSWORD=__GENERATE__$/m);
    assert.match(read(d, "backend/.env.example"), /^REDIS_PASSWORD=__GENERATE__$/m);
    assert.doesNotMatch(read(d, "frontend/.env.example"), /DB_|REDIS/);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).options, { db: "postgres", redis: true });
    assert.match(sh("make", ["-C", "backend", "-n", "dev"], d).stdout, /-f compose\.db\.yaml -f compose\.redis\.yaml/);
  });

  it("infra.sh resolves its project from its own location: backend's copy writes into backend/ from any folder (S17)", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi+react").code, 0);
    gitCommitAll(d);
    const infra = "backend/.agents/skills/infra-setup/scripts/infra.sh";
    const fromRoot = sh("bash", [infra, "--db", "mysql", "--redis"], d);
    assert.equal(fromRoot.code, 0, fromRoot.stdout + fromRoot.stderr);
    assert.match(fromRoot.stdout, /infra OK: db=mysql redis=1/);
    for (const f of ["compose.db.yaml", "compose.redis.yaml", ".make/db.mk"]) {
      assert.ok(existsSync(join(d, "backend", f)), `missing backend/${f}`);
      assert.ok(!existsSync(join(d, f)), `root ${f}`);
      assert.ok(!existsSync(join(d, "frontend", f)), `frontend/${f}`);
    }
    // From inside backend/ (the git top level is the root) and from outside the project: same folder.
    const inside = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", "mysql", "--redis"], join(d, "backend"));
    assert.equal(inside.code, 0, inside.stdout + inside.stderr);
    assert.match(inside.stdout, /^\s*= compose\.db\.yaml$/m);
    const outside = sh("bash", [join(d, infra), "--db", "mysql", "--redis"], scratch());
    assert.equal(outside.code, 0, outside.stdout + outside.stderr);
    assert.match(outside.stdout, /^\s*= compose\.db\.yaml$/m);
    assert.deepEqual(readdirSync(join(d, "frontend")).filter((f) => f.startsWith("compose.db")), []);
  });

  it("Claude's allowlist and AGENTS.md name the side copies of the skill scripts (S17)", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi+react", "--agents", "claude-code").code, 0);
    const settings = JSON.parse(read(d, ".claude/settings.json"));
    const scaffold = "bash backend/.agents/skills/py-scaffold/scripts/scaffold.sh";
    assert.ok(existsSync(join(d, scaffold.slice(5))), "the allowlisted script exists");
    assert.ok(settings.permissions.allow.includes(`Bash(${scaffold}:*)`), JSON.stringify(settings.permissions.allow));
    assert.ok(!settings.permissions.allow.includes("Bash(bash .agents/skills/py-scaffold/scripts/scaffold.sh:*)"), "root copy is not allowlisted");
    assert.ok(settings.permissions.ask.includes("Bash(bash backend/.agents/skills/infra-setup/scripts/infra.sh:*)"));
    const agents = read(d, "AGENTS.md");
    assert.match(agents, /`bash backend\/\.agents\/skills\/<skill>\/scripts\/scaffold\.sh <nombre>`/);
    assert.match(agents, /`bash backend\/\.agents\/skills\/infra-setup\/scripts\/infra\.sh --db postgres`/);
    assert.doesNotMatch(agents, /GIT_CEILING_DIRECTORIES/);
  });

  it("OpenCode's bash allowlist covers the side copies of the skill scripts (S17)", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi+react", "--agents", "opencode").code, 0);
    const bash = JSON.parse(read(d, "opencode.json")).permission.bash;
    for (const p of ["bash .agents/skills/*", "bash backend/.agents/skills/*", "bash frontend/.agents/skills/*"]) {
      assert.equal(bash[p], "allow", p);
    }
    const agent = read(d, ".opencode/agents/backend-data-writer.md");
    assert.match(agent, /^ {4}"bash backend\/\.agents\/skills\/\*": allow$/m);
    assert.match(agent, /^ {4}"bash frontend\/\.agents\/skills\/\*": allow$/m);
  });

  it("the side env files are git-ignored (S17)", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi+react").code, 0);
    const secrets = ["backend/.env", "backend/.env.prod", "frontend/.env", "frontend/.env.prod"];
    const ignored = sh("git", ["check-ignore", ...secrets], d);
    assert.equal(ignored.code, 0, ignored.stderr);
    assert.deepEqual(ignored.stdout.trim().split("\n"), secrets);
    assert.equal(sh("git", ["check-ignore", "backend/.env.example", "frontend/.env.example"], d).code, 1, "the templates stay versioned");
  });

  it("make logs runs both sides; S=<service> needs SIDE=backend|frontend, since a service lives on one side (S17)", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi+react", "--db", "postgres").code, 0);
    const both = sh("make", ["-n", "logs"], d);
    assert.equal(both.code, 0, both.stderr);
    assert.match(both.stdout, /-p backend-dev-\d+ .*logs -f --tail=100 *$/m);
    assert.match(both.stdout, /-p frontend-dev-\d+ .*logs -f --tail=100 *$/m);

    const noSide = sh("make", ["-n", "logs", "S=db"], d);
    assert.equal(noSide.code, 2, noSide.stdout);
    assert.match(noSide.stderr, /S=db .*SIDE=backend o SIDE=frontend/);
    assert.doesNotMatch(noSide.stdout, /docker compose/);

    // `app` exists on both sides, so S=app keeps following both, as it did before SIDE existed.
    const app = sh("make", ["-n", "logs", "S=app"], d);
    assert.equal(app.code, 0, app.stderr);
    assert.match(app.stdout, /-p backend-dev-\d+ .*logs -f --tail=100 app$/m);
    assert.match(app.stdout, /-p frontend-dev-\d+ .*logs -f --tail=100 app$/m);

    const db = sh("make", ["-n", "logs", "S=db", "SIDE=backend"], d);
    assert.equal(db.code, 0, db.stderr);
    assert.match(db.stdout, /-p backend-dev-\d+ .*logs -f --tail=100 db$/m);
    assert.doesNotMatch(db.stdout, /frontend-dev-/);

    const front = sh("make", ["-n", "logs", "SIDE=frontend"], d);
    assert.equal(front.code, 0, front.stderr);
    assert.match(front.stdout, /-p frontend-dev-\d+ .*logs -f --tail=100 *$/m);
    assert.doesNotMatch(front.stdout, /backend-dev-/);

    const bad = sh("make", ["-n", "logs", "SIDE=web"], d);
    assert.equal(bad.code, 2, bad.stdout);
    assert.match(bad.stderr, /SIDE debe ser backend o frontend/);

    const prod = sh("make", ["-n", "prod-logs", "S=db", "SIDE=backend"], d);
    assert.equal(prod.code, 0, prod.stderr);
    assert.match(prod.stdout, /logs -f --tail=100 db$/m);
    assert.doesNotMatch(prod.stdout, /frontend/);
    assert.match(sh("make", ["help"], d).stdout, /logs .*SIDE=backend\|frontend/);
  });

  it("wires the frontend to the API through the host and lets the backend's CORS allow it", () => {
    for (const [backend, frontend] of [["fastapi", "react"], ["gin", "vue"]] as [string, string][]) {
      const d = scratch();
      assert.equal(init(d, "--stack", `${backend}+${frontend}`).code, 0);
      const api = byId(backend).port;
      const web = byId(frontend).port;
      assert.match(read(d, "frontend/.env.example"), new RegExp(`^VITE_API_URL=http://127\\.0\\.0\\.1:${api}$`, "m"));
      assert.match(read(d, "backend/.env.example"), new RegExp(`^CORS_ORIGINS=http://127\\.0\\.0\\.1:${web},http://localhost:${web}$`, "m"));
    }
  });

  // Through the CLI only while some backend lacks CORS_ORIGINS; wireEnv's own test (tests/kit/layout.test.ts) always runs.
  const noCors = BACKENDS.find((id) => !/^CORS_ORIGINS=/m.test(read(REPO, `plantillas/stacks/${id}/files/.env.example`)));
  it("warns when the backend stack has no CORS setting, and still points the frontend at it", { skip: noCors ? false : "every backend stack has CORS_ORIGINS" }, () => {
    const d = scratch();
    const r = init(d, "--stack", `${noCors}+${FRONTENDS[0]}`);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^! backend\/\.env\.example .*CORS/m);
    assert.match(read(d, "frontend/.env.example"), new RegExp(`^VITE_API_URL=http://127\\.0\\.0\\.1:${byId(noCors!).port}$`, "m"));
  });

  for (const [bad, why] of [
    ["react+fastapi", /react.*frontend/],
    ["fastapi+django", /django.*backend/],
    ["nextjs+react", /nextjs.*fullstack/],
    ["fastapi+nope", /'nope' no existe/],
    ["fastapi+react+vue", /<backend>\+<frontend>/],
    ["fastapi+", /<backend>\+<frontend>/],
  ] as [string, RegExp][]) {
    it(`rejects --stack ${bad} with a usage error and writes nothing`, () => {
      const d = join(scratch(), "app");
      const r = init(d, "--stack", bad);
      assert.equal(r.code, 2, r.stdout);
      assert.match(r.stderr, why);
      assert.match(r.stderr, /<backend>\+<frontend>|no existe/);
      assert.ok(!existsSync(d), "nothing written");
    });
  }

  it("a frontend stack alone still rejects --db, and writes nothing (S1b regression)", () => {
    const d = join(scratch(), "app");
    const r = init(d, "--stack", FRONTENDS[0]!, "--db", "postgres");
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stderr, /--db 'postgres' no aplica/);
    assert.ok(!existsSync(d), "nothing written");
  });

  it("--dry-run writes nothing and shows the side paths", () => {
    const d = join(scratch(), "app");
    const r = init(d, "--stack", "fastapi+react", "--db", "postgres", "--dry-run");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(d));
    assert.match(r.stdout, /^\+ backend\/Dockerfile$/m);
    assert.match(r.stdout, /^\+ frontend\/\.make\/stack\.mk$/m);
    assert.match(r.stdout, /^\+ \.claude\/agents\/backend-data-writer\.md$/m);
    assert.match(r.stdout, /^· ejecutaría: bash backend\/\.agents\/skills\/infra-setup\/scripts\/infra\.sh --db postgres$/m);
    assert.match(r.stdout, /^\+ backend\/\.agents\/skills\/infra-setup\/scripts\/infra\.sh$/m);
  });

  it("a rerun takes the pair from the manifest and changes nothing; sync and doctor work on it", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi+react", "--agents", "claude-code,opencode").code, 0);
    gitCommitAll(d);
    const before = read(d, ".agents/manifest.json");

    const again = init(d);
    assert.equal(again.code, 0, again.stderr);
    assert.deepEqual(again.stdout.split("\n").filter((l) => /^[+~!] /.test(l)), []);
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, "");
    assert.equal(read(d, ".agents/manifest.json"), before);

    rmSync(join(d, ".claude/agents/backend-data-writer.md"));
    const s = basekit(["sync", d, "--no-external-skills"]);
    assert.equal(s.code, 0, s.stderr);
    assert.match(s.stdout, /^\+ \.claude\/agents\/backend-data-writer\.md$/m);
    assert.doesNotMatch(s.stdout, /^\+ \.claude\/agents\/data-writer\.md$/m);
    assert.equal(JSON.parse(read(d, ".agents/manifest.json")).stack, "fastapi+react");
    // Only the restored adapter changed, so the manifest only moves its updatedAt.
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, " M .agents/manifest.json\n", "sync restores exactly what init wrote");
    const { updatedAt: _a, ...afterSync } = JSON.parse(read(d, ".agents/manifest.json"));
    const { updatedAt: _b, ...atInit } = JSON.parse(before);
    assert.deepEqual(afterSync, atInit);

    const doc = basekit(["doctor", d]);
    assert.equal(doc.code, 1, "no app nor .env yet");
    for (const f of ["backend/Makefile", "backend/.make/stack.mk", "backend/Dockerfile", "backend/compose.yaml", "frontend/compose.prod.yaml",
      "frontend/.env.example", "backend/.agents/skills/py-verify/SKILL.md", "frontend/.agents/skills/react-verify/SKILL.md"]) {
      assert.match(lineFor(doc.stdout, new RegExp(` ${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`)), /^OK /, f);
    }
    assert.match(lineFor(doc.stdout, / Makefile \(raíz\)/), /^OK /);
    assert.match(lineFor(doc.stdout, /frontend\/package\.json/), /^FALTA .*make -C frontend new-app/);
    assert.match(lineFor(doc.stdout, /backend\/pyproject\.toml/), /^OK /);
    assert.match(lineFor(doc.stdout, / backend\/\.env(\s|$)/), /^FALTA .*make env/);
    assert.match(lineFor(doc.stdout, /py-verify\/SKILL\.md$/), /^OK /);
    assert.doesNotMatch(doc.stdout, /stack 'fastapi\+react'/);
  });

  for (const pair of ["fastapi+react", "gin+vue", "node-native+vanilla-ts"]) {
    it(`${pair}: zone-check --owners finds 0 files without an owner right after init`, () => {
      const d = scratch();
      assert.equal(init(d, "--stack", pair).code, 0);
      sh("git", ["add", "-A"], d);
      const z = sh("bash", [".agents/skills/zone-check/scripts/check_zones.sh", "--owners"], d);
      assert.equal(z.code, 0, z.stdout);
      assert.match(z.stdout, / 0 sin dueño/);
    });
  }

  it("every backend pairs with a frontend: init succeeds and zone-check finds every file an owner", () => {
    BACKENDS.forEach((backend, i) => {
      const d = scratch();
      const pair = `${backend}+${FRONTENDS[i % FRONTENDS.length]}`;
      const r = init(d, "--stack", pair);
      assert.equal(r.code, 0, `${pair}: ${r.stderr}`);
      sh("git", ["add", "-A"], d);
      const z = sh("bash", [".agents/skills/zone-check/scripts/check_zones.sh", "--owners"], d);
      assert.equal(z.code, 0, `${pair}: ${z.stdout}`);
      assert.ok(readdirSync(join(d, ".agents/roles")).every((f) => /^(backend|frontend)-/.test(f)), `${pair}: unprefixed role`);
    });
  });
});

describe("help text", () => {
  it("documents the combined --stack value", () => {
    const r = basekit(["help"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /--stack <back>\+<front> +Fullstack combinado/);
    assert.match(r.stdout, /--stack <id> +Stack/);
  });
});

describe("single-stack projects keep their format (S16 regression)", () => {
  it("the manifest of a single stack keeps the same keys and a plain stack id", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi").code, 0);
    const m = JSON.parse(read(d, ".agents/manifest.json"));
    assert.deepEqual(Object.keys(m).sort(), ["agents", "createdAt", "externalSkills", "files", "kit", "options", "stack", "updatedAt", "version"]);
    assert.equal(m.stack, "fastapi");
    assert.ok(!existsSync(join(d, "backend")) && !existsSync(join(d, "frontend")));
    assert.ok(existsSync(join(d, ".agents/roles/data-writer.md")));
    assert.ok(Object.keys(m.files).every((f: string) => f.startsWith(".agents/") || f === "Makefile"), "no side files");
  });
});
