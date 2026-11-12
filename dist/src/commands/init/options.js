import { parseAgents } from "../../kit/agents.js";
import { UsageError } from "../../kit/errors.js";
import { parseExternalSkills } from "../../kit/external-skills.js";
import { resolveParts } from "../../kit/layout.js";
import { dbEngines, hasDatabase } from "../../kit/stacks.js";
export const DBS = ["auto", "postgres", "mysql", "sqlite", "mongo", "none"];
/** The engines of the interactive database question (S1), in its order; PostgreSQL is the default. */
const DB_CHOICES = [
    { id: "mysql", label: "MySQL", hint: "mysql" },
    { id: "sqlite", label: "SQLite", hint: "sqlite" },
    { id: "postgres", label: "PostgreSQL", hint: "postgres" },
    { id: "mongo", label: "MongoDB", hint: "mongo" },
];
export const DEFAULT_DB_CHOICE = "postgres";
/** S6: the database question offers only the engines the stack accepts, in the S1 order. */
export function dbChoices(stack) {
    const accepted = dbEngines(stack);
    return DB_CHOICES.filter((c) => accepted.includes(c.id));
}
/** docker follow-ups S3: the error of `--db` other than auto/none or `--redis` without Docker (unchanged text). */
export const NEEDS_DOCKER = "--db y --redis necesitan Docker: no se pueden usar con --no-docker ni sin Docker en el manifest";
/** Whether the flags ask for something only Docker runs: `--db` other than auto/none, or `--redis`. */
export function needsDocker(o) {
    return (o.db !== undefined && o.db !== "auto" && o.db !== "none") || o.redis === true;
}
export function checkDb(db) {
    if (!DBS.includes(db))
        throw new UsageError(`--db '${db}' no es válido. Valores: ${DBS.join(", ")}`);
    return db;
}
/** Validates every flag against its whitelist before anything touches the disk; returns the parsed agents and external skills. */
export function validateFlags(o, stacks) {
    if (o.docker && o.noDocker)
        throw new UsageError("Usa --docker o --no-docker, no los dos");
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
 * for it; returns the engine to record (auto becomes none). S6: an explicit `--db` (`explicit`) must be one
 * of the stack's engines; an engine saved in the manifest is kept as is.
 */
export function checkStackDb(stack, db, redisFlag, explicit) {
    if (hasDatabase(stack)) {
        const accepted = dbEngines(stack);
        if (explicit && db !== "auto" && db !== "none" && !accepted.includes(db)) {
            throw new UsageError(`--db '${db}' no aplica a ${stack.id}: motores admitidos: ${accepted.join(", ")} (o auto, none)`);
        }
        return db;
    }
    if (db !== "auto" && db !== "none") {
        throw new UsageError(`--db '${db}' no aplica a ${stack.id}: un stack frontend no tiene base de datos (usa --db none o quita --db)`);
    }
    if (redisFlag)
        throw new UsageError(`--redis no aplica a ${stack.id}: un stack frontend no tiene base de datos ni Redis (quita --redis)`);
    return "none";
}
