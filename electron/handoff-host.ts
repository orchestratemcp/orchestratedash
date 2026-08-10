/**
 * The Electron half of the handoff: dialogs, ports and the OS registration.
 *
 * Everything that *decides* anything is in `lib/handoff-flow.ts`, which is pure
 * of Electron and covered by the suite that runs on every push. What is left
 * here is the part that genuinely cannot be tested without a real Electron
 * process — showing a dialog, claiming a URL scheme, focusing a window — and it
 * is kept as small as that description implies, for the same reason
 * `electron/main.ts` is thin.
 *
 * ## Why the consent question is a native dialog and not a page
 *
 * The handoff originates outside the renderer and may be the event that starts
 * DASH, before any page exists. Its consent gate therefore cannot depend on a
 * page loading successfully. Keeping it native also makes the question
 * unspoofable by page content and prevents a compromised or broken renderer
 * from replacing, suppressing or approving it.
 *
 * MAR-432 (DASH-20) replaced the packaged placeholder with the real UI. That
 * removes the historical reason a page could not host the question; it does not
 * remove any of the trust or startup reasons above. MAR-423 (DASH-19) owns
 * making the rest of onboarding beautiful. This gate has to remain trustworthy.
 */

import { app, dialog } from "electron";

// MAR-436. `getAllWindows()[0]` used to answer "the DASH window"; the splash
// made that wrong for the first seconds of every launch. See `./app-window.ts`.
import { appWindow } from "./app-window";

import path from "node:path";

import { HANDOFF_SCHEME } from "../lib/handoff";
import {
  openHandoff,
  removeAgent,
  type HandoffPorts,
  type HandoffPrompt,
  type HandoffReport,
  type RunnerPort,
} from "../lib/handoff-flow";
import { readHandoffRecord, recordHandoff } from "../lib/handoff-ledger";
import { runnerLifecycle } from "../lib/runner-lifecycle";
import { forgetAgent, importManifest } from "../lib/store";
import { runnerFetch, type RunnerHandle } from "./runner-process";

/**
 * Claim the `dash://` scheme with the operating system.
 *
 * In a packaged install this is the MSIX manifest's job — see the
 * `windows.protocol` extension in `build/appx/AppxManifest.xml`, which is what
 * an installed DASH actually registers with. This call is what makes the
 * *developer* path work, where there is no package and no manifest, and it is
 * harmless in a packaged app because the manifest has already won.
 *
 * The argv dance is Electron's documented requirement on Windows: an unpackaged
 * app must tell Windows both which executable to launch and which arguments to
 * put before the URL, or the handler resolves to `electron.exe` with no project
 * and opens a blank app.
 *
 * ## Why the entry point is checked rather than trusted
 *
 * `process.argv[1]` is whichever script Electron was started with, and more than
 * one script imports `main.ts`. `electron/smoke.ts` is the one that matters: a
 * proof run would register *itself* as the machine's `dash://` handler, and the
 * next handoff link a user clicked would launch the harness, run its proofs and
 * call `app.exit()`. The link appears to do nothing at all.
 *
 * That is not hypothetical — it is what a smoke run had actually left on this
 * developer's machine, and it silently broke MAR-428's whole zero-file-picker
 * flow until somebody looked in the registry.
 *
 * So a script that is not the app's entry point does not touch the registration.
 * Doing nothing is deliberately the failure mode: a correct registration from an
 * earlier `pnpm shell` survives a smoke run, where overwriting-then-restoring
 * would leave the machine broken for as long as the harness ran.
 */
export function isAppEntryPoint(entry: string): boolean {
  // `package.json`'s `main` is `dist/electron/main.mjs`, and `electron .`
  // resolves argv[1] to exactly that. The basename is what distinguishes it from
  // `smoke.mjs` beside it; the directory is the same for both.
  //
  // Split on both separators rather than using `path.basename`, which follows the
  // platform it runs on: the bug this guards against is a Windows one, and on a
  // posix CI runner `path.basename` does not split a backslash path at all, so
  // the case that matters would go untested.
  return ["main.mjs", "main.js"].includes(entryBasename(entry));
}

function entryBasename(entry: string): string {
  return entry.split(/[\\/]/).pop() ?? "";
}

export function registerProtocolClient(): void {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(HANDOFF_SCHEME);
    return;
  }
  const entry = process.argv[1];
  if (entry === undefined) {
    app.setAsDefaultProtocolClient(HANDOFF_SCHEME);
    return;
  }
  if (!isAppEntryPoint(entry)) {
    console.warn(
      `[dash-shell] not claiming ${HANDOFF_SCHEME}:// from ${entryBasename(entry)} — ` +
        "only the app's own entry point may be the handler",
    );
    return;
  }
  app.setAsDefaultProtocolClient(HANDOFF_SCHEME, process.execPath, [path.resolve(entry)]);
}

/**
 * A `RunnerPort` over the bundled runner's own socket or pipe.
 *
 * Null in, null out: a machine where no runner could be started gets a flow that
 * refuses to claim an agent is running, rather than one that cannot run at all.
 */
export function runnerPort(runner: RunnerHandle | null): RunnerPort | null {
  if (runner === null) {
    return null;
  }
  // Bound to a const so the narrowing survives into the closures below: a
  // parameter is a mutable binding, and TypeScript will not carry a null check
  // on one across a function boundary.
  const handle = runner;
  const call = runnerFetch(handle);
  const authorized = { authorization: `Bearer ${handle.token}` };
  // The stop-is-true decision lives in lib/runner-lifecycle.ts (MAR-597),
  // where the suite can reach it. This file only wires the transport.
  const { lifecycle } = runnerLifecycle(call, handle.origin, authorized);

  return {
    async reload(): Promise<{ ok: boolean; detail?: string }> {
      try {
        const response = await call(`${handle.origin}/registrations/reload`, {
          method: "POST",
          headers: authorized,
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json()) as { ok?: boolean; detail?: string };
        return { ok: body.ok === true, detail: body.detail };
      } catch {
        return { ok: false, detail: "The runner could not be reached." };
      }
    },
    start: (agentId) => lifecycle(agentId, "start"),
    stop: (agentId) => lifecycle(agentId, "stop"),
  };
}

/**
 * The real ports, wired to this installation's store, ledger and runner.
 *
 * `dataDir` is passed in rather than recomputed. `docs/msix-lifecycle-evidence.md`
 * is emphatic about why: a package-activated MSIX app's AppData is transparently
 * redirected, so any component that *derives* the conventional path lands
 * somewhere the packaged app cannot see. There is exactly one authority for
 * where DASH's data is, and it is `lib/db.ts`'s resolved `dataDir`.
 */
export function handoffPorts(dataDir: string, runner: RunnerHandle | null): HandoffPorts {
  return {
    dataDir,
    now: () => new Date(),
    confirm: askUser,
    importManifest: (manifest, options) => {
      const result = importManifest(manifest, options);
      return result.ok
        ? { ok: true }
        : { ok: false, errors: result.errors, locked: result.locked };
    },
    forgetAgent,
    recordHandoff,
    readHandoffRecord,
    runner: runnerPort(runner),
    log: (line) => {
      console.warn(line);
    },
  };
}

/**
 * Ask the person, modally, on top of the DASH window if there is one.
 *
 * `cancelId` and `defaultId` both point at "no". A dialog that runs a program
 * when someone hits Return by reflex is not a consent dialog, and the cost of
 * getting this wrong is asymmetric: declining costs one more click, agreeing by
 * accident starts a process.
 */
async function askUser(prompt: HandoffPrompt, expiresAt: string): Promise<boolean | "expired"> {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return "expired";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, expiresAtMs - Date.now());
  timeout.unref();

  const parent = appWindow();
  const options = {
    type: "question" as const,
    title: prompt.title,
    message: prompt.message,
    detail: prompt.detail,
    buttons: [prompt.confirm_label, prompt.cancel_label],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    signal: controller.signal,
  };

  try {
    const answer =
      parent === null
        ? await dialog.showMessageBox(options)
        : await dialog.showMessageBox(parent, options);
    if (controller.signal.aborted || Date.now() >= expiresAtMs) {
      return "expired";
    }
    return answer.response === 0;
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      return "expired";
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Report an outcome that needs no decision. */
export function reportOutcome(report: HandoffReport): void {
  const parent = appWindow();
  const options = {
    type: report.ok ? ("info" as const) : ("warning" as const),
    title: report.ok ? "DASH" : "DASH could not add that agent",
    message: report.headline,
    detail: report.detail ?? "",
    buttons: ["OK"],
    noLink: true,
  };
  if (parent === null) {
    void dialog.showMessageBox(options);
  } else {
    void dialog.showMessageBox(parent, options);
  }
}

/**
 * Bring DASH forward, because a deep link means the user is looking for it.
 *
 * Restoring a minimised window before focusing it is the part that is easy to
 * forget and very visible when missing: `focus()` on a minimised window on
 * Windows flashes the taskbar button and shows nothing.
 */
export function surfaceWindow(): void {
  const window = appWindow();
  if (window === null) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

/**
 * The whole user-visible sequence for one link: surface, ask, act, report.
 *
 * Serialised by the caller in `electron/main.ts`. Two links arriving at once —
 * an impatient double click on "Open in DASH" — must not produce two dialogs
 * racing to register the same agent, and the flow's idempotency is a property of
 * its *outcome*, not a substitute for not asking twice.
 */
export async function openHandoffLink(url: string, ports: HandoffPorts): Promise<HandoffReport> {
  surfaceWindow();
  const report = await openHandoff(url, ports);
  reportOutcome(report);
  return report;
}

/** Removing an agent, with the same report-what-happened contract. */
export async function removeAgentWithReport(
  agentId: string,
  ports: HandoffPorts,
  options: { deleteFiles?: boolean } = {},
): Promise<{ ok: boolean; detail: string }> {
  const report = await removeAgent(agentId, ports, options);
  const lines = [
    report.headline,
    ...(report.removed.length > 0
      ? ["", "Removed:", ...report.removed.map((item) => `• ${item}`)]
      : []),
    ...(report.left_alone.length > 0
      ? ["", "Left alone:", ...report.left_alone.map((item) => `• ${item}`)]
      : []),
  ];
  return { ok: report.ok, detail: lines.join("\n") };
}
