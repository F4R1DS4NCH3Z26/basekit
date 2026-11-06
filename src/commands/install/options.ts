import { UsageError } from "../../kit/errors.js";

export type InstallMode = "global" | "project";

export interface InstallOptions {
  dir?: string;
  /** Undefined: ask (interactive) or fail with a hint (non-interactive). */
  mode?: InstallMode;
  /** Package spec to install instead of this package's own repository (a fork, a tag, a local tarball). */
  from?: string;
}

/**
 * A package spec, a URL or a path, with no spaces or shell characters: it is passed to npm, which on
 * Windows only starts through a shell, and it must never be read as an npm option.
 */
const SPEC = /^[\w@./~][\w@./:#+~\\-]*$/;

export function validateInstall(o: { global?: boolean; project?: boolean; from?: string }): Pick<InstallOptions, "mode" | "from"> {
  if (o.global && o.project) throw new UsageError("Usa --global o --project, no los dos");
  if (o.from !== undefined && !SPEC.test(o.from)) {
    throw new UsageError(`--from '${o.from}' no es válido: usa un paquete, una URL o una ruta sin espacios`);
  }
  return { mode: o.global ? "global" : o.project ? "project" : undefined, from: o.from };
}
