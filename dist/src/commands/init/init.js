import { readFileSync } from "node:fs";
import { join } from "node:path";
import { linkSkills, writeAdapters } from "../../kit/adapters.js";
import { DEFAULT_AGENTS, detectAgents, parseAgents } from "../../kit/agents.js";
import { templateVars, writeAgentsMd } from "../../kit/agents-md.js";
import { UsageError } from "../../kit/errors.js";
import { installExternalSkills } from "../../kit/external-skills.js";
import { displayName, inPart, isCombined, nameCompose, resolveParts, roleFiles, specOf, wireEnv, zoneFiles } from "../../kit/layout.js";
import { readManifest, writeManifest } from "../../kit/manifest.js";
import { Project, resolveRoot } from "../../kit/project.js";
import { detectStack, loadStacks, stackDir } from "../../kit/stacks.js";
import { modeOf, render, template, TEMPLATES, walk } from "../../kit/templates.js";
import { checkDb, checkStackDb, validateFlags } from "./options.js";
const INFRA = ".agents/skills/infra-setup/scripts/infra.sh";
function nextStep(ctx, project, parts, context) {
    ctx.log("");
    ctx.log(project.changed ? `Listo: base de ${displayName(parts)} preparada en ${project.root}` : "Todo al día: no había nada que cambiar.");
    ctx.log("Próximo paso, dile a tu agente:");
    ctx.log(`  «Lee AGENTS.md y ejecuta el bootstrap. El proyecto trata de: ${context || "<una o dos frases>"}»`);
    for (const part of parts) {
        const marker = part.stack.appMarker;
        const fromStarter = marker !== undefined && walk(join(stackDir(part.stack), "starter")).includes(marker);
        if (marker !== undefined && !project.exists(inPart(part, marker)) && !fromStarter) {
            const where = part.side ? ` en ${part.side}/` : "";
            const cmd = part.side ? `make -C ${part.side} new-app` : "make new-app";
            ctx.log(`Falta la app del framework${where}: ejecuta \`${cmd}\` (corre dentro de Docker).`);
        }
    }
}
/**
 * The project's Makefile in `dir` ("" for the root). A user's own Makefile is kept: basekit's goes to
 * Makefile.basekit next to it.
 */
function writeMakefile(project, dir, text, prev, files, force) {
    const at = (f) => (dir ? `${dir}/${f}` : f);
    const own = project.read(at("Makefile"));
    const name = own !== undefined && !own.includes("generado por basekit") ? at("Makefile.basekit") : at("Makefile");
    const mark = project.tracked(name, text, 0o644, prev, files, force);
    if (name.endsWith(".basekit") && (mark === "+" || mark === "~")) {
        project.report("!", at("Makefile"), "ya existe uno propio: el de basekit queda en Makefile.basekit; intégralos a mano");
    }
}
/** Spec 02 §3: the `init` algorithm, step by step. */
export async function init(o, ctx) {
    const stacks = loadStacks();
    const flags = validateFlags(o, stacks);
    const project = new Project(resolveRoot(o.dir), o.dryRun, ctx.log, ctx.fs);
    const root = project.root;
    const prev = project.existsRoot() ? readManifest(project) : undefined;
    // 2 · Stack: flag → manifest → detection → question. `<backend>+<frontend>` is a combined project (S16).
    let stackId = o.stack ?? prev?.stack ?? (project.existsRoot() ? detectStack(stacks, project)?.id : undefined);
    if (!stackId && ctx.prompt)
        stackId = await ctx.prompt.stack(stacks);
    if (!stackId) {
        throw new UsageError(`No se pudo detectar el stack. Usa --stack <id> (disponibles: ${stacks.map((s) => s.id).join(", ")})`);
    }
    const parts = resolveParts(stacks, stackId.trim());
    // The database belongs to the first part (the backend of a combined project). A frontend stack has none:
    // checked before any other question or write.
    const db = checkStackDb(parts[0].stack, checkDb(o.db ?? prev?.options?.db ?? "auto"), o.redis);
    // 3 · Agents: flag → manifest → detection → question.
    let agents = flags.agents ?? (prev?.agents ? parseAgents(prev.agents.join(",")) : undefined);
    if (!agents) {
        const detected = project.existsRoot() ? detectAgents(project) : [];
        agents = detected.length > 0 ? detected : ctx.prompt ? await ctx.prompt.agents(DEFAULT_AGENTS) : DEFAULT_AGENTS;
    }
    // 4 · Context (asked only on the first run) and database.
    const context = (o.context ?? (!prev && ctx.prompt ? await ctx.prompt.context() : "")).trim();
    const redis = o.redis ?? prev?.options?.redis ?? false;
    if (o.dryRun)
        ctx.log(`(dry-run: no se escribe nada en ${root})`);
    project.createRoot();
    // 5 · Git (zone-check needs it).
    const newRepository = !project.exists(".git");
    if (newRepository) {
        project.report("+", ".git", "git init");
        if (!o.dryRun)
            ctx.runner.run(ctx.log, "git", ["init", "-q"], root);
    }
    const prevFiles = prev?.files ?? {};
    const files = {};
    const copy = (src) => readFileSync(src, "utf8");
    const stackSkills = (part) => join(stackDir(part.stack), "skills");
    // 6 · .agents/ core (once, at the root, with the roles and skills of every part).
    project.create(".agents/README.md", template("core/agents-README.md"));
    for (const f of roleFiles(parts))
        project.create(`.agents/roles/${f.rel}`, f.text);
    for (const f of zoneFiles(parts))
        project.create(`.agents/zones/${f.rel}`, f.text);
    for (const skillsRoot of [join(TEMPLATES, "skills"), ...parts.map(stackSkills)]) {
        for (const f of walk(skillsRoot)) {
            const src = join(skillsRoot, f);
            project.tracked(`.agents/skills/${f}`, copy(src), modeOf(src), prevFiles, files, o.force);
        }
    }
    // A side runs its Makefile inside Docker with only its own folder mounted: it gets a copy of its stack's
    // skills, which `make verify` and `make new-app` read from `.agents/skills/`.
    for (const part of parts.filter((p) => p.side)) {
        for (const f of walk(stackSkills(part))) {
            const src = join(stackSkills(part), f);
            project.tracked(inPart(part, `.agents/skills/${f}`), copy(src), modeOf(src), prevFiles, files, o.force);
        }
    }
    // 7 · AGENTS.md managed block.
    writeAgentsMd(project, parts, context);
    for (const f of [".hermes.md", "HERMES.md"]) {
        if (project.exists(f))
            project.report("!", f, "Hermes lo carga en lugar de AGENTS.md; bórralo o fusiónalo");
    }
    // 8 · Docker and Make: each part is a complete project of its stack (S16: in its side folder,
    // with a root Makefile that delegates to both).
    if (isCombined(parts))
        writeMakefile(project, "", template("core/combo/Makefile"), prevFiles, files, o.force);
    for (const part of parts) {
        const sdir = stackDir(part.stack);
        const marker = part.stack.appMarker;
        const appMissing = marker !== undefined && !project.exists(inPart(part, marker));
        writeMakefile(project, part.side ?? "", template("core/Makefile"), prevFiles, files, o.force);
        for (const f of walk(join(sdir, "files"))) {
            const src = join(sdir, "files", f);
            let text = copy(src);
            if (part.side && f === ".env.example" && !project.exists(inPart(part, f))) {
                const wired = wireEnv(parts, part, text);
                text = wired.text;
                if (wired.warning)
                    project.report("!", inPart(part, f), wired.warning);
            }
            if (f === "compose.yaml")
                text = nameCompose(root, part, text);
            project.create(inPart(part, f), text, modeOf(src));
        }
        if (appMissing) {
            for (const f of walk(join(sdir, "starter"))) {
                const src = join(sdir, "starter", f);
                project.create(inPart(part, f), copy(src), modeOf(src));
            }
        }
    }
    project.block(".gitignore", template("core/gitignore.block"), (l) => l.trim() === "# >>> basekit", "# <<< basekit");
    // LF for everyone: a Windows clone with core.autocrlf=true would otherwise break the scripts in WSL/Docker.
    // In a repository that already existed it is only suggested: it could renormalize files committed with CRLF.
    if (newRepository || project.exists(".gitattributes")) {
        project.create(".gitattributes", template("core/gitattributes"));
    }
    else {
        project.report("!", ".gitattributes", "agrega `* text=auto eol=lf` (y ejecuta `git add --renormalize .`) para que Windows no convierta los scripts a CRLF");
    }
    // 9 · Documentation (GLOSSARY.md and docs/adr/ are created later by domain-modeling).
    const vars = templateVars(parts, root, context);
    project.create("README.md", render(template("core/README.tpl.md"), vars));
    for (const f of walk(join(TEMPLATES, "core/docs"))) {
        const text = template(`core/docs/${f}`);
        project.create(`docs/${f}`, f.endsWith(".md") ? render(text, vars) : text);
    }
    // 10 · Adapters. 12 · External skills. 11 · Skill links last, so they also cover the external skills.
    writeAdapters(project, parts, agents);
    if (o.externalSkills)
        installExternalSkills(project, agents, ctx.log, ctx.runner, false);
    linkSkills(project, parts, agents);
    // 13 · Infrastructure, through the same script the agent uses, in the folder of the part with the database.
    // Only when --db is passed: a rerun that takes the db from the manifest must not touch the infrastructure again.
    if (o.db !== undefined && o.db !== "auto") {
        const side = parts[0].side;
        const args = [side ? `../${INFRA}` : INFRA, "--db", db, ...(redis ? ["--redis"] : [])];
        // infra.sh works at the git top level: in a side folder the ceiling keeps git from climbing to the root.
        const shown = `${side ? `cd ${side} && GIT_CEILING_DIRECTORIES="$PWD/.." ` : ""}bash ${args.join(" ")}`;
        if (o.dryRun)
            ctx.log(`· ejecutaría: ${shown}`);
        else {
            const env = side ? { GIT_CEILING_DIRECTORIES: `${root}:${ctx.fs.realpath(root)}` } : undefined;
            if (!ctx.runner.run(ctx.log, "bash", args, side ? join(root, side) : root, env)) {
                project.report("!", INFRA, `falló; reinténtalo con: ${shown}`);
            }
        }
    }
    writeManifest(project, prev, { stack: specOf(parts), agents, db, redis, files });
    // 14 · Summary and next step.
    nextStep(ctx, project, parts, context);
    return 0;
}
