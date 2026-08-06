/**
 * The startup window (MAR-436).
 *
 * `createWindow` uses `show: false` and reveals the app only on
 * `ready-to-show`, so a cold start has been a gap where nothing appears at all.
 * On a first run that gap covers a database migration, three location
 * assertions, a credential-vault check and starting a detached runner — seconds,
 * during which DASH is indistinguishable from an app that failed to launch.
 *
 * ## No preload, and nothing to say
 *
 * ADR 0001 amendment 7 makes an extra bridge a review event, and this window
 * has no business being one: it renders no agent data, reads nothing, and has
 * no user input at all. So it carries **no preload**, and `webPreferences` says
 * so explicitly rather than by omission.
 *
 * Main therefore updates it with `executeJavaScript`, which deserves a note
 * because it looks like the thing this codebase spends most of its comments
 * refusing to do. What crosses is a member of `StartupStepId` — a union defined
 * in `lib/shell/splash.ts`, chosen by `electron/main.ts` at a call site that
 * names it as a literal. No agent, manifest, filename, error message or anything
 * else from outside this process reaches it. The failure path is the same shape:
 * main names a step, and the *copy* comes from `describeStartupFailure` inside
 * the page's own script, never from the thrown error.
 *
 * That last point is the load-bearing one. An `Error.message` from a failed
 * assertion is a developer's sentence full of paths and function names, and
 * putting it on this window would put a raw identifier in front of a novice in
 * the one moment they are least equipped to read one.
 *
 * ## Why a `data:` URL
 *
 * The splash has to be able to paint *before* `assertRendererPresent` has run —
 * it is on screen partly to explain a failure of that very check. A window that
 * loaded its markup from the packaged renderer could not report that the
 * packaged renderer is missing. So the document is a string in this file, and
 * the window that shows it depends on nothing but Electron.
 */

import { BrowserWindow } from "electron";

import { SURFACE_0, type ThemeName } from "../lib/shell/chrome";
import {
  STARTUP_STEPS,
  describeStartupFailure,
  type StartupStepId,
} from "../lib/shell/splash";

const WIDTH = 420;
const HEIGHT = 260;

export interface SplashWindow {
  /** Name the step now under way. Ignored once the window has been closed. */
  step(id: StartupStepId): void;
  /** Show the failure for a step and stop the progress indication. */
  fail(id: StartupStepId): void;
  /** Close it. Safe to call twice, and safe to call after `fail`. */
  close(): void;
}

/**
 * Open the splash.
 *
 * `frame: false` plus `backgroundColor` is what removes Electron's white flash:
 * the window is painted in the app's own surface colour by the compositor
 * before any HTML exists. MAR-436 names both.
 */
export function openSplash(theme: ThemeName): SplashWindow {
  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Above the desktop but not above every other application: a splash that
    // outranks the user's other windows for three seconds is a splash that
    // interrupts whatever they were doing to launch this.
    alwaysOnTop: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: SURFACE_0[theme],
    webPreferences: {
      // Stated rather than omitted. This window has no bridge and must not
      // acquire one by someone copying `createWindow`'s options into it.
      preload: undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // It never navigates. Not "only to allowed origins" — nowhere at all, which
  // is a rule this window can actually keep, since its whole document is the
  // one string below.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  void window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(document(theme))}`,
  );

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });

  let closed = false;

  /**
   * Fire and forget, deliberately.
   *
   * The window can be destroyed between a step starting and this resolving —
   * that is the normal ending, not an error — and a rejected promise here would
   * become an unhandled rejection during a perfectly successful startup.
   */
  const run = (script: string): void => {
    if (closed || window.isDestroyed()) {
      return;
    }
    void window.webContents.executeJavaScript(script).catch(() => {
      /* the window went away; nothing to report */
    });
  };

  return {
    step(id) {
      run(`window.dashSplashStep(${JSON.stringify(id)})`);
    },
    fail(id) {
      const recovery = describeStartupFailure(id);
      run(`window.dashSplashFail(${JSON.stringify(recovery)})`);
      if (!closed && !window.isDestroyed()) {
        // A failed startup is the one case this window must outlive: it is now
        // the only thing telling the user what happened, and closing it on a
        // timer would take the message away before it was read.
        window.setResizable(true);
      }
    },
    close() {
      closed = true;
      if (!window.isDestroyed()) {
        window.close();
      }
    },
  };
}

/**
 * The splash document.
 *
 * Inline styles rather than `app/tokens.css`, because this window paints before
 * the renderer exists and cannot import from it. The two values that must match
 * across that gap — the surface colour, and it alone — come from
 * `lib/shell/chrome.ts`, which is the same module `createWindow` and the title
 * bar read. Nothing else here is shared with the app, and nothing else needs
 * to be: no seam is visible between two windows that are never on screen
 * together.
 */
function document(theme: ThemeName): string {
  const dark = theme === "dark";
  const surface = SURFACE_0[theme];
  const text = dark ? "#e8ecf3" : "#131722";
  const muted = dark ? "#9aa5b8" : "#5a6474";
  const line = dark ? "#232a36" : "#dfe4ec";
  const accent = dark ? "#4d8dff" : "#1d5fd6";
  const err = dark ? "#ff6b5e" : "#b3261e";

  const steps = STARTUP_STEPS.map(
    (step) =>
      `<li data-step="${step.id}"><span class="dot"></span><span>${escapeHtml(step.label)}</span></li>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>DASH</title>
<style>
  :root { color-scheme: ${theme}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    justify-content: center; gap: 16px; padding: 24px 28px;
    background: ${surface}; color: ${text};
    font: 15px/1.55 Inter, "Segoe UI Variable Text", "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    -webkit-app-region: drag; user-select: none; cursor: default;
    border: 1px solid ${line};
  }
  h1 { margin: 0; font-size: 1rem; font-weight: 650; letter-spacing: -0.01em; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: center; gap: 10px; color: ${muted}; font-size: 0.8125rem; }
  .dot { width: 6px; height: 6px; border-radius: 999px; background: ${line}; flex: none; }
  li[data-state="active"] { color: ${text}; }
  li[data-state="active"] .dot { background: ${accent}; }
  li[data-state="done"] .dot { background: ${accent}; opacity: 0.45; }
  #failure { display: none; }
  #failure h2 { margin: 0 0 6px; font-size: 0.9375rem; color: ${err}; }
  #failure p { margin: 0 0 6px; font-size: 0.8125rem; color: ${muted}; }
  #failure p.next { color: ${text}; }
  body[data-failed="true"] ol { display: none; }
  body[data-failed="true"] #failure { display: block; }
</style>
</head>
<body>
  <h1>Starting DASH</h1>
  <ol id="steps">${steps}</ol>
  <section id="failure" role="alert">
    <h2 id="failure-headline"></h2>
    <p id="failure-meaning"></p>
    <p class="next" id="failure-next"></p>
  </section>
<script>
  // Only ever called by main, with a step id from its own union. Written with
  // textContent throughout: nothing here builds markup from a value.
  window.dashSplashStep = function (id) {
    var seen = false;
    document.querySelectorAll("#steps li").forEach(function (item) {
      if (item.dataset.step === id) { seen = true; item.dataset.state = "active"; }
      else { item.dataset.state = seen ? "" : "done"; }
    });
  };
  window.dashSplashFail = function (recovery) {
    document.getElementById("failure-headline").textContent = recovery.headline;
    document.getElementById("failure-meaning").textContent = recovery.meaning;
    document.getElementById("failure-next").textContent = recovery.next_action;
    document.body.dataset.failed = "true";
  };
</script>
</body>
</html>`;
}

/** The step labels are ours, but building markup from a string without this is a habit worth not having. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
