import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./errors.js";
import type { Project } from "./project.js";
import { TEMPLATES } from "./templates.js";

/** `plantillas/stacks/<id>/stack.json` (spec 02 §6). Everything stack-specific lives there, never in code. */
export interface Stack {
  id: string;
  name: string;
  port: number;
  detect: { files?: string[]; manifest?: string; contains?: string };
  appMarker?: string;
  roles: string[];
  skills: [string, string][];
  defaultAuth?: string;
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Every stack, sorted by id (that is also the detection order). */
export function loadStacks(): Stack[] {
  const dir = join(TEMPLATES, "stacks");
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
        Number.isInteger(s.port) &&
        typeof s.detect === "object" &&
        Array.isArray(s.roles) &&
        Array.isArray(s.skills) &&
        s.skills.every((r) => Array.isArray(r) && r.length === 2);
      if (!valid) throw new Error(`stack.json inválido: stacks/${name}/stack.json`);
      return s;
    });
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

/** Spec 02 §6: any of detect.files exists, or detect.manifest exists and contains detect.contains. First match wins. */
export function detectStack(stacks: Stack[], project: Project): Stack | undefined {
  return stacks.find((s) => {
    if ((s.detect.files ?? []).some((f) => project.exists(f))) return true;
    const { manifest, contains } = s.detect;
    if (!manifest || !contains || !project.isFile(manifest)) return false;
    return (project.read(manifest) ?? "").includes(contains);
  });
}
