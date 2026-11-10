import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { hasDatabase, loadStacks } from "../../src/kit/stacks.js";
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
  for (const stack of loadStacks().filter(hasDatabase).map((s) => s.id)) {
    for (const db of ["postgres", "mysql", "sqlite"]) {
      if (stack === "spring" && db === "sqlite") continue; // 05 §3: SQLite is not offered for Spring
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
