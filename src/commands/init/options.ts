import { parseAgents } from "../../kit/agents.js";
import { UsageError } from "../../kit/errors.js";
import { findStack, type Stack } from "../../kit/stacks.js";

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
