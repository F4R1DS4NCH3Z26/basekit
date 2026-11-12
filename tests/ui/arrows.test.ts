import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { DEFAULT_AGENTS } from "../../src/kit/agents.js";
import { CancelledError, failure, UsageError } from "../../src/kit/errors.js";
import { loadStacks } from "../../src/kit/stacks.js";
import { Prompter } from "../../src/ui/prompt.js";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const SPACE = " ";
const CTRL_C = "\x03";
const CTRL_D = "\x04";
const ESC = "\x1b";

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
  /** Types the keys once `question` is printed (the first time only). */
  const when = (question: string, ...keys: string[]) => {
    const watch = () => {
      if (!text.includes(question)) return;
      out.removeListener("data", watch);
      setImmediate(() => input.write(keys.join("")));
    };
    out.on("data", watch);
  };
  return { p, input, type, when, modes, output: () => text };
}

/** The visible text, without escape sequences. */
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");

const OPTIONS = [
  { id: "global", label: "Global", hint: "npm install -g" },
  { id: "project", label: "Este proyecto", hint: "npm install -D" },
];

// A menu that never settles must fail the test, not hang the suite.
describe("clack menus in a terminal", { timeout: 5000 }, () => {
  it("choose: ↓ and Enter pick the second option; raw mode is turned on and back off", async () => {
    const t = terminal();
    t.type(DOWN, ENTER);
    assert.equal(await t.p.choose("¿Dónde?", OPTIONS), "project");
    assert.equal(t.modes[0], true);
    assert.equal(t.modes.at(-1), false);
    assert.match(plain(t.output()), /¿Dónde\?/);
    assert.match(plain(t.output()), /Global/);
    assert.match(plain(t.output()), /npm install -g/, "the focused option shows its hint");
    t.p.close();
  });

  it("choose: with a default, the menu starts on it and Enter right away takes it", async () => {
    for (const [keys, expected] of [[[ENTER], "project"], [[UP, ENTER], "global"]] as [string[], string][]) {
      const t = terminal();
      t.type(...keys);
      assert.equal(await t.p.choose("¿Dónde?", OPTIONS, "project"), expected, JSON.stringify(keys));
      t.p.close();
    }
  });

  it("choose: Enter right away keeps the first option, ↑ wraps to the last, j/k move", async () => {
    for (const [keys, expected] of [[[ENTER], "global"], [[UP, ENTER], "project"], [["j", ENTER], "project"], [["j", "k", ENTER], "global"]] as [string[], string][]) {
      const t = terminal();
      t.type(...keys);
      assert.equal(await t.p.choose("¿Dónde?", OPTIONS), expected, JSON.stringify(keys));
      t.p.close();
    }
  });

  it("stack: one menu per step (tipo, lenguaje, framework), each filtered by the previous answers", async () => {
    const stacks = loadStacks();
    const t = terminal();
    // Each menu reads keys only while it is open: type them once its question is on screen.
    t.when("¿Qué tipo de app es?", DOWN, ENTER); // Frontend
    t.when("¿Con qué framework?", DOWN, DOWN, ENTER);
    const frontend = stacks.filter((s) => s.kind === "frontend");
    assert.equal(await t.p.stack(stacks), frontend[2]!.id);
    const text = plain(t.output());
    assert.match(text, new RegExp(`Lenguaje: ${frontend[0]!.language} \\(única opción\\)`));
    assert.doesNotMatch(text, /¿En qué lenguaje\?/);
    for (const s of frontend) assert.ok(text.includes(s.name), s.id);
    for (const s of stacks.filter((x) => x.kind !== "frontend")) assert.ok(!text.includes(s.name), s.id);
    t.p.close();
  });

  it("stack: a framework step with a single option is chosen by itself", async () => {
    const stacks = loadStacks();
    const fullstack = stacks.filter((s) => s.kind === "fullstack");
    const languages = [...new Set(fullstack.map((s) => s.language))].sort();
    const only = fullstack.find((s) => s.language === languages[1])!;
    const t = terminal();
    t.when("¿Qué tipo de app es?", DOWN, DOWN, ENTER); // Fullstack
    t.when("¿En qué lenguaje?", DOWN, ENTER);
    assert.equal(await t.p.stack(stacks), only.id);
    assert.ok(plain(t.output()).includes(`Framework: ${only.name} (única opción)`));
    assert.doesNotMatch(plain(t.output()), /¿Con qué framework\?/);
    t.p.close();
  });

  it("stack: fullstack → Combinar, then backend and frontend with the arrows (S16)", async () => {
    const stacks = loadStacks();
    const backendLanguages = [...new Set(stacks.filter((s) => s.kind === "backend").map((s) => s.language))].sort();
    const go = stacks.filter((s) => s.kind === "backend" && s.language === "Go");
    const frontend = stacks.filter((s) => s.kind === "frontend");
    const t = terminal();
    t.when("¿Qué tipo de app es?", DOWN, DOWN, ENTER); // Fullstack
    t.when("¿En qué lenguaje?", UP, ENTER); // the last option: Combinar backend + frontend
    t.when("¿En qué lenguaje es el backend?", ...Array<string>(backendLanguages.indexOf("Go")).fill(DOWN), ENTER);
    t.when("¿Con qué framework de backend?", DOWN, ENTER);
    t.when("¿Con qué framework de frontend?", UP, ENTER);
    assert.equal(await t.p.stack(stacks), `${go[1]!.id}+${frontend[frontend.length - 1]!.id}`);
    assert.ok(plain(t.output()).includes("Combinar backend + frontend"));
    assert.ok(plain(t.output()).includes(`Lenguaje del frontend: ${frontend[0]!.language} (única opción)`));
    t.p.close();
  });

  it("agents: the defaults start checked with the hint «por defecto»; space toggles; the result keeps the canonical order", async () => {
    const a = terminal();
    a.type(ENTER);
    assert.deepEqual(await a.p.agents(DEFAULT_AGENTS), DEFAULT_AGENTS);
    assert.match(plain(a.output()), /¿Con qué herramientas vas a trabajar\?/);
    assert.match(plain(a.output()), /\(por defecto\)/);
    assert.doesNotMatch(plain(a.output()), /\(\(por defecto\)\)/);
    a.p.close();

    // claude-code (1st) off, opencode (2nd) stays on, hermes-agent (last) on.
    const b = terminal();
    b.type(SPACE, UP, SPACE, ENTER);
    assert.deepEqual(await b.p.agents(DEFAULT_AGENTS), ["opencode", "hermes-agent"]);
    b.p.close();
  });

  it("agents: Enter with nothing checked chooses no agent (S2)", async () => {
    const t = terminal();
    t.type(SPACE, DOWN, SPACE, ENTER);
    assert.deepEqual(await t.p.agents(DEFAULT_AGENTS), []);
    assert.doesNotMatch(plain(t.output()), /at least one/);
    t.p.close();
  });

  it("external skills: all four start checked; Enter keeps them, space unchecks, none checked is none (S1)", async () => {
    const skills = ["grill-me", "grill-with-docs", "grilling", "domain-modeling"];
    const a = terminal();
    a.type(ENTER);
    assert.deepEqual(await a.p.externalSkills(skills), skills);
    assert.match(plain(a.output()), /¿Qué skills externas instalo\? \(usan npx y red\)/);
    a.p.close();

    const b = terminal();
    b.type(SPACE, DOWN, DOWN, SPACE, ENTER);
    assert.deepEqual(await b.p.externalSkills(skills), ["grill-with-docs", "domain-modeling"]);
    b.p.close();

    const c = terminal();
    c.type(SPACE, DOWN, SPACE, DOWN, SPACE, DOWN, SPACE, ENTER);
    assert.deepEqual(await c.p.externalSkills(skills), []);
    c.p.close();
  });

  it("confirm: Enter takes the default, ↓ switches the answer, y and n answer directly", async () => {
    for (const [keys, byDefault, expected] of [
      [[ENTER], true, true],
      [[ENTER], false, false],
      [[DOWN, ENTER], true, false],
      [["y"], false, true],
      [["n"], true, false],
    ] as [string[], boolean, boolean][]) {
      const t = terminal();
      t.type(...keys);
      assert.equal(await t.p.confirm("¿Seguro?", byDefault), expected, JSON.stringify([keys, byDefault]));
      assert.match(plain(t.output()), /¿Seguro\?/);
      assert.match(plain(t.output()), /Sí/);
      t.p.close();
    }
  });

  it("context: the text typed is returned trimmed; Enter alone leaves it empty", async () => {
    const a = terminal();
    a.type("  Tienda de bicis ", ENTER);
    assert.equal(await a.p.context(), "Tienda de bicis");
    assert.match(plain(a.output()), /¿De qué trata el proyecto\? \(una o dos frases; Enter para dejarlo vacío\)/);
    a.p.close();

    const b = terminal();
    b.type(ENTER);
    assert.equal(await b.p.context(), "");
    b.p.close();
  });

  it("Ctrl+C cancels every kind of question and gives the terminal back", async () => {
    const questions: [string, (p: Prompter) => Promise<unknown>][] = [
      ["choose", (p) => p.choose("¿Dónde?", OPTIONS)],
      ["stack", (p) => p.stack(loadStacks())],
      ["agents", (p) => p.agents(DEFAULT_AGENTS)],
      ["externalSkills", (p) => p.externalSkills(["grill-me", "grilling"])],
      ["confirm", (p) => p.confirm("¿Seguro?", true)],
      ["context", (p) => p.context()],
    ];
    for (const [name, ask] of questions) {
      const t = terminal();
      t.type(DOWN, CTRL_C);
      await assert.rejects(ask(t.p), CancelledError, name);
      assert.equal(t.modes.at(-1), false, name);
      t.p.close();
    }
  });

  it("Esc and Ctrl+D cancel too", async () => {
    for (const key of [ESC, CTRL_D]) {
      const t = terminal();
      t.type(key);
      await assert.rejects(t.p.choose("¿Dónde?", OPTIONS), CancelledError, JSON.stringify(key));
      assert.equal(t.modes.at(-1), false);
      t.p.close();
    }
  });

  it("the end of the input while a menu is open cancels instead of hanging", async () => {
    const t = terminal();
    setImmediate(() => t.input.end());
    await assert.rejects(t.p.choose("¿Dónde?", OPTIONS), CancelledError);
    assert.equal(t.modes.at(-1), false);
    t.p.close();
  });

  it("questions in a row each read their own keys", async () => {
    const t = terminal();
    t.type(DOWN, ENTER);
    assert.equal(await t.p.choose("¿Dónde?", OPTIONS), "project");
    t.type("Tienda de bicis", ENTER);
    assert.equal(await t.p.context(), "Tienda de bicis");
    t.type(DOWN, ENTER);
    assert.equal(await t.p.confirm("¿Seguro?", false), true);
    t.p.close();
  });
});

describe("exit codes", () => {
  it("Ctrl+C maps to exit 130 with 'Cancelado.', usage errors to 2, the rest to 1", () => {
    assert.deepEqual(failure(new CancelledError()), { code: 130, message: "Cancelado." });
    assert.deepEqual(failure(new UsageError("--x no aplica")), { code: 2, message: "ERROR: --x no aplica" });
    assert.deepEqual(failure(new Error("boom")), { code: 1, message: "ERROR: boom" });
  });
});
