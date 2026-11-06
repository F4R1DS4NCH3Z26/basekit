/** A mistake in how the CLI was called (bad flag or value). The CLI exits with code 2. */
export class UsageError extends Error {
}
/** The user cancelled an interactive question (Ctrl+C, Esc, Ctrl+D or end of input). Exit code 130, like a shell. */
export class CancelledError extends Error {
    constructor() {
        super("Cancelado.");
    }
}
/** How the CLI reports an error: exit code and the line for stderr. */
export function failure(err) {
    if (err instanceof CancelledError)
        return { code: 130, message: err.message };
    const parse = err instanceof TypeError && "code" in err && String(err.code).startsWith("ERR_PARSE_ARGS");
    const message = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    return { code: err instanceof UsageError || parse ? 2 : 1, message };
}
