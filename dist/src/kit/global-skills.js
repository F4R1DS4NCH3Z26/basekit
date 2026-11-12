import { posix } from "node:path";
import { AGENTS } from "./agents.js";
/** The manifest of a global install (`basekit init --global` of basekit-go), relative to the home directory. */
export const GLOBAL_MANIFEST = ".agents/basekit.json";
/** The single copy of every global skill, relative to the home directory. */
const CANONICAL = ".agents/skills";
/**
 * Reads the global manifest from `home` (a Project rooted at the home directory) and works out what
 * basekit installed there. Undefined when there is no global install. Only paths the manifest lists under
 * ~/.agents/skills count, so the user's own skills are never part of it.
 */
export function findGlobalSkills(home) {
    const text = home.read(GLOBAL_MANIFEST);
    if (text === undefined)
        return undefined;
    let listed;
    try {
        listed = JSON.parse(text).files;
    }
    catch {
        throw new Error(`${GLOBAL_MANIFEST} no es JSON válido; corrígelo o bórralo antes de continuar`);
    }
    const files = Object.keys(listed && typeof listed === "object" ? listed : {})
        .map((f) => posix.normalize(f.replaceAll("\\", "/")))
        .filter((f) => f.startsWith(`${CANONICAL}/`) && f.split("/").length > 3 && !f.split("/").includes(".."))
        .sort();
    const names = [...new Set(files.map((f) => f.split("/")[2]))];
    const links = AGENTS.filter((a) => a.globalSkillsDir !== CANONICAL).flatMap((a) => names.map((n) => `${a.globalSkillsDir}/${n}`).filter((l) => home.linksTo(l, `${CANONICAL}/${l.split("/").at(-1)}`)));
    return { files, dirs: names.map((n) => `${CANONICAL}/${n}`), links, manifest: GLOBAL_MANIFEST };
}
/** Removes the links first, then the listed files, the skill folders left empty and the manifest. */
export function removeGlobalSkills(home, g) {
    for (const l of g.links)
        home.remove(l);
    for (const f of g.files)
        home.remove(f);
    for (const d of g.dirs)
        home.removeEmptyDirs(d);
    home.remove(g.manifest);
}
