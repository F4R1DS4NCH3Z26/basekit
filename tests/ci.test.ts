import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dbEngines, hasDatabase, loadStacks } from "../src/kit/stacks.js";
import { REPO, sh } from "./helpers.js";

const CI = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
const STACKS = loadStacks();

/** The e2e job's matrix rows: `- stack: x` (with an indented `db:` line) or `- { stack: x, db: y, env: prod }`. */
function e2eMatrix(): { stack: string; db?: string; env?: string }[] {
  const job = CI.slice(CI.indexOf("\n  e2e:"));
  const include = job.slice(job.indexOf("include:"), job.indexOf("steps:"));
  const rows: { stack: string; db?: string; env?: string }[] = [];
  for (const line of include.split("\n")) {
    const flow = /^\s*- \{(.*)\}\s*$/.exec(line);
    const block = /^\s*- stack: (\S+)\s*$/.exec(line);
    const extra = /^\s+(db|env): (\S+)\s*$/.exec(line);
    if (flow) rows.push(Object.fromEntries(flow[1]!.split(",").map((kv) => kv.split(":").map((x) => x.trim()))));
    else if (block) rows.push({ stack: block[1]! });
    else if (extra && rows.length > 0) rows[rows.length - 1]![extra[1] as "db" | "env"] = extra[2]!;
  }
  return rows;
}

describe("CI e2e job (S8, S17)", () => {
  const rows = e2eMatrix();

  it("runs every stack in dev and in prod; frontend stacks never get a database", () => {
    for (const s of STACKS) {
      const mine = rows.filter((r) => r.stack === s.id);
      assert.ok(mine.some((r) => r.env === undefined), `${s.id}: no dev job`);
      assert.ok(mine.some((r) => r.env === "prod"), `${s.id}: no prod job`);
      if (!hasDatabase(s)) assert.ok(mine.every((r) => r.db === undefined), `${s.id}: a frontend job has a db`);
    }
    assert.deepEqual(rows.filter((r) => !STACKS.some((s) => s.id === r.stack)), [], "unknown stack in the matrix");
  });

  it("runs <stack> + mongo in dev for every stack that lists mongo in dbs, and for no other (mongo-support S3)", () => {
    const mongo = STACKS.filter((s) => dbEngines(s).includes("mongo")).map((s) => s.id);
    assert.ok(mongo.length > 0, "no stack lists mongo");
    for (const id of ["nestjs", "fastapi", "spring", "gin", "go-native", "flask", "python-native", "express", "node-native", "nextjs", "laravel", "symfony", "php-native"]) assert.ok(mongo.includes(id), `${id} does not list mongo (mongo-support S4, S7, S9)`);
    for (const id of mongo) {
      assert.ok(rows.some((r) => r.stack === id && r.db === "mongo" && r.env === undefined), `${id}: no dev job with mongo`);
    }
    assert.deepEqual(rows.filter((r) => r.db === "mongo" && !mongo.includes(r.stack)), [], "a mongo job for a stack without mongo");
  });

  it("passes scripts/e2e.sh exactly <stack> [db] [--prod], with no empty argument", () => {
    const run = /^\s*- run: (bash scripts\/e2e\.sh .*)$/m.exec(CI)?.[1];
    assert.ok(run, "the e2e step");
    assert.doesNotMatch(run!, /\$\{\{/, "matrix values go through env, never into the script text");
    // The step's script, with `bash scripts/e2e.sh` replaced by a printer of its arguments.
    const argv = run!.replace("bash scripts/e2e.sh", "printf '[%s]\\n'");
    for (const r of rows) {
      const out = sh("bash", ["-c", argv], REPO, { STACK: r.stack, DB: r.db ?? "", PROD: r.env === "prod" ? "1" : "" });
      assert.equal(out.code, 0, out.stderr);
      const expected = [r.stack, ...(r.db ? [r.db] : []), ...(r.env === "prod" ? ["--prod"] : [])];
      assert.equal(out.stdout, expected.map((a) => `[${a}]\n`).join(""), JSON.stringify(r));
    }
  });
});

describe("scripts/e2e.sh arguments (mongo-support S3)", () => {
  const USAGE = "Uso: scripts/e2e.sh <stack> [postgres|mysql|sqlite|mongo] [--prod]\n";
  // An unknown stack stops the script after the arguments are parsed and before anything runs (no Docker needed).
  const e2e = (...args: string[]) => sh("bash", ["scripts/e2e.sh", ...args], REPO);

  it("accepts every database engine, mongo included", () => {
    for (const db of ["postgres", "mysql", "sqlite", "mongo"]) {
      const r = e2e("no-such-stack", db);
      assert.equal(r.code, 2, db);
      assert.equal(r.stderr, "Stack desconocido: no-such-stack\n", db);
    }
  });

  it("rejects any other value with the usage line, which lists mongo", () => {
    const r = e2e("flask", "oracle");
    assert.equal(r.code, 2);
    assert.equal(r.stderr, USAGE);
    assert.equal(r.stdout, "");
  });
  // mongo-support S9: BASEKIT_E2E_PORT moves the app to another host port (parallel runs, a busy default port).
  it("takes BASEKIT_E2E_PORT only as a port number", () => {
    const withPort = (port: string) => sh("env", [`BASEKIT_E2E_PORT=${port}`, "bash", "scripts/e2e.sh", "no-such-stack"], REPO);
    const bad = withPort("80a");
    assert.equal(bad.code, 2);
    assert.equal(bad.stderr, "BASEKIT_E2E_PORT debe ser un número de puerto\n");
    assert.equal(bad.stdout, "");
    const good = withPort("8101");
    assert.equal(good.code, 2);
    assert.equal(good.stderr, "Stack desconocido: no-such-stack\n");
  });
});
