/**
 * The host helper's process boundary, and nothing else (MAR-487).
 *
 * Separate from `main.ts` for `runner/standalone.ts`'s reason: a module that
 * calls `process.exit` at import time cannot be driven by a test, and the whole
 * merged bar for this plane is that the real helper is exercised as a local
 * child. `runHelper` returns a number; this is the one place it becomes an exit
 * code.
 */

import { helperArgv, runHelper } from "./main";

/*
 * Argv, or the request `sshd` set aside when it ran this instead (MAR-573).
 *
 * With ADR 0009's forced command in the host's allowed-keys file, `sshd` runs
 * this program no matter what DASH asked for and puts DASH's actual request in
 * `SSH_ORIGINAL_COMMAND`. Reading only `process.argv` — which is what this file
 * did — would mean every verb arrived as no verb at all.
 *
 * The resolution itself is in `main.ts` so it can be tested without a process.
 * This file stays what its header says it is: the one place a number becomes an
 * exit code.
 */
void runHelper(helperArgv(process.argv.slice(2), process.env["SSH_ORIGINAL_COMMAND"])).then(
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
