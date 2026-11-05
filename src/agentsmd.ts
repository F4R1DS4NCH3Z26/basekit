import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Project } from "./project.js";
import { render, stackDir, TEMPLATES, VERSION, type Stack } from "./templates.js";

export const AGENTS_MD_WARN = 18_000;

/** Placeholder values (spec 02 §5). `context` is free text: it is only ever written to files. */
export function templateVars(stack: Stack, root: string, context: string): Record<string, string> {
  const section = join(stackDir(stack), "AGENTS.section.md");
  return {
    VERSION,
    STACK_NAME: stack.name,
    STACK_SKILLS: stack.skills.map(([name, when]) => `| \`${name}\` | ${when} |`).join("\n"),
    STACK_SECTION: existsSync(section) ? readFileSync(section, "utf8").replace(/\n+$/, "") : "",
    PROJECT_NAME: basename(root),
    ONE_LINER: context || "Descripción pendiente: la completa el bootstrap.",
    CONTEXT: context || "_(sin contexto inicial: el bootstrap lo pedirá)_",
    PORT: String(stack.port),
  };
}

/** Writes the managed block of AGENTS.md and warns when the file gets close to Hermes' limit. */
export function writeAgentsMd(project: Project, stack: Stack, context: string): void {
  const block = render(readFileSync(join(TEMPLATES, "core/AGENTS.block.md"), "utf8"), templateVars(stack, project.root, context));
  const text = project.block("AGENTS.md", block, (l) => l.startsWith("<!-- basekit:start"), "<!-- basekit:end -->");
  if (text.length > AGENTS_MD_WARN) {
    project.report("!", "AGENTS.md", `${text.length} caracteres: Hermes trunca a partir de 20.000`);
  }
}
