import type { FileSystem } from "../infra/file-system.js";
import type { Runner } from "../infra/runner.js";
import type { Prompter } from "../ui/prompt.js";

/** What a command receives from the CLI: output, optional questions and the I/O ports. */
export interface Context {
  log: (line: string) => void;
  /** Present only in an interactive session (a TTY without --yes). */
  prompt?: Prompter;
  fs: FileSystem;
  runner: Runner;
}
