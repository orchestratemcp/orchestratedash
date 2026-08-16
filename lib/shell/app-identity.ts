/**
 * Who this process is, and whether its store agrees (MAR-656).
 *
 * Pure, and here rather than in `electron/data-dir.ts`, for the reason
 * `lib/shell/install-layout.ts` gives about the rest of the shell: the module
 * that touches Electron should be wiring, and the part with a decision in it
 * should be testable without launching a browser process. `electron/data-dir.ts`
 * additionally runs `app.setName` as a module side effect, so importing it from
 * a test is not merely awkward — it is not possible.
 *
 * ## The failure this exists to name
 *
 * `app.getPath("userData")` is `<appData>/<app name>`, and Electron reads the
 * name from the package.json of the **app directory** — which it only has when
 * it was launched with one. `electron .` is `orchestratedash`. `electron
 * dist/electron/main.mjs` consults no package.json and falls back to `Electron`,
 * so the store becomes `%APPDATA%\Electron`.
 *
 * That is not a cosmetic difference. The registered `dash://` handler was the
 * second form, the single-instance lock is keyed on `userData`, and so a deep
 * link opened a **whole second DASH** — its own store, its own runner, its own
 * agents — beside the one already on screen, colliding with nothing. It had been
 * quietly collecting agents since 2026-08-03 before anybody looked.
 *
 * ## Why the existing check could not catch it
 *
 * `assertStoreLocation` compared the resolved store against
 * `app.getPath("userData")`. In the phantom both were `%APPDATA%\Electron`, so
 * they agreed. Equality catches import-order bugs; it cannot catch an identity
 * bug, because a wrong identity is wrong on both sides of the comparison.
 * Identity has to be checked against a constant.
 */

/**
 * DASH's name, and therefore the last segment of its store path.
 *
 * Duplicated from the root package.json rather than read from it, for the reason
 * `electron/smoke-identity.ts` gives: reading the file means resolving the repo
 * root from a bundle, and this shell has one cwd-dependence too many already. If
 * the package name ever changes, the assertion below fails loudly rather than a
 * shell quietly writing somewhere new.
 */
export const APP_NAME = "orchestratedash";

/**
 * Is this process the app itself, rather than something that imports it?
 *
 * Two questions ride on this and they are the same question. **Who may claim the
 * `dash://` scheme** — a smoke run once registered itself as the machine's
 * handler, so every handoff link launched the proof harness, which ran its
 * proofs and called `app.exit()`, and the link appeared to do nothing. And
 * **who may claim the app's name**, which is the MAR-656 half.
 *
 * The second one has to be asked, not assumed, and that is the whole subtlety of
 * this fix. A dozen capture harnesses under `electron/` import `./main.js` and
 * deliberately **do not** import `electron/smoke-identity.ts`, so that they run
 * as app name `Electron`. `electron/capture-settings-polish.ts` states the
 * bargain in full: a capture process claiming the real app's identity *"would
 * either fight that test for the single-instance lock or, if `DASH_DATA_DIR`
 * were forgotten even once, write into its store."* Setting the name for every
 * importer of `main.ts` would take both of those away — the harnesses could no
 * longer run beside a live DASH, which is a property this project uses
 * constantly.
 *
 * So the name is claimed by the app's entry point and by nothing else. A
 * harness that forgets `DASH_DATA_DIR` still lands outside the real store, and
 * `storeIdentityProblem` now turns that from a silent second store into a crash
 * on line one.
 *
 * `package.json`'s `main` is `dist/electron/main.mjs`, and the basename is what
 * distinguishes it from `smoke.mjs` and a dozen `capture-*.mjs` beside it. An
 * **app directory** — `electron .`, which is how a person launches DASH — is not
 * matched and does not need to be: Electron reads the name from that
 * directory's package.json, which is where `orchestratedash` came from in the
 * first place.
 */
export function isAppEntryPoint(entry: string): boolean {
  // Split on both separators rather than using `path.basename`, which follows
  // the platform it runs on: the bug this guards against is a Windows one, and
  // on a posix CI runner `path.basename` does not split a backslash path at all,
  // so the case that matters would go untested.
  return ["main.mjs", "main.js"].includes(entryBasename(entry));
}

export function entryBasename(entry: string): string {
  return entry.split(/[\\/]/).pop() ?? "";
}

/**
 * `package.json`'s `main`, as the tail of a path, on either platform.
 *
 * A regex over the string rather than `path.dirname` three times, for
 * `entryBasename`'s reason: the entry is a Windows path in the case that
 * matters.
 */
const APP_ENTRY_TAIL = /[\\/]dist[\\/]electron[\\/]main\.m?js$/i;

/**
 * The app directory that owns an entry script, or null if it cannot be derived.
 *
 * ## Why the `dash://` registration names a directory (MAR-656)
 *
 * Registering the script meant every deep-link launch ran as app name
 * `Electron`, with `userData` at `%APPDATA%\Electron` — a second store, a second
 * runner, and a single-instance lock that never engaged because the lock is
 * keyed on `userData`. Agents added through a `dash://` link had been landing
 * there since 2026-08-03.
 *
 * `app.setName` is the fix for the identity. This is the other half: the handler
 * launches DASH the same way a person does, so the app-directory path — the one
 * that has always been right — is the only one left.
 *
 * Null rather than a guess when the tail is absent: registering a directory
 * derived from an unrecognised path would be worse than registering nothing,
 * because nothing is a visible failure and a wrong directory is a blank window.
 */
export function appDirectoryFor(entry: string): string | null {
  const match = APP_ENTRY_TAIL.exec(entry);
  if (match === null || match.index === 0) {
    return null;
  }
  return entry.slice(0, match.index);
}

/**
 * The last segment of a path, without `node:path`.
 *
 * `path.basename` follows the platform it runs on, and the bug this guards
 * against is a Windows one: on a posix CI runner `path.basename` does not split
 * a backslash path at all, so the case that matters would go untested. Same
 * shape, and the same reasoning, as `entryBasename` in
 * `electron/handoff-host.ts`.
 *
 * Trailing separators are dropped rather than yielding an empty name, because a
 * `userData` path is just as valid with one and the answer should not depend on
 * that.
 */
export function storeBasename(resolved: string): string {
  const segments = resolved.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? "";
}

/**
 * What is wrong with this store's identity, or null if nothing is.
 *
 * The message names the mechanism, because the path alone does not explain
 * itself: `%APPDATA%\Electron` looks like a stray directory until somebody knows
 * that `userData` is derived from `app.getName()` and that one launch form never
 * sets it. Anybody who hits this crash should not have to find that out the way
 * it was found out the first time.
 */
export function storeIdentityProblem(resolved: string, appName: string): string | null {
  if (storeBasename(resolved) === APP_NAME) {
    return null;
  }
  return (
    `The store resolved to "${resolved}", which is not a "${APP_NAME}" directory. ` +
    `This process is running under the app name "${appName}", and \`userData\` is ` +
    `<appData>/<app name> — so this launch has a store of its own that no DASH window ` +
    `will ever show. Electron only reads the name from package.json when it is launched ` +
    `with an app directory. If this is the shell, it should have reached app.setName in ` +
    `electron/data-dir.ts. If this is a capture harness, it is missing its DASH_DATA_DIR ` +
    `and was about to write into a store of its own instead of the scratch one it meant ` +
    `to use — which is how %APPDATA%\\Electron quietly collected two weeks of agents.`
  );
}
