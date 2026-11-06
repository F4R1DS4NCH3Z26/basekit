import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { basekit, cleanup, gitCommitAll, scratch, sh } from "../helpers.js";

after(cleanup);

const SCRIPT = ".agents/skills/zone-check/scripts/check_zones.sh";
const zones = (dir: string, ...args: string[]) => sh("bash", [SCRIPT, ...args], dir);

/** A committed nextjs project with the given extra files (path -> content). */
function project(files: Record<string, string> = {}): string {
  const d = scratch();
  const r = basekit(["init", d, "-y", "--no-external-skills", "--stack", "nextjs"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(d, f, ".."), { recursive: true });
    writeFileSync(join(d, f), body);
  }
  gitCommitAll(d);
  return d;
}

describe("zone-check script", () => {
  it("a staged rename checks the old path too: moving a file out of another zone fails", () => {
    const d = project({ "src/lib/auth.ts": "export {};\n" });
    mkdirSync(join(d, "src/features/orders"), { recursive: true });
    const mv = sh("git", ["mv", "src/lib/auth.ts", "src/features/orders/services.ts"], d);
    assert.equal(mv.code, 0, mv.stderr);
    const r = zones(d, "data-writer");
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^FUERA DE ZONA: src\/lib\/auth\.ts$/m);
    assert.doesNotMatch(r.stdout, /FUERA DE ZONA: src\/features\/orders\/services\.ts/);
    assert.match(r.stdout, /zone-check \[data-writer\]: 2 cambios nuevos, 1 fuera de zona/);
  });

  it("a path with an accent and a space is tracked literally across snapshots", () => {
    const f = "src/app/api/decisión final.ts"; // data-writer zone: src/app/api/**
    const d = project({ [f]: "export {};\n" });
    for (const round of [1, 2]) {
      assert.equal(zones(d, "--snapshot").code, 0);
      appendFileSync(join(d, f), `// edit ${round}\n`);
      const own = zones(d, "data-writer");
      assert.equal(own.code, 0, `round ${round}: ${own.stdout}${own.stderr}`);
      assert.match(own.stdout, /zone-check \[data-writer\]: 1 cambios nuevos, 0 fuera de zona/, `round ${round}`);
      const other = zones(d, "ui-writer");
      assert.equal(other.code, 1, `round ${round}: ${other.stdout}${other.stderr}`);
      assert.ok(other.stdout.includes(`FUERA DE ZONA: ${f}\n`), `round ${round}: ${other.stdout}`);
    }
    const baseline = readFileSync(join(d, ".git/zone-baseline"), "utf8");
    assert.match(baseline, /^[0-9a-f]{40}\tsrc\/app\/api\/decisión final\.ts$/m);
    assert.doesNotMatch(baseline, /deleted/);
  });

  it("an untracked file with quotes in its name is reported literally", () => {
    const d = project();
    mkdirSync(join(d, "src/lib"), { recursive: true });
    writeFileSync(join(d, `src/lib/it's "q".ts`), "x\n");
    const r = zones(d, "data-writer");
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`FUERA DE ZONA: src/lib/it's "q".ts\n`), r.stdout);
  });

  it("keeps the existing behaviour: in-zone passes, out-of-zone fails, owners after init", () => {
    const d = project({ "src/lib/auth.ts": "export {};\n" });
    const owners = zones(d, "--owners");
    assert.equal(owners.code, 0, owners.stdout + owners.stderr);
    assert.match(owners.stdout, / 0 sin dueño/);

    assert.equal(zones(d, "--snapshot").code, 0);
    mkdirSync(join(d, "src/app/api/orders"), { recursive: true });
    writeFileSync(join(d, "src/app/api/orders/route.ts"), "export {};\n");
    const ok = zones(d, "data-writer");
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /zone-check \[data-writer\]: 1 cambios nuevos, 0 fuera de zona/);

    assert.equal(zones(d, "--snapshot").code, 0);
    appendFileSync(join(d, "src/lib/auth.ts"), "// out of zone\n");
    const bad = zones(d, "data-writer");
    assert.equal(bad.code, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout, /^FUERA DE ZONA: src\/lib\/auth\.ts$/m);
    assert.match(bad.stdout, /zone-check \[data-writer\]: 1 cambios nuevos, 1 fuera de zona/);
  });
});
