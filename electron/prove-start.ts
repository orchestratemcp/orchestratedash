/**
 * The run record MAR-657 is actually about.
 *
 * Not a release gate and not a test. This drives the real shell against a real
 * store, presses the control this issue adds, and reports whether an agent that
 * was `offline` with nothing waiting ended up with a run — which is the one
 * claim no unit test in this repository can make, because every part of it that
 * matters is a process this repository does not own.
 *
 * ## Running it
 *
 * ```powershell
 * pnpm build:renderer; pnpm build:shell
 * $env:DASH_SHELL_URL='dash-app://ui/'
 * $env:DASH_DATA_DIR='C:\Users\<you>\AppData\Roaming\orchestratedash'
 * $env:DASH_PROVE_AGENT='competitor-scout'
 * pnpm exec electron --user-data-dir=<isolated profile> dist/electron/prove-start.mjs
 * ```
 *
 * `DASH_DATA_DIR` is **required and deliberately not defaulted.** A capture
 * harness runs as `Electron` rather than as `orchestratedash`, so
 * `app.getPath("userData")` resolves somewhere that is not DASH's store — a run
 * that quietly defaulted would photograph an empty fleet and report a triumph.
 * `--user-data-dir` is the separate, Chromium-level profile, isolated so a run
 * beside another worktree's does not fight it for a cache.
 *
 * Nothing here writes to the store. Every mutation is one the renderer performs
 * through the ordinary command channel, which is the whole point: a harness that
 * inserted a run would be evidence of nothing.
 */
import "./main.js";
import { app } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { appWindow } from "./app-window.js";

const AGENT = process.env["DASH_PROVE_AGENT"] ?? "competitor-scout";
const out = path.resolve(process.cwd(), process.env["DASH_CAPTURE_DIR"] ?? "qa-screenshots-mar657");

/** How long to let the whole press settle, in 500 ms steps. */
const SETTLE_STEPS = 120;

interface Observation {
  status: string;
  control: string;
  runs: number;
  tasks: string[];
  feedback: string | null;
}

async function windowReady() {
  for (;;) {
    const window = appWindow();
    if (window !== null && !window.webContents.isLoading()) {
      return window;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * What the page says about this agent, read from the rendered DOM and the same
 * view the page renders from.
 *
 * The control is read as the primary button's own text rather than inferred
 * from the snapshot, because the claim under test is that a person sees a
 * control — and `innerText` uppercases a chip in this design system, so the
 * comparison below is deliberately case-insensitive.
 */
const OBSERVE = `(() => {
  const primary = document.querySelector('.agent-controls .button-primary');
  const feedback = document.querySelector('.notice');
  return window.dashData.workspace(${JSON.stringify(AGENT)}).then((view) => ({
    status: view.data?.snapshot?.overview?.status ?? 'no-snapshot',
    control: primary === null ? 'none' : primary.textContent.trim(),
    runs: view.data?.snapshot?.runs?.length ?? 0,
    tasks: (view.data?.snapshot?.tasks ?? []).map((task) => task.id + '/' + task.status),
    feedback: feedback === null ? null : feedback.textContent.trim(),
  }));
})()`;

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(out, { recursive: true });
  const window = await windowReady();

  const url = new URL(
    `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=run`,
    window.webContents.getURL(),
  ).toString();
  await window.loadURL(url);
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const before = (await window.webContents.executeJavaScript(OBSERVE)) as Observation;
  console.log(`[prove-start] before: ${JSON.stringify(before)}`);
  writeFileSync(path.join(out, "before.json"), `${JSON.stringify(before, null, 2)}\n`);
  writeFileSync(path.join(out, "before.png"), (await window.webContents.capturePage()).toPNG());

  if (before.control.toLowerCase() !== "start and run") {
    throw new Error(
      `expected a start control for a stopped agent, found ${JSON.stringify(before.control)}`,
    );
  }

  // The press itself. A real click on the real button, so nothing about the
  // page's own wiring is bypassed — a harness calling `startAgent` directly
  // would prove the bridge works and leave the control unproven.
  await window.webContents.executeJavaScript(
    `document.querySelector('.agent-controls .button-primary').click()`,
  );

  let after = before;
  for (let step = 0; step < SETTLE_STEPS; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    after = (await window.webContents.executeJavaScript(OBSERVE)) as Observation;
    if (after.runs > before.runs) {
      break;
    }
  }

  console.log(`[prove-start] after: ${JSON.stringify(after)}`);
  writeFileSync(path.join(out, "after.json"), `${JSON.stringify(after, null, 2)}\n`);
  writeFileSync(path.join(out, "after.png"), (await window.webContents.capturePage()).toPNG());

  const started = after.status !== "offline" && after.status !== "error";
  const ran = after.runs > before.runs;
  console.log(
    `[prove-start] ${started ? "PASS" : "FAIL"} the process started (${before.status} -> ${after.status})`,
  );
  console.log(
    `[prove-start] ${ran ? "PASS" : "FAIL"} a run exists (${String(before.runs)} -> ${String(after.runs)})`,
  );
  app.exit(started && ran ? 0 : 1);
}

void run().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
