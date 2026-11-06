import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { DEFAULT_AGENTS } from "../../src/kit/agents.js";
import { CancelledError } from "../../src/kit/errors.js";
import { loadStacks } from "../../src/kit/stacks.js";
import { Prompter } from "../../src/ui/prompt.js";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const SPACE = " ";
const CTRL_C = "\x03";

/** A fake terminal: a TTY input with raw mode, and an output that records what was drawn. */
function terminal() {
  const input = new PassThrough() as PassThrough & { isTTY: boolean; isRaw: boolean; setRawMode: (raw: boolean) => void };
  input.isTTY = true;
  input.isRaw = false;
  const modes: boolean[] = [];
  input.setRawMode = (raw: boolean) => {
    input.isRaw = raw;
    modes.push(raw);
  };
  const out = new PassThrough();
  let text = "";
  out.on("data", (c: Buffer) => (text += c.toString("utf8")));
  const p = new Prompter(input, out);
  /** Types the keys once the prompt is listening. */
  const type = (...keys: string[]) => setImmediate(() => input.write(keys.join("")));
  return { p, input, type, modes, output: () => text };
}

const OPTIONS = [
  { id: "global", label: "Global", hint: "npm install -g" },
  { id: "project", label: "Este proyecto", hint: "npm install -D" },
];

describe("arrow-key menus in a terminal", () => {
  it("choose: ↓ and Enter pick the second option; raw mode is turned on and back off", async () => {
    const t = terminal();
    t.type(DOWN, ENTER);
    assert.equal(await t.p.choose("¿Dónde?", OPTIONS), "project");
    assert.deepEqual(t.modes, [true, false]);
    assert.match(t.output(), /❯/);
    assert.match(t.output(), /↑\/↓/);
    assert.match(t.output(), /\x1b\[\?25l[\s\S]*\x1b\[\?25h/, "the cursor is hidden while choosing and shown again");
    t.p.close();
  });

  it("choose: Enter right away keeps the first option, ↑ wraps to the last, a number jumps to it", async () => {
    for (const [keys, expected] of [[[ENTER], "global"], [[UP, ENTER], "project"], [["2", ENTER], "project"], [["j", "k", ENTER], "global"]] as [string[], string][]) {
      const t = terminal();
      t.type(...keys);
      assert.equal(await t.p.choose("¿Dónde?", OPTIONS), expected, JSON.stringify(keys));
      t.p.close();
    }
  });

  it("stack: arrows over the stacks", async () => {
    const stacks = loadStacks();
    const t = terminal();
    t.type(DOWN, DOWN, ENTER);
    assert.equal(await t.p.stack(stacks), stacks[2]!.id);
    t.p.close();
  });

  it("agents: the defaults start checked; space toggles; the result keeps the canonical order", async () => {
    const a = terminal();
    a.type(ENTER);
    assert.deepEqual(await a.p.agents(DEFAULT_AGENTS), DEFAULT_AGENTS);
    assert.match(a.output(), /◉/);
    assert.match(a.output(), /◯/);
    a.p.close();

    // claude-code (1st) off, opencode (2nd) stays on, hermes-agent (last) on.
    const b = terminal();
    b.type(SPACE, UP, SPACE, ENTER);
    assert.deepEqual(await b.p.agents(DEFAULT_AGENTS), ["opencode", "hermes-agent"]);
    b.p.close();
  });

  it("agents: Enter with nothing checked does not finish", async () => {
    const t = terminal();
    t.type(SPACE, DOWN, SPACE, ENTER);
    setTimeout(() => t.input.write(SPACE + ENTER), 20);
    assert.deepEqual(await t.p.agents(DEFAULT_AGENTS), ["opencode"]);
    assert.match(t.output(), /Marca al menos una/);
    t.p.close();
  });

  it("Ctrl+C cancels and gives the terminal back", async () => {
    const t = terminal();
    t.type(DOWN, CTRL_C);
    await assert.rejects(t.p.choose("¿Dónde?", OPTIONS), CancelledError);
    assert.deepEqual(t.modes, [true, false]);
    assert.match(t.output(), /\x1b\[\?25h/);
    t.p.close();
  });

  it("after a menu, text and yes/no questions still read whole lines", async () => {
    const t = terminal();
    t.type(DOWN, ENTER);
    assert.equal(await t.p.choose("¿Dónde?", OPTIONS), "project");
    setImmediate(() => t.input.write("Tienda de bicis\n"));
    assert.equal(await t.p.context(), "Tienda de bicis");
    setImmediate(() => t.input.write("s\n"));
    assert.equal(await t.p.confirm("¿Seguro?", false), true);
    t.p.close();
  });
});
