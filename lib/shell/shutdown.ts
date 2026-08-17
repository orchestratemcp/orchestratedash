/**
 * Running DASH's shutdown so that no single step can prevent the exit (MAR-678).
 *
 * `electron/main.ts` does its cleanup from `before-quit` and `will-quit`
 * listeners. Those are ordinary emitters: a listener that throws takes the
 * exception out through `app.quit()` itself, and the quit does not happen. The
 * app is then a process with no window, holding whatever it holds, until the
 * machine is restarted — `AGENTS.md` forbids killing it, so on Windows that is
 * literally the cost of one thrown error on this path.
 *
 * Every step there is a plausible thrower. The broker stop, the browser
 * teardown, a `safeStorage` call, `closeDb` against a store another process has
 * locked: none of them is a reason to keep DASH alive, and none of them is a
 * reason to skip the steps after it either. So each one runs inside its own
 * boundary, a failure is named rather than swallowed, and the sequence always
 * reaches its end.
 *
 * Deliberately synchronous and Electron-free. `before-quit` and `will-quit` are
 * synchronous events — anything awaited inside them happens after the process is
 * already gone — so a step that returns a promise would be a step that silently
 * does not run. Keeping the type `() => void` says that at the call site.
 */

/** One named piece of teardown. */
export interface ShutdownStep {
  readonly name: string;
  readonly run: () => void;
}

export interface ShutdownOutcome {
  /** Step names that ran without throwing, in order. */
  readonly completed: readonly string[];
  /** Step names that threw, with what they threw, in order. */
  readonly failed: readonly { readonly name: string; readonly detail: string }[];
}

/**
 * Run every step, in order, whatever any of them does.
 *
 * Returns what happened rather than throwing, so the caller can say so on the
 * way out. Failures are logged as they happen instead of only at the end: the
 * step *after* a failure may be the one that never returns, and a log written
 * afterwards would not exist to say which one it was.
 */
export function runShutdownSteps(
  steps: readonly ShutdownStep[],
  log: (line: string) => void,
): ShutdownOutcome {
  const completed: string[] = [];
  const failed: { name: string; detail: string }[] = [];

  for (const step of steps) {
    try {
      step.run();
      completed.push(step.name);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      failed.push({ name: step.name, detail });
      log(`[dash-shell] shutdown step "${step.name}" failed: ${detail}`);
    }
  }

  return { completed, failed };
}

/** One line for the shell log: what ran, and what did not. */
export function describeShutdown(outcome: ShutdownOutcome): string {
  const ran = `${String(outcome.completed.length)} step${outcome.completed.length === 1 ? "" : "s"}`;
  return outcome.failed.length === 0
    ? `${ran} ok`
    : `${ran} ok, failed: ${outcome.failed.map((step) => step.name).join(", ")}`;
}
