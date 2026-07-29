/**
 * Where the packaged app's read-only resources are, and proof that it found them.
 *
 * **This module exists for its import position**, the same way `data-dir.ts`
 * does, and for a closely related reason. `lib/contracts.ts` resolves the
 * schema directory once and caches it with the compiled validators, so the
 * first thing to validate anything decides the answer for the whole process.
 * Setting `DASH_CONTRACTS_DIR` after that point is not late by a little; it is
 * unreachable, exactly as `useUserDataDirectory()` inside `whenReady` was.
 *
 * ## Why a packaged app has to say this out loud (MAR-429)
 *
 * `lib/contracts.ts` searches three places in order: `DASH_CONTRACTS_DIR`, then
 * upward from its own `import.meta.url`, then `cwd`. Two of those three are
 * accidents of a development tree:
 *
 * - The walk-up works because `dist/electron/` sits inside the repo, so it
 *   reaches `<repo>/contracts`. In an MSIX install the bundles are under the
 *   package's immutable root and the schemas are in the *resources* directory,
 *   which is not an ancestor of anything.
 * - `cwd` for a shortcut-launched packaged app is whatever the shell handed it,
 *   frequently `C:\Windows\system32`.
 *
 * So the fallbacks do not merely become unreliable when packaged — they become
 * wrong in a way that is invisible on the machine that built the package, where
 * `<repo>/contracts` still exists and the walk-up still finds it. That is the
 * single most likely MSIX path failure and it is why this is set explicitly and
 * then verified rather than trusted.
 *
 * ## What is deliberately *not* here
 *
 * `runner/supervisor.ts` strips `DASH_CONTRACTS_DIR` from every agent's
 * environment. That is correct and must stay: an agent is somebody else's code
 * and has no business being pointed at DASH's schema directory. The runner
 * itself does inherit it, via `cleanEnvironment()` in `runner-process.ts`,
 * which is the whole point — a separate process with its own working directory
 * was the original reason this variable exists.
 */

import { app } from "electron";

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contractsDirectory } from "../lib/contracts";
import { isInsideInstallRoot } from "../lib/shell/install-layout";

/**
 * Whether the caller had already chosen a contracts directory before we ran.
 *
 * Assigned with `??=` for the same reason `DASH_DATA_DIR` is: an explicit
 * environment variable is a supported override, and the tests in
 * `tests/contracts.test.ts` depend on being able to set it. Recording that it
 * came from outside is what lets the assertion below tell "somebody chose this
 * on purpose" apart from "packaging resolved the wrong thing".
 */
const overridden = process.env.DASH_CONTRACTS_DIR !== undefined;

/**
 * The resources directory of a packaged app.
 *
 * `process.resourcesPath` is where electron-builder's `extraResources` land.
 * It is defined in an unpackaged launch too — it points into the Electron
 * install — which is why this is gated on `app.isPackaged` rather than on the
 * path existing.
 */
function packagedResourcesDir(): string | null {
  return app.isPackaged ? process.resourcesPath : null;
}

const resources = packagedResourcesDir();
if (resources !== null) {
  process.env.DASH_CONTRACTS_DIR ??= path.join(resources, "contracts");
}

/**
 * The renderer the packaged app loads.
 *
 * **A placeholder, on purpose, and only for MAR-429.** DASH's real UI is a Next
 * server application with API routes that read SQLite; it is not a static
 * export and cannot be one without moving that data access somewhere else.
 * Packaging a loopback Next server instead would re-open a listening TCP port
 * and undo MAR-430, which took the last one away.
 *
 * That decision belongs to **MAR-432 (DASH-20)**, which owns it and describes
 * the way through: a conditional static export, one renderer over two data
 * sources, and a read-only IPC surface beside the audited command channel. It
 * was filed by MAR-423 rather than assumed, because this comment used to point
 * at MAR-422 — whose description covers Store distribution, packaging and the
 * update lifecycle, and never says what the window contains.
 *
 * What MAR-429 needs is a window that opens,
 * because every lifecycle claim it makes — runner spawns, survives the window
 * closing, is re-adopted on reopen, is not orphaned by an update — is a
 * main-process and runner behaviour that no renderer participates in.
 *
 * Returns null when unpackaged, so `pnpm dev` + `pnpm shell` keep pointing at
 * the dev server exactly as they do today.
 */
export function packagedRendererUrl(): string | null {
  if (!app.isPackaged) {
    return null;
  }
  const file = fileURLToPath(new URL("./renderer/index.html", import.meta.url));
  return new URL(`file://${file.replace(/\\/g, "/")}`).href;
}

/**
 * Prove the packaged app is reading schemas from inside its own install.
 *
 * The MAR-429 acceptance criterion, executed rather than asserted in prose.
 * This is also what replaces the "clean machine" argument: the dev tree still
 * exists on the machine capturing the evidence, so the risk is not that the
 * schemas cannot be found but that they are found *in the wrong place* and
 * everything appears to work. A resolved path checked against the install root
 * catches that; an absent directory on a pristine VM only hides it.
 *
 * Called from `main.ts` at startup, like `assertStoreLocation`, so a packaging
 * regression is a crash on line one instead of a schema error much later from
 * whichever process happened to validate something first.
 */
export function assertContractsLocation(): void {
  // Throws with the full candidate list when nothing was found, which is a
  // better message than anything this function could add.
  const resolved = contractsDirectory();

  if (!app.isPackaged) {
    console.warn(`[dash-shell] contracts: ${resolved} (unpackaged)`);
    return;
  }

  if (overridden) {
    console.warn(`[dash-shell] DASH_CONTRACTS_DIR override in effect: ${resolved}`);
    return;
  }

  const root = process.resourcesPath;
  if (!isInsideInstallRoot(root, resolved)) {
    throw new Error(
      `The contracts directory resolved to "${resolved}", which is outside this ` +
        `install's resources ("${root}"). A packaged app must read its schemas ` +
        `from its own install layout — resolving elsewhere means it found a ` +
        `development tree, and the package would fail on any other machine. ` +
        `See electron/resources.ts.`,
    );
  }

  console.warn(`[dash-shell] contracts: ${resolved}`);
}

/**
 * Prove the packaged renderer was actually shipped.
 *
 * `loadURL` on a missing `file:` URL fails into a blank window rather than an
 * error, which would make a packaging mistake look like a renderer bug.
 */
export function assertRendererPresent(): void {
  const url = packagedRendererUrl();
  if (url === null) {
    return;
  }
  const file = fileURLToPath(url);
  if (!existsSync(file)) {
    throw new Error(
      `The packaged renderer is missing at "${file}". ` +
        `scripts/build-shell.mjs copies electron/renderer/ into dist/electron/renderer/.`,
    );
  }
}
