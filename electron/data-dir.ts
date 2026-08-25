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
 *
 * ## The app's name is decided here too (MAR-656)
 *
 * `userData` is `<appData>/<app name>`, and Electron takes the name from the
 * package.json of the **app directory** — which it only has when it was launched
 * with one. `electron .` gets `orchestratedash`; `electron dist/electron/main.mjs`
 * consults no package.json at all and falls back to the name `Electron`.
 *
 * The registered `dash://` handler is the second form, so every deep-link launch
 * ran as a different application with a different store: `%APPDATA%\Electron`,
 * with its own agents, its own runner, and — because the single-instance lock is
 * keyed on `userData` — no collision with the DASH already on screen. It had been
 * quietly collecting agents since 2026-08-03.
 *
 * `electron/smoke-identity.ts` had already found this and fixed it for the proof
 * harness. The shell never made the same call, so the harness was more careful
 * about its own identity than the product was. That asymmetry is closed here.
 *
 * **The call is gated on the entry point, and the gate is not caution.** A dozen
 * capture harnesses under `electron/` import `main.ts` and deliberately skip
 * `smoke-identity.ts` so that they run as `Electron` — that is what lets them
 * photograph DASH beside a live one without fighting it for the single-instance
 * lock. Claiming the name for every importer of this file would take that away.
 * See `isAppEntryPoint` in `lib/shell/app-identity.ts`, which owns the rule
 * because the `dash://` registration asks the identical question.
 *
 * The harnesses keep their old identity and lose their old *silence*:
 * `assertStoreLocation` now refuses a store that is not DASH's, so a harness
 * that forgets `DASH_DATA_DIR` crashes on line one instead of quietly opening a
 * second DASH's worth of agents.
 */

import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { app } from "electron";

import {
  APP_NAME,
  foreignCheckoutProblem,
  isAppEntryPoint,
  resolvesInstalledStore,
  storeIdentityProblem,
  storeLocationChosen,
  type GitEntryKind,
} from "../lib/shell/app-identity";
import { useUserDataDirectory } from "./secure-store";

// BEFORE `useUserDataDirectory()`, which is the first thing to read
// `app.getPath("userData")` — see the header. A name set after that read would
// be a no-op wearing the appearance of a fix.
//
// Gated on the entry point, and that gate is load-bearing rather than cautious:
// a dozen capture harnesses import this file through `main.ts` and rely on NOT
// being `orchestratedash`, so that they can run beside a live DASH without
// fighting it for the single-instance lock. `isAppEntryPoint` says why in full.
if (isAppEntryPoint(process.argv[1] ?? "")) {
  app.setName(APP_NAME);
}

/**
 * Whether the caller had already chosen a directory before we ran.
 *
 * `useUserDataDirectory()` assigns with `??=`, so `DASH_DATA_DIR` set in the
 * environment wins — a deliberate, supported override. Recording it here is
 * what lets `assertStoreLocation` tell "someone chose a different directory on
 * purpose" apart from "the ordering broke", which look identical from the
 * outside and need opposite responses.
 *
 * **Read before `useUserDataDirectory()` runs**, because that call is what makes
 * the two indistinguishable. `storeLocationChosen` also counts Electron's own
 * `--user-data-dir` switch, which is a second way of choosing on purpose and one
 * this repository's capture harnesses use to keep parallel worktrees from
 * colliding — see that function for why the identity check would otherwise crash
 * a run whose store was exactly where its operator put it.
 */
const overridden = storeLocationChosen(process.env, process.argv);

useUserDataDirectory();

/**
 * What `<app path>/.git` is, which is how git itself tells a worktree apart.
 *
 * A linked worktree's `.git` is a file holding `gitdir: …`; the main working
 * tree's is a directory. Read here rather than in `lib/shell/app-identity.ts` so
 * that the decision stays pure and testable — the same split
 * `lib/shell/install-layout.ts` argues for and this module's header repeats.
 *
 * An unreadable entry is `absent` rather than a throw. This runs on every launch
 * before anything else, and a permission error on a `.git` is not a reason to
 * refuse to start; it is a reason to fall through to the refusal that names the
 * remedy, which is the same answer.
 *
 * Exported for `electron/autostart.ts` (MAR-785), which asks the identical
 * question for the identical reason: ADR 0027 refuses a worktree the installed
 * store, and ADR 0030 refuses a worktree the ability to put itself into a
 * person's Windows startup list. One question, one implementation — a second
 * copy of this would be free to drift from the one the store guard uses.
 */
export function gitEntryKind(): GitEntryKind {
  const entry = path.join(app.getAppPath(), ".git");
  try {
    if (!existsSync(entry)) {
      return "absent";
    }
    return statSync(entry).isDirectory() ? "directory" : "file";
  } catch {
    return "absent";
  }
}

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
 *
 * ## Why agreement is not enough (MAR-656)
 *
 * The equality check catches import-order bugs and nothing else. In the phantom
 * `%APPDATA%\Electron` store *both* sides read `%APPDATA%\Electron`, so they
 * agreed, and this function passed while DASH wrote a person's agents somewhere
 * no DASH window has ever shown. Identity has to be checked against a constant,
 * not against itself — which is precisely the check `electron/smoke.ts` already
 * made about the harness and the shell never made about itself.
 */
export function assertStoreLocation(resolved: string): void {
  if (overridden) {
    console.warn(`[dash-shell] DASH_DATA_DIR override in effect: ${resolved}`);
    return;
  }

  /*
   * MAR-676. Whose store is this, and is this build allowed to open it?
   *
   * First among the checks below, because the other two are about DASH's own
   * wiring being sound and this one is about whether this process should be here
   * at all — a message about import order would be noise on top of it.
   *
   * **Gated on the destination, not the entry point (MAR-700).** It used to ask
   * `isAppEntryPoint(process.argv[1])`, on the belief that this named the
   * app-directory launch — the form that reads a `package.json`, takes the name
   * `orchestratedash` from it and lands on the installed userData. It does not.
   * `electron .` puts the literal `"."` in `argv[1]`, so the predicate was false
   * and **the refusal was skipped for the one form it existed to catch**, which
   * is also the form `pnpm shell` uses. Six worktrees walked through it between
   * 2026-08-19 and 2026-08-21 and left the store truncated mid-checkpoint.
   * `resolvesInstalledStore` says why the destination is the honest question.
   *
   * The harnesses stay outside it, by a better route than a launch-form gate:
   * they run as app name `Electron`, so their store is not an `orchestratedash`
   * directory and this branch does not apply — and when one forgets its
   * `DASH_DATA_DIR`, `storeIdentityProblem` below is what catches it, which is
   * the check that was always about them. The smoke reaches the real store on
   * purpose (MAR-424's third acceptance criterion) and now says so out loud in
   * `electron/smoke-identity.ts` rather than arriving through a hole.
   */
  if (resolvesInstalledStore(resolved)) {
    const foreign = foreignCheckoutProblem(
      { app_path: app.getAppPath(), packaged: app.isPackaged, git_entry: gitEntryKind() },
      resolved,
      process.env,
    );
    if (foreign !== null) {
      throw new Error(foreign);
    }
  }

  const expected = app.getPath("userData");
  if (resolved !== expected) {
    throw new Error(
      `The store resolved to "${resolved}" but this shell requires "${expected}". ` +
        `Something imported lib/db.ts before electron/data-dir.ts ran — check the ` +
        `import order at the top of electron/main.ts.`,
    );
  }

  const problem = storeIdentityProblem(resolved, app.getName());
  if (problem !== null) {
    throw new Error(problem);
  }
}
