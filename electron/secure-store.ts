/**
 * Wiring `lib/vault.ts` to the real `safeStorage`.
 *
 * The same split as `lib/shell/ipc.ts` and `electron/main.ts`: everything with
 * a rule in it lives in a pure module that is unit-tested without launching
 * Electron, and what remains here is the part that cannot be — which is
 * therefore kept as small as it can be made.
 *
 * This file is the only place in the repo that imports `safeStorage`, and it
 * lives under `electron/` rather than `lib/` on purpose. A credential store
 * reachable from the renderer by following an import is exactly what
 * `contextIsolation` and the narrow preload exist to prevent, and physical
 * placement makes that a property of the tree rather than a convention. It is
 * the same argument that keeps `MemorySecureStore` under `tests/`.
 */

import path from "node:path";

import { app, safeStorage } from "electron";

import type { SecureStore } from "../lib/secure-store";
import { Vault } from "../lib/vault";

let store: SecureStore | null = null;

/**
 * The process-wide secure store.
 *
 * Lazy because `app.getPath` throws before the app is ready, and because
 * importing this module must not have the side effect of touching the vault.
 * Call it after `app.whenReady()`.
 */
export function secureStore(): SecureStore {
  store ??= new Vault({
    // Beside the store, under the OS's per-user application data directory.
    // Crucially this path contains no version number: an upgrade replaces the
    // application bundle and leaves userData alone, which is what makes
    // "a key survives an app upgrade" true by construction rather than by a
    // migration step that could be forgotten.
    directory: path.join(app.getPath("userData"), "vault"),
    safeStorage,
    platform: process.platform,
  });
  return store;
}

/**
 * Point the SQLite store at the same per-user directory.
 *
 * Must run before anything imports `lib/db.ts`, which resolves its location
 * once at import time. Without it a packaged app would write `dash.sqlite`
 * beside its own executable — read-only on macOS, and wiped by an upgrade on
 * Windows.
 */
export function useUserDataDirectory(): void {
  process.env.DASH_DATA_DIR ??= app.getPath("userData");
}
