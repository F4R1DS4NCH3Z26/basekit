import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { install, validateInstall } from "../../../src/commands/install/index.js";
import { nodeFileSystem } from "../../../src/infra/file-system.js";
import type { Runner } from "../../../src/infra/runner.js";
import { Prompter } from "../../../src/ui/prompt.js";
import { basekit, cleanup, scratch } from "../../helpers.js";

after(cleanup);

const SOURCE = "github:F4R1DS4NCH3Z26/basekit";

/** Records the processes install would start, without starting them. */
class FakeRunner implements Runner {
  calls: { kind: "run" | "interactive"; cmd: string; args: string[]; cwd: string }[] = [];
  constructor(private readonly ok = true) {}
  run(_log: (l: string) => void, cmd: string, args: string[], cwd: string) {
    this.calls.push({ kind: "run", cmd, args, cwd });
    return this.ok;
  }
  interactive(cmd: string, args: string[], cwd: string) {
    this.calls.push({ kind: "interactive", cmd, args, cwd });
    return true;
  }
  works() {
    return true;
  }
}

/** Runs install in-process with the given answers; returns the exit code, the runner and the output. */
async function run(o: Parameters<typeof install>[0], answers?: string[], runner = new FakeRunner()) {
  let out = "";
  const lines: string[] = [];
  let prompt: Prompter | undefined;
  if (answers) {
    const input = new PassThrough();
    const output = new PassThrough();
    output.on("data", (c: Buffer) => (out += c.toString("utf8")));
    input.end(answers.map((a) => `${a}\n`).join(""));
    prompt = new Prompter(input, output);
  }
  try {
    const code = await install(o, { log: (l) => lines.push(l), prompt, fs: nodeFileSystem, runner });
    return { code, runner, out, log: lines.join("\n") };
  } finally {
    prompt?.close();
  }
}

describe("install: interactive menu", () => {
  it("offers global and this project; 1 installs globally from the package's own repository", async () => {
    const d = scratch();
    const r = await run({ dir: d }, ["1"]);
    assert.equal(r.code, 0);
    assert.match(r.out, /1\) Global .*npm install -g/);
    assert.match(r.out, /2\) Este proyecto .*npm install -D/);
    assert.deepEqual(r.runner.calls, [{ kind: "run", cmd: "npm", args: ["install", "-g", "--install-links", "--no-audit", "--no-fund", SOURCE], cwd: d }]);
    assert.match(r.log, /basekit init/);
  });

  it("2 installs as a devDependency, and can run init right away", async () => {
    const d = scratch();
    writeFileSync(join(d, "package.json"), '{ "name": "app" }\n');
    const r = await run({ dir: d }, ["2", "s"]);
    assert.equal(r.code, 0);
    assert.deepEqual(r.runner.calls, [
      { kind: "run", cmd: "npm", args: ["install", "-D", "--no-audit", "--no-fund", SOURCE], cwd: d },
      { kind: "interactive", cmd: "npx", args: ["--no-install", "basekit", "init", "."], cwd: d },
    ]);
  });

  it("without package.json it asks before creating one, and stops if the answer is no", async () => {
    const d = scratch();
    const no = await run({ dir: d }, ["2", "n"]).catch((e: Error) => e);
    assert.ok(no instanceof Error && /npm init -y|--global/.test(no.message), String(no));
    assert.deepEqual(readdirSync(d), [], "nothing may be created");

    const yes = await run({ dir: d }, ["2", "s", "n"]);
    assert.equal(yes.code, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(d, "package.json"), "utf8")).private, true);
    assert.equal(yes.runner.calls.length, 1, "init must not run when the user says no");
    assert.match(yes.log, /npx --no-install basekit init \./);
  });

  it("a failed npm install exits 1 and prints the command to retry", async () => {
    const d = scratch();
    const r = await run({ dir: d, mode: "global" }, undefined, new FakeRunner(false));
    assert.equal(r.code, 1);
    assert.match(r.log, /Reinténtalo con: npm install -g --install-links github:F4R1DS4NCH3Z26\/basekit/);
  });

  it("--from replaces the source", async () => {
    const r = await run({ dir: scratch(), mode: "global", from: "github:otro/basekit#v0.2.0" });
    assert.equal(r.runner.calls[0]!.args.at(-1), "github:otro/basekit#v0.2.0");
  });

  it("--from accepts packages, URLs and paths (absolute, relative, ~)", () => {
    for (const from of ["github:otro/basekit#v0.2.0", "/tmp/basekit-0.1.0.tgz", "./basekit.tgz", "~/basekit.tgz", "https://example.com/b.tgz", "C:\\pkgs\\b.tgz"]) {
      assert.deepEqual(validateInstall({ global: true, from }), { mode: "global", from }, from);
    }
  });
});

describe("install: from the command line (no terminal, no questions)", () => {
  it("needs --global or --project", () => {
    const r = basekit(["install", scratch()]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--global o basekit install --project/);
  });

  it("--project without package.json fails before creating anything", () => {
    const d = scratch();
    const r = basekit(["install", d, "--project"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No hay package.json/);
    assert.deepEqual(readdirSync(d), []);
  });

  it("rejects both flags, unsafe --from values and options of other commands", () => {
    for (const args of [["--global", "--project"], ["--global", "--from=a;rm -rf x"], ["--global", "--from=-x"], ["--global", "--stack", "nextjs"]]) {
      const r = basekit(["install", scratch(), ...args]);
      assert.equal(r.code, 2, args.join(" "));
    }
    assert.ok(!existsSync("x"));
  });

  it("uninstall's --skills does not apply to install, and install's own flags still parse", () => {
    const r = basekit(["install", scratch(), "--global", "--skills"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "ERROR: --skills no aplica a `install`\n");
  });

  it("plain `basekit` without a terminal still prints the help and exits 2", () => {
    const r = basekit([]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /basekit install/);
  });
});
