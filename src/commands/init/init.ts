import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linkSkills, writeAdapters } from "../../kit/adapters.js";
import { DEFAULT_AGENTS, detectAgents, parseAgents } from "../../kit/agents.js";
import { templateVars, writeAgentsMd } from "../../kit/agents-md.js";
import { UsageError } from "../../kit/errors.js";
import { installExternalSkills } from "../../kit/external-skills.js";
import { readManifest, writeManifest } from "../../kit/manifest.js";
import { Project, resolveRoot } from "../../kit/project.js";
import { detectStack, findStack, loadStacks, stackDir, type Stack } from "../../kit/stacks.js";
import { modeOf, render, template, TEMPLATES, walk } from "../../kit/templates.js";
import type { Context } from "../context.js";
import { checkDb, validateFlags, type InitOptions } from "./options.js";

const INFRA = ".agents/skills/infra-setup/scripts/infra.sh";

function nextStep(ctx: Context, project: Project, stack: Stack, context: string): void {
  ctx.log("");
  ctx.log(project.changed ? `Listo: base de ${stack.name} preparada en ${project.root}` : "Todo al día: no había nada que cambiar.");
  ctx.log("Próximo paso, dile a tu agente:");
  ctx.log(`  «Lee AGENTS.md y ejecuta el bootstrap. El proyecto trata de: ${context || "<una o dos frases>"}»`);
  const marker = stack.appMarker;
  const fromStarter = marker !== undefined && walk(join(stackDir(stack), "starter")).includes(marker);
  if (marker !== undefined && !project.exists(marker) && !fromStarter) {
    ctx.log("Falta la app del framework: ejecuta `make new-app` (corre dentro de Docker).");
  }
}

/** Spec 02 §3: the `init` algorithm, step by step. */
export async function init(o: InitOptions, ctx: Context): Promise<number> {
  const stacks = loadStacks();
  const flags = validateFlags(o, stacks);
  const project = new Project(resolveRoot(o.dir), o.dryRun, ctx.log, ctx.fs);
  const root = project.root;
  const prev = project.existsRoot() ? readManifest(project) : undefined;

  // 2 · Stack: flag → manifest → detection → question.
  let stackId = o.stack ?? prev?.stack ?? (project.existsRoot() ? detectStack(stacks, project)?.id : undefined);
  if (!stackId && ctx.prompt) stackId = await ctx.prompt.stack(stacks);
  if (!stackId) {
    throw new UsageError(`No se pudo detectar el stack. Usa --stack <id> (disponibles: ${stacks.map((s) => s.id).join(", ")})`);
  }
  const stack = findStack(stacks, stackId.trim());

  // 3 · Agents: flag → manifest → detection → question.
  let agents = flags.agents ?? (prev?.agents ? parseAgents(prev.agents.join(",")) : undefined);
  if (!agents) {
    const detected = project.existsRoot() ? detectAgents(project) : [];
    agents = detected.length > 0 ? detected : ctx.prompt ? await ctx.prompt.agents(DEFAULT_AGENTS) : DEFAULT_AGENTS;
  }

  // 4 · Context (asked only on the first run) and database.
  const context = (o.context ?? (!prev && ctx.prompt ? await ctx.prompt.context() : "")).trim();
  const db = checkDb(o.db ?? prev?.options?.db ?? "auto");
  const redis = o.redis ?? prev?.options?.redis ?? false;

  if (o.dryRun) ctx.log(`(dry-run: no se escribe nada en ${root})`);
  project.createRoot();

  // 5 · Git (zone-check needs it).
  const newRepository = !project.exists(".git");
  if (newRepository) {
    project.report("+", ".git", "git init");
    if (!o.dryRun) ctx.runner.run(ctx.log, "git", ["init", "-q"], root);
  }

  const sdir = stackDir(stack);
  const prevFiles = prev?.files ?? {};
  const files: Record<string, string> = {};
  const copy = (src: string) => readFileSync(src, "utf8");

  // 6 · .agents/ core.
  project.create(".agents/README.md", template("core/agents-README.md"));
  for (const f of walk(join(sdir, "roles"))) project.create(`.agents/roles/${f}`, copy(join(sdir, "roles", f)));
  for (const f of walk(join(sdir, "zones"))) {
    if (f !== "orchestrator.stack.txt") project.create(`.agents/zones/${f}`, copy(join(sdir, "zones", f)));
  }
  const common = template("core/zones.orchestrator.common.txt");
  const stackZones = walk(join(sdir, "zones")).includes("orchestrator.stack.txt") ? copy(join(sdir, "zones/orchestrator.stack.txt")) : "";
  project.create(".agents/zones/orchestrator.txt", common.endsWith("\n") || !common ? common + stackZones : `${common}\n${stackZones}`);
  for (const skillsRoot of [join(TEMPLATES, "skills"), join(sdir, "skills")]) {
    for (const f of walk(skillsRoot)) {
      const src = join(skillsRoot, f);
      project.tracked(`.agents/skills/${f}`, copy(src), modeOf(src), prevFiles, files, o.force);
    }
  }

  // 7 · AGENTS.md managed block.
  writeAgentsMd(project, stack, context);
  for (const f of [".hermes.md", "HERMES.md"]) {
    if (project.exists(f)) project.report("!", f, "Hermes lo carga en lugar de AGENTS.md; bórralo o fusiónalo");
  }

  // 8 · Docker and Make.
  const appMissing = stack.appMarker !== undefined && !project.exists(stack.appMarker);
  const ownMakefile = project.read("Makefile");
  const makefile = ownMakefile !== undefined && !ownMakefile.includes("generado por basekit") ? "Makefile.basekit" : "Makefile";
  const mark = project.tracked(makefile, template("core/Makefile"), 0o644, prevFiles, files, o.force);
  if (makefile === "Makefile.basekit" && (mark === "+" || mark === "~")) {
    project.report("!", "Makefile", "ya existe uno propio: el de basekit queda en Makefile.basekit; intégralos a mano");
  }
  for (const f of walk(join(sdir, "files"))) {
    const src = join(sdir, "files", f);
    project.create(f, copy(src), modeOf(src));
  }
  if (appMissing) {
    for (const f of walk(join(sdir, "starter"))) {
      const src = join(sdir, "starter", f);
      project.create(f, copy(src), modeOf(src));
    }
  }
  project.block(".gitignore", template("core/gitignore.block"), (l) => l.trim() === "# >>> basekit", "# <<< basekit");
  // LF for everyone: a Windows clone with core.autocrlf=true would otherwise break the scripts in WSL/Docker.
  // In a repository that already existed it is only suggested: it could renormalize files committed with CRLF.
  if (newRepository || project.exists(".gitattributes")) {
    project.create(".gitattributes", template("core/gitattributes"));
  } else {
    project.report("!", ".gitattributes", "agrega `* text=auto eol=lf` (y ejecuta `git add --renormalize .`) para que Windows no convierta los scripts a CRLF");
  }

  // 9 · Documentation (GLOSSARY.md and docs/adr/ are created later by domain-modeling).
  const vars = templateVars(stack, root, context);
  project.create("README.md", render(template("core/README.tpl.md"), vars));
  for (const f of walk(join(TEMPLATES, "core/docs"))) {
    const text = template(`core/docs/${f}`);
    project.create(`docs/${f}`, f.endsWith(".md") ? render(text, vars) : text);
  }

  // 10 · Adapters. 12 · External skills. 11 · Skill links last, so they also cover the external skills.
  writeAdapters(project, stack, agents);
  if (o.externalSkills) installExternalSkills(project, agents, ctx.log, ctx.runner, false);
  linkSkills(project, stack, agents);

  // 13 · Infrastructure, through the same script the agent uses. Only when --db is passed:
  // a rerun that takes the db from the manifest must not touch the infrastructure again.
  if (o.db !== undefined && db !== "auto") {
    const args = [INFRA, "--db", db, ...(redis ? ["--redis"] : [])];
    if (o.dryRun) ctx.log(`· ejecutaría: bash ${args.join(" ")}`);
    else if (!ctx.runner.run(ctx.log, "bash", args, root)) project.report("!", INFRA, `falló; reinténtalo con: bash ${args.join(" ")}`);
  }

  writeManifest(project, prev, { stack: stack.id, agents, db, redis, files });

  // 14 · Summary and next step.
  nextStep(ctx, project, stack, context);
  return 0;
}
