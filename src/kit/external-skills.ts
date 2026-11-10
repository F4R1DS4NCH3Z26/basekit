import type { Runner } from "../infra/runner.js";
import { AGENTS } from "./agents.js";
import { UsageError } from "./errors.js";
import { EXTERNAL_SKILLS } from "./manifest.js";
import type { Project } from "./project.js";

const TELEMETRY_OFF = { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" };

/** The value of `--external-skills` that chooses no external skill. */
export const NO_EXTERNAL = "none";

/**
 * Validates `--external-skills` (S4) before anything touches the disk: undefined when it was not given;
 * otherwise the pinned names it lists (comma-separated, case-sensitive), in pinned order without duplicates,
 * or [] for `none` alone. `skip` is `--no-external-skills`, which it cannot be combined with.
 */
export function parseExternalSkills(raw: string | undefined, skip: boolean): string[] | undefined {
  if (raw === undefined) return undefined;
  if (skip) throw new UsageError("--external-skills y --no-external-skills no se combinan");
  const names = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (names.includes(NO_EXTERNAL)) {
    if (names.every((n) => n === NO_EXTERNAL)) return [];
    throw new UsageError(`--external-skills ${NO_EXTERNAL} no se combina con otras skills`);
  }
  const bad = names.filter((n) => !EXTERNAL_SKILLS.skills.includes(n));
  if (names.length === 0 || bad.length > 0) {
    throw new UsageError(
      `--external-skills '${bad.join(",") || raw}' no es una skill externa. Disponibles: ${EXTERNAL_SKILLS.skills.join(", ")}`,
    );
  }
  return EXTERNAL_SKILLS.skills.filter((s) => names.includes(s));
}

export function externalArgs(agents: string[], skills: string[] = EXTERNAL_SKILLS.skills): string[] {
  const { cli, source, ref } = EXTERNAL_SKILLS;
  return ["-y", cli, "add", `${source}/tree/${ref}`, "-s", ...skills, "-a", ...agents, "-y"];
}

/** The given external skills (by default, all the pinned ones) that are not in `.agents/skills/`. */
export const missingExternal = (project: Project, skills: string[] = EXTERNAL_SKILLS.skills) =>
  skills.filter((s) => !project.exists(`.agents/skills/${s}/SKILL.md`));

/**
 * Installs the chosen external skills (spec 02 §9; by default all the pinned ones) when any is missing,
 * or for new agents when `reinstall` is set. Nothing runs when none was chosen or there is no agent
 * (the skills CLI needs `-a`). A failure never aborts: it prints the command to retry.
 */
export function installExternalSkills(
  project: Project,
  agents: string[],
  log: (line: string) => void,
  runner: Runner,
  reinstall: boolean,
  skills: string[] = EXTERNAL_SKILLS.skills,
): void {
  if (skills.length === 0) {
    project.report("=", "skills externas", "ninguna elegida");
    return;
  }
  const names = skills.join(", ");
  const missing = missingExternal(project, skills);
  if (missing.length === 0 && !reinstall) {
    project.report("=", "skills externas", names);
    return;
  }
  if (agents.length === 0) {
    project.report("!", "skills externas", "sin agentes: se instalan cuando agregues uno con basekit sync --agents <a,b>");
    return;
  }
  // `skills` writes into these folders itself, so it must not run if one of them leads outside the project.
  const targets = [".agents/skills", ...AGENTS.filter((a) => a.skillsDir && agents.includes(a.id)).map((a) => a.skillsDir!)];
  const escaping = targets.filter((t) => project.escapes(t));
  if (escaping.length > 0) {
    project.report("!", "skills externas", `no se instalan: ${escaping.join(", ")} está fuera del proyecto por un enlace simbólico`);
    return;
  }
  const args = externalArgs(agents, skills);
  if (project.dryRun) {
    log(`· ejecutaría: npx ${args.join(" ")}`);
    return;
  }
  const ok = runner.run(log, "npx", args, project.root, TELEMETRY_OFF);
  const still = missingExternal(project, skills);
  if (ok && still.length === 0) {
    project.report(missing.length > 0 ? "+" : "~", "skills externas", names);
  } else {
    const retry = `DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx ${args.join(" ")}`;
    project.report("!", "skills externas", `no se instalaron${still.length ? ` (${still.join(", ")})` : ""}; reinténtalo con: ${retry}`);
  }
}
