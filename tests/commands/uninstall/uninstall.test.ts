import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { PassThrough } from "node:stream";
import { UsageError } from "../../../src/kit/errors.js";
import { uninstall, validateUninstall, type UninstallEnv, type UninstallOptions } from "../../../src/commands/uninstall/index.js";
import { nodeFileSystem } from "../../../src/infra/file-system.js";
import type { Runner } from "../../../src/infra/runner.js";
import { Prompter } from "../../../src/ui/prompt.js";
import { basekit, cleanup, scratch } from "../../helpers.js";

after(cleanup);

/**
 * Records the processes uninstall would start; `npm root -g` answers with `globalRoot`, or fails when it is
 * undefined. Never runs npm.
 */
class FakeRunner implements Runner {
  calls: { cmd: string; args: string[]; cwd: string }[] = [];
  constructor(private readonly globalRoot: string | undefined, private readonly ok = true) {}
  run(log: (l: string) => void, cmd: string, args: string[], cwd: string) {
    this.calls.push({ cmd, args, cwd });
    if (args.join(" ") === "root -g") {
      if (this.globalRoot === undefined) return false;
      log(`  ${this.globalRoot}`);
      return true;
    }
    return this.ok;
  }
  interactive(cmd: string, args: string[], cwd: string) {
    this.calls.push({ cmd, args, cwd });
    return true;
  }
  works() {
    return true;
  }
}

const touch = (path: string, text = "x\n") => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

/**
 * A temp machine: a HOME, an npm global root holding a global basekit, a project holding a local
 * basekit, and an empty PATH directory. Nothing outside the scratch directory is touched.
 */
function machine() {
  // Real path: on macOS the temp dir is a symlink (/var → /private/var) and basekit resolves its own package.
  const s = realpathSync(scratch());
  const home = join(s, "home");
  const globalRoot = join(s, "prefix", "lib", "node_modules");
  const globalPkg = join(globalRoot, "basekit");
  const project = join(s, "proj");
  const projectPkg = join(project, "node_modules", "basekit");
  const bin = join(s, "bin");
  for (const d of [home, globalPkg, projectPkg, bin]) mkdirSync(d, { recursive: true });
  touch(join(project, "package.json"), '{ "name": "proj", "devDependencies": { "basekit": "github:x/basekit" } }\n');
  const env = (packageRoot: string, path = bin): UninstallEnv => ({ home, path, packageRoot, cwd: s, platform: "linux" });
  return { s, home, globalRoot, globalPkg, project, projectPkg, bin, env };
}

/** Runs uninstall in-process; `answers` makes it interactive. Returns the exit code, the runner and the output. */
async function run(o: Partial<UninstallOptions>, env: UninstallEnv, runner: FakeRunner, answers?: string[]) {
  const lines: string[] = [];
  let out = "";
  let prompt: Prompter | undefined;
  if (answers) {
    const input = new PassThrough();
    const output = new PassThrough();
    output.on("data", (c: Buffer) => (out += c.toString("utf8")));
    input.end(answers.map((a) => `${a}\n`).join(""));
    prompt = new Prompter(input, output);
  }
  try {
    const code = await uninstall({ skills: false, yes: false, dryRun: false, ...o }, { log: (l) => lines.push(l), prompt, fs: nodeFileSystem, runner }, env);
    return { code, out, log: lines.join("\n"), lines };
  } finally {
    prompt?.close();
  }
}

const npmCalls = (r: FakeRunner) => r.calls.filter((c) => c.args[0] === "uninstall");

/** A global install of basekit-go in the temp HOME: two skills listed in the manifest, links for claude-code and opencode. */
function globalSkills(home: string) {
  const files = {
    ".agents/skills/cli-verify/SKILL.md": "h1",
    ".agents/skills/cli-verify/scripts/verify.sh": "h2",
    ".agents/skills/zone-check/SKILL.md": "h3",
  };
  for (const f of Object.keys(files)) touch(join(home, f));
  touch(join(home, ".agents/skills/mine/SKILL.md"), "the user's own skill\n");
  touch(join(home, ".agents/basekit.json"), `${JSON.stringify({ kit: "basekit", scope: "global", agents: ["claude-code", "opencode"], files }, null, 2)}\n`);
  for (const dir of [".claude/skills", ".config/opencode/skills"]) {
    mkdirSync(join(home, dir), { recursive: true });
    for (const sk of ["cli-verify", "zone-check"]) symlinkSync(join(home, ".agents/skills", sk), join(home, dir, sk), "dir");
  }
  // A link to the user's own skill and a basekit-named link that points elsewhere: neither is basekit's.
  symlinkSync(join(home, ".agents/skills/mine"), join(home, ".claude/skills/mine"), "dir");
  mkdirSync(join(home, "elsewhere"));
  mkdirSync(join(home, ".cursor/skills"), { recursive: true });
  symlinkSync(join(home, "elsewhere"), join(home, ".cursor/skills/cli-verify"), "dir");
}

const isLink = (p: string) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

describe("uninstall: plan, question and modes", () => {
  it("prints the plan, asks, and a no leaves everything intact (exit 0)", async () => {
    const m = machine();
    const runner = new FakeRunner(m.globalRoot);
    const r = await run({}, m.env(m.globalPkg), runner, ["n"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines.slice(0, 2), ["Se va a desinstalar:", "  - npm uninstall -g basekit"]);
    assert.match(r.out, /¿Desinstalar basekit\? \[s\/N\]/);
    assert.equal(r.lines.at(-1), "No se desinstaló nada.");
    assert.deepEqual(npmCalls(runner), []);
  });

  it("an empty answer is no (the default)", async () => {
    const m = machine();
    const runner = new FakeRunner(m.globalRoot);
    const r = await run({}, m.env(m.globalPkg), runner, [""]);
    assert.equal(r.code, 0);
    assert.match(r.log, /No se desinstaló nada\./);
    assert.deepEqual(npmCalls(runner), []);
  });

  it("-y on the global basekit runs `npm uninstall -g basekit` and reports success", async () => {
    const m = machine();
    const runner = new FakeRunner(m.globalRoot);
    const r = await run({ yes: true }, m.env(m.globalPkg), runner);
    assert.equal(r.code, 0);
    assert.deepEqual(npmCalls(runner), [{ cmd: "npm", args: ["uninstall", "-g", "basekit"], cwd: m.s }]);
    assert.equal(r.lines.at(-1), "basekit desinstalado. Los proyectos que ya creaste no cambian.");
    assert.doesNotMatch(r.log, /¿Desinstalar/);
  });

  it("a yes answer uninstalls too", async () => {
    const m = machine();
    const runner = new FakeRunner(m.globalRoot);
    const r = await run({}, m.env(m.globalPkg), runner, ["s"]);
    assert.equal(r.code, 0);
    assert.equal(npmCalls(runner).length, 1);
  });

  it("-y on a project's basekit runs `npm uninstall basekit` in the folder that holds node_modules", async () => {
    const m = machine();
    const runner = new FakeRunner(m.globalRoot);
    const r = await run({ yes: true }, m.env(m.projectPkg), runner);
    assert.equal(r.code, 0);
    assert.equal(r.lines[1], `  - npm uninstall basekit (en ${m.project})`);
    assert.deepEqual(npmCalls(runner), [{ cmd: "npm", args: ["uninstall", "basekit"], cwd: m.project }]);
  });

  it("--global and --project force the mode", async () => {
    const m = machine();
    const g = new FakeRunner(m.globalRoot);
    await run({ yes: true, mode: "global" }, m.env(m.projectPkg), g);
    assert.deepEqual(npmCalls(g), [{ cmd: "npm", args: ["uninstall", "-g", "basekit"], cwd: m.s }]);
    assert.ok(!g.calls.some((c) => c.args[0] === "root"), "a forced mode does not ask npm");

    const p = new FakeRunner(m.globalRoot);
    const r = await run({ yes: true, mode: "project" }, m.env(m.globalPkg), p);
    assert.deepEqual(npmCalls(p), [{ cmd: "npm", args: ["uninstall", "basekit"], cwd: m.s }]);
    assert.equal(r.lines[1], `  - npm uninstall basekit (en ${m.s})`);
  });

  it("a basekit that is neither npm's global one nor under node_modules needs --global or --project", async () => {
    const m = machine();
    const checkout = join(m.s, "checkout");
    mkdirSync(checkout);
    const runner = new FakeRunner(m.globalRoot);
    await assert.rejects(
      run({ yes: true }, m.env(checkout), runner),
      { message: `basekit uninstall: no se sabe si este basekit (${checkout}) es global o de un proyecto; usa --global o --project` },
    );
    assert.deepEqual(npmCalls(runner), []);
  });

  it("a failed `npm root -g` with a node_modules ancestor whose package.json does not list basekit is a usage error", async () => {
    const m = machine();
    touch(join(m.project, "package.json"), '{ "name": "proj", "dependencies": { "other": "1.0.0" } }\n');
    const runner = new FakeRunner(undefined);
    await assert.rejects(run({ yes: true }, m.env(m.projectPkg), runner), (e: Error) => {
      assert.ok(e instanceof UsageError, "a usage error exits 2");
      assert.equal(e.message, `basekit uninstall: no se sabe si este basekit (${m.projectPkg}) es global o de un proyecto; usa --global o --project`);
      return true;
    });
    assert.deepEqual(npmCalls(runner), []);
  });

  it("an empty `npm root -g` with a node_modules ancestor but no package.json is a usage error", async () => {
    const m = machine();
    rmSync(join(m.project, "package.json"));
    const runner = new FakeRunner("");
    await assert.rejects(run({ yes: true }, m.env(m.projectPkg), runner), UsageError);
    assert.deepEqual(npmCalls(runner), []);
  });

  it("a failed `npm root -g` in a real project (basekit in devDependencies) runs `npm uninstall basekit` there", async () => {
    const m = machine();
    const runner = new FakeRunner(undefined);
    const r = await run({ yes: true }, m.env(m.projectPkg), runner);
    assert.equal(r.code, 0);
    assert.equal(r.lines[1], `  - npm uninstall basekit (en ${m.project})`);
    assert.deepEqual(npmCalls(runner), [{ cmd: "npm", args: ["uninstall", "basekit"], cwd: m.project }]);
    assert.equal(r.lines.at(-1), "basekit desinstalado. Los proyectos que ya creaste no cambian.");
  });

  it("basekit listed in dependencies also marks a project", async () => {
    const m = machine();
    touch(join(m.project, "package.json"), '{ "dependencies": { "basekit": "1.0.0" } }\n');
    const runner = new FakeRunner(m.globalRoot);
    await run({ yes: true }, m.env(m.projectPkg), runner);
    assert.deepEqual(npmCalls(runner), [{ cmd: "npm", args: ["uninstall", "basekit"], cwd: m.project }]);
  });

  it("--global together with --project is a usage error", () => {
    assert.throws(() => validateUninstall({ global: true, project: true }), /^Error: Usa --global o --project, no los dos$/);
    assert.deepEqual(validateUninstall({ global: true }), { mode: "global" });
    assert.deepEqual(validateUninstall({ project: true }), { mode: "project" });
    assert.deepEqual(validateUninstall({}), { mode: undefined });
  });

  it("--dry-run prints the plan and the dry-run line, and changes nothing", async () => {
    const m = machine();
    globalSkills(m.home);
    const runner = new FakeRunner(m.globalRoot);
    const r = await run({ dryRun: true, skills: true }, m.env(m.globalPkg), runner);
    assert.equal(r.code, 0);
    assert.equal(r.lines.at(-1), "(dry-run: no se borra nada)");
    assert.deepEqual(npmCalls(runner), []);
    assert.ok(existsSync(join(m.home, ".agents/basekit.json")));
    assert.ok(existsSync(join(m.home, ".agents/skills/cli-verify/SKILL.md")));
    assert.ok(isLink(join(m.home, ".claude/skills/cli-verify")));
  });

  it("an npm failure prints the retry line and exits 1", async () => {
    const m = machine();
    const g = await run({ yes: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot, false));
    assert.equal(g.code, 1);
    assert.equal(g.lines.at(-1), "! npm uninstall falló; reinténtalo con: npm uninstall -g basekit");
    assert.doesNotMatch(g.log, /basekit desinstalado/);

    const p = await run({ yes: true }, m.env(m.projectPkg), new FakeRunner(m.globalRoot, false));
    assert.equal(p.code, 1);
    assert.equal(p.lines.at(-1), `! npm uninstall falló; reinténtalo con: npm uninstall basekit (en ${m.project})`);
  });
});

describe("uninstall --skills", () => {
  it("removes only the manifest's skills, basekit's links to them and the manifest", async () => {
    const m = machine();
    globalSkills(m.home);
    const runner = new FakeRunner(m.globalRoot);
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), runner);
    assert.equal(r.code, 0);
    const h = (p: string) => join(m.home, p);
    assert.deepEqual(r.lines.slice(0, 8), [
      "Se va a desinstalar:",
      "  - npm uninstall -g basekit",
      `  - ${h(".agents/skills/cli-verify")}`,
      `  - ${h(".agents/skills/zone-check")}`,
      `  - ${h(".claude/skills/cli-verify")}`,
      `  - ${h(".claude/skills/zone-check")}`,
      `  - ${h(".config/opencode/skills/cli-verify")}`,
      `  - ${h(".config/opencode/skills/zone-check")}`,
    ]);
    assert.equal(r.lines[8], `  - ${h(".agents/basekit.json")}`);
    for (const gone of [".agents/skills/cli-verify", ".agents/skills/zone-check", ".claude/skills/cli-verify", ".claude/skills/zone-check", ".config/opencode/skills/cli-verify", ".config/opencode/skills/zone-check", ".agents/basekit.json"]) {
      assert.ok(!existsSync(h(gone)) && !isLink(h(gone)), `${gone} must be removed`);
    }
    assert.equal(readFileSync(h(".agents/skills/mine/SKILL.md"), "utf8"), "the user's own skill\n");
    assert.ok(isLink(h(".claude/skills/mine")), "a link to the user's own skill stays");
    assert.ok(isLink(h(".cursor/skills/cli-verify")), "a link that points outside ~/.agents/skills stays");
    assert.ok(existsSync(h("elsewhere")));
    assert.equal(npmCalls(runner).length, 1);
  });

  it("keeps files inside a basekit skill folder that the manifest does not list", async () => {
    const m = machine();
    globalSkills(m.home);
    touch(join(m.home, ".agents/skills/cli-verify/notes.md"), "mine\n");
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot));
    assert.equal(r.code, 0);
    assert.equal(readFileSync(join(m.home, ".agents/skills/cli-verify/notes.md"), "utf8"), "mine\n");
    assert.ok(!existsSync(join(m.home, ".agents/skills/cli-verify/SKILL.md")));
    assert.ok(!existsSync(join(m.home, ".agents/skills/cli-verify/scripts")));
  });

  it("a skill folder with the user's files gets the suffix in the plan, and the folder and those files stay", async () => {
    const m = machine();
    globalSkills(m.home);
    touch(join(m.home, ".agents/skills/cli-verify/notes.md"), "mine\n");
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot));
    assert.equal(r.code, 0);
    const h = (p: string) => join(m.home, p);
    assert.deepEqual(r.lines.slice(2, 4), [
      `  - ${h(".agents/skills/cli-verify")}  (solo los archivos de basekit; se conservan los tuyos)`,
      `  - ${h(".agents/skills/zone-check")}`,
    ]);
    assert.equal(readFileSync(h(".agents/skills/cli-verify/notes.md"), "utf8"), "mine\n");
    assert.ok(!existsSync(h(".agents/skills/zone-check")), "a folder with only listed files is removed");
  });

  it("a link goes only with its folder: folders that stay (untouched or keeping the user's files) keep their links", async () => {
    const m = machine();
    globalSkills(m.home);
    const h = (p: string) => join(m.home, p);
    // cli-verify keeps the user's notes.md; zone-check has none of its listed files left, only the user's file.
    touch(h(".agents/skills/cli-verify/notes.md"), "mine\n");
    rmSync(h(".agents/skills/zone-check/SKILL.md"));
    touch(h(".agents/skills/zone-check/notes.md"), "mine\n");
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot));
    assert.equal(r.code, 0);
    for (const dir of [".claude/skills", ".config/opencode/skills"]) {
      for (const sk of ["cli-verify", "zone-check"]) {
        assert.ok(!r.lines.includes(`  - ${h(`${dir}/${sk}`)}`), `${dir}/${sk} is not in the plan`);
        assert.ok(isLink(h(`${dir}/${sk}`)), `${dir}/${sk} stays: its folder stays`);
      }
    }
    assert.ok(!existsSync(h(".agents/basekit.json")));
  });

  it("a symlink the user put in a skill folder counts as the user's file", async () => {
    const m = machine();
    globalSkills(m.home);
    symlinkSync(join(m.home, "elsewhere"), join(m.home, ".agents/skills/zone-check/mine"), "dir");
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot));
    assert.equal(r.lines[3], `  - ${join(m.home, ".agents/skills/zone-check")}  (solo los archivos de basekit; se conservan los tuyos)`);
    assert.ok(isLink(join(m.home, ".agents/skills/zone-check/mine")));
    assert.ok(existsSync(join(m.home, "elsewhere")));
  });

  it("listed files that no longer exist are not in the plan and do not make a folder line appear", async () => {
    const m = machine();
    globalSkills(m.home);
    rmSync(join(m.home, ".agents/skills/cli-verify/scripts"), { recursive: true });
    // zone-check: its only listed file is gone, its folder holds just the user's file.
    rmSync(join(m.home, ".agents/skills/zone-check/SKILL.md"));
    touch(join(m.home, ".agents/skills/zone-check/notes.md"), "mine\n");
    for (const dir of [".claude/skills", ".config/opencode/skills"]) rmSync(join(m.home, dir, "zone-check"));
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot));
    assert.equal(r.code, 0);
    const h = (p: string) => join(m.home, p);
    assert.deepEqual(r.lines.slice(0, 6), [
      "Se va a desinstalar:",
      "  - npm uninstall -g basekit",
      `  - ${h(".agents/skills/cli-verify")}`,
      `  - ${h(".claude/skills/cli-verify")}`,
      `  - ${h(".config/opencode/skills/cli-verify")}`,
      `  - ${h(".agents/basekit.json")}`,
    ]);
    assert.doesNotMatch(r.log, /zone-check|scripts/);
    assert.ok(!existsSync(h(".agents/skills/cli-verify")));
    assert.equal(readFileSync(h(".agents/skills/zone-check/notes.md"), "utf8"), "mine\n");
  });

  it("a skill folder whose listed files are all gone is not shown and is left as it is", async () => {
    const m = machine();
    globalSkills(m.home);
    rmSync(join(m.home, ".agents/skills/zone-check/SKILL.md"));
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot));
    assert.equal(r.code, 0);
    assert.ok(!r.lines.includes(`  - ${join(m.home, ".agents/skills/zone-check")}`));
    assert.ok(existsSync(join(m.home, ".agents/skills/zone-check")), "a folder the plan does not show is not touched");
  });

  it("without a global manifest it reports that there is no global install", async () => {
    const m = machine();
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot));
    assert.equal(r.code, 0);
    assert.deepEqual(r.lines.slice(0, 3), ["Se va a desinstalar:", "  - npm uninstall -g basekit", "= skills globales  (no hay instalación global)"]);
  });

  it("an npm failure leaves the global skills untouched", async () => {
    const m = machine();
    globalSkills(m.home);
    const r = await run({ yes: true, skills: true }, m.env(m.globalPkg), new FakeRunner(m.globalRoot, false));
    assert.equal(r.code, 1);
    assert.ok(existsSync(join(m.home, ".agents/basekit.json")));
    assert.ok(isLink(join(m.home, ".claude/skills/cli-verify")));
  });
});

describe("uninstall: other copies in PATH", () => {
  it("warns about every other basekit once (by real path) and never deletes them", async () => {
    const m = machine();
    const other = join(m.s, "other-bin");
    const otherAlias = join(m.s, "other-alias");
    touch(join(other, "basekit"), "#!/bin/sh\n");
    symlinkSync(other, otherAlias, "dir");
    // The global shim of the basekit being removed points into its package: it is not "another copy".
    mkdirSync(join(m.globalPkg, "dist/src"), { recursive: true });
    touch(join(m.globalPkg, "dist/src/cli.js"));
    symlinkSync(join(m.globalPkg, "dist/src/cli.js"), join(m.bin, "basekit"));
    const path = [m.bin, other, otherAlias, join(m.s, "missing")].join(delimiter);
    const r = await run({ yes: true }, m.env(m.globalPkg, path), new FakeRunner(m.globalRoot));
    assert.equal(r.code, 0);
    const warnings = r.lines.filter((l) => l.startsWith("! otra copia"));
    assert.deepEqual(warnings, [`! otra copia de basekit en el PATH: ${join(other, "basekit")} (no se borra)`]);
    assert.ok(existsSync(join(other, "basekit")));
  });

  it("on Windows it also finds basekit.cmd and basekit.exe", async () => {
    const m = machine();
    const a = join(m.s, "a");
    const b = join(m.s, "b");
    touch(join(a, "basekit.cmd"));
    touch(join(b, "basekit.exe"));
    const env = { ...m.env(m.globalPkg, [a, b].join(";")), platform: "win32" as const };
    const r = await run({ yes: true }, env, new FakeRunner(m.globalRoot));
    assert.deepEqual(r.lines.filter((l) => l.startsWith("! otra copia")), [
      `! otra copia de basekit en el PATH: ${join(a, "basekit.cmd")} (no se borra)`,
      `! otra copia de basekit en el PATH: ${join(b, "basekit.exe")} (no se borra)`,
    ]);
  });
});

describe("uninstall: from the command line (no terminal)", () => {
  it("without -y or --dry-run it is a usage error (exit 2) with the exact message", () => {
    const r = basekit(["uninstall"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "ERROR: basekit uninstall necesita confirmación: usa -y (o --dry-run para ver qué borraría)\n");
    assert.equal(r.stdout, "");
  });

  it("rejects --global with --project, a [dir] and options of other commands", () => {
    const both = basekit(["uninstall", "--global", "--project", "--dry-run"]);
    assert.equal(both.code, 2);
    assert.equal(both.stderr, "ERROR: Usa --global o --project, no los dos\n");
    for (const args of [["uninstall", "somewhere", "--dry-run"], ["uninstall", "--from", "x", "--dry-run"], ["uninstall", "--stack", "x", "--dry-run"]]) {
      assert.equal(basekit(args).code, 2, args.join(" "));
    }
  });

  it("--dry-run with a forced mode prints the plan and touches nothing", () => {
    const home = scratch();
    const r = basekit(["uninstall", "--global", "--skills", "--dry-run"], undefined, { HOME: home, USERPROFILE: home });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(
      r.stdout,
      "Se va a desinstalar:\n  - npm uninstall -g basekit\n= skills globales  (no hay instalación global)\n(dry-run: no se borra nada)\n",
    );
  });

  it("the help lists the uninstall line", () => {
    const r = basekit(["help"]);
    assert.ok(
      r.stdout.includes("  basekit uninstall [--global|--project] [--skills] [-y] [--dry-run]   Desinstala este basekit (con --skills, también las skills globales)\n"),
      r.stdout,
    );
  });
});
