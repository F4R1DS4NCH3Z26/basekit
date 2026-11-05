import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, fakeNpx, scratch } from "./helpers.js";

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

  it("never reads .env", () => {
    const d = scratch();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--no-external-skills"]).code, 0);
    writeFileSync(join(d, ".env"), "SECRET=leak-me\n");
    const r = basekit(["doctor", d]);
    assert.doesNotMatch(r.stdout + r.stderr, /leak-me/);
    assert.match(lineFor(r.stdout, /^\S+ +\.env(\s|$)/), /^OK /);
  });
});
