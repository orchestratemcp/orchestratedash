/**
 * Point the store at the per-user data directory, before anything can read it.
 *
 * **This module exists for its import position, not for its contents.**
 *
 * `lib/db.ts` resolves `dataDir` from `process.env.DASH_DATA_DIR` once, at
 * module-evaluation time. `electron/main.ts` imports the Agent DOM runner, which
 * imports `lib/db.ts` — so by the time any statement in `main.ts` runs, the
 * store's location is already decided. Calling `useUserDataDirectory()` inside
 * `app.whenReady()`, as `main.ts` did before MAR-424, could never have worked:
 * it was not merely late, it was unreachable in time. Nothing caught it because
 * the shell had never been launched.
 *
 * ES modules evaluate their imports in source order, depth first. So a bare
 * side-effect import placed *first* in `main.ts` is guaranteed by the language
 * to run before the runner's import chain reaches `lib/db.ts`. That is the whole
 * mechanism.
 *
 * **Nothing here may import `lib/db.ts`, directly or transitively.** Doing so
 * would evaluate the store from inside the module whose job is to configure it
 * first — the bug this file exists to prevent, wearing this file's name. That is
 * why `assertStoreLocation` takes the resolved directory as an argument instead
 * of importing it: the caller is `main.ts`, where the import is already safe.
 *
 * Two further consequences worth stating plainly:
 *
 * - **Import order in `main.ts` is load-bearing.** A tool that sorts imports
 *   alphabetically would silently send the store back to the source tree. The
 *   comment there says so, and the assertion below makes it fail loudly rather
 *   than quietly.
 * - **`app.getPath("userData")` is read before `whenReady`.** That is supported
 *   — `userData` is one of the paths Electron resolves as soon as the app module
 *   loads — and it is the only reason this can be done early enough at all.
 */

import { app } from "electron";

import { useUserDataDirectory } from "./secure-store";

/**
 * Whether the caller had already chosen a directory before we ran.
 *
 * `useUserDataDirectory()` assigns with `??=`, so `DASH_DATA_DIR` set in the
 * environment wins — a deliberate, supported override. Recording it here is
 * what lets `assertStoreLocation` tell "someone chose a different directory on
 * purpose" apart from "the ordering broke", which look identical from the
 * outside and need opposite responses.
 */
const overridden = process.env.DASH_DATA_DIR !== undefined;

useUserDataDirectory();

/**
 * Prove the ordering held, at startup, on every launch.
 *
 * The failure this catches is silent and expensive: a shell that works
 * perfectly while writing `dash.sqlite` beside the source tree, and loses the
 * user's agents the moment it is launched from anywhere else. Comparing the
 * location the store actually resolved against the one it was supposed to
 * resolve turns that into a crash on line one.
 *
 * An explicit `DASH_DATA_DIR` is honoured rather than rejected — it is the
 * override the seam was written to allow — but it is reported, because a shell
 * quietly not using the user's real data directory is worth one line of log.
 *
 * `resolved` is `lib/db.ts`'s `dataDir`, passed in by `main.ts`. See the module
 * header for why it is a parameter and not an import.
 */
export function assertStoreLocation(resolved: string): void {
  if (overridden) {
    console.warn(`[dash-shell] DASH_DATA_DIR override in effect: ${resolved}`);
    return;
  }

  const expected = app.getPath("userData");
  if (resolved !== expected) {
    throw new Error(
      `The store resolved to "${resolved}" but this shell requires "${expected}". ` +
        `Something imported lib/db.ts before electron/data-dir.ts ran — check the ` +
        `import order at the top of electron/main.ts.`,
    );
  }
}
