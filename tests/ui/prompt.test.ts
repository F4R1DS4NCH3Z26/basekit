import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { AGENTS, DEFAULT_AGENTS } from "../../src/kit/agents.js";
import { init, type InitOptions } from "../../src/commands/init/index.js";
import { nodeFileSystem } from "../../src/infra/file-system.js";
import { processRunner, type Runner } from "../../src/infra/runner.js";
import { Prompter } from "../../src/ui/prompt.js";
import { loadStacks } from "../../src/kit/stacks.js";
import { cleanup, scratch, sh } from "../helpers.js";

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

  it("a typed stack id ignores case, like the option names do (R3-typed-id-case)", async () => {
    const { p, output } = prompter("Spring");
    assert.equal(await p.stack(stacks), "spring");
    assert.doesNotMatch(output(), /no es una opción válida|¿En qué lenguaje\?/);
    p.close();
    const side = prompter("3", "combinar", "GIN", "Vue");
    assert.equal(await side.p.stack(stacks), "gin+vue");
    side.p.close();
  });

  it("fullstack offers the integrated stacks plus «Combinar backend + frontend» (S16)", async () => {
    const { p, output } = prompter("3", "Combinar", "Python", "fastapi", "react");
    assert.equal(await p.stack(stacks), "fastapi+react");
    const text = output();
    const integrated = languages("fullstack");
    assert.match(text, new RegExp(`${integrated.length + 1}\\) Combinar backend \\+ frontend`));
    assert.match(text, /¿En qué lenguaje es el backend\?/);
    of("backend", "Python").forEach((s, i) => assert.match(text, new RegExp(`${i + 1}\\) ${escape(s.name)} +${s.id}\n`)));
    assert.match(text, new RegExp(`Lenguaje del frontend: ${languages("frontend")[0]} \\(única opción\\)`));
    assert.match(text, /¿Con qué framework de frontend\?/);
    for (const s of of("fullstack")) assert.doesNotMatch(text, new RegExp(`\\) ${escape(s.name)} +${s.id}\n`), "no integrated framework list");
    p.close();
  });

  it("combined: numbers work at every step and a stack id of the right kind is taken at its side", async () => {
    const integrated = languages("fullstack");
    const go = languages("backend").indexOf("Go") + 1;
    const a = prompter("3", String(integrated.length + 1), String(go), "1", "3");
    assert.equal(await a.p.stack(stacks), `${of("backend", "Go")[0]!.id}+${of("frontend")[2]!.id}`);
    a.p.close();

    const b = prompter("fullstack", "combinar", "gin", "vue");
    assert.equal(await b.p.stack(stacks), "gin+vue");
    b.p.close();

    const c = prompter("3", "combinar", "react", "Go", "gin", "fastapi", "vue");
    assert.equal(await c.p.stack(stacks), "gin+vue");
    assert.match(c.output(), /«react» no es una opción válida/);
    assert.match(c.output(), /«fastapi» no es una opción válida/);
    c.p.close();
  });

  it("fails with a hint when the input ends at any step", async () => {
    for (const answers of [[], ["foo"], ["1"], ["1", "Python"], ["3", "combinar"], ["3", "combinar", "Go", "gin"]]) {
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

  it("rejects a lone comma and asks again, like basekit-go (S5)", async () => {
    const { p, output } = prompter(",", "");
    assert.deepEqual(await p.agents(DEFAULT_AGENTS), DEFAULT_AGENTS, "the second answer (Enter) keeps the defaults");
    assert.match(output(), /No reconozco: ,\. Usa los números o los ids de la lista\./);
    p.close();
  });

  it("ninguno or ninguna, in any case, chooses no agent (S2)", async () => {
    for (const answer of ["ninguno", "NINGUNA", " Ninguno "]) {
      const { p, output } = prompter(answer);
      assert.deepEqual(await p.agents(DEFAULT_AGENTS), [], answer);
      assert.match(output(), /¿Con qué herramientas vas a trabajar\?/);
      assert.doesNotMatch(output(), /No reconozco/);
      p.close();
    }
  });
});

describe("external skills question (S1)", () => {
  const SKILLS = ["grill-me", "grill-with-docs", "grilling", "domain-modeling"];

  it("lists the four skills numbered, in order, and keeps them all on Enter or at the end of the input", async () => {
    const { p, output } = prompter("");
    assert.deepEqual(await p.externalSkills(SKILLS), SKILLS);
    assert.match(output(), /¿Qué skills externas instalo\? \(usan npx y red\)\n {2}1\) grill-me\n {2}2\) grill-with-docs\n {2}3\) grilling\n {2}4\) domain-modeling\n/);
    p.close();
    const ended = prompter();
    assert.deepEqual(await ended.p.externalSkills(SKILLS), SKILLS);
    ended.p.close();
  });

  it("accepts numbers and names mixed, in the pinned order without duplicates", async () => {
    const { p } = prompter("domain-modeling, 1,4");
    assert.deepEqual(await p.externalSkills(SKILLS), ["grill-me", "domain-modeling"]);
    p.close();
  });

  it("ninguna or ninguno, in any case, chooses none", async () => {
    for (const answer of ["ninguna", "Ninguno", "NINGUNA"]) {
      const { p } = prompter(answer);
      assert.deepEqual(await p.externalSkills(SKILLS), [], answer);
      p.close();
    }
  });

  it("asks again naming what it did not recognise", async () => {
    const { p, output } = prompter("grilling, x, 9", "3");
    assert.deepEqual(await p.externalSkills(SKILLS), ["grilling"]);
    assert.match(output(), /No reconozco: x, 9/);
    p.close();
  });

  it("an answer made only of commas or spaces is not none: it is named and the list asked again (S5)", async () => {
    for (const answer of [",", ", ,"]) {
      const { p, output } = prompter(answer, "3");
      assert.deepEqual(await p.externalSkills(SKILLS), ["grilling"], answer);
      const prompt = "Números o nombres [grill-me,grill-with-docs,grilling,domain-modeling]: ";
      assert.ok(
        output().includes(`${prompt}  No reconozco: ${answer}. Usa los números o los nombres de la lista.\n${prompt}`),
        output(),
      );
      p.close();
    }
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

  it("choose: with a default, Enter takes it and the prompt shows its number", async () => {
    const a = prompter("");
    assert.equal(await a.p.choose("¿Dónde?", options, "project"), "project");
    assert.match(a.output(), /Número \[2\]: /);
    a.p.close();
    const b = prompter("1");
    assert.equal(await b.p.choose("¿Dónde?", options, "project"), "global");
    b.p.close();
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

/** A runner that fakes `npx skills add` (creates each `-s` skill) and runs anything else for real. */
function fakeRunner(): { runner: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: Runner = {
    ...processRunner,
    run: (log, cmd, args, cwd, env) => {
      if (cmd !== "npx") return processRunner.run(log, cmd, args, cwd, env);
      calls.push(args);
      for (const s of skillsOfCall(args)) {
        mkdirSync(join(cwd, ".agents/skills", s), { recursive: true });
        writeFileSync(join(cwd, ".agents/skills", s, "SKILL.md"), `---\nname: ${s}\n---\n`);
      }
      return true;
    },
  };
  return { runner, calls };
}

/** The skills an `npx skills add` call names after `-s`. */
const skillsOfCall = (args: string[]) => args.slice(args.indexOf("-s") + 1, args.indexOf("-a"));
const EXTERNAL = ["grill-me", "grill-with-docs", "grilling", "domain-modeling"];
const manifest = (d: string) => JSON.parse(readFileSync(join(d, ".agents/manifest.json"), "utf8"));

const quietInit = (o: Partial<InitOptions> & { dir: string }, prompt?: Prompter) =>
  init({ externalSkills: false, force: false, dryRun: false, ...o }, { log: () => {}, prompt, fs: nodeFileSystem, runner: processRunner });

describe("init with interactive answers", () => {
  it("uses the stack, agents and context answered, re-asking after an invalid stack", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("nope", "1", "Python", "flask", "1,2", "", "", "n", "", "Tienda de bicis");
    assert.equal(await quietInit({ dir: d }, p), 0);
    p.close();
    assert.match(output(), /«nope» no es una opción válida/);
    const m = JSON.parse(readFileSync(join(d, ".agents/manifest.json"), "utf8"));
    assert.equal(m.stack, "flask");
    assert.deepEqual(m.agents, ["claude-code", "opencode"]);
    assert.match(readFileSync(join(d, "docs/PROJECT.md"), "utf8"), /Tienda de bicis/);
  });

  it("a combined answer becomes a backend/ + frontend/ project (S16)", async () => {
    const d = join(scratch(), "app");
    const { p } = prompter("3", "combinar", "Python", "fastapi", "react", "", "n", "", "");
    assert.equal(await quietInit({ dir: d }, p), 0);
    p.close();
    assert.equal(JSON.parse(readFileSync(join(d, ".agents/manifest.json"), "utf8")).stack, "fastapi+react");
    assert.ok(existsSync(join(d, "backend/.make/stack.mk")));
    assert.ok(existsSync(join(d, "frontend/.make/stack.mk")));
  });

  it("asks only what flags, the manifest or detection did not answer", async () => {
    const d = join(scratch(), "app");
    const first = prompter("", "", "n", "", "Reservas");
    assert.equal(await quietInit({ dir: d, stack: "fastapi", agents: "codex" }, first.p), 0);
    first.p.close();
    assert.doesNotMatch(first.output(), /tipo de app|lenguaje|framework|herramientas|skills externas/);
    assert.match(first.output(), /¿De qué trata el proyecto\?/);

    const rerun = prompter();
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a manifest asks nothing");
    assert.ok(existsSync(join(d, ".agents/manifest.json")));
  });

  it("asks before git init and leaves the project without git when the answer is no", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "", "n", "n", "");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex" }, p), 0);
    p.close();
    assert.match(output(), /¿Inicializar git \(git init\)\? zone-check lo necesita \[S\/n\]/);
    assert.ok(!existsSync(join(d, ".git")), "no repository");
    assert.ok(!existsSync(join(d, ".gitattributes")), ".gitattributes only comes with a repository basekit creates");
    assert.ok(existsSync(join(d, ".agents/manifest.json")));
  });

  it("asks about Docker after the agents and before git; no skips the Docker files and a rerun keeps the choice", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "n", "", "");
    assert.equal(await quietInit({ dir: d, stack: "flask" }, p), 0);
    p.close();
    const text = output();
    const docker = text.indexOf("¿Usar Docker? Todo corre en contenedores (Dockerfile y compose) [S/n]");
    assert.ok(docker > text.indexOf("¿Con qué herramientas vas a trabajar?"), "Docker comes after the agents");
    assert.ok(docker >= 0 && docker < text.indexOf("¿Inicializar git"), "Docker comes before git");
    assert.doesNotMatch(text, /¿Usar Makefile\?|base de datos/, "no Makefile nor database question without Docker");
    for (const f of ["Makefile", "Dockerfile", "compose.yaml", ".make/stack.mk", ".env.example"]) assert.ok(!existsSync(join(d, f)), f);
    assert.equal(manifest(d).options.docker, false);

    const rerun = prompter();
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a manifest asks nothing");
    assert.ok(!existsSync(join(d, "Makefile")), "the stored no-Docker choice is kept");
  });

  it("does not ask about Docker with --no-docker nor for a combined project", async () => {
    const d = join(scratch(), "app");
    const flag = prompter("", "");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex", noDocker: true }, flag.p), 0);
    flag.p.close();
    assert.doesNotMatch(flag.output(), /Docker/);
    assert.equal(manifest(d).options.docker, false);

    const combo = join(scratch(), "app");
    const both = prompter("n", "", "");
    assert.equal(await quietInit({ dir: combo, stack: "fastapi+react", agents: "codex" }, both.p), 0);
    both.p.close();
    assert.doesNotMatch(both.output(), /Docker|Makefile/);
    assert.equal(manifest(combo).options.docker, true);
    assert.equal(manifest(combo).options.makefile, true);
    assert.ok(existsSync(join(combo, "Makefile")), "a combined project always has the root Makefile");
  });

  it("asks about the Makefile only after a yes to Docker; no keeps the Docker files without Makefile and a rerun keeps it (S3)", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "n", "n", "", "");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex" }, p), 0);
    p.close();
    const text = output();
    const docker = text.indexOf("¿Usar Docker? Todo corre en contenedores (Dockerfile y compose) [S/n]");
    const makefile = text.indexOf("¿Usar Makefile? Es la interfaz para correr los comandos en los contenedores [S/n]");
    assert.ok(docker >= 0 && makefile > docker, "the Makefile question comes after Docker");
    assert.ok(makefile < text.indexOf("¿Integrar base de datos?") && makefile < text.indexOf("¿Inicializar git"));
    for (const f of ["Makefile", ".make"]) assert.ok(!existsSync(join(d, f)), f);
    for (const f of ["Dockerfile", "compose.yaml", ".env.example"]) assert.ok(existsSync(join(d, f)), f);
    assert.deepEqual(manifest(d).options, { db: "none", redis: false, docker: true, makefile: false });

    const rerun = prompter();
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a manifest asks nothing");
    assert.ok(!existsSync(join(d, "Makefile")), "the stored no-Makefile choice is kept");
  });

  it("does not ask about the Makefile with --no-makefile", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "n", "", "");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex", noMakefile: true }, p), 0);
    p.close();
    assert.doesNotMatch(output(), /¿Usar Makefile\?/);
    assert.equal(manifest(d).options.makefile, false);
    assert.ok(!existsSync(join(d, "Makefile")));
  });

  it("asks for the database after Docker and the Makefile: yes and an engine run infra-setup like --db (S1)", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "", "", "4", "", "");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex" }, p), 0);
    p.close();
    const text = output();
    const ask = text.indexOf("¿Integrar base de datos? [S/n]");
    assert.ok(ask > text.indexOf("¿Usar Makefile?"), "after the Makefile question");
    assert.ok(text.indexOf("¿Qué base de datos?") > ask && text.indexOf("¿Qué base de datos?") < text.indexOf("¿Inicializar git"));
    assert.match(text, /¿Qué base de datos\?\n {2}1\) MySQL {7}mysql\n {2}2\) SQLite {6}sqlite\n {2}3\) PostgreSQL {2}postgres\n {2}4\) MongoDB {5}mongo\nNúmero \[3\]: /);
    assert.equal(manifest(d).options.db, "mongo");
    assert.match(readFileSync(join(d, "compose.db.yaml"), "utf8"), /mongo/);
    assert.match(readFileSync(join(d, ".make/db.mk"), "utf8"), /mongosh/);

    const byDefault = join(scratch(), "app");
    const q = prompter("", "", "", "", "", "");
    assert.equal(await quietInit({ dir: byDefault, stack: "flask", agents: "codex" }, q.p), 0);
    q.p.close();
    assert.equal(manifest(byDefault).options.db, "postgres", "Enter takes PostgreSQL");
    assert.match(readFileSync(join(byDefault, "compose.db.yaml"), "utf8"), /postgres/);
  });

  it("offers only the engines the stack accepts, in the S1 order, with PostgreSQL as default (S6)", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "", "", "", "", "");
    assert.equal(await quietInit({ dir: d, stack: "spring", agents: "codex" }, p), 0);
    p.close();
    assert.match(output(), /¿Qué base de datos\?\n {2}1\) MySQL {7}mysql\n {2}2\) PostgreSQL {2}postgres\n {2}3\) MongoDB {5}mongo\nNúmero \[2\]: /);
    assert.doesNotMatch(output(), /SQLite/);
    assert.equal(manifest(d).options.db, "postgres", "Enter takes PostgreSQL");
    assert.match(readFileSync(join(d, "compose.db.yaml"), "utf8"), /postgres/);
  });

  it("does not ask about the Makefile on a rerun of a legacy manifest without the key, and keeps it (S5)", async () => {
    const d = join(scratch(), "app");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex" }), 0);
    const m = manifest(d);
    delete m.options.makefile;
    writeFileSync(join(d, ".agents/manifest.json"), JSON.stringify(m));
    const rerun = prompter();
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a legacy manifest asks nothing");
    assert.equal(manifest(d).options.makefile, true);
    for (const f of ["Makefile", ".make/stack.mk"]) assert.ok(existsSync(join(d, f)), f);
  });

  it("does not ask about Docker on a rerun of a legacy manifest without the key, and keeps it (docker follow-ups S1a)", async () => {
    const d = join(scratch(), "app");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex" }), 0);
    const m = manifest(d);
    delete m.options.docker;
    writeFileSync(join(d, ".agents/manifest.json"), JSON.stringify(m));
    const rerun = prompter("n", "n");
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a legacy manifest asks nothing");
    assert.equal(manifest(d).options.docker, true);
    for (const f of ["Makefile", "Dockerfile", "compose.yaml"]) assert.ok(existsSync(join(d, f)), f);
  });

  it("--docker on a project without Docker asks about the Makefile but not the database (docker follow-ups S2)", async () => {
    const d = join(scratch(), "app");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex", noDocker: true }), 0);
    const { p, output } = prompter("n");
    assert.equal(await quietInit({ dir: d, docker: true }, p), 0);
    p.close();
    const text = output();
    assert.match(text, /¿Usar Makefile\? Es la interfaz para correr los comandos en los contenedores \[S\/n\]/);
    assert.doesNotMatch(text, /¿Usar Docker\?|base de datos/);
    assert.ok(existsSync(join(d, "Dockerfile")));
    assert.ok(!existsSync(join(d, "Makefile")), "no to the Makefile");
    assert.deepEqual(manifest(d).options, { db: "auto", redis: false, docker: true, makefile: false });
  });

  it("rejects --db/--redis without Docker before any question, the stack one included (docker follow-ups S3)", async () => {
    for (const extra of [{ db: "postgres" }, { redis: true }]) {
      const d = join(scratch(), "app");
      const { p, output } = prompter("1", "Python", "flask", "", "");
      await assert.rejects(quietInit({ dir: d, noDocker: true, ...extra }, p),
        { message: "--db y --redis necesitan Docker: no se pueden usar con --no-docker ni sin Docker en el manifest" });
      p.close();
      assert.equal(output(), "", JSON.stringify(extra));
      assert.ok(!existsSync(d), "nothing written");
    }

    const saved = join(scratch(), "app");
    assert.equal(await quietInit({ dir: saved, stack: "flask", noDocker: true }), 0);
    const before = readFileSync(join(saved, ".agents/manifest.json"), "utf8");
    const q = prompter("", "");
    await assert.rejects(quietInit({ dir: saved, redis: true, externalSkills: true }, q.p), /--db y --redis necesitan Docker/);
    q.p.close();
    assert.equal(q.output(), "", "not even the external skills question");
    assert.equal(readFileSync(join(saved, ".agents/manifest.json"), "utf8"), before);
  });

  it("--db or --redis on a first run skip the Docker question: Docker is yes, the Makefile is still asked (docker follow-ups S3)", async () => {
    for (const extra of [{ db: "sqlite" }, { redis: true }]) {
      const d = join(scratch(), "app");
      const { p, output } = prompter("n", "", "");
      assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex", ...extra }, p), 0);
      p.close();
      const text = output();
      assert.doesNotMatch(text, /¿Usar Docker\?/, JSON.stringify(extra));
      assert.match(text, /¿Usar Makefile\?/);
      assert.equal(manifest(d).options.docker, true);
      assert.equal(manifest(d).options.makefile, false);
      assert.ok(existsSync(join(d, "Dockerfile")));
    }
  });

  it("no to the database records none and adds no overlay (S1)", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "", "n", "", "");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex" }, p), 0);
    p.close();
    assert.doesNotMatch(output(), /¿Qué base de datos\?/);
    assert.equal(manifest(d).options.db, "none");
    assert.ok(!existsSync(join(d, "compose.db.yaml")));
  });

  it("does not ask for the database for a frontend stack, with --db, or on a rerun, even with a saved auto (S1)", async () => {
    const front = join(scratch(), "app");
    const f = prompter("", "", "", "");
    assert.equal(await quietInit({ dir: front, stack: "react", agents: "codex" }, f.p), 0);
    f.p.close();
    assert.doesNotMatch(f.output(), /base de datos/);
    assert.equal(manifest(front).options.db, "none");

    const flag = join(scratch(), "app");
    const g = prompter("", "", "", "");
    assert.equal(await quietInit({ dir: flag, stack: "flask", agents: "codex", db: "sqlite" }, g.p), 0);
    g.p.close();
    assert.doesNotMatch(g.output(), /base de datos/);
    assert.equal(manifest(flag).options.db, "sqlite");
    const rerun = prompter();
    assert.equal(await quietInit({ dir: flag }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a saved engine is not asked again");

    const auto = join(scratch(), "app");
    assert.equal(await quietInit({ dir: auto, stack: "flask", agents: "codex" }), 0);
    assert.equal(manifest(auto).options.db, "auto", "without a prompter the default stays auto");
    // The agent activated the database itself (bootstrap runs infra.sh), which leaves options.db as auto.
    const infra = sh("bash", [".agents/skills/infra-setup/scripts/infra.sh", "--db", "postgres"], auto);
    assert.equal(infra.code, 0, infra.stdout + infra.stderr);
    const overlay = readFileSync(join(auto, "compose.db.yaml"), "utf8");
    const again = prompter();
    const lines: string[] = [];
    assert.equal(await init({ dir: auto, externalSkills: false, force: false, dryRun: false },
      { log: (l) => lines.push(l), prompt: again.p, fs: nodeFileSystem, runner: processRunner }), 0);
    again.p.close();
    assert.doesNotMatch(again.output(), /base de datos/, "a rerun never asks for the database");
    assert.doesNotMatch(lines.join("\n"), /infra OK|ya existe con otro contenido|^\s*[+~] compose\.db\.yaml/m, "a rerun does not run infra-setup again");
    assert.equal(manifest(auto).options.db, "auto");
    assert.equal(readFileSync(join(auto, "compose.db.yaml"), "utf8"), overlay, "the agent's overlay is untouched");
  });

  it("does not ask about git with --no-git", async () => {
    const d = join(scratch(), "app");
    const { p, output } = prompter("", "", "n", "Reservas");
    assert.equal(await quietInit({ dir: d, stack: "flask", agents: "codex", noGit: true }, p), 0);
    p.close();
    assert.doesNotMatch(output(), /Inicializar git/);
    assert.ok(!existsSync(join(d, ".git")));
    assert.match(readFileSync(join(d, "docs/PROJECT.md"), "utf8"), /Reservas/, "the context is still asked");
  });

  it("lists the included skills and installs all the external ones when the answer is the default", async () => {
    const d = join(scratch(), "app");
    const { runner, calls } = fakeRunner();
    const { p, output } = prompter("", "", "", "n", "");
    const lines: string[] = [];
    const code = await init({ dir: d, stack: "flask", agents: "codex", externalSkills: true, force: false, dryRun: false }, { log: (l) => lines.push(l), prompt: p, fs: nodeFileSystem, runner });
    p.close();
    assert.equal(code, 0);
    assert.match(output(), /¿Qué skills externas instalo\? \(usan npx y red\)/);
    assert.doesNotMatch(output(), /¿Instalar también/);
    assert.match(lines.join("\n"), /Skills incluidas: .*zone-check/);
    assert.deepEqual(calls.map(skillsOfCall), [EXTERNAL]);
    assert.deepEqual(manifest(d).options.externalSkills, EXTERNAL);
  });

  it("installs only the chosen external skills, persists the choice and does not ask again (S1)", async () => {
    const d = join(scratch(), "app");
    const { runner, calls } = fakeRunner();
    const { p, output } = prompter("1,grilling", "", "", "n", "");
    const lines: string[] = [];
    assert.equal(await init({ dir: d, stack: "flask", agents: "codex", externalSkills: true, force: false, dryRun: false }, { log: (l) => lines.push(l), prompt: p, fs: nodeFileSystem, runner }), 0);
    p.close();
    assert.match(output(), /¿Qué skills externas instalo/);
    assert.deepEqual(calls.map(skillsOfCall), [["grill-me", "grilling"]]);
    assert.match(lines.join("\n"), /^\+ skills externas/m);
    assert.deepEqual(manifest(d).options.externalSkills, ["grill-me", "grilling"]);
    assert.ok(!existsSync(join(d, ".agents/skills/domain-modeling")), "an unchosen skill is not installed");

    // A rerun takes the persisted choice: nothing missing, no question, no npx.
    const rerun = prompter();
    const again: string[] = [];
    assert.equal(await init({ dir: d, externalSkills: true, force: false, dryRun: false }, { log: (l) => again.push(l), prompt: rerun.p, fs: nodeFileSystem, runner }), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "a rerun with a persisted choice asks nothing");
    assert.equal(calls.length, 1);
    assert.match(again.join("\n"), /^= skills externas  \(grill-me, grilling\)$/m);
    assert.deepEqual(manifest(d).options.externalSkills, ["grill-me", "grilling"]);
  });

  it("ninguna installs nothing, reports it and persists an empty choice (S1)", async () => {
    const d = join(scratch(), "app");
    const { runner, calls } = fakeRunner();
    const { p } = prompter("ninguna", "", "", "n", "");
    const lines: string[] = [];
    assert.equal(await init({ dir: d, stack: "flask", agents: "codex", externalSkills: true, force: false, dryRun: false }, { log: (l) => lines.push(l), prompt: p, fs: nodeFileSystem, runner }), 0);
    p.close();
    assert.deepEqual(calls, [], "npx must not run");
    assert.ok(lines.includes("= skills externas  (ninguna elegida)"), lines.join("\n"));
    assert.deepEqual(manifest(d).options.externalSkills, []);

    const rerun = prompter();
    const again: string[] = [];
    assert.equal(await init({ dir: d, externalSkills: true, force: false, dryRun: false }, { log: (l) => again.push(l), prompt: rerun.p, fs: nodeFileSystem, runner }), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "");
    assert.deepEqual(calls, []);
    assert.ok(again.includes("= skills externas  (ninguna elegida)"));
  });

  it("ninguno as the agents answer writes no tool files and a rerun keeps it without detection (S2)", async () => {
    const d = join(scratch(), "app");
    const { runner, calls } = fakeRunner();
    const { p, output } = prompter("", "ninguno", "", "", "n", "");
    const lines: string[] = [];
    assert.equal(await init({ dir: d, stack: "flask", externalSkills: true, force: false, dryRun: false }, { log: (l) => lines.push(l), prompt: p, fs: nodeFileSystem, runner }), 0);
    p.close();
    assert.match(output(), /¿Con qué herramientas vas a trabajar\?/);
    assert.deepEqual(manifest(d).agents, []);
    for (const f of ["AGENTS.md", ".agents/README.md", ".agents/roles", ".agents/skills/zone-check/SKILL.md", "docs", "Makefile"]) assert.ok(existsSync(join(d, f)), f);
    for (const f of [".claude", "CLAUDE.md", ".opencode", "opencode.json", ".gemini", ".hermes"]) assert.ok(!existsSync(join(d, f)), f);
    assert.deepEqual(calls, [], "no external skills without agents");
    assert.ok(lines.includes("! skills externas  (sin agentes: se instalan cuando agregues uno con basekit sync --agents <a,b>)"), lines.join("\n"));

    mkdirSync(join(d, ".cursor"));
    const rerun = prompter();
    assert.equal(await quietInit({ dir: d }, rerun.p), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "", "agents: [] is a decided answer");
    assert.deepEqual(manifest(d).agents, []);
  });

  it("--external-skills skips the question, installs the chosen skills and persists them (S4)", async () => {
    const d = join(scratch(), "app");
    const { runner, calls } = fakeRunner();
    const { p, output } = prompter("", "", "n", "");
    const lines: string[] = [];
    const o = { dir: d, stack: "flask", agents: "codex", externalSkills: true, externalChoice: "grilling,grill-me", force: false, dryRun: false };
    assert.equal(await init(o, { log: (l) => lines.push(l), prompt: p, fs: nodeFileSystem, runner }), 0);
    p.close();
    assert.doesNotMatch(output(), /skills externas/);
    assert.deepEqual(calls.map(skillsOfCall), [["grill-me", "grilling"]]);
    assert.match(lines.join("\n"), /^\+ skills externas  \(grill-me, grilling\)$/m);
    assert.deepEqual(manifest(d).options.externalSkills, ["grill-me", "grilling"]);

    // A rerun with a new --external-skills replaces the persisted choice without asking.
    const rerun = prompter();
    assert.equal(await init({ dir: d, externalSkills: true, externalChoice: "domain-modeling", force: false, dryRun: false }, { log: () => {}, prompt: rerun.p, fs: nodeFileSystem, runner }), 0);
    rerun.p.close();
    assert.equal(rerun.output(), "");
    assert.deepEqual(calls.map(skillsOfCall), [["grill-me", "grilling"], ["domain-modeling"]]);
    assert.deepEqual(manifest(d).options.externalSkills, ["domain-modeling"]);
  });

  it("does not ask about the external skills when they are already installed", async () => {
    const d = join(scratch(), "app");
    for (const s of ["grill-me", "grill-with-docs", "grilling", "domain-modeling"]) {
      mkdirSync(join(d, ".agents/skills", s), { recursive: true });
      writeFileSync(join(d, ".agents/skills", s, "SKILL.md"), "---\nname: x\n---\n");
    }
    const { p, output } = prompter("", "", "n", "");
    const code = await init({ dir: d, stack: "flask", agents: "codex", externalSkills: true, force: false, dryRun: false }, { log: () => {}, prompt: p, fs: nodeFileSystem, runner: processRunner });
    p.close();
    assert.equal(code, 0);
    assert.doesNotMatch(output(), /skills externas/);
  });
});
