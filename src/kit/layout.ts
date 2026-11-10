import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { UsageError } from "./errors.js";
import { findStack, stackDir, type Stack } from "./stacks.js";
import { render, template, walk } from "./templates.js";

/**
 * Where each stack of a project lives (S16). A single stack is one part at the root, exactly as
 * before; a combined project is a backend part in `backend/` plus a frontend part in `frontend/`.
 * The `--stack` value and the manifest's `stack` field share one grammar: `<id>` or `<backend>+<frontend>`.
 */
export const SIDES = ["backend", "frontend"] as const;
export type Side = (typeof SIDES)[number];

export interface Part {
  stack: Stack;
  /** The folder of a combined project's half; undefined for a single stack at the root. */
  side?: Side;
}

const PAIR = "<backend>+<frontend>";

/** The parts of a `--stack` value; any bad id or pair is a usage error. The first part is the one with the database. */
export function resolveParts(stacks: Stack[], spec: string): Part[] {
  const ids = spec.split("+").map((id) => id.trim());
  if (ids.length === 1) return [{ stack: findStack(stacks, ids[0]!) }];
  const list = (side: Side) => stacks.filter((s) => s.kind === side).map((s) => s.id).join(", ");
  const hint = `Backend: ${list("backend")}. Frontend: ${list("frontend")}`;
  if (ids.length !== SIDES.length || ids.some((id) => id === "")) {
    throw new UsageError(`--stack '${spec}' no es válido: un proyecto combinado es ${PAIR} (un stack backend y uno frontend). ${hint}`);
  }
  return SIDES.map((side, i) => {
    const stack = findStack(stacks, ids[i]!);
    if (stack.kind !== side) {
      throw new UsageError(`--stack '${spec}': ${stack.id} es ${stack.kind}, y en ${PAIR} la ${i === 0 ? "primera" : "segunda"} parte es un stack ${side}. ${hint}`);
    }
    return { stack, side };
  });
}

/** The parts of a manifest's `stack`, or undefined when this version does not know it. */
export function partsOf(stacks: Stack[], spec: string | undefined): Part[] | undefined {
  if (!spec) return undefined;
  try {
    return resolveParts(stacks, spec);
  } catch {
    return undefined;
  }
}

/** The value recorded in the manifest: the stack id, or `<backend>+<frontend>`. */
export const specOf = (parts: Part[]) => parts.map((p) => p.stack.id).join("+");

export const isCombined = (parts: Part[]) => parts.some((p) => p.side !== undefined);

/** `rel` inside the part's folder (unchanged for a single stack). */
export const inPart = (part: Part, rel: string) => (part.side ? `${part.side}/${rel}` : rel);

/**
 * infra-setup's script, relative to a part's folder. The script works on the project that holds it, so in a combined
 * project the backend (the part with the database) has its own copy: `backend/.agents/skills/infra-setup/…` (S17).
 */
export const INFRA_SKILL = "infra-setup";
export const INFRA = `.agents/skills/${INFRA_SKILL}/scripts/infra.sh`;

/** The command that creates the framework's app of a part (`make new-app`, or `make -C <side> new-app`). */
export const newAppCommand = (part: Part) => (part.side ? `make -C ${part.side} new-app` : "make new-app");

/** The role name in the project: prefixed by side in a combined project (`backend-data-writer`). */
export const roleIn = (part: Part, role: string) => (part.side ? `${part.side}-${role}` : role);

/** How the project's stack reads in AGENTS.md, the README and init's summary. */
export function displayName(parts: Part[]): string {
  return isCombined(parts) ? parts.map((p) => `${p.stack.name} en ${p.side}/`).join(" + ") : parts[0]!.stack.name;
}

/** A text file the kit writes under a known folder (`rel` relative to it). */
export interface KitFile {
  rel: string;
  text: string;
}

const lines = (text: string) => text.split("\n");
/** Every glob line of a zone file moved under `dir/`; comments and blank lines stay as they are. */
const prefixGlobs = (text: string, dir: string) =>
  lines(text).map((l) => (l.trim() === "" || l.trim().startsWith("#") ? l : `${dir}/${l.trim()}`)).join("\n");
const joined = (a: string, b: string) => (a === "" || a.endsWith("\n") ? a + b : `${a}\n${b}`);

/**
 * `.agents/roles/` of the project. A single stack gets its role files as they are; in a combined project
 * each role is renamed by side and opens with a note on where it works (`core/combo/role.note.md`).
 */
export function roleFiles(parts: Part[]): KitFile[] {
  return parts.flatMap((part) => {
    const dir = join(stackDir(part.stack), "roles");
    return walk(dir).map((rel) => {
      const text = readFileSync(join(dir, rel), "utf8");
      if (!part.side || rel.includes("/") || !rel.endsWith(".md")) return { rel: part.side ? `${part.side}-${rel}` : rel, text };
      const role = rel.slice(0, -3);
      const name = roleIn(part, role);
      const note = render(template("core/combo/role.note.md"), { SIDE: part.side, STACK_NAME: part.stack.name, ROLE: name }).replace(/\n*$/, "\n");
      const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
      const body = (m ? m[2]! : text).split(`.agents/zones/${role}.txt`).join(`.agents/zones/${name}.txt`);
      const meta = m ? m[1]!.replace(/^name:.*$/m, `name: ${name}`) : `name: ${name}`;
      return { rel: `${name}.md`, text: `---\n${meta}\n---\n${note}\n${body}` };
    });
  });
}

/**
 * `.agents/zones/` of the project: one file per role and the orchestrator's, which starts with the common
 * zones. In a combined project every glob of a side is moved under its folder, and the orchestrator also
 * owns each side's project files (the common zones again, under `backend/` and `frontend/`).
 */
export function zoneFiles(parts: Part[]): KitFile[] {
  const common = template("core/zones.orchestrator.common.txt");
  let orchestrator = common;
  const files: KitFile[] = [];
  for (const part of parts) {
    const dir = join(stackDir(part.stack), "zones");
    let own = "";
    for (const rel of walk(dir)) {
      const text = readFileSync(join(dir, rel), "utf8");
      if (rel === "orchestrator.stack.txt") own = text;
      else files.push(part.side ? { rel: `${part.side}-${rel}`, text: prefixGlobs(text, part.side) } : { rel, text });
    }
    orchestrator = part.side
      ? joined(orchestrator, `# ${part.side}/ (${part.stack.name})\n${joined(prefixGlobs(common, part.side), prefixGlobs(own, part.side))}`)
      : joined(orchestrator, own);
  }
  return [...files, { rel: "orchestrator.txt", text: orchestrator }];
}

/** The variables of the API wiring (S16): the frontend's API base URL and the backend's allowed origins. */
const API_URL = "VITE_API_URL";
const CORS = "CORS_ORIGINS";

/** Replaces the value of `key=` in an env file; undefined when the key is not there. */
function setEnv(text: string, key: string, value: string): string | undefined {
  const re = new RegExp(`^${key}=.*$`, "m");
  return re.test(text) ? text.replace(re, `${key}=${value}`) : undefined;
}

/**
 * The `.env.example` of one half of a combined project, wired to the other half: the browser reaches the
 * API through the host (`127.0.0.1:<backend port>`), and the backend allows the frontend's origin.
 * `warning` says what to wire by hand when the stack does not have the variable: init never invents one.
 */
export function wireEnv(parts: Part[], part: Part, text: string): { text: string; warning?: string } {
  const backend = parts.find((p) => p.side === "backend");
  const frontend = parts.find((p) => p.side === "frontend");
  if (!backend || !frontend) return { text };
  const api = `http://127.0.0.1:${backend.stack.port}`;
  const web = `http://127.0.0.1:${frontend.stack.port}`;
  const [key, value, warning] =
    part === frontend
      ? [API_URL, api, `${part.stack.id} no tiene ${API_URL}: apunta el frontend a la API en ${api}`]
      : [CORS, `${web},http://localhost:${frontend.stack.port}`, `${part.stack.id} no tiene ${CORS}: la API debe permitir (CORS) el origen ${web} del frontend`];
  const next = setEnv(text, key, value);
  return next === undefined ? { text, warning } : { text: next };
}

/**
 * The `compose.yaml` of one half of a combined project, with a top-level `name`. Prod uses Compose's default
 * project name, the folder's: every combined project would be called `backend` and `frontend`, so two of them on
 * one server would take over each other's containers and volumes. The name is `<project>-<side>`, normalized
 * like Compose does; dev keeps its own `-p <side>-dev-<checksum>` from the Makefile, which wins over `name`.
 */
export function nameCompose(root: string, part: Part, text: string): string {
  if (!part.side || /^name:/m.test(text)) return text;
  const project = basename(root).toLowerCase().replace(/[^a-z0-9_-]/g, "").replace(/^[-_]+/, "") || "app";
  const rows = lines(text);
  const at = rows.findIndex((l) => l.trim() !== "" && !l.startsWith("#"));
  rows.splice(at < 0 ? rows.length : at, 0, `name: ${project}-${part.side}`);
  return rows.join("\n");
}

