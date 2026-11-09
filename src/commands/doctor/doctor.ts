import { join } from "node:path";
import { AGENTS } from "../../kit/agents.js";
import { AGENTS_MD_WARN } from "../../kit/agents-md.js";
import { missingExternal } from "../../kit/external-skills.js";
import { inPart, isCombined, partsOf } from "../../kit/layout.js";
import { EXTERNAL_SKILLS, MANIFEST, readManifest } from "../../kit/manifest.js";
import { Project, resolveRoot } from "../../kit/project.js";
import { loadStacks, stackDir } from "../../kit/stacks.js";
import { TEMPLATES, walk } from "../../kit/templates.js";
import type { Context } from "../context.js";

const skillNames = (dir: string) => [...new Set(walk(dir).map((f) => f.split("/")[0]!))];

/** Spec 02 §11. Read-only: prints OK or FALTA with a suggestion; exits 1 if anything is missing. */
export function doctor(dir: string | undefined, ctx: Context): number {
  const project = new Project(resolveRoot(dir), true, () => {}, ctx.fs);
  let missing = 0;
  const check = (ok: boolean, label: string, hint: string) => {
    if (!ok) missing++;
    ctx.log(ok ? `OK    ${label}` : `FALTA ${label}  → ${hint}`);
  };

  const node = Number(process.versions.node.split(".")[0]);
  check(node >= 20, `Node ≥ 20 (v${process.versions.node})`, "instala Node 20 o superior");
  check(ctx.runner.works("git", ["--version"]), "git", "instala git");
  check(ctx.runner.works("docker", ["--version"]), "docker", "instala Docker");
  check(ctx.runner.works("docker", ["compose", "version"]), "docker compose (plugin v2 o superior)", "instala el plugin Compose v2");
  check(ctx.runner.works("make", ["--version"]), "make", "instala GNU Make");
  check(ctx.runner.works("openssl", ["version"]), "openssl", "instala OpenSSL (lo usa make env)");

  const manifest = readManifest(project);
  check(manifest !== undefined, MANIFEST, "ejecuta `basekit init`");
  const parts = partsOf(loadStacks(), manifest?.stack);
  if (!manifest || !parts) {
    if (manifest) check(false, `stack '${manifest.stack ?? ""}'`, "el manifest apunta a un stack que esta versión no conoce");
    return 1;
  }

  const agentsMd = project.read("AGENTS.md") ?? "";
  const hasBlock = agentsMd.includes("<!-- basekit:start") && agentsMd.includes("<!-- basekit:end -->");
  check(hasBlock && agentsMd.length <= AGENTS_MD_WARN, `AGENTS.md (bloque de basekit, ${agentsMd.length} caracteres)`,
    hasBlock ? "acórtalo: Hermes trunca a partir de 20.000" : "ejecuta `basekit sync`");

  // A combined project (S16): the root Makefile delegates, and each side is a complete project of its stack.
  if (isCombined(parts)) check(project.exists("Makefile"), "Makefile (raíz)", "ejecuta `basekit init`");
  for (const part of parts) {
    for (const f of ["Makefile", ".make/stack.mk", "Dockerfile", "compose.yaml", "compose.dev.yaml", "compose.prod.yaml", ".env.example"]) {
      check(project.exists(inPart(part, f)), inPart(part, f), "ejecuta `basekit init`");
    }
    const marker = part.stack.appMarker;
    if (marker) {
      check(project.exists(inPart(part, marker)), `${inPart(part, marker)} (app del framework)`,
        `ejecuta \`${part.side ? `make -C ${part.side} new-app` : "make new-app"}\``);
    }
  }

  const kit = [...skillNames(join(TEMPLATES, "skills")), ...parts.flatMap((p) => skillNames(join(stackDir(p.stack), "skills")))];
  for (const s of kit) check(project.exists(`.agents/skills/${s}/SKILL.md`), `.agents/skills/${s}/SKILL.md`, "ejecuta `basekit init`");
  for (const part of parts.filter((p) => p.side)) {
    for (const s of skillNames(join(stackDir(part.stack), "skills"))) {
      const f = inPart(part, `.agents/skills/${s}/SKILL.md`);
      check(project.exists(f), f, "ejecuta `basekit init` (make verify la lee dentro de Docker)");
    }
  }
  const absent = new Set(missingExternal(project));
  for (const s of EXTERNAL_SKILLS.skills) {
    check(!absent.has(s), `.agents/skills/${s}/SKILL.md (externa)`, "ejecuta `basekit sync`");
  }

  const skills = project.dirs(".agents/skills");
  for (const agent of AGENTS) {
    if (!agent.skillsDir || !manifest.agents?.includes(agent.id)) continue;
    const dirs = agent.skillsDir;
    const unlinked = skills.filter((s) => !project.exists(`${dirs}/${s}/SKILL.md`));
    check(unlinked.length === 0, `${dirs} (enlaces de ${agent.id})`, `faltan ${unlinked.join(", ")}: ejecuta \`basekit sync\``);
  }

  const hermesFiles = [".hermes.md", "HERMES.md"].filter((f) => project.exists(f));
  check(hermesFiles.length === 0, "Hermes: sin .hermes.md ni HERMES.md",
    `borra ${hermesFiles.join(" y ")}: Hermes lo carga en lugar de AGENTS.md`);
  // Only existence is checked: basekit never reads .env.
  for (const part of parts) check(project.exists(inPart(part, ".env")), inPart(part, ".env"), "ejecuta `make env`");
  return missing > 0 ? 1 : 0;
}
