import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, fakeNpx, gitCommitAll, scratch, sh } from "../../helpers.js";

after(cleanup);

const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const init = (dir: string, ...extra: string[]) => basekit(["init", dir, "--yes", "--no-external-skills", ...extra]);

describe("sync", () => {
  it("fails without a manifest", () => {
    const r = basekit(["sync", scratch()]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /manifest/);
  });

  it("regenerates adapters from .agents/roles and recreates deleted ones", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--agents", "claude-code,opencode").code, 0);
    const role = ".agents/roles/data-writer.md";
    writeFileSync(join(d, role), read(d, role).replace(/^description: .*$/m, "description: Nueva descripción: con dos puntos"));
    writeFileSync(join(d, ".agents/zones/data-writer.txt"), "src/nuevo/**\n");
    rmSync(join(d, ".claude/agents/ui-writer.md"));

    const r = basekit(["sync", d, "--no-external-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(read(d, ".claude/agents/data-writer.md"), /^description: "Nueva descripción: con dos puntos"$/m);
    assert.match(read(d, ".opencode/agents/data-writer.md"), /^ {4}"src\/nuevo\/\*\*": allow$/m);
    assert.ok(existsSync(join(d, ".claude/agents/ui-writer.md")));
    assert.match(r.stdout, /^~ \.claude\/agents\/data-writer\.md/m);
    assert.match(r.stdout, /^\+ \.claude\/agents\/ui-writer\.md/m);
  });

  it("re-renders only the AGENTS.md block", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "spring").code, 0);
    const original = read(d, "AGENTS.md");
    writeFileSync(join(d, "AGENTS.md"), `${original.replace("## Reglas globales", "## X")}\n## Mío\n`);
    assert.equal(basekit(["sync", d, "--no-external-skills"]).code, 0);
    assert.equal(read(d, "AGENTS.md"), `${original}\n## Mío\n`);
  });

  it("--agents adds a tool: adapters, links, manifest and external skills for it", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "fastapi", "--agents", "opencode"], undefined, npx.env).code, 0);
    const r = basekit(["sync", d, "--agents", "opencode,claude-code"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(d, ".claude/agents/data-writer.md")));
    assert.ok(existsSync(join(d, ".claude/skills/py-scaffold/SKILL.md")));
    assert.ok(existsSync(join(d, ".claude/skills/grilling/SKILL.md")));
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).agents, ["claude-code", "opencode"]);
    const calls = npx.log().filter((l) => l.startsWith("ARGS"));
    assert.equal(calls.length, 2);
    assert.match(calls[1]!, / -a claude-code opencode -y$/);
  });

  it("--agents none leaves the tools out of the manifest; none mixed with ids is a usage error (S2)", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--agents", "codex").code, 0);
    const bad = basekit(["sync", d, "--agents", "codex,none"]);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /^ERROR: --agents none no se combina con otros agentes/);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).agents, ["codex"]);

    const r = basekit(["sync", d, "--agents", "none", "--no-external-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).agents, []);
  });

  it("--agents later installs the external skills for a project without agents, honoring the persisted choice (S1, S2)", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "none"], undefined, npx.env).code, 0);
    assert.deepEqual(npx.log(), []);
    const m = JSON.parse(read(d, ".agents/manifest.json"));
    m.options.externalSkills = ["grill-with-docs"];
    writeFileSync(join(d, ".agents/manifest.json"), `${JSON.stringify(m, null, 2)}\n`);

    const r = basekit(["sync", d, "--agents", "claude-code"], undefined, npx.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const calls = npx.log().filter((l) => l.startsWith("ARGS"));
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, / -s grill-with-docs -a claude-code -y$/);
    assert.ok(existsSync(join(d, ".claude/agents/data-writer.md")));
    assert.ok(existsSync(join(d, ".claude/skills/grill-with-docs/SKILL.md")));
    assert.ok(!existsSync(join(d, ".agents/skills/grilling")));
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).options.externalSkills, ["grill-with-docs"]);
  });

  it("--external-skills replaces the persisted choice and installs the chosen missing skills, keeping deselected ones (S4)", () => {
    const d = scratch();
    const npx = fakeNpx();
    const calls = () => npx.log().filter((l) => l.startsWith("ARGS"));
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "codex", "--external-skills", "grilling"], undefined, npx.env).code, 0);
    const s = basekit(["sync", d, "--external-skills", "grill-me"], undefined, npx.env);
    assert.equal(s.code, 0, s.stdout + s.stderr);
    assert.equal(calls().length, 2);
    assert.match(calls()[1]!, / -s grill-me -a codex -y$/);
    assert.match(s.stdout, /^\+ skills externas {2}\(grill-me\)$/m);
    assert.ok(existsSync(join(d, ".agents/skills/grilling/SKILL.md")), "a deselected skill already installed stays");
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).options.externalSkills, ["grill-me"]);

    const again = basekit(["init", d, "-y"], undefined, npx.env);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /^= skills externas {2}\(grill-me\)$/m);
    assert.equal(calls().length, 2);

    const none = basekit(["sync", d, "--external-skills", "none"], undefined, npx.env);
    assert.equal(none.code, 0, none.stderr);
    assert.match(none.stdout, /^= skills externas {2}\(ninguna elegida\)$/m);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).options.externalSkills, []);
    assert.equal(calls().length, 2);
  });

  it("--dry-run --external-skills prints the npx call and changes nothing (S4)", () => {
    const d = scratch();
    const npx = fakeNpx();
    const calls = () => npx.log().filter((l) => l.startsWith("ARGS"));
    assert.equal(basekit(["init", d, "-y", "--stack", "nextjs", "--agents", "codex", "--external-skills", "grilling"], undefined, npx.env).code, 0);
    const before = read(d, ".agents/manifest.json");
    const s = basekit(["sync", d, "--dry-run", "--external-skills", "grill-me"], undefined, npx.env);
    assert.equal(s.code, 0, s.stdout + s.stderr);
    assert.match(s.stdout, /ejecutaría: npx -y skills@1\.7\.4 add .* -s grill-me -a codex -y/);
    assert.equal(calls().length, 1, "only the npx call from init");
    assert.equal(read(d, ".agents/manifest.json"), before, "the dry run leaves the manifest as it was");
    assert.ok(!existsSync(join(d, ".agents/skills/grill-me/SKILL.md")), "the dry run installs nothing");
  });

  it("--external-skills without agents stores the choice but installs nothing (S4)", () => {
    const d = scratch();
    const npx = fakeNpx();
    assert.equal(init(d, "--stack", "nextjs", "--agents", "none").code, 0);
    const s = basekit(["sync", d, "--external-skills", "grilling"], undefined, npx.env);
    assert.equal(s.code, 0, s.stdout + s.stderr);
    assert.match(s.stdout, /^! skills externas {2}\(sin agentes: se instalan cuando agregues uno con basekit sync --agents <a,b>\)$/m);
    assert.deepEqual(npx.log(), []);
    assert.deepEqual(JSON.parse(read(d, ".agents/manifest.json")).options.externalSkills, ["grilling"]);
  });

  it("bad --external-skills values are usage errors (exit 2) that change nothing, checked before the manifest (S4)", () => {
    const available = "Disponibles: grill-me, grill-with-docs, grilling, domain-modeling";
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--agents", "codex").code, 0);
    const before = read(d, ".agents/manifest.json");
    for (const [extra, message] of [
      [["--external-skills", "grill-me,foo,bar"], `--external-skills 'foo,bar' no es una skill externa. ${available}`],
      [["--external-skills", ""], `--external-skills '' no es una skill externa. ${available}`],
      [["--external-skills", "none,grilling"], "--external-skills none no se combina con otras skills"],
      [["--external-skills", "grilling", "--no-external-skills"], "--external-skills y --no-external-skills no se combinan"],
    ] as const) {
      const npx = fakeNpx();
      const r = basekit(["sync", d, ...extra], undefined, npx.env);
      assert.equal(r.code, 2, extra.join(" "));
      assert.equal(r.stderr, `ERROR: ${message}\n`);
      assert.equal(r.stdout, "");
      assert.equal(read(d, ".agents/manifest.json"), before);
      assert.deepEqual(npx.log(), []);
      const noManifest = basekit(["sync", scratch(), ...extra]);
      assert.equal(noManifest.code, 2, "the flag is checked before reading the manifest");
      assert.equal(noManifest.stderr, `ERROR: ${message}\n`);
    }
  });

  it("is idempotent", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "laravel", "--agents", "claude-code,opencode,gemini-cli,hermes-agent").code, 0);
    gitCommitAll(d);
    const r = basekit(["sync", d, "--no-external-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.stdout.split("\n").filter((l) => /^[+~!] /.test(l)), []);
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, "");
  });

  it("rejects options that only init accepts", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs").code, 0);
    for (const flag of [["--stack", "spring"], ["-y"]]) {
      const r = basekit(["sync", d, ...flag]);
      assert.equal(r.code, 2, flag.join(" "));
      assert.match(r.stderr, flag[0] === "-y" ? /--yes no aplica/ : /--stack/);
    }
  });
});
