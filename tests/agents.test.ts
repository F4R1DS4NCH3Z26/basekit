import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, sh } from "./helpers.js";

/** The development agents of this repository: .agents/roles is the source, .claude/agents its copy. */
const ROLES = join(REPO, ".agents/roles");
const ZONES = join(REPO, ".agents/zones");
const CLAUDE = join(REPO, ".claude/agents");
const names = (dir: string, ext: string) =>
  readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();

/** Front matter fields and body of an agent file. */
function parse(file: string): { fields: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(file, "utf8"));
  assert.ok(m, `${file} has no front matter`);
  const fields = Object.fromEntries(m[1]!.split("\n").map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
  return { fields, body: m[2]! };
}

/** A zone line as zone-check reads it: a bash pattern where `*` also matches `/`. */
function zoneLines(role: string): RegExp[] {
  return readFileSync(join(ZONES, `${role}.txt`), "utf8").split("\n")
    .map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)
    .map((g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*+/g, ".*").replace(/\?/g, ".")}$`));
}

describe("development agents", () => {
  it("every role has a zone, and every zone but the orchestrator's has a role", () => {
    assert.deepEqual(names(ZONES, ".txt"), [...names(ROLES, ".md"), "orchestrator"].sort());
  });

  it(".claude/agents mirrors .agents/roles: same name, description and instructions", () => {
    assert.deepEqual(names(CLAUDE, ".md"), names(ROLES, ".md"));
    for (const role of names(ROLES, ".md")) {
      const source = parse(join(ROLES, `${role}.md`));
      const copy = parse(join(CLAUDE, `${role}.md`));
      assert.equal(source.fields.name, role);
      assert.equal(copy.fields.name, role);
      assert.equal(JSON.parse(copy.fields.description!), source.fields.description, `${role}: description differs`);
      assert.equal(copy.body.replace(/^<!--.*-->\n/, ""), source.body, `${role}: instructions differ; copy .agents/roles/${role}.md`);
    }
  });

  it("every tracked file has exactly one owner zone", () => {
    const zones = names(ZONES, ".txt").map((z) => ({ z, lines: zoneLines(z) }));
    const files = sh("git", ["ls-files"], REPO).stdout.split("\n").filter(Boolean);
    assert.ok(files.length > 100, `git ls-files returned ${files.length} files`);
    for (const f of files) {
      const owners = zones.filter(({ lines }) => lines.some((re) => re.test(f))).map(({ z }) => z);
      assert.equal(owners.length, 1, `${f}: owners ${JSON.stringify(owners)}`);
    }
  });
});
