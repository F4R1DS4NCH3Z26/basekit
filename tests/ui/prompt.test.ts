import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { AGENTS, DEFAULT_AGENTS } from "../../src/kit/agents.js";
import { init, type InitOptions } from "../../src/commands/init/index.js";
import { nodeFileSystem } from "../../src/infra/file-system.js";
import { processRunner } from "../../src/infra/runner.js";
import { Prompter } from "../../src/ui/prompt.js";
import { loadStacks } from "../../src/kit/stacks.js";
import { cleanup, scratch } from "../helpers.js";

after(cleanup);

/** A Prompter fed with the given answers; `output()` returns everything it printed. */
function prompter(...answers: string[]): { p: Prompter; output: () => string } {
  const input = new PassThrough();
  const out = new PassThrough();
  let text = "";
  out.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
  input.end(answers.map((a) => `${a}\n`).join(""));
  return { p: new Prompter(input, out), output: () => text };
}

const stacks = loadStacks();

describe("stack question", () => {
  it("lists every stack numbered and accepts an id", async () => {
    const { p, output } = prompter("nextjs");
    assert.equal(await p.stack(stacks), "nextjs");
    stacks.forEach((s, i) => assert.match(output(), new RegExp(`${i + 1}\\) ${s.id} +${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)));
    p.close();
  });

  it("accepts the option number", async () => {
    const { p } = prompter("3");
    assert.equal(await p.stack(stacks), stacks[2]!.id);
    p.close();
  });

  it("asks again after an invalid or empty answer", async () => {
    const { p, output } = prompter("foo", "9", "", "spring");
    assert.equal(await p.stack(stacks), "spring");
    assert.match(output(), /«foo» no es una opción válida/);
    assert.match(output(), /«9» no es una opción válida/);
    assert.match(output(), /Hace falta elegir un stack/);
    p.close();
  });

  it("fails with a hint when the input ends without a valid answer", async () => {
    const { p } = prompter("foo");
    await assert.rejects(p.stack(stacks), /--stack/);
    p.close();
  });
});

describe("agents question", () => {
  it("lists every agent, marks the defaults and takes them on Enter", async () => {
    const { p, output } = prompter("");
    assert.deepEqual(await p.agents(DEFAULT_AGENTS), DEFAULT_AGENTS);
    AGENTS.forEach((a, i) => assert.match(output(), new RegExp(`${i + 1}\\) ${a.id}`)));
    for (const id of DEFAULT_AGENTS) assert.match(output(), new RegExp(`\\) ${id} +\\(por defecto\\)`));
    p.close();
  });

  it("accepts numbers and ids mixed, in canonical order without duplicates", async () => {
    const { p } = prompter("7, opencode,2");
    assert.deepEqual(await p.agents(DEFAULT_AGENTS), ["opencode", "hermes-agent"]);
    p.close();
  });

  it("asks again naming what it did not recognise", async () => {
    const { p, output } = prompter("claude-code, x, 99", "1");
    assert.deepEqual(await p.agents(DEFAULT_AGENTS), ["claude-code"]);
    assert.match(output(), /No reconozco: x, 99/);
    p.close();
  });

  it("falls back to the defaults when the input ends", async () => {
    const { p } = prompter();
    assert.deepEqual(await p.agents(DEFAULT_AGENTS), DEFAULT_AGENTS);
    p.close();
  });
});

describe("context question", () => {
  it("returns the trimmed text, or empty on Enter or end of input", async () => {
    const a = prompter("  Reservas de pádel  ");
    assert.equal(await a.p.context(), "Reservas de pádel");
    a.p.close();
    const b = prompter("");
    assert.equal(await b.p.context(), "");
    b.p.close();
    const c = prompter();
    assert.equal(await c.p.context(), "");
    c.p.close();
  });
});

const quietInit = (o: Partial<InitOptions> & { dir: string }, prompt?: Prompter) =>
  init({ externalSkills: false, force: false, dryRun: false, ...o }, { log: () => {}, prompt, fs: nodeFileSystem, runner: processRunner });

describe("init with interactive answers", () => {
  it("uses the stack, agents and context answered, re-asking after an invalid stack", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("nope", "3", "1,2", "Tienda de bicis");
    assert.equal(await quietInit({ dir: d }, p), 0);
    p.close();
    assert.match(output(), /«nope» no es una opción válida/);
    const m = JSON.parse(readFileSync(join(d, ".agents/manifest.json"), "utf8"));
    assert.equal(m.stack, stacks[2]!.id);
    assert.deepEqual(m.agents, ["claude-code", "opencode"]);
    assert.match(readFileSync(join(d, "docs/PROJECT.md"), "utf8"), /Tienda de bicis/);
  });

  it("asks only what flags, the manifest or detection did not answer", async () => {
    const d = join(scratch(), "app");
    const first = prompter("Reservas");
    assert.equal(await quietInit({ dir: d, stack: "fastapi", agents: "codex" }, first.p), 0);
    first.p.close();
    assert.doesNotMatch(first.output(), /stack usa|herramientas/);
    assert.match(first.output(), /¿De qué trata el proyecto\?/);

    const rerun = prompter();
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a manifest asks nothing");
    assert.ok(existsSync(join(d, ".agents/manifest.json")));
  });
});
