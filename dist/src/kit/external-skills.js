import { AGENTS } from "./agents.js";
import { EXTERNAL_SKILLS } from "./manifest.js";
const TELEMETRY_OFF = { DISABLE_TELEMETRY: "1", DO_NOT_TRACK: "1" };
export function externalArgs(agents, skills = EXTERNAL_SKILLS.skills) {
    const { cli, source, ref } = EXTERNAL_SKILLS;
    return ["-y", cli, "add", `${source}/tree/${ref}`, "-s", ...skills, "-a", ...agents, "-y"];
}
/** The given external skills (by default, all the pinned ones) that are not in `.agents/skills/`. */
export const missingExternal = (project, skills = EXTERNAL_SKILLS.skills) => skills.filter((s) => !project.exists(`.agents/skills/${s}/SKILL.md`));
/**
 * Installs the chosen external skills (spec 02 §9; by default all the pinned ones) when any is missing,
 * or for new agents when `reinstall` is set. Nothing runs when none was chosen or there is no agent
 * (the skills CLI needs `-a`). A failure never aborts: it prints the command to retry.
 */
export function installExternalSkills(project, agents, log, runner, reinstall, skills = EXTERNAL_SKILLS.skills) {
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
    const targets = [".agents/skills", ...AGENTS.filter((a) => a.skillsDir && agents.includes(a.id)).map((a) => a.skillsDir)];
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
    }
    else {
        const retry = `DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx ${args.join(" ")}`;
        project.report("!", "skills externas", `no se instalaron${still.length ? ` (${still.join(", ")})` : ""}; reinténtalo con: ${retry}`);
    }
}
