import { UsageError } from "../../kit/errors.js";
/**
 * A package spec, a URL or a path, with no spaces or shell characters: it is passed to npm, which on
 * Windows only starts through a shell, and it must never be read as an npm option.
 */
const SPEC = /^[\w@./~][\w@./:#+~\\-]*$/;
export function validateInstall(o) {
    if (o.global && o.project)
        throw new UsageError("Usa --global o --project, no los dos");
    if (o.from !== undefined && !SPEC.test(o.from)) {
        throw new UsageError(`--from '${o.from}' no es válido: usa un paquete, una URL o una ruta sin espacios`);
    }
    return { mode: o.global ? "global" : o.project ? "project" : undefined, from: o.from };
}
