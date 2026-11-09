import { parseAgents } from "../../kit/agents.js";
import { UsageError } from "../../kit/errors.js";
import { findStack, hasDatabase, type Stack } from "../../kit/stacks.js";

export const DBS = ["auto", "postgres", "mysql", "sqlite", "none"];

export interface InitOptions {
  dir?: string;
  stack?: string;
  agents?: string;
  context?: string;
  db?: string;
  redis?: boolean;
  externalSkills: boolean;
  force: boolean;
  dryRun: boolean;
}

export function checkDb(db: string): string {
  if (!DBS.includes(db)) throw new UsageError(`--db '${db}' no es válido. Valores: ${DBS.join(", ")}`);
  return db;
}

/** Validates every flag against its whitelist before anything touches the disk; returns the parsed agents. */
export function validateFlags(o: InitOptions, stacks: Stack[]): { agents?: string[] } {
  if (o.stack !== undefined) findStack(stacks, o.stack);
  const agents = o.agents !== undefined ? parseAgents(o.agents) : undefined;
  if (o.db !== undefined) checkDb(o.db);
  return { agents };
}

/**
 * S1b: a frontend stack has no database. `--db` other than auto/none and `--redis` are usage errors
 * for it; returns the engine to record (auto becomes none).
 */
export function checkStackDb(stack: Stack, db: string, redisFlag: boolean | undefined): string {
  if (hasDatabase(stack)) return db;
  if (db !== "auto" && db !== "none") {
    throw new UsageError(`--db '${db}' no aplica a ${stack.id}: un stack frontend no tiene base de datos (usa --db none o quita --db)`);
  }
  if (redisFlag) throw new UsageError(`--redis no aplica a ${stack.id}: un stack frontend no tiene base de datos ni Redis (quita --redis)`);
  return "none";
}
