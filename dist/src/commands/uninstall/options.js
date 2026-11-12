import { UsageError } from "../../kit/errors.js";
export function validateUninstall(o) {
    if (o.global && o.project)
        throw new UsageError("Usa --global o --project, no los dos");
    return { mode: o.global ? "global" : o.project ? "project" : undefined };
}
