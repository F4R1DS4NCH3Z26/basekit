/** A mistake in how the CLI was called (bad flag or value). The CLI exits with code 2. */
export class UsageError extends Error {
}
/** The user cancelled an interactive question (Ctrl+C). The CLI exits with code 130, like a shell. */
export class CancelledError extends Error {
    constructor() {
        super("Cancelado.");
    }
}
