import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, fakeNpx, gitCommitAll, scratch, sh } from "./helpers.js";

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
