#!/usr/bin/env node
import { parseArgs } from "node:util";
import { AGENTS } from "./agents.js";
import { doctor } from "./doctor.js";
import { init, type Ui } from "./init.js";
import { Prompter } from "./prompt.js";
import { sync } from "./sync.js";
import { loadStacks, UsageError, VERSION } from "./templates.js";

/** Options each command accepts; anything else is an error instead of being silently ignored. */
const ALLOWED: Record<string, string[]> = {
  init: ["stack", "agents", "context", "db", "redis", "no-external-skills", "force", "dry-run", "yes"],
  sync: ["agents", "no-external-skills", "dry-run"],
  doctor: [],
  stacks: [],
};

const USAGE = `basekit ${VERSION} — prepara la base de un proyecto para agentes de código

Uso:
  basekit init [dir] [opciones]   Crea la base completa en un proyecto nuevo o existente
  basekit sync [dir] [opciones]   Regenera el bloque de AGENTS.md, los adaptadores y los enlaces
  basekit doctor [dir]            Diagnóstico del entorno y del proyecto (OK / FALTA)
  basekit stacks                  Lista los stacks y los agentes soportados

Opciones de init:
  --stack <id>            Stack (por defecto: detectado; si no, se pregunta)
  --agents <a,b>          Agentes (por defecto: detectados; si no, claude-code,opencode)
  --context <texto>       De qué trata el proyecto
  --db <motor>            auto | postgres | mysql | sqlite | none (por defecto: auto)
  --redis                 Agrega Redis
  --no-external-skills    No instala las skills externas (CI o sin red)
  --force                 Reemplaza las skills del kit modificadas localmente
  --dry-run               Muestra lo que haría sin escribir nada
  -y, --yes               No interactivo: usa flags y valores por defecto

Opciones de sync:
  --agents <a,b>          Reemplaza la lista de agentes (los nuevos reciben adaptadores, enlaces y skills externas)
  --no-external-skills    No reinstala las skills externas
  --dry-run               Muestra lo que haría sin escribir nada
`;

function makeUi(interactive: boolean): Ui {
  return {
    log: (line) => process.stdout.write(`${line}\n`),
    prompt: interactive ? new Prompter(process.stdin, process.stdout) : undefined,
  };
}

function stacksCommand(): number {
  const stacks = loadStacks();
  const width = Math.max(...stacks.map((s) => s.id.length));
  process.stdout.write("Stacks:\n");
  for (const s of stacks) process.stdout.write(`  ${s.id.padEnd(width)}  ${s.name} (puerto ${s.port})\n`);
  process.stdout.write(`Agentes: ${AGENTS.map((a) => a.id).join(", ")}\n`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
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
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, dir, ...rest] = positionals;
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (values.help || command === undefined || command === "help") {
    process.stdout.write(USAGE);
    return command === undefined && !values.help ? 2 : 0;
  }
  if (rest.length > 0) throw new UsageError(`Argumentos de más: ${rest.join(" ")}`);
  const allowed = ALLOWED[command];
  if (!allowed) throw new UsageError(`Comando desconocido: ${command}. Usa \`basekit help\``);
  const extra = Object.keys(values).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new UsageError(`${extra.map((k) => `--${k}`).join(", ")} no aplica a \`${command}\``);
  if (command === "stacks" && dir !== undefined) throw new UsageError(`Argumentos de más: ${dir}`);

  switch (command) {
    case "stacks":
      return stacksCommand();
    case "init": {
      const ui = makeUi(process.stdin.isTTY === true && !values.yes);
      try {
        return await init(
        {
          dir,
          stack: values.stack,
          agents: values.agents,
          context: values.context,
          db: values.db,
          redis: values.redis,
          externalSkills: !values["no-external-skills"],
          force: values.force ?? false,
          dryRun: values["dry-run"] ?? false,
        },
        ui,
        );
      } finally {
        ui.prompt?.close();
      }
    }
    case "sync":
      return sync(
        { dir, agents: values.agents, externalSkills: !values["no-external-skills"], dryRun: values["dry-run"] ?? false },
        makeUi(false),
      );
    case "doctor":
      return doctor(dir, makeUi(false));
    default:
      throw new UsageError(`Comando desconocido: ${command}. Usa \`basekit help\``);
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    const usage = err instanceof UsageError || (err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS"));
    process.stderr.write(`ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(usage ? 2 : 1);
  },
);
