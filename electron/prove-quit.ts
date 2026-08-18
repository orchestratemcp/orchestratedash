/**
 * Does DASH actually exit when its window is closed? (MAR-678)
 *
 * Not a release gate and not a unit test — the same terms as
 * `electron/prove-start.ts` and `electron/prove-browser.ts`. This one drives the
 * **real** quit chain: it imports `electron/main.ts`, lets the app boot exactly
 * as a double-click does, closes the app window the way the X does, and then
 * reports whether `window-all-closed` -> `before-quit` -> `will-quit` -> `quit`
 * actually completed or whether the process is still alive with no window.
 *
 * That last state is the defect. On 2026-08-17 it cost two Windows restarts:
 * the main process survived the close, windowless, holding the store lock, and
 * `AGENTS.md` forbids force-killing it. Nothing in this repository could see it
 * — `electron/smoke.ts` ends with `app.exit`, which skips the quit chain
 * entirely, so eighty-five smoke proofs pass over the path this harness walks.
 *
 * ## The scenes
 *
 * `plain` closes the window with nothing else open. This is the control: it is
 * expected to pass even on a build with the defect, which is what makes a
 * failure of the other scene mean something.
 *
 * `approval` first shows and then hides the approval popup — the two calls
 * `electron/approval-notifier.ts` makes when an approval arrives and is then
 * decided. `electron/approval-popup.ts` hides that window rather than closing
 * it and says so in its own docblock ("never destroyed while DASH runs"), and a
 * hidden `BrowserWindow` is an *open* window as far as `window-all-closed` is
 * concerned. So any session that ever had one live approval leaves a window
 * Electron is still counting, `window-all-closed` never fires, `app.quit()` is
 * never called, and DASH cannot exit. That is the shape Henrik saw, down to the
 * one surviving renderer child beside the GPU and network-utility processes.
 *
 * `wedged` is the backstop's own scene. It opens a window DASH's teardown knows
 * nothing about — standing in for the next ancillary window somebody adds, and
 * refusing its own close the way the approval popup does — and then closes the
 * app window. Nothing in the quit chain will ever close that window, so the only
 * thing that can end this run is `main.ts`'s own deadline. Read its two lines
 * together: this harness reports the exit, and the shell reports *why* it had to
 * force one ("the quit did not complete within 5000ms"), naming the window that
 * would otherwise have cost a restart. A pass here is a pass of the last resort,
 * not of the fix — the `approval` scene is the fix.
 *
 * `brief_print` proves `electron/brief-pdf.ts`'s hazard is actually mitigated
 * rather than only documented (MAR-674, ADR 0025 decision 4). It opens a hidden
 * `BrowserWindow` the same way `exportBriefAsPdf` does — a `data:` URL, no
 * preload, sandboxed, never navigating — lets it sit for two seconds the way a
 * real print would, then destroys it itself, exactly as that module's `finally`
 * does. Unlike `wedged`, this window IS destroyed before the app window closes,
 * so a pass here demonstrates the `finally` block's own cleanup keeps DASH
 * quittable, not merely that some later window was never opened.
 *
 * ## Running it
 *
 * ```powershell
 * pnpm build:renderer; pnpm build:shell
 * $env:DASH_SHELL_URL='dash-app://ui/'
 * $env:DASH_DATA_DIR='C:\Users\<you>\AppData\Local\Temp\dash-prove-quit'
 * $env:DASH_PROVE_QUIT_SCENE='approval'   # or 'plain'
 * pnpm exec electron --user-data-dir=<isolated profile> dist/electron/prove-quit.mjs
 * ```
 *
 * `DASH_DATA_DIR` is **required and deliberately not defaulted**, for the reason
 * `prove-start.ts` gives at length: a harness runs as `Electron`, not as
 * `orchestratedash`, so a forgotten override resolves somewhere that is not
 * DASH's store. Here it matters twice over, because this harness deliberately
 * ends a process that holds a store lock. Point it at a scratch directory.
 *
 * The scratch store gets its own runner. `DASH_PROVE_QUIT_RUNNER=stop` (the
 * default) shuts that runner down through the authenticated `/shutdown` route
 * before the window closes, so a proof run does not leave a process behind;
 * `leave` reproduces MAR-415's real arrangement, where the runner outlives DASH
 * and keeps its own handle on the store. Both are honest, and the quit chain
 * does not touch the runner either way — see `app.on("before-quit")` in
 * `electron/main.ts`, which stops the poller and leaves the process alone.
 */
import "./main.js";

import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appWindow } from "./app-window.js";
import { setApprovalPopupVisible } from "./approval-popup.js";
import { ensureRunner, stopRunner } from "./runner-process.js";
import { dataDir } from "../lib/db";
import type { ApprovalWorkRow } from "../lib/shell/approval-popup";
import { RENDERER_ORIGIN } from "../lib/shell/renderer-scheme";

const SCENE = process.env["DASH_PROVE_QUIT_SCENE"] ?? "approval";
const RUNNER_MODE = process.env["DASH_PROVE_QUIT_RUNNER"] ?? "stop";
const DEADLINE_MS = Number(process.env["DASH_PROVE_QUIT_DEADLINE_MS"] ?? "12000");
const out = path.resolve(process.cwd(), process.env["DASH_CAPTURE_DIR"] ?? "qa-proof-mar678");

const started = Date.now();
const stages: string[] = [];

function note(stage: string): void {
  stages.push(`+${String(Date.now() - started)}ms ${stage}`);
  console.log(`[prove-quit] ${stage}`);
}

/**
 * Every window Electron still counts, which is the whole question.
 *
 * `getAllWindows` excludes destroyed windows, so anything listed here is a
 * window `window-all-closed` is still waiting on — visible or not.
 */
function windows(): Array<{ title: string; visible: boolean }> {
  return BrowserWindow.getAllWindows().map((window) => ({
    title: window.getTitle(),
    visible: window.isVisible(),
  }));
}

function describeWindows(): string {
  const open = windows();
  return open.length === 0
    ? "no windows"
    : open.map((w) => `${JSON.stringify(w.title)}${w.visible ? "" : " (hidden)"}`).join(", ");
}

/** A plausible live approval. Only its existence matters; see `setApprovalPopupVisible`. */
function approval(): ApprovalWorkRow {
  return {
    kind: "approval",
    id: "prove-quit-approval",
    task_id: "prove-quit-task",
    task_label: "Send the digest",
    run_id: "prove-quit-run",
    label: "Send the digest",
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    expired: false,
    options: [],
    action_id: "prove-quit-action",
    action_label: "Send an email to the meeting attendees",
    agent: "prove-quit-agent",
    agent_title: "Prove Quit",
    observed_at: new Date().toISOString(),
  };
}

let reported = false;

/**
 * The verdict, written once.
 *
 * Written from the `quit` event on the good path and from the deadline timer on
 * the bad one, so the file exists either way — including the way where nothing
 * ever prints again because the process is wedged.
 */
function report(quit: boolean): void {
  if (reported) {
    return;
  }
  reported = true;
  const survivors = windows();
  const verdict = quit ? "PASS" : "FAIL";
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, `quit-${SCENE}.json`),
    `${JSON.stringify({ scene: SCENE, runner: RUNNER_MODE, quit, survivors, stages }, null, 2)}\n`,
  );
  console.log(
    `[prove-quit] ${verdict} scene=${SCENE} the app quit when its window closed` +
      (quit ? "" : ` — still alive after ${String(DEADLINE_MS)}ms with ${describeWindows()}`),
  );
  for (const stage of stages) {
    console.log(`[prove-quit]   ${stage}`);
  }
  if (!quit) {
    // The harness ends itself rather than leaving the very survivor it exists to
    // report. `app.exit` skips `will-quit`, which is exactly right here: the
    // quit chain is what failed, and running half of it now would muddy the
    // evidence. WAL means the store is durable regardless.
    app.exit(1);
  }
}

// `prependListener`, not `on`: `main.ts` registered its own handlers at import
// time and quits from inside them, so an appended listener would record stages
// in an order that reads backwards.
app.prependListener("window-all-closed", () => {
  note(`window-all-closed (${describeWindows()})`);
});
app.prependListener("before-quit", () => {
  note("before-quit");
});
app.prependListener("will-quit", () => {
  note("will-quit");
});
app.prependListener("quit", () => {
  note("quit");
  report(true);
});

async function windowReady(): Promise<BrowserWindow> {
  for (;;) {
    const window = appWindow();
    if (window !== null && !window.webContents.isLoading()) {
      return window;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  await app.whenReady();
  const window = await windowReady();
  note(`app window ready (${describeWindows()})`);

  if (SCENE === "approval") {
    // Exactly what a notifier tick does when an approval arrives, and then what
    // the next tick does once it has been decided.
    setApprovalPopupVisible([approval()], RENDERER_ORIGIN);
    await settle(2_000);
    note(`approval shown (${describeWindows()})`);
    setApprovalPopupVisible([], RENDERER_ORIGIN);
    await settle(1_000);
    note(`approval resolved (${describeWindows()})`);
  }

  if (SCENE === "wedged") {
    // Not DASH's window and not known to any teardown it runs — which is the
    // point. `show: false` so it reproduces the shape that is hard to notice:
    // a window nobody can see, keeping a process alive nobody may kill.
    const stray = new BrowserWindow({ show: false, title: "prove-quit stray window" });
    stray.on("close", (event) => {
      event.preventDefault();
    });
    note(`stray window opened (${describeWindows()})`);
  }

  if (SCENE === "brief_print") {
    // The same shape `exportBriefAsPdf` creates: hidden, no preload, sandboxed,
    // never navigating. See that module's header for why each option is there —
    // this scene exists to prove its `finally` really frees the process, not to
    // re-argue the options themselves.
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: undefined,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        experimentalFeatures: false,
      },
    });
    printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    printWindow.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });
    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent("<html><body>prove-quit brief_print scene</body></html>")}`,
    );
    note(`print window loaded (${describeWindows()})`);
    await settle(2_000);
    printWindow.destroy();
    note(`print window destroyed (${describeWindows()})`);
  }

  if (RUNNER_MODE === "stop") {
    // Adopting this store's own runner to get a handle for it, then shutting it
    // down over the authenticated route. Nothing about the quit path depends on
    // this; it is here so a proof run is not a process leak.
    const runner = await ensureRunner(dataDir);
    if (runner.ok) {
      const stopped = await stopRunner(runner.handle);
      note(`runner stopped: ${stopped.ok ? "yes" : `no — ${stopped.detail}`}`);
    } else {
      note(`no runner to stop (${runner.reason})`);
    }
  }

  note(`closing the app window (${describeWindows()})`);
  if (SCENE === "wedged") {
    console.log(
      "[prove-quit] wedged: nothing here will close that stray window, so a pass means " +
        "the shell's own deadline ended the process — expect its line beside this one",
    );
  }
  window.close();

  setTimeout(() => {
    report(false);
  }, DEADLINE_MS);
}

void run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
