import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, fakeNpx, scratch } from "../../helpers.js";

after(cleanup);

const lineFor = (out: string, label: RegExp) => out.split("\n").find((l) => label.test(l)) ?? "";

describe("doctor", () => {
  it("reports OK and FALTA with suggestions on a fresh project", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "claude-code,hermes-agent"], undefined, npx.env).code, 0);
    const r = basekit(["doctor", d]);
    assert.equal(r.code, 1, "a fresh project lacks the app and .env");
    const out = r.stdout;
    for (const label of [/node/i, /git\b/, /manifest/, /AGENTS\.md/, /Makefile/, /\.make\/stack\.mk/, /Dockerfile/, /compose\.yaml/, /\.env\.example/]) {
      assert.match(lineFor(out, label), /^OK /, `${label}`);
    }
    assert.match(lineFor(out, /package\.json/), /^FALTA .*make new-app/);
    assert.match(lineFor(out, /^\S+ +\.env(\s|$)/), /^FALTA .*make env/);
    assert.match(lineFor(out, /nextjs-verify/), /^OK /);
    assert.match(lineFor(out, /grill-with-docs/), /^OK /);
    assert.match(lineFor(out, /\.claude\/skills/), /^OK /);
    assert.match(lineFor(out, /\.hermes\/skills/), /^OK /);
    assert.match(lineFor(out, /HERMES/), /^OK /);
  });

  it("flags a missing manifest, missing external skills and a .hermes.md", () => {
    const d = scratch();
    assert.equal(basekit(["init", d, "-y", "--stack", "fastapi", "--no-external-skills", "--agents", "hermes-agent"]).code, 0);
    writeFileSync(join(d, ".hermes.md"), "x\n");
    const r = basekit(["doctor", d]);
    assert.equal(r.code, 1);
    assert.match(lineFor(r.stdout, /grilling/), /^FALTA /);
    assert.match(lineFor(r.stdout, /HERMES/), /^FALTA .*\.hermes\.md/);

    const empty = basekit(["doctor", scratch()]);
    assert.equal(empty.code, 1);
    assert.match(lineFor(empty.stdout, /manifest/), /^FALTA .*basekit init/);
  });

  it("checks only the chosen external skills, and none without agents (S1, S2)", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "fastapi", "--agents", "codex", "--no-external-skills"], undefined, npx.env).code, 0);
    const m = JSON.parse(readFileSync(join(d, ".agents/manifest.json"), "utf8"));
    m.options.externalSkills = ["grilling"];
    writeFileSync(join(d, ".agents/manifest.json"), JSON.stringify(m));
    assert.equal(basekit(["init", d, "-y"], undefined, npx.env).code, 0);
    const r = basekit(["doctor", d]);
    assert.match(lineFor(r.stdout, /grilling/), /^OK /);
    assert.equal(lineFor(r.stdout, /grill-me/), "", "an unchosen skill is not checked");

    const none = scratch();
    assert.equal(basekit(["init", none, "-y", "--stack", "fastapi", "--agents", "none"], undefined, npx.env).code, 0);
    assert.equal(lineFor(basekit(["doctor", none]).stdout, /\(externa\)/), "", "no external skills are expected without agents");
  });

  it("never reads .env", () => {
    const d = scratch();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--no-external-skills"]).code, 0);
    writeFileSync(join(d, ".env"), "SECRET=leak-me\n");
    const r = basekit(["doctor", d]);
    assert.doesNotMatch(r.stdout + r.stderr, /leak-me/);
    assert.match(lineFor(r.stdout, /^\S+ +\.env(\s|$)/), /^OK /);
  });
});

describe("doctor and docs/AUTH.md", () => {
  const setState = (dir: string, file: string, state: string) => {
    const f = join(dir, "docs", file);
    writeFileSync(f, readFileSync(f, "utf8").replace(/^Estado: .*$/m, `Estado: ${state}`));
  };
  const project = () => {
    const d = scratch();
    assert.equal(basekit(["init", d, "-y", "--stack", "fastapi", "--no-external-skills", "--agents", "none"]).code, 0);
    return d;
  };

  it("only informs while the project is undefined (the bootstrap has not run yet)", () => {
    const r = basekit(["doctor", project()]);
    assert.match(lineFor(r.stdout, /AUTH\.md/), /^· .*pendiente.*bootstrap/);
  });

  it("flags a defined project whose auth is still pending, and exits 1 because of it", () => {
    const d = project();
    setState(d, "PROJECT.md", "definido");
    const faltas = (out: string) => out.split("\n").filter((l) => l.startsWith("FALTA "));
    const pending = basekit(["doctor", d]);
    assert.match(lineFor(pending.stdout, /AUTH\.md/), /^FALTA docs\/AUTH\.md .*project-bootstrap.*ADR/);
    assert.equal(pending.code, 1);
    // Other checks (the app, .env, Docker on this machine) may fail too: the auth line must be the only difference.
    setState(d, "AUTH.md", "completo");
    const decided = basekit(["doctor", d]);
    assert.deepEqual(faltas(pending.stdout).filter((l) => !/AUTH\.md/.test(l)), faltas(decided.stdout));
    if (faltas(decided.stdout).length === 0) assert.equal(decided.code, 0);
  });

  it("reports OK once the auth is documented, or without docs/AUTH.md says nothing", () => {
    const d = project();
    setState(d, "PROJECT.md", "definido");
    setState(d, "AUTH.md", "completo");
    assert.match(lineFor(basekit(["doctor", d]).stdout, /AUTH\.md/), /^OK +docs\/AUTH\.md/);
    // Like the Makefile's grep, "Estado:" and "pendiente" must be on the same line.
    writeFileSync(join(d, "docs/AUTH.md"), "Estado:\npendiente\n");
    assert.match(lineFor(basekit(["doctor", d]).stdout, /AUTH\.md/), /^OK +docs\/AUTH\.md/);
    rmSync(join(d, "docs/AUTH.md"));
    assert.equal(lineFor(basekit(["doctor", d]).stdout, /AUTH\.md/), "");
  });
});
