import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./errors.js";
import type { Project } from "./project.js";
import { TEMPLATES } from "./templates.js";

/** The kinds of app a stack builds (S1b). A frontend stack has no database. */
export const KINDS = ["backend", "frontend", "fullstack"] as const;
export type Kind = (typeof KINDS)[number];

/** The database engines a stack can accept (S6): what a stack.json without `dbs` accepts. */
export const DB_ENGINES = ["postgres", "mysql", "sqlite", "mongo"];

/** `plantillas/stacks/<id>/stack.json` (spec 02 §6). Everything stack-specific lives there, never in code. */
export interface Stack {
  id: string;
  /**
   * Human name, "<language> · <framework> …" ("Python · Flask + SQLAlchemy 2 (API REST ligera)"): the label of the
   * framework question, and how the stack reads in AGENTS.md, the README, init's summary and `basekit stacks`.
   */
  name: string;
  language: string;
  kind: Kind;
  port: number;
  /** Path of the health endpoint (`/health`, `/up`…). */
  health: string;
  /** `priority`: lower is tried first (default DEFAULT_PRIORITY); ties keep the id order. */
  detect: { files?: string[]; manifest?: string; contains?: string; priority?: number };
  appMarker?: string;
  roles: string[];
  skills: [string, string][];
  defaultAuth?: string;
  /** S6: the database engines the stack accepts, a subset of DB_ENGINES; missing means all of them. */
  dbs?: string[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Every stack, sorted by id (that is also the detection order). */
export function loadStacks(dir = join(TEMPLATES, "stacks")): Stack[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => {
      const s = JSON.parse(readFileSync(join(dir, name, "stack.json"), "utf8")) as Stack;
      const valid =
        s.id === name &&
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
      if (!valid) throw new Error(`stack.json inválido: stacks/${name}/stack.json`);
      return s;
    });
}

/** S6: the engines a stack accepts: its `dbs`, or every engine. */
export function dbEngines(stack: Stack): string[] {
  return stack.dbs ?? DB_ENGINES;
}

/** S1b: a frontend stack has no database, so neither a database engine nor Redis applies to it. */
export function hasDatabase(stack: Stack): boolean {
  return stack.kind !== "frontend";
}

export function stackDir(stack: Stack): string {
  return join(TEMPLATES, "stacks", stack.id);
}

/** The stack with that id, or a usage error listing the available ones. */
export function findStack(stacks: Stack[], id: string): Stack {
  const s = stacks.find((x) => x.id === id);
  if (!s) throw new UsageError(`--stack '${id}' no existe. Disponibles: ${stacks.map((x) => x.id).join(", ")}`);
  return s;
}

const DEFAULT_PRIORITY = 50;

/**
 * Spec 02 §6: any of detect.files exists, or detect.manifest exists and contains detect.contains. Stacks are tried by
 * detect.priority, then by id, and the first match wins: a project that carries the markers of two stacks (Spring Boot
 * with a Vite React package.json) goes to the one with the stronger signal, whatever their ids.
 */
export function detectStack(stacks: Stack[], project: Project): Stack | undefined {
  const rank = (s: Stack) => s.detect.priority ?? DEFAULT_PRIORITY;
  const ordered = [...stacks].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  return ordered.find((s) => {
    if ((s.detect.files ?? []).some((f) => project.exists(f))) return true;
    const { manifest, contains } = s.detect;
    if (!manifest || !contains || !project.isFile(manifest)) return false;
    return (project.read(manifest) ?? "").includes(contains);
  });
}
