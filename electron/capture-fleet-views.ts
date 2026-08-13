/**
 * Screenshots of the fleet's three layouts, in the real shell (MAR-612).
 * **Not part of the shipped shell.**
 *
 * `electron/capture.ts` walks every surface and photographs whatever the machine
 * happens to hold. It is the wrong harness for this feature twice over. **The
 * store decides what this page draws** — a spotlight needs neighbours, and a
 * fleet of one photographs a state the feature is not about — and **the setting
 * decides what shape it draws them in**, which nothing on the machine can be
 * relied on to be.
 *
 * So this points the same real renderer at a store this run seeds, and walks the
 * whole matrix: three views × two densities × three widths × two themes, 36
 * frames.
 *
 * ## The mislabelling trap, and how this avoids it
 *
 * MAR-612's own issue warns about it in as many words: *"the capture harness has
 * scenes rather than a per-frame click model, and density is a toggle — a
 * harness that clicks once per frame mislabels half its images."* That is a real
 * defect this repository has shipped: `electron/capture.ts` produced three images
 * labelled with a viewport they were not taken at, because `setContentSize` is a
 * request rather than a guarantee.
 *
 * A toggle is worse than a resize, because there is nothing in the picture that
 * says which state it is in — `comfortable` and `compact` differ by spacing, and
 * `grid` and `rows` differ by a track. A frame that missed a click looks like a
 * frame of the other scene, and a reviewer has no way to know.
 *
 * Two things answer it, and the second is the one that matters:
 *
 * 1. **Nothing is clicked.** Both settings are written to `localStorage` and the
 *    page is reloaded, so each frame is a cold render of a stored preference —
 *    which is also the path a real user's second visit takes, through the
 *    pre-paint scripts in `app/layout.tsx`.
 * 2. **Every frame reads its own labels back before it is taken.** The document's
 *    `data-fleet-view` and `data-density` are compared against the filename this
 *    frame is about to be written under, and a mismatch fails the run rather than
 *    producing an image. A harness that cannot prove what it photographed should
 *    not produce a photograph.
 *
 * That makes each image a small proof as well as a picture — the same claim
 * `electron/capture.ts` makes about pressing the density control, reached from
 * the other end.
 *
 * ## What is real here, and the one thing that is not
 *
 * Real: the packaged renderer and its compiled stylesheet, the `dash-app://ui/`
 * route, the agents view arriving over the read channel, `app/tokens.css`
 * resolved against a `color-scheme` the operating system's own signal moved, and
 * the two preferences taking the exact path a returning user's take — stored
 * before paint, applied by the scripts, read by the components.
 *
 * Not real: **whose data it is.** The store is a scratch directory this run
 * seeded, so these are evidence of what the page draws for a given store and
 * evidence about nobody's actual machine.
 *
 * ## What no frame here can show
 *
 * **The chief bringing an agent to the middle when you talk to it.** MAR-419 is
 * the Chief chat, it is unbuilt, and the band under the spotlight carries the
 * sentence and the action rather than a conversation. The frames show the room
 * left for it. Faking a transcript into the picture would be the substitution
 * ADR 0002 amendment 1 named.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-fleet-views'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar612'
 *     pnpm exec electron dist/electron/capture-fleet-views.mjs
 *
 * Every line is load-bearing and each has cost a session before:
 * `build:renderer` first because `build:shell` only *copies* `out/`;
 * `DASH_SHELL_URL` because without it an unpackaged main loads loopback and
 * every page fails to connect; PowerShell because under Git Bash the runner
 * cannot read its own user identity and the shell renders empty; a visible
 * window because `capturePage()` never resolves against a compositor that is not
 * compositing.
 *
 * `DASH_CAPTURE_VIEW` narrows the run to one view (`grid`, `rows`, `spotlight`)
 * for a re-shoot, on `electron/capture-deploy.ts`'s reasoning: re-taking one
 * scene should not cost re-taking all of them, because that is how a reviewer
 * ends up with the first attempt's images beside the second attempt's.
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
 * smoke depends on it. Each run leaves one live runner holding a scratch store,
 * exactly as every other harness here does. Harmless to anybody's records, and
 * **not** harmless to the next `pnpm verify:shell` on this machine. Run this when
 * you are about to review images, not when you are about to run the gate, and
 * name the leftover pid in whatever you write afterwards.
 */

/*
 * `electron/smoke-identity.ts` is deliberately **not** imported, for
 * `electron/capture-servers.ts`'s reason: borrowing the app's name borrows its
 * single-instance lock, which would mean this could only run with DASH closed.
 * Launched as a bare file, Electron falls back to the name `Electron` and a
 * user-data directory of its own, so this runs beside a live DASH and cannot
 * touch its records — which matters here because this run *writes* to the store
 * it was handed.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { importManifest, ingestArtifacts, ingestEvents, recordAgentLook } from "../lib/store.js";
import {
  DENSITY_ATTRIBUTE,
  DENSITY_STORAGE_KEY,
  type Density,
} from "../lib/views/density";
import {
  FLEET_VIEWS,
  FLEET_VIEW_ATTRIBUTE,
  FLEET_VIEW_STORAGE_KEY,
  type FleetView,
} from "../lib/views/fleet-view";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar612");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 980 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES: readonly Density[] = ["comfortable", "compact"];

/**
 * One view, or all three.
 *
 * The env var is validated against the module's own union rather than trusted,
 * so a typo is a refusal at the top of the run instead of an empty output
 * directory forty seconds later.
 */
const ONLY = process.env.DASH_CAPTURE_VIEW;
const VIEWS: readonly FleetView[] =
  ONLY === undefined ? FLEET_VIEWS : FLEET_VIEWS.filter((view) => view === ONLY);

if (VIEWS.length === 0) {
  throw new Error(
    `DASH_CAPTURE_VIEW=${String(ONLY)} is not one of ${FLEET_VIEWS.join(", ")}`,
  );
}

/* ---------------------------------------------------------------------- *
 * The fleet this run photographs
 *
 * Five agents, which is the smallest fleet that shows what each view is for: a
 * grid with a second row, a column of rows worth scrolling, and a spotlight with
 * a neighbour on both sides and more beyond them.
 *
 * Three of the five say something different at a glance, so the chief's line
 * under the spotlight is a different sentence depending on which card is in the
 * middle — which is the only way a still frame can show that it is reading the
 * card rather than reciting a fixture.
 * ---------------------------------------------------------------------- */

const NEW_OUTPUT = "news-scout";
const OVERDUE = "project-reporter";
const NOT_CONNECTED = "ledger-reporter";
const CALM = "quiet-worker";
const ALSO_CALM = "inbox-sorter";

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** The same document under a name this scene chose, so five cards are five agents. */
function renamed(file: string, name: string, displayName: string): Record<string, unknown> {
  const manifest = example(file);
  const agent = manifest["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;
  return manifest;
}

/** Days before now, as an instant, so the scene ages with the run. */
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
 * `ingestEvents`, `ingestArtifacts` — rather than by writing rows, which is
 * `electron/capture-glance.ts`'s rule: a seed that reached past the validators
 * could stage a state the product cannot actually reach.
 */
function seed(): void {
  /* Something new to read: an artifact arrived and nobody has opened the page. */
  importManifest(renamed("agent.manifest.example.json", NEW_OUTPUT, "News Scout"));
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

  /*
   * Overdue: a schedule declaring three days, and a run five days ago. The run
   * goes in as real events so `listRuns` derives it the way it derives every
   * other run — a row written by hand would be a run DASH never received.
   */
  importManifest(renamed("dash-managed.manifest.v2.example.json", OVERDUE, "Project Reporter"));
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

  /* Not connected: a declared key DASH could hold and does not. */
  importManifest(
    renamed("dash-managed-secret.manifest.v2.example.json", NOT_CONNECTED, "Ledger Reporter"),
  );

  /*
   * Two calm agents, so the fleet has a second row in the grid and something
   * beyond the spotlight's neighbours. The look is stamped explicitly rather
   * than by opening the page, because the page has not been opened yet at seed
   * time and these cards have to be calm in the very first photograph.
   */
  for (const [name, label] of [
    [CALM, "Quiet Worker"],
    [ALSO_CALM, "Inbox Sorter"],
  ] as const) {
    importManifest(renamed("agent.manifest.example.json", name, label));
    recordAgentLook(name, new Date().toISOString());
  }

  console.log(
    "[views] seeded 5 agents: new output, overdue, not connected, and two with nothing waiting",
  );
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
  /*
   * Retried once, because the first `capturePage()` after a window shrink fails
   * deterministically rather than flakily — `electron/capture-models.ts` found
   * it and `electron/capture-deploy.ts` adopted the same retry.
   */
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch {
    await settle(600);
    image = await within(`capturePage retry for ${name}`, 20_000, target.webContents.capturePage());
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[views] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * `setContentSize` is a request to the window manager, not a guarantee: a
 * maximized window ignores it and reports the screen's width back, which on a
 * 1280-wide display is indistinguishable from a successful resize to 1280. That
 * really happened to `electron/capture.ts` — three images labelled with a
 * viewport they were not taken at, which is worse than a missing image.
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

/**
 * Store both preferences and reload, which is the path a returning user takes.
 *
 * Written rather than clicked, and the header says why at length. What it means
 * mechanically: the value goes into `localStorage`, the page is loaded again, and
 * the pre-paint scripts in `app/layout.tsx` put the attributes on `<html>` before
 * the first frame — so what is photographed is the same cold render somebody gets
 * the second time they open DASH.
 *
 * The keys come from the modules rather than as literals. The first draft of
 * `electron/capture.ts` wrote `"dash.fleet-strip"` for a key that is
 * `"dash.fleetStrip"`, and the witness it fed read `null` and reported it — a
 * harness disagreeing with the thing it measures. Importing means a rename breaks
 * the build instead.
 */
async function choose(target: BrowserWindow, view: FleetView, density: Density): Promise<void> {
  await within(
    "store the preferences",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         window.localStorage.setItem(${JSON.stringify(FLEET_VIEW_STORAGE_KEY)}, ${JSON.stringify(view)});
         window.localStorage.setItem(${JSON.stringify(DENSITY_STORAGE_KEY)}, ${JSON.stringify(density)});
         return true;
       })()`,
    ),
  );
  await reload(target);
}

async function reload(target: BrowserWindow): Promise<void> {
  const here = target.webContents.getURL();
  await within("reload", 20_000, target.webContents.loadURL(here));
  /*
   * Every DASH page reads its content across the IPC boundary after the first
   * paint, so a screenshot taken on `did-finish-load` is a picture of the boot
   * sequence — a real state, and not the one under review.
   */
  await settle(1800);
}

/**
 * What this frame actually is, read off the document it is about to photograph.
 *
 * The whole answer to the mislabelling trap. `data-density` and `data-fleet-view`
 * are absent for their defaults, so `?? "comfortable"` and `?? "grid"` are the
 * readings rather than fallbacks — the pre-paint scripts deliberately write
 * nothing for a default, which is the same reason `app/globals.css` treats "no
 * attribute" as the grid.
 */
async function labels(target: BrowserWindow): Promise<{ view: string; density: string }> {
  return (await within(
    "read the frame's own labels",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         return {
           view: root.getAttribute(${JSON.stringify(FLEET_VIEW_ATTRIBUTE)}) ?? "grid",
           density: root.getAttribute(${JSON.stringify(DENSITY_ATTRIBUTE)}) ?? "comfortable",
         };
       })()`,
    ),
  )) as { view: string; density: string };
}

/**
 * What a picture cannot settle.
 *
 * MAR-491's rule is that a record list reflows rather than scrolling the *page*,
 * and a screenshot of a page that overflows looks identical to one that does not
 * — the overflow is off the right-hand edge of the frame.
 *
 * The spotlight is the exception and the measurement knows it: that view's `<ol>`
 * is a scroll container on purpose, so its own overflow is the feature rather
 * than the defect. `page_overflows` is read from the document element, which is
 * the claim that actually matters, and the track's scroll width is reported
 * beside it rather than folded into it.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const track = document.querySelector(".row-list.fleet-grid");
         const cards = [...document.querySelectorAll(".fleet-card")];
         const widths = cards.map((node) => Math.round(node.getBoundingClientRect().width));
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           /* Every agent is drawn in every view — that is the rule the three
              views live under, and a count is how a frame proves it. */
           cards: cards.length,
           card_widths: widths,
           /* The chief stands under every view, and says one thing. */
           chief: document.querySelector(".chief-says")?.textContent?.trim() ?? null,
           chief_action: document.querySelector(".chief-band .button-link")?.textContent ?? null,
           centred: document.querySelectorAll("li.is-centred").length,
           turned: document.querySelectorAll("li.is-before, li.is-after").length,
           /* The track scrolls sideways only where that is the point. */
           track_scrolls: track === null ? null : track.scrollWidth > track.clientWidth,
           /* MAR-612's control, on the page it changes. */
           options: document.querySelectorAll(".fleet-view-option").length,
         };
       })()`,
    ),
  );
}

async function go(target: BrowserWindow, route: string): Promise<void> {
  const next = new URL(route, target.webContents.getURL()).toString();
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  await settle(1800);
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });
  seed();

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);

  let mismatches = 0;

  for (const view of VIEWS) {
    for (const density of DENSITIES) {
      for (const theme of THEMES) {
        // The operating system's own signal, not a stylesheet override.
        nativeTheme.themeSource = theme;
        await settle(300);

        for (const viewport of VIEWPORTS) {
          await go(window, "/");
          const at = await resizeTo(window, viewport.width, viewport.height);
          /*
           * Chosen *after* the resize and therefore reloaded after it: this page
           * reads its view once on mount, and a fleet laid out at the previous
           * width would be photographed under this width's filename.
           */
          await choose(window, view, density);

          const name = `fleet-${view}-${viewport.name}-${theme}-${density}`;
          const seen = await labels(window);
          if (seen.view !== view || seen.density !== density) {
            /*
             * The frame is not taken. A picture whose filename disagrees with the
             * document it came from is worse than a missing picture, because a
             * reviewer has no way to tell — which is the whole hazard MAR-612's
             * issue names.
             */
            mismatches += 1;
            console.error(
              `[views] REFUSED ${name}: the document says view=${seen.view} density=${seen.density}`,
            );
            continue;
          }

          const measured = await layout(window);
          measurements.push({ view, density, theme, viewport: viewport.name, ...(measured as object) });
          console.log(
            `[views] ${view}/${density} at ${viewport.name}/${theme} ` +
              `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
          );
          await shoot(window, name);
        }
      }
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify(
      { views: VIEWS, captured_at: new Date().toISOString(), measurements },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  console.log(
    `\n[views] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[views] ${overflowed.length === 0 ? "no frame overflowed the page sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[views] ${mismatches === 0 ? "every frame's labels matched the document it photographed" : `${String(mismatches)} FRAMES REFUSED — the labels did not match`}`,
  );

  app.exit(mismatches === 0 ? 0 : 1);
}

void run().catch((error: unknown) => {
  console.error(`[views] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
