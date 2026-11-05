import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { linkSkills, writeAdapters } from "./adapters.js";
import { DEFAULT_AGENTS, detectAgents, parseAgents } from "./agents.js";
import { templateVars, writeAgentsMd } from "./agentsmd.js";
import { installExternalSkills } from "./external.js";
import { readManifest, writeManifest } from "./manifest.js";
import { Project } from "./project.js";
import type { Prompter } from "./prompt.js";
import { run } from "./run.js";
import { detectStack, loadStacks, modeOf, render, stackDir, TEMPLATES, UsageError, walk, type Stack } from "./templates.js";

export const DBS = ["auto", "postgres", "mysql", "sqlite", "none"];
const INFRA = ".agents/skills/infra-setup/scripts/infra.sh";

export interface InitOptions {
  dir?: string;
  stack?: string;
  agents?: string;
  context?: string;
  db?: string;
  redis?: boolean;
  externalSkills: boolean;
  force: boolean;
  dryRun: boolean;
}

export interface Ui {
  log: (line: string) => void;
  /** Present only in an interactive session (a TTY without --yes). */
  prompt?: Prompter;
}

export function expandHome(dir: string): string {
  if (dir === "~") return homedir();
  return dir.startsWith("~/") ? join(homedir(), dir.slice(2)) : dir;
}

const tpl = (rel: string) => readFileSync(join(TEMPLATES, rel), "utf8");

export function pickStack(stacks: Stack[], id: string): Stack {
  const s = stacks.find((x) => x.id === id);
  if (!s) throw new UsageError(`--stack '${id}' no existe. Disponibles: ${stacks.map((x) => x.id).join(", ")}`);
  return s;
}

function checkDb(db: string): string {
  if (!DBS.includes(db)) throw new UsageError(`--db '${db}' no es válido. Valores: ${DBS.join(", ")}`);
  return db;
}

export function nextStep(ui: Ui, project: Project, stack: Stack, context: string): void {
  ui.log("");
  ui.log(project.changed ? `Listo: base de ${stack.name} preparada en ${project.root}` : "Todo al día: no había nada que cambiar.");
  ui.log("Próximo paso, dile a tu agente:");
  ui.log(`  «Lee AGENTS.md y ejecuta el bootstrap. El proyecto trata de: ${context || "<una o dos frases>"}»`);
  const marker = stack.appMarker;
  const fromStarter = marker !== undefined && walk(join(stackDir(stack), "starter")).includes(marker);
  if (marker !== undefined && !project.exists(marker) && !fromStarter) {
    ui.log("Falta la app del framework: ejecuta `make new-app` (corre dentro de Docker).");
  }
}

export async function init(o: InitOptions, ui: Ui): Promise<number> {
  const root = resolve(expandHome(o.dir ?? "."));
  const stacks = loadStacks();
  // Validate every flag before touching the disk.
  if (o.stack !== undefined) pickStack(stacks, o.stack);
  const flagAgents = o.agents !== undefined ? parseAgents(o.agents) : undefined;
  if (o.db !== undefined) checkDb(o.db);

  const project = new Project(root, o.dryRun, ui.log);
  const prev = existsSync(root) ? readManifest(project) : undefined;

  // 2 · Stack: flag → manifest → detection → question.
  let stackId = o.stack ?? prev?.stack ?? (existsSync(root) ? detectStack(stacks, root)?.id : undefined);
  if (!stackId && ui.prompt) stackId = await ui.prompt.stack(stacks);
  if (!stackId) {
    throw new UsageError(`No se pudo detectar el stack. Usa --stack <id> (disponibles: ${stacks.map((s) => s.id).join(", ")})`);
  }
  const stack = pickStack(stacks, stackId.trim());

  // 3 · Agents: flag → manifest → detection → question.
  let agents = flagAgents ?? (prev?.agents ? parseAgents(prev.agents.join(",")) : undefined);
  if (!agents) {
    const detected = existsSync(root) ? detectAgents(root) : [];
    agents = detected.length > 0 ? detected : ui.prompt ? await ui.prompt.agents(DEFAULT_AGENTS) : DEFAULT_AGENTS;
  }

  // 4 · Context (asked only on the first run) and database.
  const context = (o.context ?? (!prev && ui.prompt ? await ui.prompt.context() : "")).trim();
  const db = checkDb(o.db ?? prev?.options?.db ?? "auto");
  const redis = o.redis ?? prev?.options?.redis ?? false;

  if (o.dryRun) ui.log(`(dry-run: no se escribe nada en ${root})`);
  else mkdirSync(root, { recursive: true });

  // 5 · Git (zone-check needs it).
  if (!project.exists(".git")) {
    project.report("+", ".git", "git init");
    if (!o.dryRun) run(ui.log, "git", ["init", "-q"], root);
  }

  const sdir = stackDir(stack);
  const prevFiles = prev?.files ?? {};
  const files: Record<string, string> = {};

  // 6 · .agents/ core.
  project.create(".agents/README.md", tpl("core/agents-README.md"));
  for (const f of walk(join(sdir, "roles"))) project.create(`.agents/roles/${f}`, readFileSync(join(sdir, "roles", f), "utf8"));
  for (const f of walk(join(sdir, "zones"))) {
    if (f === "orchestrator.stack.txt") continue;
    project.create(`.agents/zones/${f}`, readFileSync(join(sdir, "zones", f), "utf8"));
  }
  const common = tpl("core/zones.orchestrator.common.txt");
  const stackZones = existsSync(join(sdir, "zones/orchestrator.stack.txt"))
    ? readFileSync(join(sdir, "zones/orchestrator.stack.txt"), "utf8")
    : "";
  project.create(".agents/zones/orchestrator.txt", common.endsWith("\n") || !common ? common + stackZones : `${common}\n${stackZones}`);
  for (const skillsRoot of [join(TEMPLATES, "skills"), join(sdir, "skills")]) {
    for (const f of walk(skillsRoot)) {
      const src = join(skillsRoot, f);
      project.tracked(`.agents/skills/${f}`, readFileSync(src, "utf8"), modeOf(src), prevFiles, files, o.force);
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
  const mark = project.tracked(makefile, tpl("core/Makefile"), 0o644, prevFiles, files, o.force);
  if (makefile === "Makefile.basekit" && (mark === "+" || mark === "~")) {
    project.report("!", "Makefile", "ya existe uno propio: el de basekit queda en Makefile.basekit; intégralos a mano");
  }
  for (const f of walk(join(sdir, "files"))) {
    const src = join(sdir, "files", f);
    project.create(f, readFileSync(src, "utf8"), modeOf(src));
  }
  if (appMissing) {
    for (const f of walk(join(sdir, "starter"))) {
      const src = join(sdir, "starter", f);
      project.create(f, readFileSync(src, "utf8"), modeOf(src));
    }
  }
  project.block(".gitignore", tpl("core/gitignore.block"), (l) => l.trim() === "# >>> basekit", "# <<< basekit");

  // 9 · Documentation (GLOSSARY.md and docs/adr/ are created later by domain-modeling).
  const vars = templateVars(stack, root, context);
  project.create("README.md", render(tpl("core/README.tpl.md"), vars));
  for (const f of walk(join(TEMPLATES, "core/docs"))) {
    const text = tpl(`core/docs/${f}`);
    project.create(`docs/${f}`, f.endsWith(".md") ? render(text, vars) : text);
  }

  // 10 · Adapters. 12 · External skills. 11 · Skill links last, so they also cover the external skills.
  writeAdapters(project, stack, agents);
  if (o.externalSkills) installExternalSkills(project, agents, ui.log, false);
  linkSkills(project, stack, agents);

  // 13 · Infrastructure, through the same script the agent uses. Only when --db is passed:
  // a rerun that takes the db from the manifest must not touch the infrastructure again.
  if (o.db !== undefined && db !== "auto") {
    const args = [INFRA, "--db", db, ...(redis ? ["--redis"] : [])];
    if (o.dryRun) ui.log(`· ejecutaría: bash ${args.join(" ")}`);
    else if (!run(ui.log, "bash", args, root)) project.report("!", INFRA, `falló; reinténtalo con: bash ${args.join(" ")}`);
  }

  writeManifest(project, prev, { stack: stack.id, agents, db, redis, files });

  // 14 · Summary and next step.
  nextStep(ui, project, stack, context);
  return 0;
}
