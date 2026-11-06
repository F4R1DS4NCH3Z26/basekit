import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, fakeNpx, gitCommitAll, REPO, scratch, sh } from "../../helpers.js";

after(cleanup);

const STACKS = ["fastapi", "laravel", "nextjs", "spring"];
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const init = (dir: string, ...extra: string[]) =>
  basekit(["init", dir, "--yes", "--no-external-skills", ...extra]);

describe("acceptance 1: init in an empty folder, per stack", () => {
  for (const stack of STACKS) {
    it(`${stack}: no errors and make help lists >= 25 targets`, () => {
      const d = scratch();
      const r = init(d, "--stack", stack);
      assert.equal(r.code, 0, r.stderr);
      const help = sh("make", ["help"], d);
      assert.equal(help.code, 0, help.stderr);
      const targets = help.stdout.split("\n").filter((l) => /^\s+\S/.test(l));
      assert.ok(targets.length >= 25, `only ${targets.length} targets`);
    });
  }

  it("writes the core layout, a rendered AGENTS.md and a manifest", () => {
    const d = scratch();
    const r = init(d, "--stack", "nextjs", "--context", "Reservas de canchas de pádel");
    assert.equal(r.code, 0, r.stderr);
    for (const f of [
      ".git", ".agents/README.md", ".agents/zones/orchestrator.txt", ".agents/roles/data-writer.md",
      ".agents/zones/data-writer.txt", ".agents/skills/zone-check/SKILL.md", ".agents/skills/nextjs-verify/SKILL.md",
      "Makefile", ".make/stack.mk", "Dockerfile", "compose.yaml", "compose.dev.yaml", "compose.prod.yaml",
      ".env.example", ".dockerignore", "README.md", "docs/PROJECT.md", "docs/ARCHITECTURE.md",
      "docs/RUNBOOK.md", "docs/AUTH.md", "docs/specs/.gitkeep",
    ]) {
      assert.ok(existsSync(join(d, f)), `missing ${f}`);
    }
    assert.ok(!existsSync(join(d, "GLOSSARY.md")), "GLOSSARY.md must not be created");
    assert.ok(!existsSync(join(d, "docs/adr")), "docs/adr must not be created");
    assert.ok(!existsSync(join(d, ".agents/zones/orchestrator.stack.txt")));

    const agents = read(d, "AGENTS.md");
    assert.match(agents, /^<!-- basekit:start v0\.1\.0 /);
    assert.match(agents, /<!-- basekit:end -->\n$/);
    assert.match(agents, /\*\*Next\.js \(App Router\) \+ TypeScript\*\*/);
    assert.match(agents, /\| `nextjs-scaffold` \| Feature nueva: estructura \+ contrato \|/);
    assert.doesNotMatch(agents, /\{\{[A-Z_]+\}\}/);
    assert.match(read(d, "docs/PROJECT.md"), /Reservas de canchas de pádel/);
    assert.match(read(d, "README.md"), new RegExp(`^# ${d.split("/").pop()}`));

    const orch = read(d, ".agents/zones/orchestrator.txt");
    const common = readFileSync(join(REPO, "plantillas/core/zones.orchestrator.common.txt"), "utf8");
    assert.ok(orch.startsWith(common), "orchestrator zones must start with the common zones");

    assert.equal(statSync(join(d, ".agents/skills/zone-check/scripts/check_zones.sh")).mode & 0o777, 0o755);
    assert.match(read(d, ".gitignore"), /# >>> basekit\n[\s\S]*# <<< basekit\n/);

    const m = JSON.parse(read(d, ".agents/manifest.json"));
    assert.equal(m.kit, "basekit");
    assert.equal(m.version, "0.1.0");
    assert.equal(m.stack, "nextjs");
    assert.deepEqual(m.agents, ["claude-code", "opencode"]);
    assert.deepEqual(m.options, { db: "auto", redis: false });
    assert.equal(m.externalSkills.ref, "5beb35b040e3de97e54fa9e386d7e42d15c295c2");
    assert.ok(m.createdAt && m.updatedAt);

    assert.match(r.stdout, /Lee AGENTS\.md y ejecuta el bootstrap\. El proyecto trata de: Reservas de canchas de pádel/);
    assert.match(r.stdout, /make new-app/);
  });

  it("copies the starter only when the appMarker is missing", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi").code, 0);
    assert.ok(existsSync(join(d, "src/main.py")));
    assert.ok(existsSync(join(d, "pyproject.toml")));

    const d2 = scratch();
    writeFileSync(join(d2, "pyproject.toml"), '[project]\nname = "mine"\ndependencies = ["fastapi"]\n');
    assert.equal(init(d2, "--stack", "fastapi").code, 0);
    assert.ok(!existsSync(join(d2, "src/main.py")), "starter copied over an existing app");
    assert.match(read(d2, "pyproject.toml"), /name = "mine"/);
  });
});

describe("acceptance 2: init twice in a row", () => {
  it("second run only reports '=' and 'al día', leaves git status empty and keeps updatedAt", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    gitCommitAll(d);
    const before = JSON.parse(read(d, ".agents/manifest.json"));

    const r = init(d, "--stack", "nextjs");
    assert.equal(r.code, 0, r.stderr);
    const actions = r.stdout.split("\n").filter((l) => /^[+~=!] /.test(l));
    assert.ok(actions.length > 0);
    assert.deepEqual(actions.filter((l) => !l.startsWith("= ")), []);
    assert.match(r.stdout, /al día/);
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, "");
    assert.equal(JSON.parse(read(d, ".agents/manifest.json")).updatedAt, before.updatedAt);
  });

  it("does not rerun infra-setup when --db is not passed again", () => {
    const d = scratch();
    const first = init(d, "--stack", "nextjs", "--db", "postgres");
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /infra OK/);
    const r = init(d);
    assert.equal(r.code, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /infra OK|ejecutaría/);
    assert.match(r.stdout, /al día/);
    assert.equal(JSON.parse(read(d, ".agents/manifest.json")).options.db, "postgres");
  });

  it("reuses the manifest stack and options on a rerun without flags", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "spring", "--agents", "claude-code").code, 0);
    gitCommitAll(d);
    const r = init(d);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, "");
  });
});

describe("acceptance 3: project with its own AGENTS.md and Makefile", () => {
  it("keeps the original content, appends the block and writes Makefile.basekit", () => {
    const d = scratch();
    const ownAgents = "# Mis reglas\n\nNo borrar esto.\n";
    const ownMake = "all:\n\techo hola\n";
    writeFileSync(join(d, "AGENTS.md"), ownAgents);
    writeFileSync(join(d, "Makefile"), ownMake);

    const r = init(d, "--stack", "laravel");
    assert.equal(r.code, 0, r.stderr);
    const agents = read(d, "AGENTS.md");
    assert.ok(agents.startsWith("# Mis reglas\n\nNo borrar esto.\n\n<!-- basekit:start"), agents.slice(0, 120));
    assert.equal(read(d, "Makefile"), ownMake);
    assert.match(read(d, "Makefile.basekit"), /generado por basekit/);
    assert.match(r.stdout, /^! .*Makefile\.basekit/m);
  });

  it("replaces only the managed block on later runs", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    const original = read(d, "AGENTS.md");
    writeFileSync(join(d, "AGENTS.md"), "# Arriba\n\n" + original.replace("## Reglas globales", "## CAMBIADO") + "\n## Abajo\n");
    const r = init(d);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(read(d, "AGENTS.md"), "# Arriba\n\n" + original + "\n## Abajo\n");
    assert.match(r.stdout, /^~ AGENTS\.md/m);
  });
});

describe("acceptance 4: --dry-run", () => {
  it("writes nothing and runs no external process", () => {
    const d = scratch();
    const r = init(d, "--stack", "nextjs", "--db", "postgres", "--dry-run");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(d), []);
    assert.match(r.stdout, /^\+ AGENTS\.md/m);
  });

  it("does not create a missing target directory", () => {
    const d = join(scratch(), "nuevo");
    assert.equal(init(d, "--stack", "nextjs", "--dry-run").code, 0);
    assert.ok(!existsSync(d));
  });
});

describe("acceptance 5: invalid values", () => {
  for (const [flag, value] of [["--stack", "foo"], ["--agents", "x"], ["--db", "mongo"]] as const) {
    it(`${flag} ${value} fails with a clear error`, () => {
      const d = scratch();
      const r = init(d, "--stack", "nextjs", flag, value);
      assert.notEqual(r.code, 0);
      assert.match(r.stderr, new RegExp(`${flag}.*${value}|${value}.*${flag}`));
      assert.deepEqual(readdirSync(d), []);
    });
  }

  it("rejects unknown options", () => {
    const r = basekit(["init", scratch(), "--nope"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /--nope/);
  });
});

describe("acceptance 6: zone-check right after init", () => {
  for (const stack of STACKS) {
    it(`${stack}: 0 sin dueño`, () => {
      const d = scratch();
      assert.equal(init(d, "--stack", stack).code, 0);
      const r = sh("bash", [".agents/skills/zone-check/scripts/check_zones.sh", "--owners"], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.match(r.stdout, / 0 sin dueño/);
    });
  }
});

describe("acceptance 7: make env", () => {
  it("leaves no __GENERATE__, mode 600 and distinct secrets", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--db", "postgres", "--redis").code, 0);
    const r = sh("make", ["env"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const env = read(d, ".env");
    assert.doesNotMatch(env, /__GENERATE/);
    assert.equal(statSync(join(d, ".env")).mode & 0o777, 0o600);
    const secrets = env.split("\n").filter((l) => /^[A-Z_]*(SECRET|PASSWORD)[A-Z_]*=/.test(l)).map((l) => l.split("=")[1]);
    assert.ok(secrets.length >= 2, env);
    assert.equal(new Set(secrets).size, secrets.length);
  });
});

describe("acceptance 8: make -n includes the existing overlays", () => {
  it("dev, verify, migrate and prod-up", () => {
    const d = scratch();
    const r = init(d, "--stack", "nextjs", "--db", "postgres", "--redis");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(d, "compose.db.yaml")) && existsSync(join(d, "compose.redis.yaml")));
    for (const f of [".env", ".env.prod"]) writeFileSync(join(d, f), "X=1\n");
    for (const args of [["dev"], ["verify", "SCOPE=src"], ["migrate"], ["prod-up"]]) {
      const n = sh("make", ["-n", ...args], d);
      assert.equal(n.code, 0, `${args.join(" ")}: ${n.stdout}${n.stderr}`);
      assert.match(n.stdout, /-f compose\.db\.yaml/, args.join(" "));
      assert.match(n.stdout, /-f compose\.redis\.yaml/, args.join(" "));
    }
  });
});

describe("kit skills modified locally", () => {
  it("are kept with a warning, and replaced only with --force", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    const skill = ".agents/skills/zone-check/SKILL.md";
    const original = read(d, skill);
    writeFileSync(join(d, skill), "mío\n");

    const r = init(d);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(read(d, skill), "mío\n");
    assert.match(r.stdout, new RegExp(`^! ${skill.replace(/\./g, "\\.")}.*--force`, "m"));

    const f = init(d, "--force");
    assert.equal(f.code, 0, f.stderr);
    assert.equal(read(d, skill), original);
  });
});

describe("symlinks that point outside the project", () => {
  it("never writes through them: warns and leaves the outside directory untouched", () => {
    const base = scratch();
    const outside = join(base, "fuera", ".claude");
    mkdirSync(outside, { recursive: true });
    const d = join(base, "proyecto");
    mkdirSync(d);
    symlinkSync(outside, join(d, ".claude"));
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "laravel", "--agents", "claude-code"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(readdirSync(outside), []);
    assert.match(r.stdout, /^! \.claude\/settings\.json .*fuera del proyecto/m);
    assert.match(r.stdout, /^! skills externas .*fuera del proyecto/m);
    assert.deepEqual(npx.log(), [], "npx must not run while .claude escapes the project");
    assert.ok(existsSync(join(d, "AGENTS.md")));
  });
});

describe("a start marker without its end marker", () => {
  it("is left alone with a warning, so no user text is lost", () => {
    const d = scratch();
    const text = "user A\n<!-- basekit:start old\nuser B keep me\n";
    writeFileSync(join(d, "AGENTS.md"), text);
    for (let i = 0; i < 2; i++) {
      const r = init(d, "--stack", "nextjs");
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /^! AGENTS\.md .*marcador/m);
    }
    assert.equal(read(d, "AGENTS.md"), text);
  });
});

describe("paths outside the project", () => {
  it("creates nested target directories and expands nothing from --context into paths", () => {
    const base = scratch();
    mkdirSync(join(base, "a"));
    const d = join(base, "a", "b");
    const r = init(d, "--stack", "nextjs", "--context", "../../evil $(touch pwned)");
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(readdirSync(base), ["a"]);
    assert.ok(!existsSync(join(d, "pwned")));
  });
});
