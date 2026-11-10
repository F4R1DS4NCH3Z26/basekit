#!/usr/bin/env node
import { parseArgs } from "node:util";
import { doctor } from "./commands/doctor/index.js";
import { init } from "./commands/init/index.js";
import { install, validateInstall } from "./commands/install/index.js";
import { stacks } from "./commands/stacks/index.js";
import { sync } from "./commands/sync/index.js";
import { nodeFileSystem } from "./infra/file-system.js";
import { processRunner } from "./infra/runner.js";
import { failure, UsageError } from "./kit/errors.js";
import { VERSION } from "./kit/templates.js";
import { Prompter } from "./ui/prompt.js";
/** Options each command accepts; anything else is an error instead of being silently ignored. */
const ALLOWED = {
    init: ["stack", "agents", "context", "db", "redis", "no-external-skills", "force", "dry-run", "yes"],
    sync: ["agents", "no-external-skills", "dry-run"],
    install: ["global", "project", "from"],
    doctor: [],
    stacks: [],
};
const USAGE = `basekit ${VERSION} — prepara la base de un proyecto para agentes de código

Uso:
  basekit                         En una terminal: pregunta si instalarlo global o en este proyecto
  basekit install [dir] [--global|--project] [--from <paquete>]
  basekit init [dir] [opciones]   Crea la base completa en un proyecto nuevo o existente
  basekit sync [dir] [opciones]   Regenera el bloque de AGENTS.md, los adaptadores y los enlaces
  basekit doctor [dir]            Diagnóstico del entorno y del proyecto (OK / FALTA)
  basekit stacks                  Lista los stacks y los agentes soportados

Opciones de init:
  --stack <id>            Stack (ver \`basekit stacks\`; por defecto: detectado; si no, se pregunta
                          tipo de app → lenguaje → framework)
  --stack <back>+<front>  Fullstack combinado: un stack backend en backend/ y uno frontend en
                          frontend/, con un Makefile raíz que delega en los dos
  --agents <a,b>          Agentes (por defecto: detectados; si no, claude-code,opencode)
  --context <texto>       De qué trata el proyecto
  --db <motor>            auto | postgres | mysql | sqlite | none (por defecto: auto;
                          un stack frontend solo admite auto o none; en un combinado, va al backend)
  --redis                 Agrega Redis (no en un stack frontend; en un combinado, va al backend)
  --no-external-skills    No instala las skills externas (CI o sin red)
  --force                 Reemplaza las skills del kit modificadas localmente
  --dry-run               Muestra lo que haría sin escribir nada
  -y, --yes               No interactivo: usa flags y valores por defecto

Opciones de install (instala desde el repositorio de GitHub de basekit, nunca desde el nombre de npm):
  --global                npm install -g: un basekit para todos tus proyectos
  --project               npm install -D en el package.json de [dir] (por defecto, este directorio)
  --from <paquete>        Instala otro origen: un fork, una etiqueta (github:usuario/basekit#v0.2.0) o un .tgz

Opciones de sync:
  --agents <a,b>          Reemplaza la lista de agentes (los nuevos reciben adaptadores, enlaces y skills externas)
  --no-external-skills    No reinstala las skills externas
  --dry-run               Muestra lo que haría sin escribir nada
`;
/** The real environment: stdout, the disk and real processes; questions only in an interactive session. */
function makeContext(interactive) {
    return {
        log: (line) => process.stdout.write(`${line}\n`),
        prompt: interactive ? new Prompter(process.stdin, process.stdout) : undefined,
        fs: nodeFileSystem,
        runner: processRunner,
    };
}
async function runInstall(o, ctx) {
    try {
        return await install(o, ctx);
    }
    finally {
        ctx.prompt?.close();
    }
}
/** Parses the arguments and routes to a command. Nothing else lives here. */
async function main(argv) {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        strict: true,
        options: {
            stack: { type: "string" },
            agents: { type: "string" },
            context: { type: "string" },
            db: { type: "string" },
            redis: { type: "boolean" },
            "no-external-skills": { type: "boolean" },
            force: { type: "boolean" },
            "dry-run": { type: "boolean" },
            yes: { type: "boolean", short: "y" },
            global: { type: "boolean" },
            project: { type: "boolean" },
            from: { type: "string" },
            help: { type: "boolean", short: "h" },
            version: { type: "boolean", short: "v" },
        },
    });
    const [command, dir, ...rest] = positionals;
    if (values.version) {
        process.stdout.write(`${VERSION}\n`);
        return 0;
    }
    const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
    // `basekit` alone in a terminal (typically `npx github:…/basekit`) is the installer.
    if (command === undefined && !values.help && Object.keys(values).length === 0 && interactive) {
        return runInstall({}, makeContext(true));
    }
    if (values.help || command === undefined || command === "help") {
        process.stdout.write(USAGE);
        return command === undefined && !values.help ? 2 : 0;
    }
    if (rest.length > 0)
        throw new UsageError(`Argumentos de más: ${rest.join(" ")}`);
    const allowed = ALLOWED[command];
    if (!allowed)
        throw new UsageError(`Comando desconocido: ${command}. Usa \`basekit help\``);
    const extra = Object.keys(values).filter((k) => !allowed.includes(k));
    if (extra.length > 0)
        throw new UsageError(`${extra.map((k) => `--${k}`).join(", ")} no aplica a \`${command}\``);
    if (command === "stacks" && dir !== undefined)
        throw new UsageError(`Argumentos de más: ${dir}`);
    switch (command) {
        case "install":
            return runInstall({ dir, ...validateInstall(values) }, makeContext(interactive && !values.global && !values.project));
        case "stacks":
            return stacks(makeContext(false));
        case "doctor":
            return doctor(dir, makeContext(false));
        case "sync":
            return sync({ dir, agents: values.agents, externalSkills: !values["no-external-skills"], dryRun: values["dry-run"] ?? false }, makeContext(false));
        default: {
            const ctx = makeContext(process.stdin.isTTY === true && !values.yes);
            try {
                return await init({
                    dir,
                    stack: values.stack,
                    agents: values.agents,
                    context: values.context,
                    db: values.db,
                    redis: values.redis,
                    externalSkills: !values["no-external-skills"],
                    force: values.force ?? false,
                    dryRun: values["dry-run"] ?? false,
                }, ctx);
            }
            finally {
                ctx.prompt?.close();
            }
        }
    }
}
main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    const { code, message } = failure(err);
    process.stderr.write(`${message}\n`);
    process.exit(code);
});
