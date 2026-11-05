import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, fakeNpx, scratch } from "./helpers.js";

after(cleanup);

const SKILLS = ["grill-me", "grill-with-docs", "grilling", "domain-modeling"];
const PINNED =
  "-y skills@1.7.4 add https://github.com/mattpocock/skills/tree/5beb35b040e3de97e54fa9e386d7e42d15c295c2 " +
  "-s grill-me grill-with-docs grilling domain-modeling";

describe("external skills", () => {
  it("installs the four pinned skills for the chosen agents with telemetry off", () => {
    const d = scratch();
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "claude-code,hermes-agent"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(npx.log(), [
      `ARGS ${PINNED} -a claude-code hermes-agent -y`,
      "ENV DISABLE_TELEMETRY=1 DO_NOT_TRACK=1",
    ]);
    for (const s of SKILLS) assert.ok(existsSync(join(d, ".agents/skills", s, "SKILL.md")), s);
    assert.match(r.stdout, /^\+ skills externas/m);
  });

  it("does not reinstall them when they are already present", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs"], undefined, npx.env).code, 0);
    const r = basekit(["init", d, "-y"], undefined, npx.env);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(npx.log().filter((l) => l.startsWith("ARGS")).length, 1);
    assert.match(r.stdout, /^= skills externas/m);
  });

  it("a failed install warns with the retry command and does not abort init", () => {
    const d = scratch();
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs"], undefined, { ...npx.env, FAKE_NPX_FAIL: "1" });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^! skills externas.*npx -y skills@1\.7\.4 add/m);
    assert.ok(existsSync(join(d, ".agents/manifest.json")));
  });

  it("--dry-run runs no npx", () => {
    const d = scratch();
    const npx = fakeNpx();
    const r = basekit(["init", d, "-y", "--stack", "nextjs", "--dry-run"], undefined, npx.env);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(npx.log(), []);
    assert.match(r.stdout, /ejecutaría: npx -y skills@1\.7\.4/);
  });

  it("--no-external-skills skips the install", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--no-external-skills"], undefined, npx.env).code, 0);
    assert.deepEqual(npx.log(), []);
  });
});
