/**
 * Electron main-process skeleton.
 *
 * ADR 0001 (Accepted) adopts Electron as DASH's installable shell. This is the
 * first structural slice of it: a window, the security posture, and the audited
 * command boundary. Nothing else.
 *
 * **What this deliberately does not do**, per the ADR's "Not decided here":
 * no secret storage, no `safeStorage`, no OAuth, no credential UI, no local
 * bridge or ingest server, no packaging. `SecureStore` (`lib/secure-store.ts`)
 * is a seam with no implementation, and nothing in this file touches it.
 *
 * The file is intentionally thin. Everything with a rule in it — the renderer
 * posture, the URL allowlist, the command review — lives in pure modules under
 * `lib/shell/` that are unit-tested without launching Electron. What remains
 * here is wiring, which is the part that cannot be tested without a real
 * Electron process and therefore should be as small as possible.
 */

import { app, BrowserWindow, ipcMain } from "electron";

import {
  SHELL_COMMAND_CHANNEL,
  executeCommand,
  formatAuditLine,
  reviewCommand,
} from "../lib/shell/ipc";
import {
  SHELL_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  isAllowedRendererUrl,
} from "../lib/shell/window";

/**
 * Where the renderer loads from.
 *
 * The developer path is the loopback Next dev server, which ADR 0001 keeps as a
 * second entry point. The packaged app will point this at a local static
 * export. Either way it goes through `isAllowedRendererUrl` — an env var is
 * caller-controlled input, and "no remote content in the renderer" has to hold
 * even when the caller is us.
 */
const DEFAULT_RENDERER_URL = "http://127.0.0.1:3000";

function rendererUrl(): string {
  const url = process.env.DASH_SHELL_URL ?? DEFAULT_RENDERER_URL;
  if (!isAllowedRendererUrl(url)) {
    // Fail loudly at startup rather than rendering off-machine content in a
    // window that holds a command channel.
    throw new Error(
      `Refusing to load "${url}": DASH's renderer may only load local files or loopback origins.`,
    );
  }
  return url;
}

export function createWindow(): BrowserWindow {
  // Re-assert the posture at the point of use. `SHELL_WEB_PREFERENCES` is
  // frozen, so this can only fail if someone edits the constant — which is
  // precisely the regression worth catching, and the tests catch it earlier.
  assertHardenedWebPreferences(SHELL_WEB_PREFERENCES);

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    // Do not paint an empty frame while the renderer boots.
    show: false,
    webPreferences: {
      ...SHELL_WEB_PREFERENCES,
      preload: new URL("./preload.js", import.meta.url).pathname,
    },
  });

  window.once("ready-to-show", () => window.show());

  // Two escapes from the allowlist, both closed. Without these, any link in the
  // UI — or injected into it — could navigate the privileged renderer to a
  // remote page that then has the command channel in reach.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url)) {
      event.preventDefault();
      console.warn(`[dash-shell] blocked navigation to ${url}`);
    }
  });

  void window.loadURL(rendererUrl());
  return window;
}

/**
 * Register the one audited command channel.
 *
 * One `handle` call, for one channel, for every command — see `lib/shell/ipc.ts`
 * for why that is the design and not an accident. The handler's whole job is:
 * review, audit, then execute only if allowed.
 *
 * The audit currently goes to stderr. Durable audit storage belongs with the
 * workspace/audit work in MAR-384, not here; what matters for this slice is
 * that the record is produced at the chokepoint and that no path skips it.
 */
export function registerCommandChannel(): void {
  ipcMain.handle(SHELL_COMMAND_CHANNEL, (_event, request: unknown) => {
    const review = reviewCommand(request);
    console.warn(formatAuditLine(review.audit));
    return executeCommand(review);
  });
}

/**
 * Guarded so importing this module in a test or a tool does not try to start an
 * app. `app` is undefined outside a real Electron process.
 */
if (typeof app !== "undefined") {
  void app.whenReady().then(() => {
    registerCommandChannel();
    createWindow();

    app.on("activate", () => {
      // macOS convention: clicking the dock icon with no windows open reopens one.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    // The long-lived bridge that would justify staying alive here does not
    // exist yet (ADR 0001 requirement 3, a later phase). Until it does, closing
    // the last window quits — leaving an invisible process running would be a
    // worse default to have to walk back.
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
