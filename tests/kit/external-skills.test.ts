import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, fakeNpx, scratch } from "../helpers.js";

after(cleanup);

const MANIFEST = ".agents/manifest.json";
const manifest = (d: string) => JSON.parse(readFileSync(join(d, MANIFEST), "utf8"));
/** Sets `options.externalSkills` in the project's manifest, as an interactive init would have persisted it. */
function choose(d: string, skills: string[]): void {
  const m = manifest(d);
  m.options.externalSkills = skills;
  writeFileSync(join(d, MANIFEST), `${JSON.stringify(m, null, 2)}\n`);
}

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

  it("a manifest without options.externalSkills means all four, and -y does not persist a choice", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "codex"], undefined, npx.env).code, 0);
    assert.equal(manifest(d).options.externalSkills, undefined);
    assert.match(npx.log()[0]!, / -s grill-me grill-with-docs grilling domain-modeling -a codex -y$/);
  });

  it("a rerun installs only the persisted choice (S1)", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "codex", "--no-external-skills"], undefined, npx.env).code, 0);
    choose(d, ["grilling", "grill-me"]);
    const r = basekit(["init", d, "-y"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(npx.log().filter((l) => l.startsWith("ARGS")), [`ARGS ${PINNED.replace(/ -s .*$/, " -s grill-me grilling")} -a codex -y`]);
    assert.match(r.stdout, /^\+ skills externas {2}\(grill-me, grilling\)$/m);
    assert.ok(!existsSync(join(d, ".agents/skills/domain-modeling")));
    assert.deepEqual(manifest(d).options.externalSkills, ["grilling", "grill-me"], "the persisted choice is kept as written");

    const again = basekit(["init", d, "-y"], undefined, npx.env);
    assert.equal(again.code, 0, again.stderr);
    assert.equal(npx.log().filter((l) => l.startsWith("ARGS")).length, 1, "only the chosen ones are checked as missing");
    assert.match(again.stdout, /^= skills externas {2}\(grill-me, grilling\)$/m);
  });

  it("an empty choice installs nothing and says so (S1)", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--no-external-skills"], undefined, npx.env).code, 0);
    choose(d, []);
    const r = basekit(["init", d, "-y"], undefined, npx.env);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(npx.log(), []);
    assert.match(r.stdout, /^= skills externas {2}\(ninguna elegida\)$/m);
  });

  it("--no-external-skills skips this run and keeps the persisted choice", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--no-external-skills"], undefined, npx.env).code, 0);
    choose(d, ["grilling"]);
    const r = basekit(["init", d, "-y", "--no-external-skills"], undefined, npx.env);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(npx.log(), []);
    assert.doesNotMatch(r.stdout, /skills externas/);
    assert.deepEqual(manifest(d).options.externalSkills, ["grilling"]);
  });
});
