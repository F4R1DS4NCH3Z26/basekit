import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { linkSkills, writeAdapters } from "../../kit/adapters.js";
import { DEFAULT_AGENTS, detectAgents, savedAgents } from "../../kit/agents.js";
import { templateVars, writeAgentsMd } from "../../kit/agents-md.js";
import { UsageError } from "../../kit/errors.js";
import { installExternalSkills, missingExternal } from "../../kit/external-skills.js";
import { displayName, INFRA, INFRA_SKILL, inPart, isCombined, nameCompose, newAppCommand, partsOf, resolveParts, roleFiles, specOf, wireEnv, zoneFiles, } from "../../kit/layout.js";
import { chosenExternal, EXTERNAL_SKILLS, MANIFEST, readManifest, resolveDocker, resolveMakefile, writeManifest } from "../../kit/manifest.js";
import { Project, resolveRoot } from "../../kit/project.js";
import { detectStack, hasDatabase, loadStacks, stackDir } from "../../kit/stacks.js";
import { modeOf, render, template, TEMPLATES, walk } from "../../kit/templates.js";
import { checkDb, checkStackDb, dbChoices, DEFAULT_DB_CHOICE, NEEDS_DOCKER, needsDocker, validateFlags } from "./options.js";
/** The kit skills plus each part's stack skills, as installed in .agents/skills (shown before the external ones). */
function skillsOf(parts) {
    const names = (dir) => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
    const skills = names(join(TEMPLATES, "skills"));
    for (const part of parts)
        for (const s of names(join(stackDir(part.stack), "skills")))
            if (!skills.includes(s))
                skills.push(s);
    return skills;
}
function nextStep(ctx, project, parts, context, makefile) {
    ctx.log("");
    ctx.log(project.changed ? `Listo: base de ${displayName(parts)} preparada en ${project.root}` : "Todo al día: no había nada que cambiar.");
    ctx.log("Próximo paso, dile a tu agente:");
    ctx.log(`  «Lee AGENTS.md y ejecuta el bootstrap. El proyecto trata de: ${context || "<una o dos frases>"}»`);
    for (const part of parts) {
        const marker = part.stack.appMarker;
        const fromStarter = marker !== undefined && walk(join(stackDir(part.stack), "starter")).includes(marker);
        if (marker !== undefined && !project.exists(inPart(part, marker)) && !fromStarter) {
            const where = part.side ? ` en ${part.side}/` : "";
            ctx.log(makefile
                ? `Falta la app del framework${where}: ejecuta \`${newAppCommand(part)}\` (corre dentro de Docker).`
                : `Falta la app del framework${where}: créala con las herramientas del stack (${marker}).`);
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
/** The infra-setup overlays at the project root (not tracked in the manifest's files), the only definition. */
const OVERLAYS = ["compose.db.yaml", "compose.redis.yaml", ".make/db.mk"];
/**
 * What Docker left behind on the run that turns it off (docker follow-ups S1b), in path order and only what exists.
 * Called only when Docker was on in the previous manifest (so the previous layout `prevParts` used Docker): basekit's
 * Makefiles and `.make/` files that manifest tracks, each previous part's Docker and Make files (its stack's `files/`)
 * and the infra-setup overlays. A user's own Makefile is not tracked, so it is not listed. The root `Makefile` is left
 * out (docker follow-ups S9): the "sin Docker" line already reports that path.
 */
function dockerLeftovers(project, prevFiles, prevParts) {
    const paths = new Set(OVERLAYS);
    for (const f of Object.keys(prevFiles))
        if (/(^|\/)(Makefile(\.basekit)?$|\.make\/)/.test(f))
            paths.add(f);
    for (const part of prevParts)
        for (const f of walk(join(stackDir(part.stack), "files")))
            paths.add(inPart(part, f));
    paths.delete("Makefile");
    return [...paths].filter((f) => project.exists(f)).sort();
}
/** Whether the infra-setup script has something to set up: an engine, or Redis (`auto` and `none` are no engine). */
const hasInfra = (db, redis) => !["auto", "none"].includes(db) || redis;
/** Spec 02 §3: the `init` algorithm, step by step. */
export async function init(o, ctx) {
    const stacks = loadStacks();
    const flags = validateFlags(o, stacks);
    const project = new Project(resolveRoot(o.dir), o.dryRun, ctx.log, ctx.fs);
    const root = project.root;
    const prev = project.existsRoot() ? readManifest(project) : undefined;
    // docker follow-ups S7: every Docker decision comes from resolveDocker. `dockerRule` is its input for this run;
    // with the "undecided" answer it tells whether Docker is decided without reaching the question step.
    const dockerRule = (combined) => ({ combined, noDocker: o.noDocker, docker: o.docker, manifest: prev });
    const undecided = () => undefined;
    // docker follow-ups S3: `--db` other than auto/none and `--redis` need Docker. With Docker off without asking (by flag
    // or by the manifest) they are a usage error raised before any question or write; when Docker would be asked, they
    // answer the question. Before the stack is known the combined step cannot apply: a combined answer with --no-docker
    // fails later anyway, and with docker: false in the manifest the flags are rejected as before.
    const dbNeedsDocker = needsDocker(o);
    const checkDockerFlags = (combined) => {
        if (dbNeedsDocker && resolveDocker(dockerRule(combined), undecided) === false)
            throw new UsageError(NEEDS_DOCKER);
    };
    // 2 · Stack: flag → manifest → detection → question. `<backend>+<frontend>` is a combined project (S16).
    let stackId = o.stack ?? prev?.stack ?? (project.existsRoot() ? detectStack(stacks, project)?.id : undefined);
    if (!stackId && ctx.prompt) {
        checkDockerFlags(false);
        stackId = await ctx.prompt.stack(stacks);
    }
    if (!stackId) {
        throw new UsageError(`No se pudo detectar el stack. Usa --stack <id> (disponibles: ${stacks.map((s) => s.id).join(", ")})`);
    }
    const parts = resolveParts(stacks, stackId.trim());
    // The database belongs to the first part (the backend of a combined project). A frontend stack has none:
    // checked before any other question or write. Flags win over the manifest; the manifest's database and
    // Redis carry over only to a stack that has a database (an existing project switched to a frontend drops them).
    const dbStack = parts[0].stack;
    const saved = hasDatabase(dbStack) ? prev?.options : undefined;
    let db = checkStackDb(dbStack, checkDb(o.db ?? saved?.db ?? "auto"), o.redis, o.db !== undefined);
    const redis = o.redis ?? saved?.redis ?? false;
    if (isCombined(parts) && o.noDocker) {
        throw new UsageError("un proyecto combinado (<backend>+<frontend>) necesita Docker: cada lado corre con su Makefile y compose; quita --no-docker");
    }
    if (isCombined(parts) && o.noMakefile) {
        throw new UsageError("un proyecto combinado (<backend>+<frontend>) necesita el Makefile: el Makefile raíz delega en cada lado; quita --no-makefile");
    }
    // A combined project always uses Docker, whatever the manifest says (resolveDocker's first step).
    checkDockerFlags(isCombined(parts));
    // Overlays left by an earlier backend stay (they are the user's files): say they no longer apply. A frontend stack
    // keeps the single-stack Makefile, whose `-include .make/db.mk` still reads that file, so only the compose overlays
    // are warned; the root Makefile of a combined project includes no `.make/` file, so `.make/db.mk` is warned too.
    if (!hasDatabase(dbStack) && parts.length === 1) {
        for (const f of OVERLAYS.filter((f) => f.startsWith("compose."))) {
            if (project.exists(f))
                project.report("!", f, `queda del stack anterior: un stack frontend no usa base de datos; bórralo si ya no lo necesitas`);
        }
    }
    if (isCombined(parts)) {
        for (const f of OVERLAYS) {
            if (project.exists(f))
                project.report("!", f, `queda del stack anterior: la base de datos ahora vive en ${inPart(parts[0], "")}; bórralo si ya no lo necesitas`);
        }
    }
    // Skills: the kit and stack skills are always installed because the roles and `make verify` depend on them;
    // only the external pack is optional (S1): the choice is asked once and persisted in the manifest.
    // `--external-skills` replaces it without asking (S4).
    let chosen = flags.externalSkills ?? chosenExternal(prev);
    let choice = flags.externalSkills;
    const decided = choice !== undefined || Array.isArray(prev?.options?.externalSkills);
    if (o.externalSkills && ctx.prompt && !decided && missingExternal(project, chosen).length > 0) {
        ctx.log(`Skills incluidas: ${skillsOf(parts).join(", ")}`);
        chosen = choice = await ctx.prompt.externalSkills(EXTERNAL_SKILLS.skills);
    }
    // 3 · Agents: flag → manifest → detection → question. `none` (or `agents: []` in the manifest) means no tool (S2).
    let agents = flags.agents ?? savedAgents(prev?.agents);
    if (!agents) {
        const detected = project.existsRoot() ? detectAgents(project) : [];
        agents = detected.length > 0 ? detected : ctx.prompt ? await ctx.prompt.agents(DEFAULT_AGENTS) : DEFAULT_AGENTS;
    }
    // Docker (docker follow-ups S1a): the rule shared with sync and doctor; asked only on a first run, and not when
    // --db or --redis already need it (docker follow-ups S3). A combined project always uses it: each side is a Docker
    // project of its stack, and the root Makefile delegates to both.
    const prompt = ctx.prompt;
    const docker = await resolveDocker(dockerRule(isCombined(parts)), prompt && !dbNeedsDocker ? () => prompt.confirm("¿Usar Docker? Todo corre en contenedores (Dockerfile y compose)", true) : undefined);
    // Whether the previous manifest had Docker (docker follow-ups S7): resolveDocker on that manifest alone, with its
    // stack's combined flag; undefined on a first run.
    const before = partsOf(stacks, prev?.stack);
    const dockerWasOn = prev && resolveDocker({ combined: before !== undefined && isCombined(before), manifest: prev });
    // Without Docker, a database or Redis that comes from the manifest is kept for when Docker comes back, with a warning
    // instead of an error (docker follow-ups S5). Each value is decided on its own: an explicit --db (auto or none) is
    // stored as given.
    const savedInfraUnused = !docker && ((o.db === undefined && hasInfra(db, false)) || (o.redis === undefined && redis));
    // Makefile (Makefile question S3, S5): the rule shared with sync and doctor; asked only on the first run. When Docker
    // comes back on (docker follow-ups S2), the stored makefile: false was derived from "no Docker", not chosen: the
    // Makefile resolves as on a first run.
    const reenabled = docker && dockerWasOn === false;
    const makefile = await resolveMakefile({ docker, combined: isCombined(parts), noMakefile: o.noMakefile, manifest: reenabled ? undefined : prev }, prompt && (() => prompt.confirm("¿Usar Makefile? Es la interfaz para correr los comandos en los contenedores", true)));
    // Database (S1): asked only on the first run (no manifest), with Docker, for a stack (or backend side) that has
    // one, and without --db. A rerun keeps the saved engine, even auto: the agent may have run infra.sh itself.
    // The answer counts as an explicit --db: infra-setup runs with it.
    let dbFlag = o.db;
    if (ctx.prompt && docker && hasDatabase(dbStack) && o.db === undefined && !prev) {
        dbFlag = (await ctx.prompt.confirm("¿Integrar base de datos?", true))
            ? await ctx.prompt.choose("¿Qué base de datos?", dbChoices(dbStack), DEFAULT_DB_CHOICE)
            : "none";
        db = dbFlag;
    }
    // A single-stack project switched to combined with the database carried from the manifest (S19): the new backend
    // side has no overlays yet, so infra.sh runs for it as with an explicit --db. The root ones stay (the user's files).
    const carried = isCombined(parts) && before !== undefined && !isCombined(before) && dbFlag === undefined && hasInfra(db, redis);
    // Back to Docker (docker follow-ups S5) with a saved engine or Redis: infra.sh runs with them as with an explicit
    // --db, so overlays deleted after the S1b warnings come back. A saved auto is never passed (infra.sh has no auto,
    // and an explicit --db auto does not run it either).
    const restored = reenabled && dbFlag === undefined && db !== "auto" && hasInfra(db, redis);
    // Git: only asked when .git is missing (zone-check needs it).
    const hasGit = project.exists(".git");
    let gitInit = !hasGit && !o.noGit;
    if (gitInit && ctx.prompt)
        gitInit = await ctx.prompt.confirm("¿Inicializar git (git init)? zone-check lo necesita", true);
    // 4 · Context (asked only on the first run) and database.
    const context = (o.context ?? (!prev && ctx.prompt ? await ctx.prompt.context() : "")).trim();
    if (o.dryRun)
        ctx.log(`(dry-run: no se escribe nada en ${root})`);
    project.createRoot();
    // 5 · Git (zone-check needs it).
    if (gitInit) {
        project.report("+", ".git", "git init");
        if (!o.dryRun)
            ctx.runner.run(ctx.log, "git", ["init", "-q"], root);
    }
    else if (!hasGit) {
        project.report("!", ".git", "sin git: zone-check no funciona hasta que ejecutes git init");
    }
    const prevFiles = prev?.files ?? {};
    const files = {};
    const copy = (src) => readFileSync(src, "utf8");
    const stackSkills = (part) => join(stackDir(part.stack), "skills");
    /** Copies every file under `srcRoot` to `dest` (a folder of the project), tracked in the manifest. */
    const copyTracked = (srcRoot, dest) => {
        for (const f of walk(srcRoot)) {
            const src = join(srcRoot, f);
            project.tracked(`${dest}/${f}`, copy(src), modeOf(src), prevFiles, files, o.force);
        }
    };
    // 6 · .agents/ core (once, at the root, with the roles and skills of every part).
    project.create(".agents/README.md", template("core/agents-README.md"));
    for (const f of roleFiles(parts))
        project.create(`.agents/roles/${f.rel}`, f.text);
    for (const f of zoneFiles(parts))
        project.create(`.agents/zones/${f.rel}`, f.text);
    for (const skillsRoot of [join(TEMPLATES, "skills"), ...parts.map(stackSkills)])
        copyTracked(skillsRoot, ".agents/skills");
    // A side runs its Makefile inside Docker with only its own folder mounted: it gets a copy of its stack's
    // skills, which `make verify` and `make new-app` read from `.agents/skills/`. The skill scripts work on the
    // project that holds them, so the side with the database also gets infra-setup (S17).
    for (const part of parts.filter((p) => p.side)) {
        copyTracked(stackSkills(part), inPart(part, ".agents/skills"));
        if (hasDatabase(part.stack))
            copyTracked(join(TEMPLATES, "skills", INFRA_SKILL), inPart(part, `.agents/skills/${INFRA_SKILL}`));
    }
    // 7 · AGENTS.md managed block.
    writeAgentsMd(project, parts, context);
    for (const f of [".hermes.md", "HERMES.md"]) {
        if (project.exists(f))
            project.report("!", f, "Hermes lo carga en lugar de AGENTS.md; bórralo o fusiónalo");
    }
    // 8 · Docker and Make: each part is a complete project of its stack (S16: in its side folder,
    // with a root Makefile that delegates to both).
    if (makefile && isCombined(parts))
        writeMakefile(project, "", template("core/combo/Makefile"), prevFiles, files, o.force);
    if (!docker) {
        project.report("!", "Makefile", "sin Docker: no se crean Makefile, Dockerfile ni compose; las reglas de AGENTS.md asumen Docker y make, adáptalas");
        if (savedInfraUnused) {
            project.report("!", MANIFEST, "sin Docker no se usan la base de datos ni Redis guardados; se conservan para cuando vuelvas a usar Docker");
        }
        // docker follow-ups S1b: on the run that turns Docker off nothing is deleted (they are the user's files now); each
        // leftover gets a warning.
        if (dockerWasOn) {
            for (const f of dockerLeftovers(project, prevFiles, before ?? parts)) {
                project.report("!", f, "queda de cuando el proyecto usaba Docker: sin Docker no se usa; bórralo si ya no lo necesitas");
            }
        }
    }
    else if (!makefile) {
        project.report("!", "Makefile", "sin Makefile: usa docker compose directo, crea .env desde .env.example (reemplaza __GENERATE__) y adapta las reglas de AGENTS.md que usan make");
    }
    for (const part of parts) {
        const sdir = stackDir(part.stack);
        const marker = part.stack.appMarker;
        const appMissing = marker !== undefined && !project.exists(inPart(part, marker));
        if (docker) {
            if (makefile)
                writeMakefile(project, part.side ?? "", template("core/Makefile"), prevFiles, files, o.force);
            for (const f of walk(join(sdir, "files"))) {
                // .make/ belongs to the Makefile: Docker only gets the Dockerfile, compose and .env.example.
                if (!makefile && f.startsWith(".make/"))
                    continue;
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
    if (gitInit || project.exists(".gitattributes")) {
        project.create(".gitattributes", template("core/gitattributes"));
    }
    else if (hasGit) {
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
        installExternalSkills(project, agents, ctx.log, ctx.runner, false, chosen);
    linkSkills(project, parts, agents);
    // 13 · Infrastructure, through the same script the agent uses: the copy of the part with the database, which
    // works on the folder that holds it. Only when --db is passed (or answered, S1), the database moves to a new backend
    // side or Docker comes back on (docker follow-ups S5): a rerun that takes the db from the manifest must not touch the
    // infrastructure again.
    if (docker && ((dbFlag !== undefined && dbFlag !== "auto") || carried || restored)) {
        const script = inPart(parts[0], INFRA);
        const args = [script, "--db", db, ...(redis ? ["--redis"] : [])];
        const shown = `bash ${args.join(" ")}`;
        if (o.dryRun)
            ctx.log(`· ejecutaría: ${shown}`);
        else if (!ctx.runner.run(ctx.log, "bash", args, root))
            project.report("!", script, `falló; reinténtalo con: ${shown}`);
    }
    writeManifest(project, prev, { stack: specOf(parts), agents, db, redis, docker, makefile, externalSkills: choice, files });
    // 14 · Summary and next step.
    nextStep(ctx, project, parts, context, makefile);
    return 0;
}
