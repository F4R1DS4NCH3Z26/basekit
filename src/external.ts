import { AGENTS } from "./agents.js";
import { EXTERNAL_SKILLS } from "./manifest.js";
import type { Project } from "./project.js";
import { run } from "./run.js";

const TELEMETRY_OFF = { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" };

export function externalArgs(agents: string[]): string[] {
  const { cli, source, ref, skills } = EXTERNAL_SKILLS;
  return ["-y", cli, "add", `${source}/tree/${ref}`, "-s", ...skills, "-a", ...agents, "-y"];
}

export const missingExternal = (project: Project) =>
  EXTERNAL_SKILLS.skills.filter((s) => !project.exists(`.agents/skills/${s}/SKILL.md`));

/**
 * Installs the pinned external skills (spec 02 §9) when any is missing, or for new agents
 * when `reinstall` is set. A failure never aborts: it prints the command to retry.
 */
export function installExternalSkills(project: Project, agents: string[], log: (line: string) => void, reinstall: boolean): void {
  const names = EXTERNAL_SKILLS.skills.join(", ");
  const missing = missingExternal(project);
  if (missing.length === 0 && !reinstall) {
    project.report("=", "skills externas", names);
    return;
  }
  // `skills` writes into these folders itself, so it must not run if one of them leads outside the project.
  const targets = [".agents/skills", ...AGENTS.filter((a) => a.skillsDir && agents.includes(a.id)).map((a) => a.skillsDir!)];
  const escaping = targets.filter((t) => project.escapes(t));
  if (escaping.length > 0) {
    project.report("!", "skills externas", `no se instalan: ${escaping.join(", ")} está fuera del proyecto por un enlace simbólico`);
    return;
  }
  const args = externalArgs(agents);
  if (project.dryRun) {
    log(`· ejecutaría: npx ${args.join(" ")}`);
    return;
  }
  const ok = run(log, "npx", args, project.root, TELEMETRY_OFF);
  const still = missingExternal(project);
  if (ok && still.length === 0) {
    project.report(missing.length > 0 ? "+" : "~", "skills externas", names);
  } else {
    const retry = `DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx ${args.join(" ")}`;
    project.report("!", "skills externas", `no se instalaron${still.length ? ` (${still.join(", ")})` : ""}; reinténtalo con: ${retry}`);
  }
}
