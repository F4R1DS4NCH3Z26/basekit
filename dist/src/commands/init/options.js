import { parseAgents } from "../../kit/agents.js";
import { UsageError } from "../../kit/errors.js";
import { parseExternalSkills } from "../../kit/external-skills.js";
import { resolveParts } from "../../kit/layout.js";
import { hasDatabase } from "../../kit/stacks.js";
export const DBS = ["auto", "postgres", "mysql", "sqlite", "mongo", "none"];
/** The engines the interactive database question offers (S1), in its order; PostgreSQL is the default. */
export const DB_CHOICES = [
    { id: "mysql", label: "MySQL", hint: "mysql" },
    { id: "sqlite", label: "SQLite", hint: "sqlite" },
    { id: "postgres", label: "PostgreSQL", hint: "postgres" },
    { id: "mongo", label: "MongoDB", hint: "mongo" },
];
export const DEFAULT_DB_CHOICE = "postgres";
export function checkDb(db) {
    if (!DBS.includes(db))
        throw new UsageError(`--db '${db}' no es válido. Valores: ${DBS.join(", ")}`);
    return db;
}
/** Validates every flag against its whitelist before anything touches the disk; returns the parsed agents and external skills. */
export function validateFlags(o, stacks) {
    if (o.stack !== undefined)
        resolveParts(stacks, o.stack.trim());
    const agents = o.agents !== undefined ? parseAgents(o.agents) : undefined;
    if (o.db !== undefined)
        checkDb(o.db);
    const externalSkills = parseExternalSkills(o.externalChoice, !o.externalSkills);
    return { agents, externalSkills };
}
/**
 * S1b: a frontend stack has no database. `--db` other than auto/none and `--redis` are usage errors
 * for it; returns the engine to record (auto becomes none).
 */
export function checkStackDb(stack, db, redisFlag) {
    if (hasDatabase(stack))
        return db;
    if (db !== "auto" && db !== "none") {
        throw new UsageError(`--db '${db}' no aplica a ${stack.id}: un stack frontend no tiene base de datos (usa --db none o quita --db)`);
    }
    if (redisFlag)
        throw new UsageError(`--redis no aplica a ${stack.id}: un stack frontend no tiene base de datos ni Redis (quita --redis)`);
    return "none";
}
