import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, gitCommitAll, scratch, sh } from "./helpers.js";

after(cleanup);

const ALL = "claude-code,opencode,gemini-cli,hermes-agent";
const read = (dir: string, f: string) => readFileSync(join(dir, f), "utf8");
const init = (dir: string, ...extra: string[]) => basekit(["init", dir, "--yes", "--no-external-skills", ...extra]);

/** Splits a generated adapter into its frontmatter lines and body. */
function frontmatter(text: string): { lines: string[]; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, "missing frontmatter");
  return { lines: m[1]!.split("\n"), body: m[2]! };
}

/** Strict check of the YAML subset basekit emits: `key: value`, nested maps, JSON-quoted keys/strings. */
function assertYamlSubset(lines: string[]): void {
  for (const line of lines) {
    const m = /^( *)("(?:[^"\\]|\\.)*"|[a-z]+):(?: (.*))?$/.exec(line);
    assert.ok(m, `not valid YAML line: ${line}`);
    assert.equal(m[1]!.length % 2, 0, `bad indent: ${line}`);
    if (m[2]!.startsWith('"')) JSON.parse(m[2]!);
    const value = m[3];
    if (value?.startsWith('"')) JSON.parse(value);
  }
}

describe("acceptance 10: OpenCode subagents", () => {
  it("valid frontmatter, edit denied by default and zones allowed", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--agents", "opencode").code, 0);
    const roles = readdirSync(join(d, ".agents/roles")).map((f) => f.replace(/\.md$/, ""));
    assert.deepEqual(readdirSync(join(d, ".opencode/agents")).sort(), roles.map((r) => `${r}.md`).sort());
    for (const role of roles) {
      const { lines, body } = frontmatter(read(d, `.opencode/agents/${role}.md`));
      assertYamlSubset(lines);
      assert.ok(lines.includes("mode: subagent"));
      assert.ok(lines.includes("  webfetch: deny"));
      const edit = lines.indexOf("  edit:");
      assert.equal(lines[edit + 1], '    "*": deny');
      const zones = read(d, `.agents/zones/${role}.txt`).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      assert.ok(zones.length > 0);
      for (const z of zones) assert.ok(lines.includes(`    ${JSON.stringify(z)}: allow`), `${role}: zone ${z}`);
      assert.match(body, /^<!-- Generado por basekit desde \.agents\/roles\//);
      const description = lines.find((l) => l.startsWith("description: "))!;
      assert.ok(JSON.parse(description.slice("description: ".length)).length > 10);
    }
    const cfg = JSON.parse(read(d, "opencode.json"));
    assert.equal(cfg.permission.read["*.env"], "deny");
    assert.equal(cfg.permission.read["*.env.example"], "allow");
    assert.ok(!existsSync(join(d, ".claude")), "no Claude files for an OpenCode-only project");
  });
});

describe("Claude Code adapter", () => {
  it("CLAUDE.md, subagents and settings.json", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "laravel", "--agents", "claude-code").code, 0);
    assert.equal(read(d, "CLAUDE.md"), "@AGENTS.md\n");
    const role = read(d, ".agents/roles/data-writer.md");
    const roleBody = role.replace(/^---\n[\s\S]*?\n---\n/, "");
    const { lines, body } = frontmatter(read(d, ".claude/agents/data-writer.md"));
    assertYamlSubset(lines);
    assert.ok(lines.includes("name: data-writer"));
    assert.ok(lines.includes("tools: Read, Edit, Write, Grep, Glob, Bash"));
    assert.ok(lines.includes("model: sonnet"));
    assert.ok(body.endsWith(roleBody), "role body copied as is");
    const settings = JSON.parse(read(d, ".claude/settings.json"));
    assert.ok(settings.permissions.deny.includes("Read(./.env)"));
    assert.ok(!settings.permissions.deny.includes("Read(./.env.*)"), "must not block .env.example");
    assert.ok(settings.permissions.allow.includes("Bash(bash .agents/skills/php-scaffold/scripts/scaffold.sh:*)"));
    assert.ok(!existsSync(join(d, "opencode.json")));
  });

  it("prepends @AGENTS.md to an existing CLAUDE.md and keeps an existing settings.json", () => {
    const d = scratch();
    writeFileSync(join(d, "CLAUDE.md"), "# Notas mías\n");
    mkdirSync(join(d, ".claude"));
    writeFileSync(join(d, ".claude/settings.json"), '{"mine":true}\n');
    assert.equal(init(d, "--stack", "nextjs", "--agents", "claude-code").code, 0);
    assert.equal(read(d, "CLAUDE.md"), "@AGENTS.md\n\n# Notas mías\n");
    assert.equal(read(d, ".claude/settings.json"), '{"mine":true}\n');
  });
});

describe("Gemini CLI and Hermes", () => {
  it("gemini settings point to AGENTS.md and Hermes gets no instruction file", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "fastapi", "--agents", "gemini-cli,hermes-agent").code, 0);
    assert.deepEqual(JSON.parse(read(d, ".gemini/settings.json")), { context: { fileName: ["AGENTS.md"] } });
    assert.ok(!existsSync(join(d, ".hermes.md")) && !existsSync(join(d, "HERMES.md")));
  });

  it("warns when a .hermes.md exists", () => {
    const d = scratch();
    writeFileSync(join(d, ".hermes.md"), "x\n");
    const r = init(d, "--stack", "fastapi", "--agents", "hermes-agent");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^! \.hermes\.md/m);
  });
});

describe("acceptance 11: skill links", () => {
  it(".claude/skills and .hermes/skills are relative links to .agents/skills", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "spring", "--agents", ALL).code, 0);
    const skills = readdirSync(join(d, ".agents/skills"));
    for (const dir of [".claude/skills", ".hermes/skills"]) {
      assert.deepEqual(readdirSync(join(d, dir)).sort(), skills.sort());
      for (const s of skills) {
        const link = join(d, dir, s);
        assert.ok(lstatSync(link).isSymbolicLink(), `${dir}/${s} is not a link`);
        assert.ok(!readlinkSync(link).startsWith("/"), "link must be relative");
        assert.equal(realpathSync(link), realpathSync(join(d, ".agents/skills", s)));
      }
    }
    assert.ok(!existsSync(join(d, ".opencode/skills")), "OpenCode reads .agents/skills natively");
  });
});

describe("idempotency with every adapter", () => {
  it("second run only reports '=' and leaves git status empty", () => {
    const d = scratch();
    assert.equal(init(d, "--stack", "nextjs", "--agents", ALL).code, 0);
    gitCommitAll(d);
    const r = init(d);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.stdout.split("\n").filter((l) => /^[+~!] /.test(l)), []);
    assert.equal(sh("git", ["status", "--porcelain"], d).stdout, "");
  });
});
