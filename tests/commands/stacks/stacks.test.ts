import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, scratch } from "../../helpers.js";

after(cleanup);

const manifest = (dir: string) => JSON.parse(readFileSync(join(dir, ".agents/manifest.json"), "utf8"));

describe("stacks command", () => {
  it("lists every stack read from plantillas/stacks and the supported agents", () => {
    const r = basekit(["stacks"]);
    assert.equal(r.code, 0, r.stderr);
    for (const id of ["fastapi", "laravel", "nextjs", "spring"]) assert.match(r.stdout, new RegExp(`\\b${id}\\b`));
    for (const id of ["claude-code", "opencode", "codex", "cursor", "gemini-cli", "github-copilot", "hermes-agent"]) {
      assert.match(r.stdout, new RegExp(`\\b${id}\\b`));
    }
  });
});

describe("stack detection", () => {
  it("detects a stack from detect.files", () => {
    const d = scratch();
    writeFileSync(join(d, "next.config.ts"), "export default {};\n");
    const r = basekit(["init", d, "--yes", "--no-external-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(manifest(d).stack, "nextjs");
  });

  it("detects a stack from detect.manifest + detect.contains", () => {
    const d = scratch();
    writeFileSync(join(d, "pyproject.toml"), '[project]\ndependencies = ["fastapi>=0.115"]\n');
    const r = basekit(["init", d, "--yes", "--no-external-skills"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(manifest(d).stack, "fastapi");
  });

  it("fails clearly when the stack cannot be detected and nothing can be asked", () => {
    const d = scratch();
    const r = basekit(["init", d, "--yes", "--no-external-skills"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /--stack/);
    assert.deepEqual(readdirSync(d), []);
  });
});
