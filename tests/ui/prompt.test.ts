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

/** The stacks of one kind and language, in id order (the order of the framework menu). */
const of = (kind: string, language?: string) => stacks.filter((s) => s.kind === kind && (language === undefined || s.language === language));
const languages = (kind: string) => [...new Set(of(kind).map((s) => s.language))].sort();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("stack question: tipo, lenguaje and framework", () => {
  it("asks the three steps numbered, each one filtered by the previous answers", async () => {
    const { p, output } = prompter("1", "Python", "flask");
    assert.equal(await p.stack(stacks), "flask");
    const text = output();
    assert.match(text, /¿Qué tipo de app es\?\n {2}1\) Backend .*\n {2}2\) Frontend .*\n {2}3\) Fullstack /);
    assert.match(text, /¿En qué lenguaje\?/);
    languages("backend").forEach((l, i) => assert.match(text, new RegExp(`${i + 1}\\) ${escape(l)}\\b`)));
    assert.match(text, /¿Con qué framework\?/);
    of("backend", "Python").forEach((s, i) => assert.match(text, new RegExp(`${i + 1}\\) ${escape(s.name)} +${s.id}\n`)));
    for (const s of stacks.filter((x) => x.kind !== "backend" || x.language !== "Python")) {
      assert.doesNotMatch(text, new RegExp(`${escape(s.name)} +${s.id}\n`), `${s.id} is not a backend Python stack`);
    }
    p.close();
  });

  it("accepts the option number at every step", async () => {
    const backend = languages("backend");
    const lang = backend.indexOf("Go");
    const { p } = prompter("1", String(lang + 1), "2");
    assert.equal(await p.stack(stacks), of("backend", "Go")[1]!.id);
    p.close();
  });

  it("chooses a step with a single option by itself and says so", async () => {
    const frontend = prompter("2", "vue");
    assert.equal(await frontend.p.stack(stacks), "vue");
    assert.equal(languages("frontend").length, 1);
    assert.match(frontend.output(), new RegExp(`Lenguaje: ${languages("frontend")[0]} \\(única opción\\)`));
    assert.doesNotMatch(frontend.output(), /¿En qué lenguaje\?/);
    frontend.p.close();

    const [htmx] = of("fullstack", "Python");
    const fullstack = prompter("3", "Python");
    assert.equal(await fullstack.p.stack(stacks), htmx!.id);
    assert.match(fullstack.output(), new RegExp(`Framework: ${escape(htmx!.name)} \\(única opción\\)`));
    assert.doesNotMatch(fullstack.output(), /¿Con qué framework\?/);
    assert.doesNotMatch(fullstack.output(), /\) Go\b|\) Java\b/, "fullstack only offers its own languages");
    fullstack.p.close();
  });

  it("asks again after an invalid or empty answer, at every step", async () => {
    const { p, output } = prompter("foo", "9", "", "backend", "Cobol", "python", "7", "flask");
    assert.equal(await p.stack(stacks), "flask");
    for (const bad of ["foo", "9", "Cobol", "7"]) assert.match(output(), new RegExp(`«${bad}» no es una opción válida`));
    assert.match(output(), /Hace falta elegir una opción/);
    p.close();
  });

  it("still accepts a stack id typed at any step", async () => {
    const { p, output } = prompter("spring");
    assert.equal(await p.stack(stacks), "spring");
    assert.doesNotMatch(output(), /¿En qué lenguaje\?/);
    p.close();
  });

  it("fails with a hint when the input ends at any step", async () => {
    for (const answers of [[], ["foo"], ["1"], ["1", "Python"]]) {
      const { p } = prompter(...answers);
      await assert.rejects(p.stack(stacks), /--stack <id>/, JSON.stringify(answers));
      p.close();
    }
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

describe("menu and yes/no questions", () => {
  const options = [
    { id: "global", label: "Global", hint: "a" },
    { id: "project", label: "Este proyecto", hint: "b" },
  ];

  it("choose: number, Enter for the first option, and asks again after an invalid answer", async () => {
    const a = prompter("2");
    assert.equal(await a.p.choose("¿Dónde?", options), "project");
    assert.match(a.output(), /1\) Global +a\n {2}2\) Este proyecto +b/);
    a.p.close();
    const b = prompter("");
    assert.equal(await b.p.choose("¿Dónde?", options), "global");
    b.p.close();
    const c = prompter("x", "3", "1");
    assert.equal(await c.p.choose("¿Dónde?", options), "global");
    assert.match(c.output(), /«x» no es una opción válida[\s\S]*«3» no es una opción válida/);
    c.p.close();
    const d = prompter();
    await assert.rejects(d.p.choose("¿Dónde?", options), /No se eligió/);
    d.p.close();
  });

  it("confirm: s/sí/n/no, Enter or end of input takes the default, anything else asks again", async () => {
    for (const [answers, byDefault, expected] of [
      [["s"], false, true], [["Sí"], false, true], [["no"], true, false], [[""], true, true], [[], false, false], [["tal vez", "n"], true, false],
    ] as [string[], boolean, boolean][]) {
      const q = prompter(...answers);
      assert.equal(await q.p.confirm("¿Seguro?", byDefault), expected, answers.join("|"));
      q.p.close();
    }
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
    const { p, output } = prompter("nope", "1", "Python", "flask", "1,2", "Tienda de bicis");
    assert.equal(await quietInit({ dir: d }, p), 0);
    p.close();
    assert.match(output(), /«nope» no es una opción válida/);
    const m = JSON.parse(readFileSync(join(d, ".agents/manifest.json"), "utf8"));
    assert.equal(m.stack, "flask");
    assert.deepEqual(m.agents, ["claude-code", "opencode"]);
    assert.match(readFileSync(join(d, "docs/PROJECT.md"), "utf8"), /Tienda de bicis/);
  });

  it("asks only what flags, the manifest or detection did not answer", async () => {
    const d = join(scratch(), "app");
    const first = prompter("Reservas");
    assert.equal(await quietInit({ dir: d, stack: "fastapi", agents: "codex" }, first.p), 0);
    first.p.close();
    assert.doesNotMatch(first.output(), /tipo de app|lenguaje|framework|herramientas/);
    assert.match(first.output(), /¿De qué trata el proyecto\?/);

    const rerun = prompter();
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a manifest asks nothing");
    assert.ok(existsSync(join(d, ".agents/manifest.json")));
  });
});
