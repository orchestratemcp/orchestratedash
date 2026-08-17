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
 * Did somebody choose this process's store on purpose?
 *
 * `electron/data-dir.ts` already asked this of `DASH_DATA_DIR`, to tell "someone
 * chose a different directory deliberately" apart from "the import ordering
 * broke" — two situations that look identical from the outside and need opposite
 * responses. MAR-656's identity check made the question wider, because there is
 * a **second** way to choose deliberately and this repository uses it.
 *
 * Electron's own `--user-data-dir` switch moves `app.getPath("userData")`, and
 * `useUserDataDirectory()` then derives `DASH_DATA_DIR` from it. A capture
 * harness launched that way — `--user-data-dir=…\scratch-final\profile`, which
 * is how runs in parallel worktrees stop colliding — would reach
 * `assertStoreLocation` with both sides agreeing on a directory called
 * `profile`, and an identity check that did not know about the switch would
 * crash a harness whose store was exactly where its operator put it.
 *
 * The switch is read from `argv` rather than from `app.getPath`, because by the
 * time the path can be compared the derivation has already happened and the two
 * cases are indistinguishable again.
 */
export function storeLocationChosen(
  // An index signature rather than one named field: the caller is
  // `process.env`, whose `ProcessEnv` shares no declared properties with a
  // one-field object type and is rejected outright by TypeScript's
  // weak-type check.
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): boolean {
  if (env.DASH_DATA_DIR !== undefined) {
    return true;
  }
  return argv.some(
    (argument) => argument === "--user-data-dir" || argument.startsWith("--user-data-dir="),
  );
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

/* ---------------------------------------------------------------------- *
 * Which checkout is allowed to open the installed store (MAR-676)
 * ---------------------------------------------------------------------- */

/**
 * The one way to say "yes, this build really may open the installed store".
 *
 * Distinct from `DASH_DATA_DIR`, and the difference is the whole reason there are
 * two. `DASH_DATA_DIR` sends a build **somewhere else**, which is what a capture
 * harness and a scratch run want. This one says *use the real one anyway*, which
 * is what somebody reproducing a fault in the actual store needs — MAR-676's own
 * repair being the example, since the store it repairs is the only store that has
 * the shape it repairs.
 */
export const ALLOW_INSTALLED_STORE_ENV = "DASH_ALLOW_INSTALLED_STORE";

/** What `<app path>/.git` turned out to be. Classified by the caller, which has fs. */
export type GitEntryKind = "directory" | "file" | "absent";

export interface AppCheckout {
  /** `app.getAppPath()` — the directory Electron read `package.json` from. */
  app_path: string;
  /** `app.isPackaged`. */
  packaged: boolean;
  git_entry: GitEntryKind;
}

/**
 * May this app path own the installed user-data directory?
 *
 * ## The failure, which is MAR-656's twin
 *
 * `userData` is `<appData>/<app name>` and Electron reads the name from the
 * package.json of the **app directory**. Every checkout of this repository has
 * the same package.json, so `electron <any worktree>` is app name
 * `orchestratedash` and resolves the **real** store — the one with the person's
 * agents, connections and history in it. On 2026-08-16 a build of the MAR-643
 * branch did exactly that and ran its own migration 24 over Henrik's store, which
 * is the whole of MAR-676: a schema history no commit of master can produce, and
 * three shipped features permanently unreachable on the one store that mattered.
 *
 * MAR-656 was the same trap reached through a deep link, and `app.setName` fixed
 * the identity. Nothing asked the second question: *this process knows who it is,
 * but should it be here at all?*
 *
 * ## Why git decides it, and not a marker file
 *
 * A linked worktree's `.git` is a **file** containing `gitdir: …`; the main
 * working tree's is a **directory**. That is not a heuristic — it is how git
 * distinguishes the two, it costs one `statSync`, and it is exactly the
 * distinction that produced the bug. A marker file would need creating,
 * documenting and remembering, and the first checkout somebody copied instead of
 * cloned would carry it.
 *
 * A packaged app is always blessed: it *is* the install, it has no `.git`, and it
 * is the thing the store belongs to.
 *
 * Everything else — a worktree, a copied tree, an export with no git at all — is
 * refused, because none of them can show they are the checkout the store belongs
 * to and the reassuring answer is the one that cost a day.
 */
export function isBlessedCheckout(checkout: AppCheckout): boolean {
  if (checkout.packaged) {
    return true;
  }
  return checkout.git_entry === "directory";
}

/**
 * Why this launch may not use the installed store, or null when it may.
 *
 * The message has to name the remedy and not merely the rule, because the person
 * reading it is mid-task and has three legitimate intentions — look at my branch,
 * work on the real store, run the shell properly — and the refusal is useless if
 * it does not say which switch belongs to which.
 *
 * `env` is the whole environment rather than one flag, matching
 * `storeLocationChosen`: `ProcessEnv` shares no declared property with a
 * one-field object type and TypeScript rejects the narrower parameter outright.
 */
export function foreignCheckoutProblem(
  checkout: AppCheckout,
  resolved: string,
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  if (isBlessedCheckout(checkout)) {
    return null;
  }
  if (env[ALLOW_INSTALLED_STORE_ENV] !== undefined) {
    return null;
  }
  const what =
    checkout.git_entry === "file"
      ? "a linked git worktree"
      : "not a git working tree at all, so it cannot show it is the checkout DASH is installed from";
  return (
    `This DASH was launched from "${checkout.app_path}", which is ${what}, and it was about to ` +
    `open the installed store at "${resolved}".\n\n` +
    `That is refused. Every checkout of this repository carries the same package.json, so ` +
    `Electron gives them all the app name "${APP_NAME}" and they all resolve the same ` +
    `userData — the real one, with the real agents and the real history in it. A branch build ` +
    `that opens it runs that branch's migrations over it, and on 2026-08-16 one did: it left a ` +
    `schema history no released DASH can produce (MAR-676).\n\n` +
    `Pick the one you meant:\n` +
    `  - to look at this branch, give it a store of its own: DASH_DATA_DIR=<some empty folder>\n` +
    `  - to work on the real store on purpose, say so: ${ALLOW_INSTALLED_STORE_ENV}=1\n` +
    `  - to just use DASH, launch it from the main checkout instead of this worktree.`
  );
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
