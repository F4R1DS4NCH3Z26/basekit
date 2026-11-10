import { UsageError } from "./errors.js";
import type { Project } from "./project.js";

/**
 * Supported tools (guide 03 §1). `detect` lists the project paths that reveal each one;
 * `skillsDir` is set only for tools that do not read `.agents/skills/` natively.
 */
export const AGENTS: { id: string; detect: string[]; skillsDir?: string }[] = [
  { id: "claude-code", detect: [".claude", "CLAUDE.md"], skillsDir: ".claude/skills" },
  { id: "opencode", detect: [".opencode", "opencode.json"] },
  { id: "codex", detect: [] },
  { id: "cursor", detect: [".cursor"] },
  { id: "gemini-cli", detect: [".gemini"] },
  { id: "github-copilot", detect: [] },
  { id: "hermes-agent", detect: [".hermes"], skillsDir: ".hermes/skills" },
];

export const DEFAULT_AGENTS = ["claude-code", "opencode"];

/** The agents a manifest recorded; an empty list is a decided "none", not a missing answer. */
export const savedAgents = (saved: string[] | undefined): string[] | undefined =>
  saved === undefined ? undefined : saved.length > 0 ? parseAgents(saved.join(",")) : [];

export function detectAgents(project: Project): string[] {
  return AGENTS.filter((a) => a.detect.some((p) => project.exists(p))).map((a) => a.id);
}

/** The value of `--agents` that chooses no tool: only the shared AGENTS.md and `.agents/` are written. */
export const NO_AGENTS = "none";

/** Parses a comma-separated list against the whitelist, keeping the canonical order; `none` alone means no agents. */
export function parseAgents(raw: string): string[] {
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.includes(NO_AGENTS)) {
    if (ids.every((id) => id === NO_AGENTS)) return [];
    throw new UsageError(`--agents ${NO_AGENTS} no se combina con otros agentes`);
  }
  const known = new Set(AGENTS.map((a) => a.id));
  const bad = ids.filter((id) => !known.has(id));
  if (ids.length === 0 || bad.length > 0) {
    throw new UsageError(
      `--agents '${bad.join(",") || raw}' no es un agente soportado. Soportados: ${[...known].join(", ")}`,
    );
  }
  return AGENTS.map((a) => a.id).filter((id) => ids.includes(id));
}
