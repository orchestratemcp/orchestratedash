/**
 * The host helper's process boundary, and nothing else (MAR-487).
 *
 * Separate from `main.ts` for `runner/standalone.ts`'s reason: a module that
 * calls `process.exit` at import time cannot be driven by a test, and the whole
 * merged bar for this plane is that the real helper is exercised as a local
 * child. `runHelper` returns a number; this is the one place it becomes an exit
 * code.
 */

import { runHelper } from "./main";

void runHelper(process.argv.slice(2)).then(
  (code) => {
    // `stdout.write` may still be draining down a pipe. Exiting on the flush
    // rather than immediately is what stops a one-line answer being lost on the
    // way to an `ssh` session that was about to close.
    process.exitCode = code;
  },
  (error: unknown) => {
    // The message is written to stderr and never to stdout, because stdout is
    // where a caller reads one JSON line and a stack trace there would parse as
    // a malformed answer rather than as a failure.
    process.stderr.write(
      `[host-helper] failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 70; // EX_SOFTWARE
  },
);
