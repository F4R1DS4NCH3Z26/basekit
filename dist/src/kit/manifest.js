import { VERSION } from "./templates.js";
export const MANIFEST = ".agents/manifest.json";
/** Pinned external skills (spec 02 §9). Change only after reviewing the upstream diff. */
export const EXTERNAL_SKILLS = {
    cli: "skills@1.7.4",
    source: "https://github.com/mattpocock/skills",
    ref: "5beb35b040e3de97e54fa9e386d7e42d15c295c2",
    skills: ["grill-me", "grill-with-docs", "grilling", "domain-modeling"],
};
export function readManifest(project) {
    const text = project.read(MANIFEST);
    if (text === undefined)
        return undefined;
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error(`${MANIFEST} no es JSON válido; corrígelo o bórralo antes de continuar`);
    }
}
const withoutUpdatedAt = ({ updatedAt: _ignored, ...rest }) => JSON.stringify(rest);
/** The external skills to install: the persisted choice (only pinned names, in pinned order), or all of them. */
export function chosenExternal(manifest) {
    const chosen = manifest?.options?.externalSkills;
    if (!Array.isArray(chosen))
        return EXTERNAL_SKILLS.skills;
    return EXTERNAL_SKILLS.skills.filter((s) => chosen.includes(s));
}
/**
 * Writes the manifest keeping `createdAt` and unknown fields (spec 02 §8).
 * `updatedAt` only moves when something else changed. `externalSkills` is written only when chosen
 * in this run; otherwise the previous choice (if any) is kept.
 */
export function writeManifest(project, prev, data) {
    const now = new Date().toISOString();
    const base = prev ?? {};
    const next = {
        ...base,
        kit: "basekit",
        version: VERSION,
        stack: data.stack,
        agents: data.agents,
        options: {
            ...(base.options ?? {}),
            db: data.db,
            redis: data.redis,
            docker: data.docker,
            ...(data.externalSkills ? { externalSkills: data.externalSkills } : {}),
        },
        externalSkills: EXTERNAL_SKILLS,
        files: data.files,
        createdAt: base.createdAt ?? now,
    };
    const same = prev !== undefined && withoutUpdatedAt(prev) === withoutUpdatedAt(next);
    next.updatedAt = same && !project.changed && prev?.updatedAt ? prev.updatedAt : now;
    project.generated(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
}
