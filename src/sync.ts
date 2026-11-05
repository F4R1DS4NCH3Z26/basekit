import { resolve } from "node:path";
import { linkSkills, writeAdapters } from "./adapters.js";
import { parseAgents } from "./agents.js";
import { writeAgentsMd } from "./agentsmd.js";
import { installExternalSkills } from "./external.js";
import { expandHome, pickStack, type Ui } from "./init.js";
import { MANIFEST, readManifest, writeManifest } from "./manifest.js";
import { Project } from "./project.js";
import { loadStacks } from "./templates.js";

export interface SyncOptions {
  dir?: string;
  agents?: string;
  externalSkills: boolean;
  dryRun: boolean;
}

/** Spec 02 §10: regenerates the AGENTS.md block, the adapters and the links from `.agents/`. */
export async function sync(o: SyncOptions, ui: Ui): Promise<number> {
  const root = resolve(expandHome(o.dir ?? "."));
  const project = new Project(root, o.dryRun, ui.log);
  const prev = readManifest(project);
  if (!prev?.stack) throw new Error(`No existe ${MANIFEST} en ${root}: ejecuta \`basekit init\` primero`);
  const stack = pickStack(loadStacks(), prev.stack);
  const saved = prev.agents ?? [];
  const agents = o.agents !== undefined ? parseAgents(o.agents) : saved.length > 0 ? parseAgents(saved.join(",")) : [];
  const added = agents.filter((a) => !saved.includes(a));
  if (o.dryRun) ui.log(`(dry-run: no se escribe nada en ${root})`);

  writeAgentsMd(project, stack, "");
  writeAdapters(project, stack, agents);
  if (o.externalSkills && agents.length > 0) installExternalSkills(project, agents, ui.log, added.length > 0);
  linkSkills(project, stack, agents);
  writeManifest(project, prev, {
    stack: stack.id,
    agents,
    db: prev.options?.db ?? "auto",
    redis: prev.options?.redis ?? false,
    files: prev.files ?? {},
  });

  ui.log("");
  ui.log(project.changed ? "Sincronizado." : "Todo al día: no había nada que cambiar.");
  return 0;
}
