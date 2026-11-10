import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { displayName } from "./layout.js";
import { stackDir } from "./stacks.js";
import { render, template, VERSION } from "./templates.js";
export const AGENTS_MD_WARN = 18_000;
/** The stack's own AGENTS.md section, without trailing blank lines ("" when it has none). */
function section(stack) {
    const file = join(stackDir(stack), "AGENTS.section.md");
    return existsSync(file) ? readFileSync(file, "utf8").replace(/\n+$/, "") : "";
}
/**
 * Placeholder values (spec 02 §5). `context` is free text: it is only ever written to files.
 * A combined project (S16) lists the skills of both stacks and wraps both sections in `core/combo/AGENTS.section.md`;
 * its README port is the frontend's, the page the user opens.
 */
export function templateVars(parts, root, context) {
    const [first] = parts;
    const backend = parts.find((p) => p.side === "backend");
    const frontend = parts.find((p) => p.side === "frontend");
    const stackSection = backend && frontend
        ? render(template("core/combo/AGENTS.section.md"), {
            BACKEND_NAME: backend.stack.name,
            FRONTEND_NAME: frontend.stack.name,
            BACKEND_PORT: String(backend.stack.port),
            FRONTEND_PORT: String(frontend.stack.port),
            BACKEND_SECTION: section(backend.stack),
            FRONTEND_SECTION: section(frontend.stack),
        }).replace(/\n+$/, "")
        : section(first.stack);
    return {
        VERSION,
        STACK_NAME: displayName(parts),
        STACK_SKILLS: parts.flatMap((p) => p.stack.skills.map(([name, when]) => `| \`${name}\` | ${when} |`)).join("\n"),
        STACK_SECTION: stackSection,
        PROJECT_NAME: basename(root),
        ONE_LINER: context || "Descripción pendiente: la completa el bootstrap.",
        CONTEXT: context || "_(sin contexto inicial: el bootstrap lo pedirá)_",
        PORT: String((frontend ?? first).stack.port),
    };
}
/** Writes the managed block of AGENTS.md and warns when the file gets close to Hermes' limit. */
export function writeAgentsMd(project, parts, context) {
    const block = render(template("core/AGENTS.block.md"), templateVars(parts, project.root, context));
    const text = project.block("AGENTS.md", block, (l) => l.startsWith("<!-- basekit:start"), "<!-- basekit:end -->");
    if (text.length > AGENTS_MD_WARN) {
        project.report("!", "AGENTS.md", `${text.length} caracteres: Hermes trunca a partir de 20.000`);
    }
}
