import { basename } from "node:path";
import { UsageError } from "../../kit/errors.js";
import { Project, resolveRoot } from "../../kit/project.js";
import { INSTALL_SOURCE } from "../../kit/templates.js";
const NPM_FLAGS = ["--no-audit", "--no-fund"];
const INIT_HERE = ["--no-install", "basekit", "init", "."];
/** A valid npm package name derived from the project directory. */
const packageName = (root) => basename(root).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+/, "") || "app";
async function chooseMode(ctx) {
    if (!ctx.prompt) {
        throw new UsageError("Elige dónde instalarlo: basekit install --global o basekit install --project");
    }
    const mode = await ctx.prompt.choose("basekit — ¿cómo quieres instalarlo?", [
        { id: "global", label: "Global", hint: "un `basekit` para todos tus proyectos (npm install -g)" },
        { id: "project", label: "Este proyecto", hint: "devDependency del package.json de este directorio (npm install -D)" },
    ]);
    return mode;
}
/**
 * Installs basekit globally or as a devDependency of the project, always from this package's own
 * repository (or `--from`), never from the npm name. Runs npm with fixed argument arrays.
 */
export async function install(o, ctx) {
    const spec = o.from ?? INSTALL_SOURCE;
    const mode = o.mode ?? (await chooseMode(ctx));
    const project = new Project(resolveRoot(o.dir), false, ctx.log, ctx.fs);
    if (mode === "global") {
        ctx.log(`· npm install -g ${spec}`);
        if (!ctx.runner.run(ctx.log, "npm", ["install", "-g", ...NPM_FLAGS, spec], project.root)) {
            ctx.log(`No se pudo instalar. Reinténtalo con: npm install -g ${spec}`);
            return 1;
        }
        ctx.log("+ basekit instalado globalmente");
        ctx.log("Siguiente: basekit init <carpeta-del-proyecto>");
        return 0;
    }
    if (!project.isFile("package.json")) {
        const create = ctx.prompt
            ? await ctx.prompt.confirm(`No hay package.json en ${project.root}. ¿Lo creo para guardar basekit como devDependency?`, false)
            : false;
        if (!create) {
            throw new UsageError(`No hay package.json en ${project.root}: créalo (npm init -y) o instala basekit globalmente (basekit install --global)`);
        }
        project.create("package.json", `${JSON.stringify({ name: packageName(project.root), private: true }, null, 2)}\n`);
    }
    ctx.log(`· npm install -D ${spec}`);
    if (!ctx.runner.run(ctx.log, "npm", ["install", "-D", ...NPM_FLAGS, spec], project.root)) {
        ctx.log(`No se pudo instalar. Reinténtalo con: npm install -D ${spec}`);
        return 1;
    }
    ctx.log("+ basekit instalado en este proyecto (devDependencies)");
    if (ctx.prompt && (await ctx.prompt.confirm("¿Preparo este proyecto ahora? (npx --no-install basekit init .)", true))) {
        return ctx.runner.interactive("npx", INIT_HERE, project.root) ? 0 : 1;
    }
    ctx.log("Siguiente: npx --no-install basekit init .");
    return 0;
}
