/**
 * MAR-746's two numbers, measured in the real shell rather than argued about:
 * how long a key press takes to produce any reaction, and how many turns N
 * rapid presses produce. **Not part of the shipped shell.**
 *
 * ## Why a harness rather than a test
 *
 * Every test in this repository is `renderToStaticMarkup` or a pure function,
 * and neither can answer either question. "Enter sent three times" is a race
 * between an OS input event, Chromium's browser process, React's commit and an
 * `invoke` round trip — four things a static render does not have. So this
 * measures the real path end to end and writes the numbers down.
 *
 * ## What it measures, and why it is decomposed the way it is
 *
 * A press that produces no reaction for seconds can be blocked in exactly two
 * places, and the fix is different for each:
 *
 * - **Delivery** — `dispatched_at` (main, just before `sendInputEvent`) to the
 *   renderer's own `keydown` listener. Chromium routes OS input through the
 *   *browser* process, which in Electron is where our `main.ts` runs, so a main
 *   process blocked in a synchronous SQLite read does not merely make `invoke`
 *   slow: it stops key presses reaching the page at all. That is the failure
 *   mode MAR-746 lists first, and this number is what proves or clears it.
 * - **Reaction** — the renderer's `keydown` to the first mutation anywhere in
 *   the composer's subtree. This is React's own commit, and it is what the
 *   in-flight guard changes: before the guard the composer's DOM does not
 *   change at all until an answer lands, so there is no reaction to see.
 *
 * `sendInputEvent` rather than `element.click()`/`dispatchEvent` on purpose:
 * the scripted paths start *inside* the renderer and would skip the browser
 * process entirely, which is the half of the journey most likely to be the
 * slow one. A harness that measured the scripted path would report a
 * millisecond and be measuring the wrong thing.
 *
 * Beside those two, main's own event loop is sampled for the whole run
 * (`watchMainLoop`), because a delivery number is only evidence about a cause
 * if we also know whether main was ever blocked long enough to be one.
 *
 * ## The stall scene, and why it is the one that settles the argument
 *
 * A press measured on an idle machine cannot distinguish "the acknowledgment is
 * local" from "the acknowledgment is a round trip that happened to be fast".
 * `measureUnderStall` takes main away on purpose — a real busy loop, right after
 * the press — and reads the two halves again. If `deliver_ms` comes back at
 * roughly the block, a blocked main is stopping key presses from reaching the
 * page at all and no renderer-side guard can help; if `deliver_ms` stays small
 * while `react_ms` used to be the whole block, the press was always arriving and
 * only the *reaction* was hostage to main. That is the question MAR-746 asks
 * first, and this is the scene that answers it with a number.
 *
 * ## The repeat count
 *
 * `chief_messages` is the ground truth Henrik's own report cited — three
 * identical turns a minute apart. So the repeat scene counts rows rather than
 * asking the page what it thinks happened: `PRESSES` Enters, dispatched faster
 * than one `invoke` can return, then the turn count. One press must produce one
 * row and `PRESSES` presses must also produce one row, because every press
 * after the first lands on a disabled field.
 *
 * The question is a **standing** one (`lib/chief/reply.ts`'s `STANDING_WORDS`
 * — "fleet"), which is answered from records with no provider, no key and no
 * charge. That is not a shortcut around the real path: `performChiefAction`
 * runs in full and writes a real row either way, and choosing the free arm is
 * what lets this run on any machine and never spend anybody's money to prove a
 * duplicate-send bug.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window — `capture-mar615.ts`'s
 * terms, and for its reasons. DASH may stay open: `smoke-identity.js` is
 * deliberately not imported, so this borrows neither the app's single-instance
 * lock nor its user-data directory.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     mkdir '…\scratch-mar746'
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-mar746'
 *     $env:DASH_CAPTURE_DIR='qa-lag-mar746/after'
 *     pnpm exec electron dist/electron/capture-lag.mjs --user-data-dir=…\ud-mar746
 *
 * **`DASH_DATA_DIR` must already exist** — `lib/db.ts` resolves it at import
 * time and `import "./main.js"` is hoisted above every statement here, so a
 * missing directory fails as an Electron error dialog that reads exactly like a
 * hang. `--user-data-dir` is not optional when more than one worktree exists on
 * the machine. See `capture-mar615.ts` for the full account of both.
 *
 * ## What it leaves behind, said out loud
 *
 * One live runner against a scratch store, as every capture harness here does.
 * Harmless to anybody's records and not harmless to the next `pnpm verify:shell`
 * on this machine — name the leftover pid in whatever you write.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { readChiefTurns } from "../lib/chief/store.js";
import { importManifest } from "../lib/store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-lag-mar746");

/**
 * How many Enters the repeat scenes fire, and how far apart.
 *
 * Two gaps, and the reason for the first one is the finding that made this
 * harness worth keeping. **The duplicate-send defect is latency-gated**: N
 * presses only become N turns when they all land inside one in-flight ask, so on
 * an idle machine where the round trip is a handful of milliseconds a 25ms gap
 * reproduces nothing at all — the first ask has already returned and cleared the
 * field before the second press arrives. Henrik's round trip was seconds, so his
 * three presses were trivially inside one window.
 *
 * `0` is that window made unconditional. `sendInputEvent` returns to main
 * without waiting, so a gapless burst queues every press in the renderer's own
 * input queue ahead of any reply the first one could receive — which is exactly
 * the state Henrik was in, reached by making the presses fast rather than by
 * making the machine slow. No human presses Enter five times in no time, and
 * that is not the claim: the claim is that *however* N presses come to be inside
 * one in-flight window, they must produce one turn, and a gapless burst is the
 * sharpest available test of it.
 *
 * `SPACED_GAP_MS` keeps the human-paced version beside it. It is the weaker
 * test — it can pass for the wrong reason on a fast machine — and it is here so
 * that a run on a *loaded* machine, where it is the realistic one, has its
 * number too.
 */
const PRESSES = 5;
const SPACED_GAP_MS = 25;

/**
 * How many separate presses the latency scene measures, and how far apart.
 *
 * Spread over half a minute rather than taken once, because the cause MAR-746
 * names first — main blocked in synchronous work — would be **periodic**, not
 * constant: `electron/agent-adapters.ts` polls every five seconds and writes
 * what it finds. A single press has no way to tell a fast path from a slow path
 * sampled at a lucky moment, so this reports the distribution and the worst
 * case, and `main_loop.timeline` below says whether the worst press coincided
 * with a stall in main.
 */
const LATENCY_SAMPLES = 12;
const LATENCY_GAP_MS = 2_500;

/** A standing question — answered from records, so this costs nothing. */
const QUESTION = "How is the fleet doing?";

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

function renamed(file: string, name: string, displayName: string): Record<string, unknown> {
  const manifest = example(file);
  const agent = manifest["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;
  return manifest;
}

/**
 * Four agents through the ordinary door, so the fleet page has cards to draw
 * and `agentsView()` has real work to do on every question.
 */
function seed(): void {
  importManifest(renamed("gmail-meeting-assistant.manifest.v2.example.json", "budget-digest", "Budget Digest"));
  importManifest(renamed("dash-managed-secret.manifest.v2.example.json", "deal-finder", "Deal Finder"));
  importManifest(renamed("agent.manifest.example.json", "ledger-notes", "Ledger Notes"));
  importManifest(renamed("dash-managed.manifest.v2.example.json", "news-scout", "News Scout"));
  console.log("[lag] seeded 4 agents");
}

/* ---------------------------------------------------------------------- *
 * Harness plumbing — `capture-mar615.ts`'s guards, unchanged
 * ---------------------------------------------------------------------- */

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function within<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish within ${String(ms)}ms`)), ms),
    ),
  ]);
}

async function painted(target: BrowserWindow): Promise<void> {
  if (!target.webContents.isLoading()) {
    return;
  }
  await new Promise<void>((resolve) => {
    target.webContents.once("did-finish-load", () => resolve());
    target.webContents.once("did-fail-load", () => resolve());
  });
}

function appWindowLoaded(): Promise<BrowserWindow> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no app window after 60s")), 60_000);
    const attach = (): void => {
      const window = appWindow();
      if (window === null) {
        setTimeout(attach, 100);
        return;
      }
      void painted(window).then(() => {
        clearTimeout(timer);
        resolve(window);
      });
    };
    attach();
  });
}

async function go(target: BrowserWindow, route: string): Promise<void> {
  const next = new URL(route, target.webContents.getURL()).toString();
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  await settle(1500);
}

/* ---------------------------------------------------------------------- *
 * The probes
 * ---------------------------------------------------------------------- */

interface LoopReport {
  samples: number;
  worst_late_ms: number;
  late_over_100ms: number;
  late_over_500ms: number;
  /** Every stall worth a name, with the wall clock it happened at. */
  timeline: { at: number; late_ms: number }[];
}

/**
 * How blocked main's own event loop was, for the whole run.
 *
 * A 20ms timer that records how late it actually fired. Lateness *is* the block:
 * nothing else can delay a timer in a single-threaded loop, and the worst sample
 * is a lower bound on the longest synchronous stretch main spent not answering
 * anybody — including, on Windows, not routing key presses to the renderer.
 */
function watchMainLoop(): () => LoopReport {
  const period = 20;
  let last = Date.now();
  const report: LoopReport = {
    samples: 0,
    worst_late_ms: 0,
    late_over_100ms: 0,
    late_over_500ms: 0,
    timeline: [],
  };
  const timer = setInterval(() => {
    const now = Date.now();
    const late = now - last - period;
    last = now;
    report.samples += 1;
    if (late > report.worst_late_ms) {
      report.worst_late_ms = late;
    }
    if (late > 100) {
      report.late_over_100ms += 1;
      report.timeline.push({ at: now, late_ms: late });
    }
    if (late > 500) {
      report.late_over_500ms += 1;
    }
  }, period);
  return () => {
    clearInterval(timer);
    return report;
  };
}

/**
 * The renderer's half: when a key press arrived, and when the composer's DOM
 * first changed because of it.
 *
 * `keydown` in the **capture** phase and on `window`, so the stamp is taken
 * before React's own listener rather than after it — the number being measured
 * is React's commit, and a probe that ran after React would subtract itself out
 * of the answer.
 *
 * The reaction is any mutation in `.chief-composer`'s subtree: attributes
 * (`disabled` appearing on the textarea), children (the activity line), or
 * text. Deliberately not "the textarea is disabled" specifically, so the same
 * probe measures the *before* state honestly — before the guard the first
 * mutation is the answer landing, which is exactly the seconds Henrik reported.
 */
const PROBE = `
(() => {
  const state = { keydown_at: null, reacted_at: null, long_tasks: [], press_count: 0 };
  window.__mar746 = state;
  window.addEventListener("keydown", () => {
    state.press_count += 1;
    if (state.keydown_at === null) { state.keydown_at = Date.now(); }
  }, true);
  const root = document.querySelector(".chief-composer");
  if (root !== null) {
    new MutationObserver(() => {
      if (state.reacted_at === null) { state.reacted_at = Date.now(); }
    }).observe(root, { subtree: true, attributes: true, childList: true, characterData: true });
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) { state.long_tasks.push(Math.round(entry.duration)); }
    }).observe({ entryTypes: ["longtask"] });
  } catch { /* no longtask support is not a reason to lose the rest */ }
  return root !== null;
})()
`;

interface Probe {
  keydown_at: number | null;
  reacted_at: number | null;
  long_tasks: number[];
  press_count: number;
}

async function readProbe(target: BrowserWindow): Promise<Probe> {
  return (await within(
    "read probe",
    10_000,
    target.webContents.executeJavaScript("JSON.parse(JSON.stringify(window.__mar746))"),
  )) as Probe;
}

/** Put the caret in the chief's field and type the question, without measuring either. */
async function primeComposer(target: BrowserWindow, text: string): Promise<boolean> {
  return (await within(
    "prime composer",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const field = document.querySelector("textarea.chief-input");
         if (field === null) { return false; }
         field.focus();
         const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
         setter.call(field, ${JSON.stringify(text)});
         field.dispatchEvent(new Event("input", { bubbles: true }));
         return true;
       })()`,
    ),
  )) as boolean;
}

/** One Enter, through the browser process, the way a finger produces one. */
function pressEnter(target: BrowserWindow): void {
  target.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  target.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
}

/* ---------------------------------------------------------------------- *
 * The scenes
 * ---------------------------------------------------------------------- */

const measurements: object[] = [];

interface PressSample {
  dispatched_at: number;
  deliver_ms: number | null;
  react_ms: number | null;
  total_ms: number | null;
  long_tasks_ms: number[];
}

/**
 * One press, decomposed.
 *
 * `timeoutMs` is generous on purpose: the point of a *before* run is to record
 * how many seconds it really took, and a tight bound would turn that number into
 * a failed scene instead of a finding.
 */
async function measureOnePress(target: BrowserWindow, timeoutMs = 30_000): Promise<PressSample> {
  const primed = await primeComposer(target, QUESTION);
  if (!primed) {
    throw new Error("the chief composer's textarea was not on the page");
  }
  await settle(300);
  // After priming, so the typing this harness did is not the reaction it reads.
  await target.webContents.executeJavaScript(PROBE);

  const dispatchedAt = Date.now();
  pressEnter(target);

  const deadline = Date.now() + timeoutMs;
  let probe = await readProbe(target);
  while (probe.reacted_at === null && Date.now() < deadline) {
    await settle(20);
    probe = await readProbe(target);
  }

  return {
    dispatched_at: dispatchedAt,
    deliver_ms: probe.keydown_at === null ? null : probe.keydown_at - dispatchedAt,
    react_ms:
      probe.keydown_at === null || probe.reacted_at === null ? null : probe.reacted_at - probe.keydown_at,
    total_ms: probe.reacted_at === null ? null : probe.reacted_at - dispatchedAt,
    long_tasks_ms: probe.long_tasks,
  };
}

function summarise(values: (number | null)[]): { median: number | null; worst: number | null } {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length === 0) {
    return { median: null, worst: null };
  }
  return {
    median: present[Math.floor(present.length / 2)] ?? null,
    worst: present[present.length - 1] ?? null,
  };
}

/**
 * Block main's own thread, hard, for `ms`.
 *
 * A busy loop and not a lie: Electron's main process *is* Chromium's browser
 * process, so a synchronous stretch here is the same stretch a slow store read,
 * a fat JSON parse or a machine with four DASH processes fighting over one core
 * produces. Making it happen on purpose is the only way to ask the question that
 * matters after the fix — *does the field grey out while main is unavailable, or
 * does the acknowledgment wait for main like the answer does?* — without
 * needing Henrik's exact machine and Henrik's exact afternoon.
 *
 * It also answers a question the guard alone cannot: whether a blocked main
 * stops the key press *reaching* the renderer at all. If it does, `deliver_ms`
 * in the stall scene comes back at roughly `ms` and no renderer-side fix can
 * help; if it does not, the press arrives on time and the guard is the whole
 * remedy. The before-run's own numbers said the second, and this is the scene
 * that says it under a stall large enough to be unambiguous.
 */
function blockMain(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* deliberately spinning */
  }
}

/** One press, with main taken away the instant after it is dispatched. */
async function measureUnderStall(target: BrowserWindow, blockMs: number): Promise<void> {
  const primed = await primeComposer(target, QUESTION);
  if (!primed) {
    throw new Error("the chief composer's textarea was not on the page");
  }
  await settle(300);
  await target.webContents.executeJavaScript(PROBE);

  const dispatchedAt = Date.now();
  pressEnter(target);
  blockMain(blockMs);

  const deadline = Date.now() + 30_000;
  let probe = await readProbe(target);
  while (probe.reacted_at === null && Date.now() < deadline) {
    await settle(20);
    probe = await readProbe(target);
  }

  measurements.push({
    scene: "under-stall",
    main_blocked_ms: blockMs,
    dispatched_at: dispatchedAt,
    deliver_ms: probe.keydown_at === null ? null : probe.keydown_at - dispatchedAt,
    react_ms:
      probe.keydown_at === null || probe.reacted_at === null ? null : probe.reacted_at - probe.keydown_at,
    total_ms: probe.reacted_at === null ? null : probe.reacted_at - dispatchedAt,
    long_tasks_ms: probe.long_tasks,
  });
}

/** `LATENCY_SAMPLES` presses spread over half a minute, so a periodic stall cannot hide. */
async function measureLatency(target: BrowserWindow): Promise<void> {
  const samples: PressSample[] = [];
  for (let i = 0; i < LATENCY_SAMPLES; i += 1) {
    samples.push(await measureOnePress(target));
    await settle(LATENCY_GAP_MS);
  }
  measurements.push({
    scene: "latency",
    samples: samples.length,
    deliver: summarise(samples.map((sample) => sample.deliver_ms)),
    react: summarise(samples.map((sample) => sample.react_ms)),
    total: summarise(samples.map((sample) => sample.total_ms)),
    presses: samples,
  });
}

/**
 * `PRESSES` Enters inside one in-flight ask, counted in the store.
 *
 * The turn count is read before and after rather than assumed to start at zero,
 * so a scene that runs twice, or a store that already had a conversation in it,
 * still reports the truth.
 */
async function measureBurst(target: BrowserWindow, gapMs: number, label: string): Promise<void> {
  const primed = await primeComposer(target, QUESTION);
  if (!primed) {
    throw new Error("the chief composer's textarea was not on the page");
  }
  await settle(300);
  await target.webContents.executeJavaScript(PROBE);

  const before = readChiefTurns().length;
  const startedAt = Date.now();
  for (let i = 0; i < PRESSES; i += 1) {
    pressEnter(target);
    if (gapMs > 0) {
      await settle(gapMs);
    }
  }
  // Long enough for every one of them to have finished if it was going to.
  await settle(8000);
  const after = readChiefTurns().length;
  const probe = await readProbe(target);

  measurements.push({
    scene: label,
    presses: PRESSES,
    press_gap_ms: gapMs,
    keydowns_seen_by_page: probe.press_count,
    turns_before: before,
    turns_after: after,
    turns_recorded: after - before,
    burst_ms: Date.now() - startedAt,
  });
}

async function run(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const stopLoopWatch = watchMainLoop();
  const window = await appWindowLoaded();
  window.show();
  window.focus();
  window.setContentSize(1280, 900);
  await settle(800);
  seed();
  await go(window, "/");

  // The room open, because that is the state Henrik was in and it is the one
  // with a transcript to re-render.
  await within(
    "open the room",
    10_000,
    window.webContents.executeJavaScript(
      `(() => { const f = document.querySelector("textarea.chief-input"); if (f !== null) { f.focus(); } return true; })()`,
    ),
  );
  await settle(600);

  await measureLatency(window);
  await settle(1500);
  await measureUnderStall(window, 2000);
  await settle(1500);
  await measureBurst(window, 0, "burst-gapless");
  await settle(1500);
  await measureBurst(window, SPACED_GAP_MS, "burst-spaced");

  const loop = stopLoopWatch();
  const latency = measurements.find((entry) => (entry as { scene: string }).scene === "latency") as
    | { deliver: { median: number | null; worst: number | null }; react: { median: number | null; worst: number | null }; total: { median: number | null; worst: number | null } }
    | undefined;
  const stalled = measurements.find((entry) => (entry as { scene: string }).scene === "under-stall") as
    | Record<string, number | null>
    | undefined;
  const gapless = measurements.find((entry) => (entry as { scene: string }).scene === "burst-gapless") as
    | Record<string, number>
    | undefined;
  const spaced = measurements.find((entry) => (entry as { scene: string }).scene === "burst-spaced") as
    | Record<string, number>
    | undefined;

  writeFileSync(
    path.join(OUT, "lag.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), main_loop: loop, measurements }, null, 2)}\n`,
    "utf8",
  );

  const ms = (value: number | null | undefined): string =>
    value === null || value === undefined ? "never" : `${String(value)}ms`;
  const gaplessTurns = gapless?.["turns_recorded"] ?? -1;
  const spacedTurns = spaced?.["turns_recorded"] ?? -1;

  console.log(
    `\n[lag] wrote lag.json to ${OUT}\n` +
      `[lag] press to reaction over ${String(LATENCY_SAMPLES)} presses: ` +
      `median ${ms(latency?.total.median)}, worst ${ms(latency?.total.worst)}\n` +
      `[lag]   of which delivery (main to renderer): median ${ms(latency?.deliver.median)}, ` +
      `worst ${ms(latency?.deliver.worst)}\n` +
      `[lag]   of which reaction (renderer commit):  median ${ms(latency?.react.median)}, ` +
      `worst ${ms(latency?.react.worst)}\n` +
      `[lag] with main blocked ${ms(stalled?.["main_blocked_ms"])}: delivery ` +
      `${ms(stalled?.["deliver_ms"])}, reaction ${ms(stalled?.["react_ms"])}\n` +
      `[lag] main's event loop: worst lateness ${String(loop.worst_late_ms)}ms over ` +
      `${String(loop.samples)} samples (${String(loop.late_over_100ms)} over 100ms, ` +
      `${String(loop.late_over_500ms)} over 500ms)\n` +
      `[lag] ${String(PRESSES)} gapless Enters recorded ${String(gaplessTurns)} turn(s) — ` +
      `${gaplessTurns === 1 ? "exactly one, as required" : "MORE THAN ONE TURN PER BURST"}\n` +
      `[lag] ${String(PRESSES)} Enters ${String(SPACED_GAP_MS)}ms apart recorded ` +
      `${String(spacedTurns)} turn(s) — ` +
      `${spacedTurns === 1 ? "exactly one, as required" : "MORE THAN ONE TURN PER BURST"}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[lag] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
