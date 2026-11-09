import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./errors.js";
import { TEMPLATES } from "./templates.js";
/** The kinds of app a stack builds (S1b). A frontend stack has no database. */
export const KINDS = ["backend", "frontend", "fullstack"];
const ID = /^[a-z0-9][a-z0-9-]*$/;
/** Every stack, sorted by id (that is also the detection order). */
export function loadStacks(dir = join(TEMPLATES, "stacks")) {
    return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
        .map((name) => {
        const s = JSON.parse(readFileSync(join(dir, name, "stack.json"), "utf8"));
        const valid = s.id === name &&
            ID.test(s.id) &&
            typeof s.name === "string" &&
            typeof s.language === "string" &&
            s.language.trim() !== "" &&
            KINDS.includes(s.kind) &&
            typeof s.health === "string" &&
            s.health.startsWith("/") &&
            Number.isInteger(s.port) &&
            typeof s.detect === "object" &&
            Array.isArray(s.roles) &&
            Array.isArray(s.skills) &&
            s.skills.every((r) => Array.isArray(r) && r.length === 2);
        if (!valid)
            throw new Error(`stack.json inválido: stacks/${name}/stack.json`);
        return s;
    });
}
/** S1b: a frontend stack has no database, so neither a database engine nor Redis applies to it. */
export function hasDatabase(stack) {
    return stack.kind !== "frontend";
}
export function stackDir(stack) {
    return join(TEMPLATES, "stacks", stack.id);
}
/** The stack with that id, or a usage error listing the available ones. */
export function findStack(stacks, id) {
    const s = stacks.find((x) => x.id === id);
    if (!s)
        throw new UsageError(`--stack '${id}' no existe. Disponibles: ${stacks.map((x) => x.id).join(", ")}`);
    return s;
}
/** Spec 02 §6: any of detect.files exists, or detect.manifest exists and contains detect.contains. First match wins. */
export function detectStack(stacks, project) {
    return stacks.find((s) => {
        if ((s.detect.files ?? []).some((f) => project.exists(f)))
            return true;
        const { manifest, contains } = s.detect;
        if (!manifest || !contains || !project.isFile(manifest))
            return false;
        return (project.read(manifest) ?? "").includes(contains);
    });
}
