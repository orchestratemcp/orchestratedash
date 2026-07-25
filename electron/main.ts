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

// MUST BE FIRST. This import's side effect points the store at the per-user
// data directory, and ES modules evaluate imports in source order — so it runs
// before the runner's import chain below reaches `lib/db.ts`, which resolves its
// location once at module-evaluation time. Moving or sorting this line silently
// sends the store back to the source tree; `assertStoreLocation` catches that at
// startup. See `electron/data-dir.ts`.
import { assertStoreLocation } from "./data-dir";

import { app, BrowserWindow, ipcMain } from "electron";

import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

import {
  localPrincipal,
  noAdapter,
  runAgentCommand,
  type AgentCommandInput,
} from "../lib/agent-dom/runner";
import { dataDir } from "../lib/db";
import { SHELL_COMMAND_CHANNEL, dispatchCommand, formatAuditLine } from "../lib/shell/ipc";
import {
  SHELL_WEB_PREFERENCES,
  assertHardenedWebPreferences,
  isAllowedRendererUrl,
} from "../lib/shell/window";
import { secureStore } from "./secure-store";

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
      // `fileURLToPath`, not `URL.pathname`: on Windows the latter yields
      // "/C:/Users/..." — a string Electron cannot resolve, and one that looks
      // close enough to a path to survive a code review. The preload is built
      // beside this file (see `scripts/build-shell.mjs`), so it is always the
      // sibling of whichever bundle is running.
      preload: fileURLToPath(new URL("./preload.js", import.meta.url)),
    },
  });

  window.once("ready-to-show", () => window.show());

  // Without this, a renderer that fails to load never fires `ready-to-show`, so
  // `show: false` above leaves an invisible process and no message anywhere. The
  // most likely cause by far is the dev server not running, so say that.
  window.webContents.on(
    "did-fail-load",
    (_event, errorCode: number, errorDescription: string, validatedURL: string) => {
      console.error(
        `[dash-shell] failed to load ${validatedURL}: ${errorDescription} (${errorCode}). ` +
          `If this is the developer path, is \`pnpm dev\` running?`,
      );
    },
  );

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
 * review, audit, then dispatch only if allowed.
 *
 * The IPC-level audit goes to stderr; the Agent DOM command audit is durable in
 * SQLite from MAR-417 (`command_audit`). Both are produced at the chokepoint and
 * no path skips either.
 *
 * **This is where the actor is bound.** The principal is derived from the
 * process's own OS session, here in main, and handed to the runner as a
 * parameter. The request that arrived over IPC is never consulted for it — and
 * cannot be, since no command declares a payload key that could carry one.
 */
export function registerCommandChannel(): void {
  const principal = localPrincipal(userInfo().username);

  ipcMain.handle(SHELL_COMMAND_CHANNEL, async (_event, request: unknown) => {
    return dispatchCommand(request, {
      audit: (record) => console.warn(formatAuditLine(record)),
      runAgentCommand: (input: AgentCommandInput) =>
        runAgentCommand(input, {
          principal,
          // No adapter is installed. MAR-415 (DASH-11) builds the bundled
          // runner and a later slice builds the HTTP transport; until then
          // every accepted command is refused here rather than reported as
          // delivered. See `noAdapter`.
          adapter: noAdapter,
        }),
    });
  });
}

/**
 * Guarded so importing this module in a test or a tool does not try to start an
 * app. `app` is undefined outside a real Electron process.
 */
/**
 * Report which vault DASH is actually using, once, at startup.
 *
 * `describeBacking()` returns only a backend name, a label and a reason — all
 * of which the seam guarantees are safe to log. Reporting it here means an
 * unusable vault is visible in the logs from the first launch rather than being
 * discovered at the moment a user tries to connect something, and it makes the
 * `basic_text` refusal legible on the Linux machines where it fires.
 */
function reportSecureStoreBacking(): void {
  const backing = secureStore().describeBacking();
  console.warn(
    `[dash-shell] secure store: ${backing.label} os_backed=${backing.os_backed}` +
      (backing.unavailable_reason ? ` reason=${backing.unavailable_reason}` : ""),
  );
}

/**
 * Report where the store actually is, once, at startup.
 *
 * The companion to `assertStoreLocation`: the assertion proves the location is
 * right, and this makes it visible. "Which database did that audit row land in"
 * is otherwise a question you can only answer by guessing at the platform's
 * conventions for `userData`.
 */
function reportStoreLocation(): void {
  console.warn(`[dash-shell] store: ${dataDir}`);
}

if (typeof app !== "undefined") {
  void app.whenReady().then(() => {
    // `electron/data-dir.ts` already pointed the store at `userData`, as the
    // first import in this file. This is the proof it worked — see that module
    // for why the old `useUserDataDirectory()` call here could never have.
    assertStoreLocation(dataDir);
    reportStoreLocation();
    reportSecureStoreBacking();
    registerCommandChannel();
    createWindow();

    app.on("activate", () => {
      // macOS convention: clicking the dock icon with no windows open reopens one.
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  }).catch((error: unknown) => {
    // Every check above is written to throw — the store location, the renderer
    // posture, the URL allowlist. Inside a promise callback a throw is only an
    // unhandled rejection, which prints a warning and lets the app carry on in
    // exactly the state the check refused to accept. This is what makes "fail
    // loudly at startup" true rather than aspirational.
    console.error(
      `[dash-shell] startup failed: ${error instanceof Error ? error.stack : String(error)}`,
    );
    app.exit(1);
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
