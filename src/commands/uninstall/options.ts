import { UsageError } from "../../kit/errors.js";

export type UninstallMode = "global" | "project";

export interface UninstallOptions {
  /** Undefined: detected from where the running basekit lives. */
  mode?: UninstallMode;
  /** Also remove the global skills of `init --global` (listed in ~/.agents/basekit.json). */
  skills: boolean;
  yes: boolean;
  dryRun: boolean;
}

export function validateUninstall(o: { global?: boolean; project?: boolean }): Pick<UninstallOptions, "mode"> {
  if (o.global && o.project) throw new UsageError("Usa --global o --project, no los dos");
  return { mode: o.global ? "global" : o.project ? "project" : undefined };
}
