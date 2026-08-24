/**
 * The judgment `scripts/verify-shell.mjs` applies to `shell:smoke`'s output —
 * pure functions over strings, kept apart from the script so `tests/
 * verify-shell.test.ts` can drive them with fixtures instead of spawning
 * Electron. Same split as `scripts/brand-rules.mjs` / `scripts/brand-check.mjs`.
 *
 * MAR-748: `electron/smoke.ts` imports `electron/main.ts`, whose module-level
 * side effect answers a lost single-instance lock with `app.quit()` — a clean
 * exit **0** that runs none of the file's 85 proofs. Before this, `verify-
 * shell.mjs` only looked at that exit code, so `pnpm verify` / `verify:shell`
 * read the silence as green. These functions make "did anything actually run"
 * the question, not "did the child say 0".
 */

/**
 * One line per `check()` call in `electron/smoke.ts`:
 * `${"PASS"|"FAIL"}  ${label}: ${detail}`. Counting these — not parsing them —
 * is deliberately the whole test: a proof harness that changes what it prints
 * per-check should not have to keep this file in sync, only keep emitting a
 * PASS or FAIL line per attempt.
 */
const PROOF_LINE = /^(?:PASS|FAIL) {2}/m;

export function countProofLines(output) {
  const matches = output.match(new RegExp(PROOF_LINE.source, "gm"));
  return matches === null ? 0 : matches.length;
}

/**
 * Verbatim substring of the line `electron/main.ts` now logs at its lock-loss
 * exit (see the comment there, MAR-748). Matched as plain text, not a regex,
 * so punctuation in the userData path can never make this fail to match.
 */
export const LOCK_HELD_MARKER = "single-instance lock already held";

/**
 * The verdict for one `shell:smoke` run, given everything it printed and the
 * exit code it chose.
 *
 * Returns `null` when the run is trustworthy — proofs ran, and the wrapper
 * should judge it purely on `exitStatus` as before. Returns a human-readable
 * reason when it is not: zero proofs ran, so no exit code from this child is
 * evidence of anything and the wrapper must fail regardless of what the child
 * reported.
 */
export function describeSmokeFailure(output, exitStatus) {
  if (countProofLines(output) > 0) {
    return null;
  }
  if (output.includes(LOCK_HELD_MARKER)) {
    return (
      "0 shell proofs ran — another DASH instance holds the single-instance lock " +
      "for this userData. Close it (never force-kill) and re-run. " +
      "(electron/main.ts logged the lock-loss quit; see MAR-748.)"
    );
  }
  return (
    `0 shell proofs ran (electron exited ${String(exitStatus)} having printed no ` +
    "PASS/FAIL line) — treat as a failure, not a pass. See MAR-748."
  );
}
