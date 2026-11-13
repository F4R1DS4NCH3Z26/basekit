import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { dbEngines, hasDatabase, loadStacks } from "../../src/kit/stacks.js";
import { basekit, cleanup, hasDocker, scratch, sh } from "../helpers.js";

after(cleanup);

const docker = hasDocker();

/** Compose project name the Makefile really uses for `ENV` (from the `make -n ps` command line). */
function projectName(dir: string, env: "dev" | "prod"): string {
  const dry = sh("make", ["-n", "ps", `ENV=${env}`], dir);
  const line = dry.stdout.split("\n").find((l) => l.startsWith("docker compose"));
  assert.ok(line, dry.stdout + dry.stderr);
  const cfg = sh("sh", ["-c", line.replace(/ ps$/, " config --format json")], dir);
  assert.equal(cfg.code, 0, cfg.stderr);
  return JSON.parse(cfg.stdout).name as string;
}

describe("dev and prod never share a Compose project", { skip: docker ? false : "Docker no disponible" }, () => {
  const setup = (name = "Mi App_1", base = scratch()) => {
    const d = join(base, name);
    assert.equal(basekit(["init", d, "-y", "--no-external-skills", "--stack", "nextjs", "--db", "postgres"]).code, 0);
    assert.equal(sh("make", ["env"], d).code, 0);
    assert.equal(sh("make", ["env", "ENV=prod"], d).code, 0);
    return d;
  };

  it("prod keeps Compose's default name (existing deployments keep their volumes); dev gets <name>-dev", () => {
    const d = setup();
    const byDefault = JSON.parse(sh("docker", ["compose", "--env-file", ".env.prod", "-f", "compose.yaml", "-f", "compose.prod.yaml",
      "config", "--format", "json"], d).stdout).name as string;
    assert.equal(projectName(d, "prod"), byDefault);
    assert.match(projectName(d, "dev"), new RegExp(`^${byDefault}-dev-\\d+$`));
  });

  it("dev gets a valid name when the directory starts with - or _ (Compose trims them)", () => {
    for (const name of ["_lead", "-lead"]) {
      const d = setup(name);
      assert.equal(projectName(d, "prod"), "lead");
      assert.match(projectName(d, "dev"), /^lead-dev-\d+$/);
    }
  });

  it("make clean never reaches the prod project of a sibling directory named <dir>-dev", () => {
    const base = scratch();
    const d = setup("shopx", base);
    const sibling = setup("shopx-dev", base);
    const volume = `${projectName(sibling, "prod")}_db-data`;
    sh("docker", ["volume", "create", "--label", `com.docker.compose.project=${projectName(sibling, "prod")}`,
      "--label", "com.docker.compose.volume=db-data", volume], d);
    try {
      const r = sh("make", ["clean", "CONFIRM=1"], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(sh("docker", ["volume", "inspect", volume], d).code, 0, "make clean deleted the sibling's production volume");
    } finally {
      sh("docker", ["volume", "rm", "-f", volume], d);
    }
  });

  it("make clean CONFIRM=1 on a server that also has .env leaves the production volume alone", () => {
    const d = setup();
    const prod = projectName(d, "prod");
    const volume = `${prod}_db-data`;
    sh("docker", ["volume", "create", "--label", `com.docker.compose.project=${prod}`, "--label", "com.docker.compose.volume=db-data", volume], d);
    try {
      const r = sh("make", ["clean", "CONFIRM=1"], d);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(sh("docker", ["volume", "inspect", volume], d).code, 0, "make clean deleted the production volume");
    } finally {
      sh("docker", ["volume", "rm", "-f", volume], d);
    }
  });
});

describe("acceptance 9: compose config with the DB overlay", { skip: docker ? false : "Docker no disponible" }, () => {
  // Frontend stacks have no database (S1b): init rejects --db for them.
  // S6: each stack only with the engines its stack.json accepts (init rejects the others).
  for (const s of loadStacks().filter(hasDatabase)) {
    const stack = s.id;
    for (const db of dbEngines(s)) {
      it(`${stack} + ${db}: valid, and migrate receives DATABASE_URL`, () => {
        const d = scratch();
        const r = basekit(["init", d, "-y", "--no-external-skills", "--stack", stack, "--db", db]);
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.equal(sh("make", ["env"], d).code, 0);
        const cfg = sh("docker", ["compose", "-f", "compose.yaml", "-f", "compose.dev.yaml", "-f", "compose.db.yaml",
          "--profile", "tools", "config", "--format", "json"], d);
        assert.equal(cfg.code, 0, cfg.stderr);
        const services = JSON.parse(cfg.stdout).services;
        assert.ok(services.migrate?.environment?.DATABASE_URL, "migrate without DATABASE_URL");
      });
    }
  }
});

describe("S2: compose config with the MongoDB overlay", { skip: docker ? false : "Docker no disponible" }, () => {
  // Acceptance 9 reaches this overlay only through stacks that list mongo (nestjs); here infra.sh activates it on nextjs.
  it("is valid, mounts the init script and gives the app the app-user URL with authSource=<db>", () => {
    const d = scratch();
    assert.equal(basekit(["init", d, "-y", "--no-external-skills", "--stack", "nextjs"]).code, 0);
    const r = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", "mongo"], d);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(sh("make", ["env"], d).code, 0);
    const cfg = sh("docker", ["compose", "-f", "compose.yaml", "-f", "compose.dev.yaml", "-f", "compose.db.yaml",
      "--profile", "tools", "config", "--format", "json"], d);
    assert.equal(cfg.code, 0, cfg.stderr);
    const model = JSON.parse(cfg.stdout);
    const { db, migrate } = model.services;
    assert.equal(db.environment.MONGO_INITDB_ROOT_USERNAME, "root");
    assert.match(db.environment.MONGO_INITDB_ROOT_PASSWORD, /^[0-9a-f]{64}$/, "DB_ROOT_PASSWORD was not generated");
    assert.notEqual(db.environment.MONGO_INITDB_ROOT_PASSWORD, db.environment.MONGO_APP_PASSWORD);
    assert.deepEqual(db.configs, [{ source: "mongo-init", target: "/docker-entrypoint-initdb.d/10-app-user.js" }]);
    assert.match(model.configs["mongo-init"].content, /createUser\(/);
    assert.match(migrate.environment.DATABASE_URL, /^mongodb:\/\/app:[0-9a-f]{64}@db:27017\/app\?authSource=app$/);
  });
});
