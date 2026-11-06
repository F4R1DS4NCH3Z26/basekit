import { UsageError } from "./errors.js";
/**
 * Supported tools (guide 03 §1). `detect` lists the project paths that reveal each one;
 * `skillsDir` is set only for tools that do not read `.agents/skills/` natively.
 */
export const AGENTS = [
    { id: "claude-code", detect: [".claude", "CLAUDE.md"], skillsDir: ".claude/skills" },
    { id: "opencode", detect: [".opencode", "opencode.json"] },
    { id: "codex", detect: [] },
    { id: "cursor", detect: [".cursor"] },
    { id: "gemini-cli", detect: [".gemini"] },
    { id: "github-copilot", detect: [] },
    { id: "hermes-agent", detect: [".hermes"], skillsDir: ".hermes/skills" },
];
export const DEFAULT_AGENTS = ["claude-code", "opencode"];
export function detectAgents(project) {
    return AGENTS.filter((a) => a.detect.some((p) => project.exists(p))).map((a) => a.id);
}
/** Parses a comma-separated list against the whitelist, keeping the canonical order. */
export function parseAgents(raw) {
    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const known = new Set(AGENTS.map((a) => a.id));
    const bad = ids.filter((id) => !known.has(id));
    if (ids.length === 0 || bad.length > 0) {
        throw new UsageError(`--agents '${bad.join(",") || raw}' no es un agente soportado. Soportados: ${[...known].join(", ")}`);
    }
    return AGENTS.map((a) => a.id).filter((id) => ids.includes(id));
}
