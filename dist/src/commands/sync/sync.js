import { linkSkills, writeAdapters } from "../../kit/adapters.js";
import { parseAgents, savedAgents } from "../../kit/agents.js";
import { writeAgentsMd } from "../../kit/agents-md.js";
import { installExternalSkills, parseExternalSkills } from "../../kit/external-skills.js";
import { resolveParts, specOf } from "../../kit/layout.js";
import { chosenExternal, MANIFEST, readManifest, writeManifest } from "../../kit/manifest.js";
import { Project, resolveRoot } from "../../kit/project.js";
import { loadStacks } from "../../kit/stacks.js";
/** Spec 02 §10: regenerates the AGENTS.md block, the adapters and the links from `.agents/`. */
export async function sync(o, ctx) {
    const choice = parseExternalSkills(o.externalChoice, !o.externalSkills);
    const project = new Project(resolveRoot(o.dir), o.dryRun, ctx.log, ctx.fs);
    const prev = readManifest(project);
    if (!prev?.stack)
        throw new Error(`No existe ${MANIFEST} en ${project.root}: ejecuta \`basekit init\` primero`);
    const parts = resolveParts(loadStacks(), prev.stack);
    const saved = prev.agents ?? [];
    const agents = o.agents !== undefined ? parseAgents(o.agents) : (savedAgents(saved) ?? []);
    const added = agents.filter((a) => !saved.includes(a));
    // Docker and the Makefile are init's choices: sync only keeps them (it never writes the Makefile nor .make/).
    const docker = prev.options?.docker !== false;
    if (o.dryRun)
        ctx.log(`(dry-run: no se escribe nada en ${project.root})`);
    writeAgentsMd(project, parts, "");
    writeAdapters(project, parts, agents);
    if (o.externalSkills)
        installExternalSkills(project, agents, ctx.log, ctx.runner, added.length > 0, choice ?? chosenExternal(prev));
    linkSkills(project, parts, agents);
    writeManifest(project, prev, {
        stack: specOf(parts),
        agents,
        db: prev.options?.db ?? "auto",
        redis: prev.options?.redis ?? false,
        docker,
        makefile: docker && prev.options?.makefile !== false,
        externalSkills: choice,
        files: prev.files ?? {},
    });
    ctx.log("");
    ctx.log(project.changed ? "Sincronizado." : "Todo al día: no había nada que cambiar.");
    return 0;
}
