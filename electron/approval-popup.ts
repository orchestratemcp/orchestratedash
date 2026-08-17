/**
 * The window an approval is decided in, regardless of which page the main
 * DASH window happens to have open (MAR-421, DASH-17 first slice).
 *
 * A second top-level window, in the shape `electron/credential-prompt.ts`
 * established for the same reason: the app's normal pages live in one window
 * and cannot be guaranteed visible, so a request that must be seen gets a
 * window of its own. What is different here, deliberately, is the preload.
 * The credential prompt is given a bespoke, minimal bridge because it must
 * never be able to issue a command. This window's whole purpose *is* issuing
 * one — approve or reject — so it loads the app's ordinary `preload.js` and
 * gets the same `dashShell`/`dashData` every other DASH window has. That is
 * what makes "approving from the popup" and "approving from the workspace
 * page" the same code path rather than two: both call `submitAgentCommand`,
 * which reaches the one audited IPC channel every window shares.
 *
 * This module owns at most one such window and only ever shows or hides it —
 * `startApprovalNotifier`'s tick decides *when*, this module decides *how*.
 * Hiding rather than destroying is what makes reshowing it free and keeps the
 * page inside from having to re-mount.
 *
 * **It is destroyed with the DASH window, and that is not optional (MAR-678).**
 * This docblock used to say the window was never destroyed while DASH ran, and
 * it was true in a way nobody had followed through: `window-all-closed` counts
 * open windows, hidden or not, so a single popup left hidden behind a decided
 * approval meant closing the DASH window quit nothing at all. The app went on
 * living with no window, holding the store, until Windows was restarted.
 * `createWindow`'s `closed` handler now calls `closeApprovalPopup`, and
 * `before-quit` still does too for a quit that starts somewhere else. This
 * window may be reshown for free any number of times; it may not outlive the
 * window it belongs to.
 */

import { BrowserWindow, screen } from "electron";
import { fileURLToPath } from "node:url";

import { APPROVAL_POPUP_ROUTE, type ApprovalWorkRow } from "../lib/shell/approval-popup";
import { SHELL_WEB_PREFERENCES, isAllowedRendererUrl } from "../lib/shell/window";

const WIDTH = 440;
const HEIGHT = 420;
const MARGIN = 24;

let popupWindow: BrowserWindow | null = null;

function ensurePopupWindow(rendererOrigin: string): BrowserWindow {
  if (popupWindow !== null && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

  const area = screen.getPrimaryDisplay().workArea;
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: area.x + area.width - WIDTH - MARGIN,
    y: area.y + MARGIN,
    show: false,
    resizable: false,
    maximizable: false,
    // Kept minimizable, unlike the credential prompt: this window is not
    // modal to anything and a user mid-approval may legitimately want it out
    // of the way for a moment. It reappears on the next tick regardless — see
    // the `close` handler below, which is what makes that true even if the
    // user closes rather than minimizes.
    alwaysOnTop: true,
    autoHideMenuBar: true,
    title: "DASH — approval needed",
    webPreferences: {
      ...SHELL_WEB_PREFERENCES,
      preload: fileURLToPath(new URL("./preload.js", import.meta.url)),
    },
  });

  // The same two escapes every DASH window closes. This one carries the
  // command bridge, so it is at least as important here as on the main
  // window that `createWindow` protects the same way.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererUrl(url)) {
      event.preventDefault();
      console.warn("[dash-shell] blocked navigation away from the approval popup");
    }
  });

  // A closed window is not a resolved approval. Hiding rather than destroying
  // means the still-pending request is exactly where the next tick expects
  // it, and it reappears rather than silently having nowhere left to render.
  window.on("close", (event) => {
    event.preventDefault();
    window.hide();
  });

  void window.loadURL(`${rendererOrigin}${APPROVAL_POPUP_ROUTE}`).catch((error: unknown) => {
    console.error(`[dash-shell] the approval popup could not load its page: ${String(error)}`);
  });

  popupWindow = window;
  return window;
}

/**
 * Show the popup while there is something live to decide, hide it the moment
 * there is not. Called on every notifier tick, so this is idempotent by
 * design rather than by accident — showing an already-visible window or
 * hiding an already-hidden one does nothing observable.
 */
export function setApprovalPopupVisible(pending: ApprovalWorkRow[], rendererOrigin: string): void {
  if (pending.length === 0) {
    popupWindow?.hide();
    return;
  }
  const window = ensurePopupWindow(rendererOrigin);
  if (!window.isVisible()) {
    window.showInactive();
  }
}

/** Bring an already-open popup to the front. Does nothing if none is open. */
export function focusApprovalPopup(): void {
  if (popupWindow !== null && !popupWindow.isDestroyed()) {
    popupWindow.show();
    popupWindow.focus();
  }
}

/** Torn down with the app. Unlike `close`, this really does end the window. */
export function closeApprovalPopup(): void {
  if (popupWindow !== null && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }
  popupWindow = null;
}
