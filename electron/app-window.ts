/**
 * Which window is *the* DASH window.
 *
 * Six call sites said `BrowserWindow.getAllWindows()[0]` and meant this — a
 * modal's parent, a prompt's owner, the window a native dialog should be
 * attached to. That worked while the app window was the first one ever created,
 * and MAR-436 ends it: the splash is created first, deliberately.
 *
 * The order was never contractual anyway. `electron/smoke.ts` already says so
 * in its own comment about finding the credential prompt: *"resolved by waiting
 * for it to appear rather than by index, because `getAllWindows` order is not
 * contractual"*. This module is that sentence applied to the other direction.
 *
 * It is a module of its own rather than an export from `electron/main.ts`
 * because `handoff-host.ts` and `sample-agent.ts` need it and main imports
 * both — reaching back into main would be a cycle, and the answer is small
 * enough that a shared owner is cheaper than one.
 *
 * ## Why this matters more than the tidiness suggests
 *
 * `drainHandoffQueue` runs immediately after `createWindow`, and the splash is
 * closed on the app window's `ready-to-show`, which is later. So there is a real
 * window — a second or two on a cold start, longer on a first run — in which a
 * handoff consent dialog would have parented itself to a splash that is about to
 * disappear. A modal whose parent closes underneath it is the kind of defect
 * that reproduces on slow machines and nowhere else.
 */

import type { BrowserWindow } from "electron";

let current: BrowserWindow | null = null;

/** Called by `createWindow`, and by nothing else. */
export function setAppWindow(window: BrowserWindow): void {
  current = window;
}

export function clearAppWindow(window: BrowserWindow): void {
  if (current === window) {
    current = null;
  }
}

/**
 * The app window, or null when there is not one.
 *
 * Null is a real answer and callers must handle it: between `window-all-closed`
 * and a macOS `activate`, and during the part of startup before `createWindow`,
 * there is genuinely no window to parent anything to. Returning the splash
 * instead would be the bug this module exists to prevent.
 */
export function appWindow(): BrowserWindow | null {
  return current !== null && !current.isDestroyed() ? current : null;
}
