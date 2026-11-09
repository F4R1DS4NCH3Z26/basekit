import { existsSync } from "node:fs";
import { join } from "node:path";
import { AGENTS } from "./agents.js";
import { roleFiles, zoneFiles } from "./layout.js";
import { stackDir } from "./stacks.js";
import { TEMPLATES, walk } from "./templates.js";
const ROLE_NAME = /^[a-z0-9][a-z0-9-]*$/;
function unquote(value) {
    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        }
        catch {
            return value.slice(1, -1);
        }
    }
    return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : value;
}
function parseRole(name, text) {
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
    const meta = {};
    for (const line of (m?.[1] ?? "").split("\n")) {
        const i = line.indexOf(":");
        if (i > 0)
            meta[line.slice(0, i).trim()] = unquote(line.slice(i + 1).trim());
    }
    const body = m ? m[2] : text;
    return { name, description: meta.description || name, body: body.endsWith("\n") ? body : `${body}\n` };
}
/** Roles from the project's `.agents/roles/`, or the ones init would write when it does not exist yet (dry-run). */
function readRoles(project, parts) {
    const own = project.files(".agents/roles").filter((f) => f.endsWith(".md"));
    const fromProject = own.length > 0 || project.exists(".agents/roles");
    const kit = new Map(roleFiles(parts).filter((f) => f.rel.endsWith(".md") && !f.rel.includes("/")).map((f) => [f.rel, f.text]));
    const names = fromProject ? own : [...kit.keys()].sort();
    return names
        .map((f) => f.slice(0, -3))
        .filter((n) => ROLE_NAME.test(n))
        .map((n) => parseRole(n, fromProject ? project.read(`.agents/roles/${n}.md`) : kit.get(`${n}.md`)));
}
function readZones(project, parts, role) {
    const own = project.read(`.agents/zones/${role}.txt`);
    const text = own ?? zoneFiles(parts).find((f) => f.rel === `${role}.txt`)?.text ?? "";
    return [...new Set(text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")))];
}
const generatedBy = (role) => `<!-- Generado por basekit desde .agents/roles/${role}.md — edita ese archivo y ejecuta \`npx --no-install basekit sync\` -->`;
function claudeAgent(r) {
    return [
        "---",
        `name: ${r.name}`,
        `description: ${JSON.stringify(r.description)}`,
        "tools: Read, Edit, Write, Grep, Glob, Bash",
        "model: sonnet",
        "---",
        generatedBy(r.name),
        r.body,
    ].join("\n");
}
const OPENCODE_BASH = [
    ["*", "ask"], ["make verify*", "allow"], ["make test*", "allow"], ["make lint*", "allow"],
    ["git status*", "allow"], ["git diff*", "allow"], ["bash .agents/skills/*", "allow"],
];
/** Zones become real edit permissions; every pattern is a JSON string, which is valid YAML. */
function opencodeAgent(r, zones) {
    return [
        "---",
        `description: ${JSON.stringify(r.description)}`,
        "mode: subagent",
        "permission:",
        "  edit:",
        '    "*": deny',
        ...zones.map((z) => `    ${JSON.stringify(z)}: allow`),
        "  bash:",
        ...OPENCODE_BASH.map(([p, v]) => `    ${JSON.stringify(p)}: ${v}`),
        "  webfetch: deny",
        "---",
        generatedBy(r.name),
        r.body,
    ].join("\n");
}
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
function claudeSettings(parts) {
    const scaffolds = parts.flatMap(({ stack }) => stack.skills
        .map(([name]) => name)
        .filter((name) => existsSync(join(stackDir(stack), "skills", name, "scripts/scaffold.sh")))
        .map((name) => `Bash(bash .agents/skills/${name}/scripts/scaffold.sh:*)`));
    return json({
        permissions: {
            allow: [
                "Bash(make help:*)", "Bash(make verify:*)", "Bash(make test:*)", "Bash(make lint:*)", "Bash(make ps:*)",
                "Bash(make logs:*)", "Bash(make doctor:*)", "Bash(git status:*)", "Bash(git diff:*)",
                "Bash(bash .agents/skills/zone-check/scripts/check_zones.sh:*)", ...scaffolds,
            ],
            ask: [
                "Bash(make dev:*)", "Bash(make up:*)", "Bash(make migrate:*)", "Bash(make migration:*)", "Bash(make install:*)",
                "Bash(make new-app:*)", "Bash(make deps-add:*)", "Bash(make prod-build:*)", "Bash(make prod-up:*)",
                "Bash(make prod-migrate:*)", "Bash(bash .agents/skills/infra-setup/scripts/infra.sh:*)",
                "Bash(docker:*)", "Bash(npx:*)", "Bash(git commit:*)", "Bash(git checkout:*)",
            ],
            // Secrets are listed one by one: `Read(./.env.*)` would also block .env.example (deny wins over allow).
            deny: [
                "Read(./.env)", "Read(./.env.prod)", "Read(./.env.local)", "Read(./.env.production)", "Read(./.env.*.local)",
                "Edit(./.env)", "Edit(./.env.prod)", "Edit(./.env.local)", "Edit(./.env.production)",
                "Read(./**/*.pem)", "Read(./**/*.key)", "Bash(make clean:*)", "Bash(git push:*)", "Bash(rm -rf:*)",
                "Bash(curl:*)", "Bash(wget:*)", "Bash(sudo:*)", "Bash(cat .env:*)",
            ],
        },
    });
}
const OPENCODE_JSON = json({
    $schema: "https://opencode.ai/config.json",
    permission: {
        // In OpenCode the last matching rule wins, so *.env.example reopens what *.env.* closes.
        read: { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
        edit: { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
        bash: {
            "*": "ask", "make help*": "allow", "make verify*": "allow", "make test*": "allow", "make lint*": "allow",
            "git status*": "allow", "git diff*": "allow", "bash .agents/skills/*": "allow",
            "make clean*": "deny", "git push*": "deny", "rm -rf*": "deny", "curl *": "deny", "wget *": "deny", "sudo *": "deny",
        },
    },
});
const GEMINI_JSON = json({ context: { fileName: ["AGENTS.md"] } });
function claudeMd(project) {
    const cur = project.read("CLAUDE.md");
    if (cur === undefined)
        project.generated("CLAUDE.md", "@AGENTS.md\n");
    else if (cur.split("\n").some((l) => l.trim() === "@AGENTS.md"))
        project.report("=", "CLAUDE.md");
    else
        project.generated("CLAUDE.md", `@AGENTS.md\n\n${cur}`);
}
/** Generated subagents are rewritten when they differ; config files are created only if missing. */
export function writeAdapters(project, parts, agents) {
    const roles = readRoles(project, parts);
    if (agents.includes("claude-code")) {
        claudeMd(project);
        for (const r of roles)
            project.generated(`.claude/agents/${r.name}.md`, claudeAgent(r));
        project.create(".claude/settings.json", claudeSettings(parts));
    }
    if (agents.includes("opencode")) {
        for (const r of roles)
            project.generated(`.opencode/agents/${r.name}.md`, opencodeAgent(r, readZones(project, parts, r.name)));
        project.create("opencode.json", OPENCODE_JSON);
    }
    if (agents.includes("gemini-cli"))
        project.create(".gemini/settings.json", GEMINI_JSON);
    // Hermes reads AGENTS.md from the cwd: it gets no instruction file of its own (never .hermes.md).
}
/** Links every skill in `.agents/skills/` into the folders of the tools that do not read it natively. */
export function linkSkills(project, parts, agents) {
    const kit = [join(TEMPLATES, "skills"), ...parts.map((p) => join(stackDir(p.stack), "skills"))].flatMap((dir) => walk(dir).map((f) => f.split("/")[0]));
    const skills = [...new Set([...project.dirs(".agents/skills"), ...kit])].sort();
    for (const agent of AGENTS) {
        if (!agent.skillsDir || !agents.includes(agent.id))
            continue;
        for (const s of skills)
            project.link(`${agent.skillsDir}/${s}`, `.agents/skills/${s}`);
    }
}
