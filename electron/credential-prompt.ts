/**
 * The window a credential is typed into (MAR-383).
 *
 * One modal window, opened by main, closed by main, alive only for the length
 * of one `connect`. It has its own preload (`electron/credential-preload.ts`)
 * and therefore its own, disjoint capability: it can submit a secret and it
 * cannot do anything else.
 *
 * ## Why the request lives here and not in the URL
 *
 * The window is told *nothing* by its URL — no agent id, no connection id, no
 * service name. It asks main what it is for, over `describe`, and main answers
 * from the request it is currently holding. So a page loaded at the prompt's
 * route with no request pending renders nothing and can submit nothing, which
 * makes "this window is only useful while main wants it to be" true by
 * construction rather than by the page behaving.
 *
 * ## The sender check
 *
 * Every handler verifies the event came from the prompt window's own
 * `webContents`. Without it, the app window — which has no `dashCredential`
 * bridge, but does run script — would still be able to reach these channels
 * through any future bridge that exposed `invoke`. The check means the
 * credential channel answers exactly one renderer, and it is one main created.
 */

import { BrowserWindow, ipcMain } from "electron";
import path from "node:path";

import {
  CREDENTIAL_CANCEL_CHANNEL,
  CREDENTIAL_DESCRIBE_CHANNEL,
  CREDENTIAL_PROMPT_ROUTE,
  CREDENTIAL_SUBMIT_CHANNEL,
  type CredentialPromptDescription,
} from "../lib/shell/credential-prompt";
import type { CredentialTarget } from "../lib/connection-credentials";

/**
 * The prompt in flight, or null.
 *
 * At most one, and main is the only writer. A second `connect` while one is
 * open is refused by the modal itself — the parent window cannot be clicked —
 * so this never needs to be a queue.
 */
interface PendingPrompt {
  window: BrowserWindow;
  description: CredentialPromptDescription;
  /** Called exactly once, with the value or null for a cancel. */
  settle(value: string | null): void;
}

let pending: PendingPrompt | null = null;

/**
 * Largest credential the prompt will accept.
 *
 * API keys and tokens are hundreds of characters at the outside. The cap is
 * here so a scripted `submit` cannot hand main an arbitrarily large string to
 * push through `safeStorage` and onto disk.
 */
const MAX_SECRET_LENGTH = 8 * 1024;

function fromPrompt(sender: Electron.WebContents): boolean {
  return pending !== null && !pending.window.isDestroyed() && pending.window.webContents === sender;
}

/**
 * Register the three credential channels.
 *
 * Called once at startup beside the command and read channels. Registering them
 * unconditionally — rather than per prompt — keeps `ipcMain.handle` calls in one
 * place and means a stray message when no prompt is open is answered with a
 * refusal instead of reaching a handler that was never removed.
 */
export function registerCredentialChannels(): void {
  ipcMain.handle(CREDENTIAL_DESCRIBE_CHANNEL, (event) => {
    if (!fromPrompt(event.sender)) {
      return null;
    }
    return pending?.description ?? null;
  });

  ipcMain.handle(CREDENTIAL_SUBMIT_CHANNEL, (event, value: unknown) => {
    if (!fromPrompt(event.sender)) {
      return;
    }
    if (typeof value !== "string" || value === "" || value.length > MAX_SECRET_LENGTH) {
      // Not echoed, not measured in the log, not described. A rejected value is
      // still a value someone typed.
      return;
    }
    pending?.settle(value);
  });

  ipcMain.handle(CREDENTIAL_CANCEL_CHANNEL, (event) => {
    if (!fromPrompt(event.sender)) {
      return;
    }
    pending?.settle(null);
  });
}

/**
 * Ask the user for one credential.
 *
 * Resolves with the value, or null if they cancelled or closed the window. The
 * value is returned to `performConnectionAction`, which puts it in the vault —
 * it is not stored here, not held after this resolves, and not logged anywhere
 * on the way.
 */
export function promptForSecret(
  target: CredentialTarget,
  vaultLabel: string,
  replacing: boolean,
  parent: BrowserWindow | null,
  rendererOrigin: string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const window = new BrowserWindow({
      width: 520,
      height: 480,
      parent: parent ?? undefined,
      modal: parent !== null,
      show: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      // No menu bar on a dialog. It would carry the app's menu, including items
      // that navigate — in a window whose whole point is that it does one thing.
      autoHideMenuBar: true,
      title: `Connect ${target.service}`,
      webPreferences: {
        preload: path.join(__dirname, "credential-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Nothing on this page needs to remember anything between prompts, and
        // a session that persisted would be a place a typed value could be
        // cached by the form-history the platform provides for free.
        partition: `credential-prompt-${String(Date.now())}`,
        spellcheck: false,
      },
    });

    let settled = false;
    const settle = (value: string | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      pending = null;
      if (!window.isDestroyed()) {
        window.destroy();
      }
      resolve(value);
    };

    pending = {
      window,
      description: {
        service: target.service,
        field_label: target.field_label,
        purpose: target.purpose,
        help: target.help,
        vault_label: vaultLabel,
        replacing,
      },
      settle,
    };

    // A window closed with the X is a cancel, not a hang. Without this the
    // promise never settles and the Connection Center waits forever.
    window.on("closed", () => {
      settle(null);
    });

    // The same two escapes the app window closes, closed again here rather than
    // assumed. This window has the credential bridge; it is the last one that
    // should be able to navigate somewhere else while holding it.
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith(`${rendererOrigin}${CREDENTIAL_PROMPT_ROUTE}`)) {
        event.preventDefault();
        console.warn("[dash-shell] blocked navigation away from the credential prompt");
      }
    });

    window.once("ready-to-show", () => {
      window.show();
    });

    void window.loadURL(`${rendererOrigin}${CREDENTIAL_PROMPT_ROUTE}`);
  });
}
