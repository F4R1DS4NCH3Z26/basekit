import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadStacks } from "../../../src/kit/stacks.js";
import { basekit, cleanup, fakeNpx, gitCommitAll, REPO, scratch, sh } from "../../helpers.js";

after(cleanup);

const STACKS = loadStacks().map((s) => s.id);
const FRONTEND = loadStacks().filter((s) => s.kind === "frontend").map((s) => s.id);
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
    assert.ok(agents.includes(`**${loadStacks().find((s) => s.id === "nextjs")!.name}**`), "the stack name in AGENTS.md");
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

describe("--agents none (S2)", () => {
  it("writes AGENTS.md and .agents/ but no tool adapters or links, and stores agents: []", () => {
    const d = scratch();
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "none"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    for (const f of ["AGENTS.md", ".agents/README.md", ".agents/roles/data-writer.md", ".agents/zones/orchestrator.txt", ".agents/skills/zone-check/SKILL.md", "docs", "Makefile", "compose.yaml"]) {
      assert.ok(existsSync(join(d, f)), f);
    }
    for (const f of [".claude", "CLAUDE.md", ".opencode", "opencode.json", ".gemini", ".hermes"]) assert.ok(!existsSync(join(d, f)), f);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).agents, []);
    assert.deepEqual(npx.log(), [], "the skills CLI needs -a: nothing is installed without agents");
    assert.match(r.stdout, /^! skills externas {2}\(sin agentes: se instalan cuando agregues uno con basekit sync --agents <a,b>\)$/m);
  });

  it("a rerun keeps agents: [] without detecting the tools present", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--agents", "none").code, 0);
    mkdirSync(join(d, ".claude"));
    const r = init(d);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).agents, []);
    assert.ok(!existsSync(join(d, ".claude/agents")), "no detection: claude-code was not added");
  });

  it("mixed with other ids is a usage error (exit 2) and writes nothing", () => {
    const d = scratch();
    const r = init(d, "--stack", "nextjs", "--agents", "none,codex");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^ERROR: --agents none no se combina con otros agentes/);
    assert.deepEqual(readdirSync(d), []);
  });

  it("--agents with ids still works as before", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--agents", "codex,claude-code").code, 0);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).agents, ["claude-code", "codex"]);
    assert.ok(existsSync(join(d, ".claude/agents/data-writer.md")));
  });

  it("is documented in the help, with the external skills list", () => {
    const help = basekit(["--help"]).stdout;
    assert.match(help, /--agents <a,b> +Agentes [^\n]*\n +none: ninguno/);
    assert.match(help, /cuáles skills externas instalar \(todas marcadas\)/);
    assert.match(help, /responde ninguna o\s+ninguno en texto plano/);
    assert.match(help, /--no-external-skills +No instala las skills externas \(CI o sin red\)\n/, "the flag line no longer describes the question");
  });
});

describe("--external-skills (S4)", () => {
  const AVAILABLE = "Disponibles: grill-me, grill-with-docs, grilling, domain-modeling";
  const args = (npx: { log: () => string[] }) => npx.log().filter((l) => l.startsWith("ARGS"));
  const options = (d: string) => JSON.parse(read(d, ".agents/manifest.json")).options;

  it("installs only the chosen skills in pinned order and persists them", () => {
    const d = scratch();
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "codex", "--external-skills", "domain-modeling, grilling"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(args(npx).length, 1);
    assert.match(args(npx)[0]!, / -s grilling domain-modeling -a codex -y$/);
    assert.match(r.stdout, /^\+ skills externas {2}\(grilling, domain-modeling\)$/m);
    assert.deepEqual(options(d).externalSkills, ["grilling", "domain-modeling"]);
    assert.ok(!existsSync(join(d, ".agents/skills/grill-me")));
  });

  it("none stores [] and installs nothing; a later --external-skills replaces it", () => {
    const d = scratch();
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "codex", "--external-skills", "none"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^= skills externas {2}\(ninguna elegida\)$/m);
    assert.deepEqual(options(d).externalSkills, []);
    assert.deepEqual(npx.log(), []);

    const again = basekit(["init", d, "-y", "--external-skills", "grill-me"], undefined, npx.env);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.equal(args(npx).length, 1);
    assert.match(args(npx)[0]!, / -s grill-me -a codex -y$/);
    assert.deepEqual(options(d).externalSkills, ["grill-me"]);
  });

  it("without agents warns, installs nothing and still persists the choice", () => {
    const d = scratch();
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "none", "--external-skills", "grilling"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^! skills externas {2}\(sin agentes: se instalan cuando agregues uno con basekit sync --agents <a,b>\)$/m);
    assert.deepEqual(npx.log(), []);
    assert.deepEqual(options(d).externalSkills, ["grilling"]);
  });

  it("--dry-run shows the npx line for the chosen skills and writes nothing", () => {
    const d = join(scratch(), "app");
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "codex", "--external-skills", "grilling", "--dry-run"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^· ejecutaría: npx -y skills@1\.7\.4 add \S+ -s grilling -a codex -y$/m);
    assert.deepEqual(npx.log(), []);
    assert.ok(!existsSync(d));
  });

  for (const [extra, message] of [
    [["--external-skills", "grill-me, foo,bar"], `--external-skills 'foo,bar' no es una skill externa. ${AVAILABLE}`],
    [["--external-skills", ""], `--external-skills '' no es una skill externa. ${AVAILABLE}`],
    [["--external-skills", ",,"], `--external-skills ',,' no es una skill externa. ${AVAILABLE}`],
    [["--external-skills", "Grilling"], `--external-skills 'Grilling' no es una skill externa. ${AVAILABLE}`],
    [["--external-skills", "none,grilling"], "--external-skills none no se combina con otras skills"],
    [["--external-skills", "grilling", "--no-external-skills"], "--external-skills y --no-external-skills no se combinan"],
  ] as const) {
    it(`${extra.join(" ")} is a usage error (exit 2) that writes nothing`, () => {
      const d = join(scratch(), "app");
      const npx = fakeNpx();
      const r = basekit(["init", d, "-y", "--stack", "nextjs", ...extra], undefined, npx.env);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.equal(r.stderr, `ERROR: ${message}\n`);
      assert.equal(r.stdout, "");
      assert.ok(!existsSync(d));
      assert.deepEqual(npx.log(), []);
    });
  }

  it("is documented in the help for init and sync", () => {
    const help = basekit(["--help"]).stdout;
    assert.equal(help.split("--external-skills <a,b>").length - 1, 2);
    assert.match(help, /no se vuelve a preguntar; cámbiala con\s+--external-skills\./);
    assert.match(
      help,
      /--external-skills <a,b> Skills externas a instalar: grill-me, grill-with-docs, grilling, domain-modeling\.\n {26}Reemplaza la elección guardada y no pregunta; --external-skills none: ninguna\n/,
    );
    assert.match(
      help,
      /--external-skills <a,b> Reemplaza la elección de skills externas e instala las elegidas que falten\n {26}\(las ya instaladas que quites se quedan\); --external-skills none: ninguna\n/,
    );
  });
});

describe("frontend stacks have no database (S1b)", () => {
  it("has at least one frontend stack to check", () => assert.ok(FRONTEND.length > 0));

  for (const stack of FRONTEND) {
    it(`${stack}: --db postgres|mysql|sqlite and --redis fail before writing anything`, () => {
      for (const extra of [["--db", "postgres"], ["--db", "mysql"], ["--db", "sqlite"], ["--redis"], ["--db", "none", "--redis"]]) {
        const d = scratch();
        const r = init(d, "--stack", stack, ...extra);
        assert.equal(r.code, 2, `${extra.join(" ")}: ${r.stdout}`);
        assert.match(r.stderr, new RegExp(`${extra.includes("--redis") ? "--redis" : `--db '${extra[1]}'`} no aplica a ${stack}: un stack frontend no tiene base de datos`));
        assert.match(r.stderr, extra.includes("--redis") ? /quita --redis/ : /usa --db none/);
        assert.deepEqual(readdirSync(d), [], extra.join(" "));
      }
    });

    it(`${stack}: --db none and --db auto succeed and record no database`, () => {
      for (const db of ["none", "auto"]) {
        const d = scratch();
        const r = init(d, "--stack", stack, "--db", db);
        assert.equal(r.code, 0, `${db}: ${r.stderr}`);
        const m = JSON.parse(read(d, ".agents/manifest.json"));
        assert.equal(m.stack, stack);
        assert.deepEqual([m.options.db, m.options.redis], ["none", false], db);
        assert.ok(!existsSync(join(d, "compose.db.yaml")) && !existsSync(join(d, "compose.redis.yaml")));
      }
    });
  }

  it("also rejects --redis on a rerun whose stack comes from the manifest", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", FRONTEND[0]!).code, 0);
    gitCommitAll(d);
    const r = init(d, "--redis");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--redis no aplica/);
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, "");
  });

  it("switching an existing project to a frontend stack drops the database and Redis the manifest had (S17)", () => {
    const d = scratch();
    const first = init(d, "--stack", "fastapi", "--db", "postgres", "--redis");
    assert.equal(first.code, 0, first.stderr);
    gitCommitAll(d);
    const r = init(d, "--stack", FRONTEND[0]!);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /no aplica|infra OK|ejecutaría/);
    const m = JSON.parse(read(d, ".agents/manifest.json"));
    assert.equal(m.stack, FRONTEND[0]);
    assert.deepEqual([m.options.db, m.options.redis], ["none", false]);
    // The old overlays stay (they are the user's files), but init says they no longer apply.
    for (const f of ["compose.db.yaml", "compose.redis.yaml"]) {
      assert.ok(existsSync(join(d, f)), `${f} is not deleted`);
      assert.match(r.stdout, new RegExp(`^\\s*! ${f.replace(".", "\\.")} .*frontend no usa base de datos`, "m"));
    }
  });

  it("switching to another backend stack still keeps the manifest's database and Redis", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi", "--db", "postgres", "--redis").code, 0);
    gitCommitAll(d);
    const r = init(d, "--stack", "django");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /infra OK|ejecutaría/);
    const m = JSON.parse(read(d, ".agents/manifest.json"));
    assert.deepEqual([m.stack, m.options.db, m.options.redis], ["django", "postgres", true]);
  });

  it("a backend stack still takes --db and --redis as before", () => {
    const d = scratch();
    const r = init(d, "--stack", "fastapi", "--db", "postgres", "--redis", "--dry-run");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /ejecutaría: bash \.agents\/skills\/infra-setup\/scripts\/infra\.sh --db postgres --redis/);
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

describe("line endings (Windows)", () => {
  it("creates a .gitattributes that keeps LF, so scripts survive a clone with core.autocrlf=true", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    assert.match(read(d, ".gitattributes"), /^\* text=auto eol=lf$/m);
    gitCommitAll(d);
    const clone = join(scratch(), "clone");
    assert.equal(sh("git", ["-c", "core.autocrlf=true", "clone", "-q", d, clone], d).code, 0);
    for (const f of [".agents/skills/zone-check/scripts/check_zones.sh", "Makefile", ".make/stack.mk", ".env.example"]) {
      assert.ok(!read(clone, f).includes("\r"), `${f} got CRLF`);
    }
  });

  it("in an existing git repository it only suggests .gitattributes (it could renormalize CRLF files)", () => {
    const d = scratch();
    sh("git", ["init", "-q"], d);
    writeFileSync(join(d, "win.txt"), "a\r\nb\r\n");
    gitCommitAll(d);
    const r = init(d, "--stack", "nextjs");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(d, ".gitattributes")), "must not be created in an existing repository");
    assert.match(r.stdout, /^! \.gitattributes .*eol=lf/m);
  });

  it("keeps an existing .gitattributes", () => {
    const d = scratch();
    writeFileSync(join(d, ".gitattributes"), "*.png binary\n");
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    assert.equal(read(d, ".gitattributes"), "*.png binary\n");
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

describe("--no-git", () => {
  it("skips git init and warns that zone-check needs it", () => {
    const d = scratch();
    const r = init(d, "--stack", "flask", "--no-git");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!existsSync(join(d, ".git")), "no repository");
    assert.ok(!existsSync(join(d, ".gitattributes")), "no .gitattributes without a repository basekit creates");
    assert.match(r.stdout, /^! \.git .*sin git: zone-check no funciona hasta que ejecutes git init/m);
    assert.doesNotMatch(r.stdout, /^! \.gitattributes/m, "the CRLF hint is only for an existing repository");
    assert.ok(existsSync(join(d, ".agents/manifest.json")));
  });

  it("is listed in the help", () => {
    assert.match(basekit(["--help"]).stdout, /--no-git\s+No ejecuta git init \(zone-check lo necesita\)/);
  });
});
