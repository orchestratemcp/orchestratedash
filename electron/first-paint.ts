/**
 * Does DASH's first page ever become a page? **Not part of the shipped shell.**
 *
 * ## Why this is its own harness and not another line in the smoke
 *
 * `electron/smoke.ts` is the mandatory release gate, and `scripts/verify-shell.mjs`
 * runs it with `DASH_SHELL_URL=dash-app://ui/` — deliberately, so that the gate
 * depends on this repository and this machine and not on a developer having a
 * dev server up (ADR 0004). That decision is right and is not changed here. Its
 * consequence is that **the mandatory gate has never loaded the developer
 * path**, which is the path a person uses every day, and is where the empty
 * shell happened.
 *
 * So this is the developer path's own check: one command, no proof numbering, no
 * store fixtures, no ability to fail a release. It launches the real startup
 * path — importing `main.ts`, exactly as the smoke does, so what is checked is
 * the real thing rather than a reconstruction — waits for the first page to stop
 * saying it is loading, and exits non-zero if it never does.
 *
 * It runs against whatever `pnpm shell` would load, because it reads the same
 * `DASH_SHELL_URL`. Pointed at the export it checks the export; pointed at
 * nothing it checks the dev server. Both are worth checking and neither is
 * checked by anything else.
 *
 * ## What it asserts, and why that is the right assertion
 *
 * See `lib/shell/first-paint.ts`. The short version: a shell whose renderer
 * never runs is not missing anything on screen — the server-delivered markup is
 * complete, headings and all — so every check that looks for content passes. The
 * one distinguishing fact is that the loading placeholder never goes away.
 */

// MUST BE FIRST, and in this order, for the reason `electron/smoke.ts` gives:
// `smoke-identity` supplies the app name `electron .` would have had, and
// `main.js` carries the side-effect import that points the store at the
// user-data directory derived from it.
import "./smoke-identity.js";
import "./main.js";
import { appWindow } from "./app-window.js";

import { app } from "electron";

import {
  FIRST_PAINT_BUDGET_MS,
  FIRST_PAINT_PROBE,
  judgeFirstPaint,
  readFirstPaint,
  type FirstPaintObservation,
} from "../lib/shell/first-paint";

/**
 * The app window, once it has finished loading, or null.
 *
 * `did-fail-load` resolves null rather than rejecting: a window that never
 * loaded is one of the outcomes this check reports, and turning it into a throw
 * would replace a described failure with a stack trace.
 */
function loadedWindow(): Promise<Electron.BrowserWindow | null> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => resolve(null), 60_000);
    const attach = (): void => {
      const window = appWindow();
      if (window === null) {
        setTimeout(attach, 100);
        return;
      }
      window.webContents.once("did-finish-load", () => {
        clearTimeout(deadline);
        resolve(window);
      });
      window.webContents.once("did-fail-load", (_event, code: number, description: string) => {
        clearTimeout(deadline);
        console.error(`[first-paint] the window failed to load: ${description} (${String(code)})`);
        resolve(null);
      });
    };
    attach();
  });
}

/**
 * Called without a top-level `await`, like `electron/smoke.ts`'s `run`, and for
 * the same reason: Electron dispatches `ready` only after the entry module has
 * finished evaluating, so a top-level await on `whenReady` deadlocks silently.
 */
async function run(): Promise<void> {
  await app.whenReady();

  const window = await loadedWindow();
  const started = Date.now();
  let polls = 0;
  let observation: FirstPaintObservation | null = null;

  if (window !== null) {
    const deadline = started + FIRST_PAINT_BUDGET_MS;
    for (;;) {
      observation = (await window.webContents.executeJavaScript(
        FIRST_PAINT_PROBE,
      )) as FirstPaintObservation;
      polls += 1;
      if (readFirstPaint(observation) !== "stuck" || Date.now() >= deadline) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const elapsed = Date.now() - started;
  const verdict = judgeFirstPaint(observation, elapsed);

  // What it waited for, for how long, over how many polls, and what it saw.
  // MAR-473's requirement, and the reason `6g` cost an afternoon of CI
  // archaeology when it reported `null`.
  console.log(
    `${verdict.ok ? "PASS" : "FAIL"}  first paint: ${JSON.stringify({
      outcome: verdict.outcome,
      waited_ms: elapsed,
      budget_ms: FIRST_PAINT_BUDGET_MS,
      polls,
      last_seen: observation,
    })}`,
  );
  console.log(`      ${verdict.detail}`);

  // The runner is left alone, as everywhere else in this repository: it is
  // detached on purpose and closing DASH is not a reason to stop it.
  app.exit(verdict.ok ? 0 : 1);
}

void run().catch((error: unknown) => {
  console.error(
    `[first-paint] the check itself failed: ${error instanceof Error ? error.stack : String(error)}`,
  );
  app.exit(1);
});
