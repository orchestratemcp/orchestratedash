/**
 * Screenshots of the fleet's glance chips, in the real shell (MAR-586). **Not
 * part of the shipped shell.**
 *
 * `electron/capture.ts` walks every surface and photographs whatever the machine
 * happens to hold. It is the wrong harness for this feature for
 * `electron/capture-deploy.ts`'s reason, and here the reason is at its sharpest:
 * **a chip exists only when the fact behind it is true.** A run against one
 * person's store photographs whichever of the sixteen combinations that store
 * happens to be in, and cannot say which one it got — so a set of images from it
 * would prove one branch and be filed as proof of the feature.
 *
 * So this points the same real renderer at a store this run seeds, with one
 * agent per answer standing side by side on one page:
 *
 * - `news-scout`      — has produced something nobody has opened yet
 * - `meeting-helper`  — has a pending approval the runner will enforce
 * - `ledger-reporter` — declares a key DASH could hold and does not
 * - `project-reporter`— has a schedule and last ran outside it
 * - `quiet-worker`    — nothing needs you, which is a chip too
 *
 * ## What is real here, and the two things that are not
 *
 * Real: the packaged renderer and its compiled stylesheet, the `dash-app://ui/`
 * routes, `agentsView()` arriving over the read channel, the chips composed by
 * `lib/copy/glance.ts` from records this run wrote through the ordinary import
 * and ingest doors, `app/tokens.css` resolved against a `color-scheme` the
 * operating system's own signal moved, and the density attribute written by
 * pressing the real control.
 *
 * Not real, and stated rather than left for a reader of the PNGs to infer:
 *
 * 1. **Whose data it is.** The store is a scratch directory this run seeded, so
 *    these are evidence of what the fleet draws for a given store and evidence
 *    about nobody's actual machine.
 * 2. **One timestamp is moved.** The Gmail example's approval expired in July,
 *    and an expired request draws a different sentence on purpose — so the seed
 *    pushes its deadline into the future to photograph the *live* branch. The
 *    expired branch is covered by `tests/glance.test.ts` rather than faked into
 *    a picture, which is the substitution ADR 0002 amendment 1 named.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-glance'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar586'
 *     pnpm exec electron dist/electron/capture-glance.mjs
 *
 * Every line is load-bearing and each has cost a session before:
 * `build:renderer` first because `build:shell` only *copies* `out/`;
 * `DASH_SHELL_URL` because without it an unpackaged main loads loopback and
 * every page fails to connect; PowerShell because under Git Bash the runner
 * cannot read its own user identity and the shell renders empty; a visible
 * window because `capturePage()` never resolves against a compositor that is not
 * compositing.
 *
 * Never on the `electron .` path and named by no `package.json` script, on
 * `electron/capture.ts`'s own terms: this produces evidence, never a verdict,
 * and ADR 0004 keeps things that cannot fail a release out of the gate.
 *
 * ## What it leaves behind, said out loud
 *
 * Importing `./main.js` starts a **runner** against the scratch store, and
 * `app.exit(0)` does not stop it — main has no quit handler that would, because
 * "closing DASH leaves agents running" is the product's own behaviour and the
 * smoke depends on it. So each run leaves one live runner holding a scratch
 * store, exactly as `capture.ts`, `capture-servers.ts` and `capture-deploy.ts`
 * already do. It is harmless to anybody's records and it is **not** harmless to
 * the next `pnpm verify:shell` on the same machine. Run this when you are about
 * to review images, not when you are about to run the gate, and name the
 * leftover pids in whatever you write afterwards.
 */

/*
 * `electron/smoke-identity.ts` is deliberately **not** imported, for
 * `electron/capture-deploy.ts`'s reason: borrowing the app's name borrows its
 * single-instance lock, which would mean this could only run with DASH closed.
 * Launched as a bare file, Electron falls back to the name `Electron` and a
 * user-data directory of its own, so this runs beside a live DASH and cannot
 * touch its records — which matters most here, because this run *writes* to the
 * store it was handed.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { putAgentDomState } from "../lib/agent-dom/store.js";
import { importManifest, ingestArtifacts, ingestEvents, recordAgentLook } from "../lib/store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar586");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

const NEW_OUTPUT = "news-scout";
const NEEDS_YOU = "meeting-helper";
const NOT_CONNECTED = "ledger-reporter";
const OVERDUE = "project-reporter";
const ALL_CLEAR = "quiet-worker";

function example(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.resolve(process.cwd(), "examples", name), "utf8"),
  ) as Record<string, unknown>;
}

/** The same document under a name this scene chose, so five cards are five agents. */
function renamed(file: string, name: string, displayName: string): Record<string, unknown> {
  const manifest = example(file);
  const agent = manifest["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;
  return manifest;
}

/** Days before now, as an instant. The seed's own arithmetic, so the scene ages with the run. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Seed the store this run was pointed at.
 *
 * Before the first navigation and after `app.whenReady()`, because every page
 * reads its view on mount: a page loaded before the rows exist is a photograph
 * of an empty state under a filename claiming otherwise.
 *
 * Everything goes in through the ordinary doors — `importManifest`,
 * `ingestEvents`, `ingestArtifacts`, `putAgentDomState` — rather than by writing
 * rows. A seed that reached past the validators would be able to stage a state
 * the product cannot actually reach.
 */
function seed(): void {
  /* 1. New output: an artifact arrived, and nobody has opened the page. */
  const scout = renamed("agent.manifest.example.json", NEW_OUTPUT, "News Scout");
  importManifest(scout);
  ingestArtifacts({
    artifact_version: 1,
    agent: NEW_OUTPUT,
    run_id: "run-scout-1",
    artifact_id: "digest-scout-1",
    kind: "digest",
    title: "Today's AI agent news",
    generated_at: daysAgo(0),
    sources_fetched: [
      {
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
        status: "ok",
        item_count: 2,
      },
    ],
    items: [
      {
        headline: "Two things happened",
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
      },
    ],
  });

  /* 2. Needs your approval: a pending, runner-enforced request. */
  const helper = renamed(
    "gmail-meeting-assistant.manifest.v2.example.json",
    NEEDS_YOU,
    "Meeting Helper",
  );
  importManifest(helper);
  const state = example("gmail-meeting-assistant.state.example.json");
  state["agent_id"] = NEEDS_YOU;
  state["observed_at"] = daysAgo(0);
  /*
   * The one moved timestamp, and the header says why. The example's deadline is
   * in July; an expired request is a real state with its own sentence, and the
   * branch worth photographing here is the live one.
   */
  for (const request of (state["approval_requests"] ?? []) as Array<Record<string, unknown>>) {
    request["expires_at"] = new Date(Date.now() + 2 * 86_400_000).toISOString();
  }
  for (const choice of (state["choices"] ?? []) as Array<Record<string, unknown>>) {
    choice["expires_at"] = new Date(Date.now() + 2 * 86_400_000).toISOString();
  }
  const put = putAgentDomState(state);
  if (!put.ok) {
    throw new Error(`the seeded snapshot was refused: ${put.errors.join("; ")}`);
  }

  /* 3. Not connected: a declared key DASH could hold and does not. */
  importManifest(
    renamed("dash-managed-secret.manifest.v2.example.json", NOT_CONNECTED, "Ledger Reporter"),
  );

  /*
   * 4. Overdue: a schedule declaring three days, and a run five days ago.
   *
   * The run goes in as real events so `listRuns` derives it the way it derives
   * every other run — a row written by hand would be a run DASH never received.
   */
  importManifest(
    renamed("dash-managed.manifest.v2.example.json", OVERDUE, "Project Reporter"),
  );
  const startedAt = daysAgo(5);
  ingestEvents([
    {
      event_version: 1,
      agent: OVERDUE,
      run_id: "run-reporter-1",
      seq: 0,
      ts: startedAt,
      type: "run_started",
    },
    {
      event_version: 1,
      agent: OVERDUE,
      run_id: "run-reporter-1",
      seq: 1,
      ts: startedAt,
      type: "run_completed",
      status: "ok",
    },
  ]);

  /*
   * 5. Nothing needs you: imported, looked at, and asked nothing of.
   *
   * The look is stamped explicitly rather than by opening the page, because the
   * page has not been opened yet at seed time and this card has to be in its
   * calm state in the very first photograph.
   */
  importManifest(renamed("agent.manifest.example.json", ALL_CLEAR, "Quiet Worker"));
  recordAgentLook(ALL_CLEAR, new Date().toISOString());

  console.log("[glance] seeded 5 agents: new output, needs approval, not connected, overdue, calm");
}

/* ---------------------------------------------------------------------- *
 * The harness — the same guards `electron/capture.ts` earned the hard way
 * ---------------------------------------------------------------------- */

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Every await here, bounded and named: a hung run must not look like a slow one. */
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

const written: string[] = [];
const measurements: object[] = [];

async function shoot(target: BrowserWindow, name: string): Promise<void> {
  const image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[glance] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * A maximized window ignores `setContentSize` and reports the screen's width
 * back, which on a 1280-wide display is indistinguishable from a successful
 * resize to 1280 — three images labelled with a viewport they were not taken at,
 * which is worse than a missing image.
 */
async function resizeTo(target: BrowserWindow, width: number, height: number): Promise<number> {
  const deadline = Date.now() + 8000;
  let seen = 0;
  while (Date.now() < deadline) {
    target.restore();
    target.unmaximize();
    target.setResizable(true);
    target.setContentSize(width, height);
    await settle(150);
    seen = (await within(
      "read viewport",
      5000,
      target.webContents.executeJavaScript("window.innerWidth"),
    )) as number;
    if (Math.abs(seen - width) <= 2) {
      await settle(400);
      return seen;
    }
  }
  const [contentWidth, contentHeight] = target.getContentSize();
  throw new Error(
    `window would not resize to ${String(width)}px — the page reports ${String(seen)}px, ` +
      `the window reports ${String(contentWidth)}x${String(contentHeight)}`,
  );
}

async function go(target: BrowserWindow, route: string): Promise<void> {
  const next = new URL(route, target.webContents.getURL()).toString();
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  // Every DASH page reads its content across the IPC boundary after the first
  // paint, so a screenshot taken on `did-finish-load` is a picture of the boot
  // sequence — a real state, and not the one under review.
  await settle(1800);
}

/**
 * Press the density control, the way a person does.
 *
 * Not `setAttribute("data-density", …)`. A harness that wrote the attribute
 * would produce identical output whether or not the control worked, and the pair
 * of images would stop being a small proof as well as a picture.
 */
async function pressDensityToggle(target: BrowserWindow): Promise<string | null> {
  const pressed = (await target.webContents.executeJavaScript(
    `(() => {
       const button = document.querySelector("button.density-toggle");
       if (button === null) return null;
       button.click();
       return document.documentElement.getAttribute("data-density");
     })()`,
  )) as string | null;
  await settle(350);
  return pressed;
}

/** Scroll the subject into the frame, so a viewport-sized image is of it. */
async function scrollTo(target: BrowserWindow, selector: string): Promise<boolean> {
  const found = (await target.webContents.executeJavaScript(
    `(() => {
       const node = document.querySelector(${JSON.stringify(selector)});
       if (node === null) return false;
       node.scrollIntoView({ block: "start" });
       return true;
     })()`,
  )) as boolean;
  await settle(300);
  return found;
}

/**
 * What a picture cannot settle.
 *
 * Two things, and the second is the one worth having. A screenshot of a page
 * that overflows looks identical to one that does not. And a screenshot of a
 * chip looks identical to a screenshot of a chip-shaped link — which is the
 * whole of MAR-547's "can't be clicked" defect — so the anchors are counted
 * rather than left to a reviewer's eye.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const widest = [...document.querySelectorAll("*")]
           .map((node) => node.scrollWidth - node.clientWidth)
           .reduce((most, gap) => (gap > most ? gap : most), 0);
         const chips = [...document.querySelectorAll(".glance .chip")];
         const links = chips.filter((node) => node.tagName === "A" && node.getAttribute("href"));
         /*
          * Lower-cased, and that is a correction rather than a nicety. The chip
          * class sets text-transform to uppercase, and innerText returns the
          * RENDERED text -- so the first run of this harness reported every chip
          * missing while photographing all five of them. A witness that
          * disagrees with the thing it is measuring is the same failure the
          * fleet strip's storage key is imported rather than retyped to avoid,
          * arriving by another door.
          */
         const text = document.body.innerText.toLowerCase();
         const clear = chips.filter(
           (node) => node.textContent.trim().toLowerCase() === "nothing needs you",
         );
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           cards: document.querySelectorAll(".row-card").length,
           chips: chips.length,
           chip_links: links.length,
           // Every chip is either a link or the all-clear chip, which is
           // deliberately not one. Anything else is a chip nobody can press.
           inert_chips: chips.length - links.length - clear.length,
           open_agent_buttons: document.querySelectorAll(".glance-actions .button-link").length,
           says_new_output: text.includes("new output"),
           says_needs_approval: text.includes("needs your approval"),
           says_not_connected: text.includes("not connected"),
           says_overdue: text.includes("overdue"),
           says_all_clear: text.includes("nothing needs you"),
           widest_overflow: widest,
         };
       })()`,
    ),
  );
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });
  seed();

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);

  for (const theme of THEMES) {
    // The operating system's own signal, not a stylesheet override.
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const viewport of VIEWPORTS) {
      for (const density of DENSITIES) {
        await go(window, "/");
        const at = await resizeTo(window, viewport.width, viewport.height);
        // Reloaded after the resize as well: a page reads its view once, on
        // mount, and a layout settled at the previous width would be
        // photographed under this width's filename.
        await go(window, "/");

        if (density === "compact" && (await pressDensityToggle(window)) === null) {
          console.log(`[glance] no density control at ${viewport.name} — compact frame skipped`);
          continue;
        }
        const focused = await scrollTo(window, ".row-card");
        const measured = await layout(window);
        measurements.push({
          surface: "fleet",
          viewport: viewport.name,
          theme,
          density,
          focused,
          ...(measured as object),
        });
        console.log(
          `[glance] fleet ${viewport.name}/${theme}/${density} ` +
            `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
        );
        await shoot(window, `fleet-${viewport.name}-${theme}-${density}`);

        if (density === "compact") {
          // Back to comfortable, so the next frame starts where this one did —
          // the preference is stored and survives navigation.
          await pressDensityToggle(window);
        }
      }
    }

    /*
     * One frame per theme with all five cards in it.
     *
     * `capturePage()` photographs the viewport, so every frame above shows the
     * two or three cards that fit — and this feature's whole claim is about what
     * a person sees *across* a fleet. A reviewer comparing four chip states
     * should not have to assemble them from four images and trust that they came
     * from one page. The width is still 1280; only the height is unreal, and the
     * filename says so.
     */
    await go(window, "/");
    await resizeTo(window, 1280, 2600);
    await go(window, "/");
    await shoot(window, `fleet-all-cards-1280x2600-${theme}-comfortable`);
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  /*
   * The two claims these images are supposed to support, checked rather than
   * left to the reviewer. A frame missing a chip, or drawing one that is not a
   * link, is a frame that would otherwise be filed as evidence of the opposite.
   */
  const missing = measurements.filter((entry) => {
    const seen = entry as Record<string, boolean | number>;
    return (
      !seen["says_new_output"] ||
      !seen["says_needs_approval"] ||
      !seen["says_not_connected"] ||
      !seen["says_overdue"] ||
      !seen["says_all_clear"]
    );
  });
  const inert = measurements.filter((entry) => ((entry as Record<string, number>)["inert_chips"] ?? 0) > 0);

  console.log(
    `[glance] wrote ${String(written.length)} image(s) to ${OUT}; ` +
      `${String(overflowed.length)} frame(s) overflowed sideways; ` +
      `${String(missing.length)} frame(s) missing a chip; ` +
      `${String(inert.length)} frame(s) where a chip was not a link`,
  );
  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error("[glance] failed", error);
  app.exit(1);
});
