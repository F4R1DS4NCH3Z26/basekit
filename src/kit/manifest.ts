import type { Project } from "./project.js";
import { VERSION } from "./templates.js";

export const MANIFEST = ".agents/manifest.json";

/** Pinned external skills (spec 02 §9). Change only after reviewing the upstream diff. */
export const EXTERNAL_SKILLS = {
  cli: "skills@1.7.4",
  source: "https://github.com/mattpocock/skills",
  ref: "5beb35b040e3de97e54fa9e386d7e42d15c295c2",
  skills: ["grill-me", "grill-with-docs", "grilling", "domain-modeling"],
};

export interface Manifest {
  kit?: string;
  version?: string;
  stack?: string;
  agents?: string[];
  /**
   * `docker`: whether the project uses Docker; missing means yes.
   * `makefile`: whether it also uses the Makefile (only with Docker); missing means yes.
   * `externalSkills`: the pinned external skills the user chose (S1); missing means all of them.
   */
  options?: { db?: string; redis?: boolean; docker?: boolean; makefile?: boolean; externalSkills?: string[]; [k: string]: unknown };
  files?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export function readManifest(project: Project): Manifest | undefined {
  const text = project.read(MANIFEST);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as Manifest;
  } catch {
    throw new Error(`${MANIFEST} no es JSON válido; corrígelo o bórralo antes de continuar`);
  }
}

/**
 * Whether the project uses Docker, the single rule of init, sync and doctor (docker follow-ups S1a). In order:
 * a combined project → yes; `--no-docker` → no; `--docker` → yes; the manifest's `options.docker !== false` (a
 * manifest without it, written before the option existed, is yes and never asked); a first run → the answer of
 * `ask`; otherwise yes. sync and doctor pass no flags.
 */
export function resolveDocker<A = never>(
  c: { combined: boolean; noDocker?: boolean; docker?: boolean; manifest: Manifest | undefined },
  ask?: () => A,
): boolean | A {
  if (c.combined) return true;
  if (c.noDocker) return false;
  if (c.docker) return true;
  if (c.manifest) return c.manifest.options?.docker !== false;
  return ask ? ask() : true;
}

/**
 * S5: whether the project uses the Makefile, the single rule of init, sync and doctor. In order: no Docker → no;
 * a combined project → yes (its root Makefile delegates); `--no-makefile` → no; the manifest's boolean; a manifest
 * without it (written before the option existed) → yes, never asked; a first run → the answer of `ask`; otherwise yes.
 */
export function resolveMakefile<A = never>(
  c: { docker: boolean; combined: boolean; noMakefile?: boolean; manifest: Manifest | undefined },
  ask?: () => A,
): boolean | A {
  if (!c.docker) return false;
  if (c.combined) return true;
  if (c.noMakefile) return false;
  if (c.manifest) return c.manifest.options?.makefile !== false;
  return ask ? ask() : true;
}

const withoutUpdatedAt = ({ updatedAt: _ignored, ...rest }: Manifest) => JSON.stringify(rest);

/** The external skills to install: the persisted choice (only pinned names, in pinned order), or all of them. */
export function chosenExternal(manifest: Manifest | undefined): string[] {
  const chosen = manifest?.options?.externalSkills;
  if (!Array.isArray(chosen)) return EXTERNAL_SKILLS.skills;
  return EXTERNAL_SKILLS.skills.filter((s) => chosen.includes(s));
}

/**
 * Writes the manifest keeping `createdAt` and unknown fields (spec 02 §8).
 * `updatedAt` only moves when something else changed. `externalSkills` is written only when chosen
 * in this run; otherwise the previous choice (if any) is kept.
 */
export function writeManifest(
  project: Project,
  prev: Manifest | undefined,
  data: { stack: string; agents: string[]; db: string; redis: boolean; docker: boolean; makefile: boolean; externalSkills?: string[]; files: Record<string, string> },
): void {
  const now = new Date().toISOString();
  const base = prev ?? {};
  const next: Manifest = {
    ...base,
    kit: "basekit",
    version: VERSION,
    stack: data.stack,
    agents: data.agents,
    options: {
      ...(base.options ?? {}),
      db: data.db,
      redis: data.redis,
      docker: data.docker,
      makefile: data.makefile,
      ...(data.externalSkills ? { externalSkills: data.externalSkills } : {}),
    },
    externalSkills: EXTERNAL_SKILLS,
    files: data.files,
    createdAt: base.createdAt ?? now,
  };
  const same = prev !== undefined && withoutUpdatedAt(prev) === withoutUpdatedAt(next);
  next.updatedAt = same && !project.changed && prev?.updatedAt ? prev.updatedAt : now;
  project.generated(MANIFEST, `${JSON.stringify(next, null, 2)}\n`);
}
