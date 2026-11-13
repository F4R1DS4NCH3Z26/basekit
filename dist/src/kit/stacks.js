import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./errors.js";
import { TEMPLATES } from "./templates.js";
/** The kinds of app a stack builds (S1b). A frontend stack has no database. */
export const KINDS = ["backend", "frontend", "fullstack"];
/** The database engines a stack can list in `dbs` (S6). */
export const DB_ENGINES = ["postgres", "mysql", "sqlite", "mongo"];
/** What a stack.json without `dbs` accepts: the SQL engines. Mongo is opt-in, only where a stack lists it (mongo-support S1). */
export const DEFAULT_DB_ENGINES = ["postgres", "mysql", "sqlite"];
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
            (s.detect.priority === undefined || Number.isInteger(s.detect.priority)) &&
            Array.isArray(s.roles) &&
            Array.isArray(s.skills) &&
            s.skills.every((r) => Array.isArray(r) && r.length === 2) &&
            (s.dbs === undefined || (Array.isArray(s.dbs) && s.dbs.length > 0 && s.dbs.every((d) => DB_ENGINES.includes(d))));
        if (!valid)
            throw new Error(`stack.json inválido: stacks/${name}/stack.json`);
        return s;
    });
}
/** S6: the engines a stack accepts: its `dbs`, or the SQL engines (mongo only when listed). */
export function dbEngines(stack) {
    return stack.dbs ?? DEFAULT_DB_ENGINES;
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
const DEFAULT_PRIORITY = 50;
/**
 * Spec 02 §6: any of detect.files exists, or detect.manifest exists and contains detect.contains. Stacks are tried by
 * detect.priority, then by id, and the first match wins: a project that carries the markers of two stacks (Spring Boot
 * with a Vite React package.json) goes to the one with the stronger signal, whatever their ids.
 */
export function detectStack(stacks, project) {
    const rank = (s) => s.detect.priority ?? DEFAULT_PRIORITY;
    const ordered = [...stacks].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    return ordered.find((s) => {
        if ((s.detect.files ?? []).some((f) => project.exists(f)))
            return true;
        const { manifest, contains } = s.detect;
        if (!manifest || !contains || !project.isFile(manifest))
            return false;
        return (project.read(manifest) ?? "").includes(contains);
    });
}
