import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { basekit, cleanup, hasDocker, scratch, sh } from "../helpers.js";

after(cleanup);

const docker = hasDocker();

describe("acceptance 9: compose config with the DB overlay", { skip: docker ? false : "Docker no disponible" }, () => {
  for (const stack of ["fastapi", "laravel", "nextjs", "spring"]) {
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
