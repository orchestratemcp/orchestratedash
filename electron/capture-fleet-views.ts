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
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar634'
 *     $env:DASH_CAPTURE_FLEET='6'
 *     pnpm exec electron --user-data-dir='…\scratch-profile' dist/electron/capture-fleet-views.mjs
 *
 * `DASH_CAPTURE_FLEET` is `3` or `6` and needs a **fresh** `DASH_DATA_DIR` per
 * size: the seed adds rows and never removes them, so a six-agent run over a
 * three-agent store is a nine-agent photograph.
 *
 * `--user-data-dir` is not optional and the failure it prevents is silent-ish.
 * Launched as a bare file this is called `Electron`, and every run launched
 * that way shares one Chromium profile — including the one a previous run left
 * behind, since this harness exits without closing its window on failure. The
 * second process loses the single-instance lock and quits: the log shows the
 * seed, then `Unable to move the cache: Åtkomst nekad`, then nothing, and the
 * run "passes" in about eight seconds having written no images at all. A
 * directory per run costs nothing and is unambiguous.
 *
 * Also clear the environment afterwards. `DASH_DATA_DIR` persists for the life
 * of the PowerShell session, and `pnpm verify:shell` in that same session then
 * smokes the scratch store rather than the installed-style one and fails on
 * *"the store is the one `electron .` uses"* — a failure that reads like a
 * defect in the shell and is a leftover variable.
 *
 * ## It is a gate for its own claim, and only its own (MAR-634)
 *
 * This exits non-zero when a 1280 frame misses MAR-630's stated count, or when
 * either of the two corner controls MAR-634 removed is back at any width. That
 * is a change of kind from the rest of the capture harnesses and it is
 * deliberate: MAR-630 stated its acceptance as *numbers* — three across by two
 * rows, two to three rows, one row of three — and a number is the one thing a
 * reviewer cannot check by looking at a picture of the top of a pane. It is
 * still not part of `pnpm verify`, per ADR 0004 and this file's own footer:
 * what it can fail is this run, not a release.
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

import {
  importManifest,
  ingestArtifacts,
  ingestEvents,
  recordAgentDeploy,
  recordAgentLook,
  saveHost,
} from "../lib/store.js";
/* The scenes' own door — see `seedWaitingWork`. */
import { putAgentDomState } from "../lib/agent-dom/store.js";
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

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar630");

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

/**
 * How many agents this run seeds: three, or six.
 *
 * MAR-634 is about a stage that read as a void at three agents and a count
 * that has to hold at six, and those are two different photographs of the same
 * CSS. A harness that could only take one of them would be evidence for half
 * the issue — which is how MAR-630 shipped a grid nobody had seen with fewer
 * agents than it was designed around.
 *
 * Three is the fleet Henrik was looking at. Six is MAR-630's stated Grid
 * count — three across by two rows — and therefore the number the bound has to
 * fit inside two thirds of the window without scrolling.
 *
 * Validated rather than trusted, on `DASH_CAPTURE_VIEW`'s reasoning: a typo
 * should be a refusal at the top of the run, not an output directory whose
 * filenames claim a fleet size the store never held.
 */
const FLEET_SIZES = [3, 6] as const;
type FleetSize = (typeof FLEET_SIZES)[number];

const REQUESTED = process.env.DASH_CAPTURE_FLEET ?? "6";
const MATCHED = FLEET_SIZES.find((size) => String(size) === REQUESTED);

if (MATCHED === undefined) {
  throw new Error(
    `DASH_CAPTURE_FLEET=${REQUESTED} is not one of ${FLEET_SIZES.join(", ")}`,
  );
}

/*
 * Re-declared with the type rather than used through the `find` result. A
 * module-level `const` narrowed by the throw above is still `| undefined` when
 * it is read from inside a function body, and the alternative — a non-null
 * assertion at each use — would be three places agreeing to ignore the same
 * question.
 */
const FLEET: FleetSize = MATCHED;

/* ---------------------------------------------------------------------- *
 * The fleet this run photographs
 *
 * Six agents, sliced to three when that is what was asked for, and the order
 * is the interesting part: the first three are the three that say different
 * things, so the small scene is not the big scene with its evidence trimmed
 * off. Whichever size runs, the frames show a card that is ready for review, a
 * card that has completed and lives on a server, and a card that has never run
 * at all — which is the case MAR-634 item 3 is about and the one that has to
 * be legible as deliberate rather than as a status that failed to load.
 *
 * At six there is a second row for the grid, a column of rows worth scrolling,
 * and a spotlight with a neighbour on both sides and more beyond them.
 *
 * The chief's line under the spotlight is therefore a different sentence
 * depending on which card is in the middle, which is the only way a still
 * frame can show that it is reading the card rather than reciting a fixture.
 * ---------------------------------------------------------------------- */

const NEW_OUTPUT = "news-scout";
const OVERDUE = "project-reporter";
const NOT_CONNECTED = "ledger-reporter";
const CALM = "quiet-worker";
const ALSO_CALM = "inbox-sorter";
const ALSO_NEVER_RUN = "weekly-digest";

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
   * MAR-630. Cloud is a deploy row, not a live sighting (ADR 0015). One host
   * and one send, written through the same doors `host.deploy` uses, so the
   * Local/Cloud mark on Project Reporter is a store fact a reviewer can
   * point at. TEST-NET-1, because this run never talks to a server.
   *
   * Before the fleet-size gate below, not after it. The three-agent scene is
   * the one Henrik photographed and it has to carry the same three marks the
   * six-agent scene does — a small scene that quietly lost its Cloud card
   * would be a frame proving less than its filename claims.
   */
  saveHost({
    host_id: "scene-vps",
    label: "My server",
    address: "192.0.2.1",
    port: 22,
    username: "dash",
    key_name: "scene-vps",
    host_fingerprint: null,
    added_at: "2026-08-10T12:00:00.000Z",
  });
  recordAgentDeploy(
    {
      agent: OVERDUE,
      host_id: "scene-vps",
      manifest_sha256: "scene-manifest-digest",
      files_sha256: "scene-files-digest",
    },
    "2026-08-10T21:00:00.000Z",
  );

  if (FLEET < 6) {
    console.log(
      "[views] seeded 3 agents: ready for review, completed + cloud, and one that has never run",
    );
    return;
  }

  /*
   * The three that only exist in the six-agent scene: enough for a second row
   * in the grid, a column of rows worth scrolling, and something beyond the
   * spotlight's two neighbours. The look is stamped explicitly rather than by
   * opening the page, because the page has not been opened yet at seed time
   * and these cards have to be calm in the very first photograph.
   */
  for (const [name, label] of [
    [CALM, "Quiet Worker"],
    [ALSO_CALM, "Inbox Sorter"],
    [ALSO_NEVER_RUN, "Weekly Digest"],
  ] as const) {
    importManifest(renamed("agent.manifest.example.json", name, label));
    recordAgentLook(name, new Date().toISOString());
  }

  console.log(
    "[views] seeded 6 agents: ready for review, completed + cloud, and four that have never run",
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
   * Retried, for two reasons this repository has already paid for:
   * `capturePage()` after a shrink fails deterministically on the first call
   * (`electron/capture-models.ts`), and a later compositor miss writes a
   * 9KB PNG of empty navy that a reviewer cannot tell from a real dark
   * frame until they open it. A picture whose bytes cannot be a page is
   * refused and taken again.
   */
  const minBytes = 40_000;
  let image = null;
  let png: Buffer | null = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
    } catch {
      await settle(700);
      continue;
    }
    png = image.toPNG();
    if (png.length >= minBytes) {
      break;
    }
    console.warn(
      `[views] ${name} attempt ${String(attempt)} was ${String(png.length)} bytes — compositor miss, retrying`,
    );
    await settle(900);
  }
  if (image === null || png === null) {
    throw new Error(`capturePage for ${name} produced nothing`);
  }
  if (png.length < minBytes) {
    throw new Error(
      `${name} stayed a compositor miss (${String(png.length)} bytes) after four attempts`,
    );
  }
  writeFileSync(path.join(OUT, `${name}.png`), png);
  const size = image.getSize();
  written.push(name);
  console.log(`[views] ${name}.png ${String(size.width)}x${String(size.height)} ${String(png.length)}b`);
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
      await settle(700);
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
         const rail = document.querySelector(".fleet-rail");
         const railStyle = rail === null ? null : getComputedStyle(rail);
         const railBox = rail === null ? null : rail.getBoundingClientRect();
         const stage = document.querySelector(".fleet-stage");
         const stageStyle = stage === null ? null : getComputedStyle(stage);
         const cardsPane = document.querySelector(".fleet-cards");
         const chiefBand = document.querySelector(".chief-band");
         const cardsBox = cardsPane === null ? null : cardsPane.getBoundingClientRect();
         const chiefBox = chiefBand === null ? null : chiefBand.getBoundingClientRect();

         /*
          * MAR-634's acceptance bar, as a number rather than an impression.
          *
          * MAR-630 stated per-view counts — Grid three across by two rows,
          * Rows two to three rows, Spotlight one row of three — and every one
          * of them is a claim about what is on screen *without scrolling*. A
          * screenshot cannot settle it: a card an inch below the fold and a
          * card an inch above it produce the same picture of the top of the
          * pane, which is exactly how the void this issue is about survived a
          * 36-frame matrix.
          *
          * So a card counts when its whole box is inside the pane's box. One
          * pixel of tolerance, because a fractional layout at some zoom will
          * otherwise report a card that is visibly, entirely on screen as
          * clipped.
          */
         const cells = [...document.querySelectorAll(".row-list.fleet-grid > li")];
         const inside = cells.filter((cell) => {
           if (cardsBox === null) return false;
           const box = cell.getBoundingClientRect();
           return box.top >= cardsBox.top - 1 && box.bottom <= cardsBox.bottom + 1
             && box.left >= cardsBox.left - 1 && box.right <= cardsBox.right + 1;
         });
         /*
          * Rows and columns from \`offsetTop\`/\`offsetLeft\` rather than from
          * the rectangles above. The spotlight turns its neighbours with
          * \`rotateY\` and \`scale\`, and a transform moves the rectangle
          * without moving the card in the layout — so counting distinct tops
          * from rectangles would report the spotlight's one row as three.
          */
         const rows = new Set(inside.map((cell) => cell.offsetTop));
         const columns = new Set(inside.map((cell) => cell.offsetLeft));
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           /* Every agent is drawn in every view — that is the rule the three
              views live under, and a count is how a frame proves it. */
           cards: cards.length,
           card_widths: widths,
           marks: cards.map((node) =>
             [...node.querySelectorAll(".fleet-mark")].map((mark) => mark.textContent.trim()),
           ),
           /*
            * The chief stands under every view, and says one thing.
            *
            * The container is \`.chief-composer\` (and \`.chief-room\` once it is
            * open), not \`.chief-band\`. MAR-659 replaced the band with the chat
            * and this measurement was never moved with it, so every \`chief_*\`
            * reading below was taken inside an element that has not existed
            * for several packets — three fields reporting 0/null as though
            * that were a finding about the page rather than about the
            * selector. Read against the classes \`chief-chat.tsx\` actually
            * names, per the rule this harness already follows for its
            * \`localStorage\` keys: match what the component states, so a rename
            * breaks the harness instead of quietly emptying it.
            */
           chief: document.querySelector(".chief-says")?.textContent?.trim() ?? null,
           chief_action: document.querySelector(".chief-composer .button-link")?.textContent ?? null,
           chief_inputs: document.querySelectorAll(
             ".chief-composer input, .chief-composer textarea",
           ).length,
           centred: document.querySelectorAll("li.is-centred").length,
           /*
            * *Which* card the spotlight has in the middle, because the count
            * of what is on screen beside it depends on it: the first agent
            * has no left-hand neighbour, so a frame taken at the track's
            * resting position shows a centred card and one neighbour and is
            * not thereby wrong.
            */
           centred_index: cells.findIndex((cell) => cell.classList.contains("is-centred")),
           turned: document.querySelectorAll("li.is-before, li.is-after").length,
           /*
            * How many columns the spotlight's track has room for, which is the
            * half of "one row of 3" that is a property of the layout rather
            * than of where the row happens to be scrolled to.
            */
           columns_fit: track === null ? null : (() => {
             const style = getComputedStyle(track);
             const column = parseFloat(style.gridAutoColumns);
             const gap = parseFloat(style.columnGap);
             return Number.isFinite(column) && column > 0
               ? Math.floor((track.clientWidth + gap) / (column + gap))
               : null;
           })(),
           /* The track scrolls sideways only where that is the point. */
           track_scrolls: track === null ? null : track.scrollWidth > track.clientWidth,
           /* MAR-612's control, on the page it changes — now in the rail. */
           options: document.querySelectorAll(".fleet-view-option").length,
           add_agent: rail?.querySelector(".button-link")?.textContent?.trim() ?? null,
           rail: rail === null || railStyle === null || railBox === null ? null : {
             display: railStyle.display,
             hidden: railStyle.display === "none" || railStyle.visibility === "hidden",
             direction: railStyle.flexDirection,
             top: Math.round(railBox.top),
             left: Math.round(railBox.left),
             width: Math.round(railBox.width),
             height: Math.round(railBox.height),
           },
           stage: stage === null || stageStyle === null ? null : {
             template_rows: stageStyle.gridTemplateRows,
             cards_height: cardsBox === null ? null : Math.round(cardsBox.height),
             chief_height: chiefBox === null ? null : Math.round(chiefBox.height),
           },
           /* MAR-634 item 1. What the stated counts are actually met by. */
           visible_cards: inside.length,
           visible_rows: rows.size,
           visible_columns: columns.size,
           /*
            * The track the cards were laid on, as the browser resolved it.
            * A count that is wrong is a count laid on the wrong track, and
            * the difference between "the rule did not match" and "the rule
            * matched and the arithmetic was wrong" is invisible in a
            * rectangle. \`client_width\` is the width the columns actually had
            * to divide, which on the spotlight is the pane less its two step
            * buttons rather than the pane.
            */
           list: track === null ? null : {
             auto_rows: getComputedStyle(track).gridAutoRows,
             auto_columns: getComputedStyle(track).gridAutoColumns,
             template_rows: getComputedStyle(track).gridTemplateRows,
             align_content: getComputedStyle(track).alignContent,
             gap: getComputedStyle(track).rowGap,
             client_width: track.clientWidth,
             client_height: track.clientHeight,
           },
           card_heights: [...new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().height)))],
           /*
            * MAR-634 item 1's other half: the stage should not read as a void.
            * How much of the cards pane the cards actually stand on, as a
            * percentage — a number a later session can compare against rather
            * than re-litigate from a screenshot.
            */
           stage_filled: cardsBox === null || inside.length === 0 ? null : Math.round(
             100 * (Math.max(...inside.map((c) => c.getBoundingClientRect().bottom))
                    - Math.min(...inside.map((c) => c.getBoundingClientRect().top)))
             / cardsBox.height,
           ),
           /* ------------------------------------------------------------ *
            * MAR-639 / MAR-640 / MAR-614 — what the counts above cannot say
            *
            * Every reading below is a claim one of those three issues makes
            * about what a card, the rail or the sidebar *says*, and not one
            * of them is settled by a rectangle. They are recorded rather than
            * asserted, on the same footing as \`marks\` above: this harness
            * gates only MAR-630's counts, and a new gate written in a proving
            * session would be a bar nobody agreed to.
            * ------------------------------------------------------------ */

           /*
            * MAR-639's status-tinted portrait, read as the tone class the
            * component chose rather than as a colour sampled off the frame. A
            * pixel value would have to be re-derived against both themes and
            * would prove the paint; the claim the issue makes is about the
            * mapping from status to tone, which is what this reads.
            */
           portrait_tones: cards.map((card) => {
             const portrait = card.querySelector(".fleet-portrait");
             if (portrait === null) return null;
             const tones = [...portrait.classList]
               .filter((name) => name.startsWith("fleet-portrait-"))
               .map((name) => name.slice("fleet-portrait-".length));
             return tones.length === 0 ? null : tones[0];
           }),

           /*
            * MAR-639's last-run line, recorded beside the status mark that
            * stands directly above it on the same card — as a pair, on
            * purpose. \`fleet-card.tsx\`'s own header forbids the two saying
            * the same thing twice ("the exact two-copies-that-can-disagree"),
            * and only the pair can show whether they do. A list of every
            * \`.fleet-mark\` on the card, as \`marks\` already collects, cannot:
            * it flattens the place mark, the status mark and the never-run
            * mark into one array with no note of which slot each came from.
            */
           card_lines: cards.map((card) => ({
             name: card.querySelector(".fleet-name")?.textContent?.trim() ?? null,
             status: [...card.querySelectorAll(".fleet-identity .fleet-mark")].map((mark) =>
               mark.textContent.trim(),
             ),
             last_run: card.querySelector(".fleet-last-run")?.textContent?.trim() ?? null,
             goal: card.querySelector(".fleet-goal")?.textContent?.trim() ?? null,
           })),

           /*
            * MAR-639's whole-card click-through, and MAR-660's visible twin.
            *
            * The second class is \`.fleet-open\` — the component is called
            * FleetOpenLink and the class is not. The first draft of this
            * measurement guessed \`.fleet-open-link\` from the component name
            * and reported 0 on a frame where "Open this agent" is plainly
            * printed on all six cards: a harness disagreeing with the thing
            * it measures, which is the exact failure this file's header
            * describes for the \`localStorage\` keys and answers by importing
            * them. There is no module to import a class name from, so it is
            * read off \`fleet-card.tsx\` and named here instead.
            */
           card_links: document.querySelectorAll(".fleet-card-link").length,
           open_links: document.querySelectorAll(".fleet-open").length,

           /*
            * MAR-640's rail filters and the counts they draw unfiltered —
            * "the rail becomes a status summary" is the issue's own framing,
            * and six numbers in a photograph cannot be checked against a
            * store unless they are also written down.
            */
           filters: [...document.querySelectorAll(".fleet-filter-option")].map((option) => ({
             label: option.querySelector("span:not(.fleet-filter-count)")?.textContent?.trim() ?? null,
             count: Number(option.querySelector(".fleet-filter-count")?.textContent ?? "-1"),
             checked: option.querySelector("input")?.checked === true,
           })),

           /* MAR-640's favourite star: one per card, and how many are lit. */
           favourite_buttons: document.querySelectorAll(".fleet-favourite").length,
           favourited: document.querySelectorAll(".fleet-favourite.is-favourite").length,

           /*
            * MAR-640's work-inbox badge. Absent is a reading rather than a
            * failure: \`app-chrome.tsx\` draws nothing at zero on purpose, so
            * null here and a number here are both correct answers depending
            * on what the store holds.
            */
           inbox_badge: document.querySelector(".sidebar-badge")?.textContent?.trim() ?? null,

           /*
            * MAR-639's text axe, read where it was swung. The page lede is
            * the paragraph that sat under the <h1>; one coming back would be
            * a <p> immediately after the heading, which is exactly this.
            */
           lede: (() => {
             const heading = document.querySelector("main h1");
             const next = heading === null ? null : heading.nextElementSibling;
             return next === null || next.tagName !== "P" ? null : next.textContent.trim();
           })(),

           /*
            * MAR-639 asked for the view legend to go. It is still in the
            * markup as a \`<legend class="visually-hidden">\`, because a radio
            * fieldset needs an accessible name — so the honest reading is
            * *visible* legends, which is the screen the issue was talking
            * about. Recorded this way rather than as a bare absence, per this
            * repository's own rule that hidden text is still in the markup:
            * a measurement that could not tell "deleted" from "relocated"
            * would report a removal that did not happen.
            */
           visible_legends: [...document.querySelectorAll("legend")]
             .filter((node) => !node.classList.contains("visually-hidden"))
             .map((node) => node.textContent.trim()),

           /*
            * MAR-614 item 3, and the only honest way a still frame can reach
            * it.
            *
            * "Animation. None of consequence exists today. He wants motion
            * that makes the product feel alive." A photograph cannot witness
            * motion — that is what makes this the one item on the issue a
            * capture sweep would otherwise have to skip and quietly claim.
            *
            * What IS checkable from a frozen page is whether the elements
            * that should be moving are *running an animation*: the computed
            * animation-name resolved by the packaged renderer against its own
            * compiled stylesheet. That is a stronger statement than "the CSS
            * file contains keyframes", which would only prove the bytes
            * shipped, and a weaker one than "it moved", which is not
            * available here and is not claimed.
            *
            * animation-play-state comes with it, because it is exactly how a
            * running animation and a paused one differ while both report a
            * name — and app/globals.css pauses these deliberately when
            * nobody is looking.
            */
           motion: [...document.querySelectorAll(".o-avatar, .fleet-strip-o .o-avatar")].map(
             (node) => {
               const style = getComputedStyle(node);
               return {
                 name: style.animationName,
                 duration: style.animationDuration,
                 running: style.animationPlayState,
               };
             },
           ).filter((one) => one.name !== "none"),
           motion_elements: document.querySelectorAll(".o-avatar").length,

           /*
            * MAR-634 item 2. Both corner leftovers, counted where they stood:
            * the density button under the sidebar and the strip's own toggle.
            * Zero is the whole of the claim, and it is asserted on every frame
            * because a control that came back at one width would be a control
            * that came back.
            */
           density_toggle: document.querySelectorAll(".app-sidebar .density-toggle").length,
           strip_toggle: document.querySelectorAll(".fleet-strip-toggle").length,
           /*
            * MAR-634 item 4, against the container that exists. The band it
            * was written for is gone (see \`chief\` above); MAR-419 arrived as
            * \`.chief-composer\`, so what this counts now is the chat's own
            * controls rather than a band's — a real number instead of a zero
            * from an empty selector.
            */
           chief_buttons: document.querySelectorAll(
             ".chief-composer button, .chief-composer .button-link",
           ).length,
         };
       })()`,
    ),
  );
}

/** The three numbers MAR-630 stated and MAR-634 has to meet. */
interface Counted {
  visible_cards: number;
  visible_rows: number;
  visible_columns: number;
  centred_index: number;
  columns_fit: number | null;
  density_toggle: number;
  strip_toggle: number;
}

/**
 * MAR-630's per-view counts, checked against what the pane actually holds —
 * MAR-639 widens the grid's own bar from "three across" to "four or more",
 * and MAR-640 widens Rows' own bar from "2–3 rows" to "the whole seeded
 * fleet", on the same reasoning both times: a number is the one thing a
 * reviewer cannot check by looking at a picture of the top of a pane.
 *
 * Returns the sentence a reviewer would have to write, or null when the frame
 * meets its bar. Making this a refusal rather than a note is the same move
 * `labels()` makes above: this harness already declines to produce an image it
 * cannot prove the identity of, and a count is the other thing about these
 * frames that a picture cannot settle on its own.
 *
 * **Only at 1280.** The counts are a desktop claim and MAR-634 says so — the
 * card's height is bounded above the rail's 900px collapse and free below it,
 * because the 375px repair and "six in two thirds" cannot both hold at one
 * size. Asserting four across at 375 would be asserting the defect MAR-630
 * fixed.
 */
function shortfall(view: FleetView, width: string, m: Counted): string | null {
  /*
   * Checked at every width, unlike the counts. A control that came back at one
   * breakpoint is a control that came back, and this is the cheapest place to
   * notice it — MAR-634 item 2 removed both, and neither has a rule that could
   * honestly reintroduce one at a narrow width.
   */
  if (m.density_toggle > 0) {
    return `the density button is back under the sidebar (${String(m.density_toggle)})`;
  }
  if (m.strip_toggle > 0) {
    return `the strip's toggle is back in the corner (${String(m.strip_toggle)})`;
  }
  if (width !== "1280") {
    return null;
  }

  /*
   * A fleet of three is one row, and the claim is that all three are on screen
   * — the void's other half, and the frame Henrik photographed to open this
   * issue.
   *
   * The spotlight is excluded and falls through to its own case below, because
   * there the claim is not true and should not be: that view centres a card
   * and pads half a track either side so the first and the last agent can both
   * reach the middle, so a track at rest shows the first agent and its one
   * neighbour whether the fleet is three or sixty. Asserting three here would
   * be asserting that the spotlight is a grid.
   */
  if (FLEET === 3 && view !== "spotlight") {
    return m.visible_cards === 3
      ? null
      : `only ${String(m.visible_cards)} of 3 cards stand inside the pane`;
  }

  switch (view) {
    case "grid":
      /*
       * "Grid — 4+ across × 2 rows visible, six cards, without scrolling."
       *
       * MAR-639 drops the three-track `max-width` cap MAR-634's own count was
       * measured against, on Henrik's own ask for more cards per row rather
       * than the number three specifically. Four is the new floor, not a new
       * ceiling — a wider window is free to earn a fifth column, and this
       * frame is 1280 either way, so nothing here asserts an upper bound.
       */
      if (m.visible_columns < 4) {
        return `${String(m.visible_columns)} columns of cards, not four or more`;
      }
      if (m.visible_rows < 2) {
        return `${String(m.visible_rows)} row(s) inside the pane, not two`;
      }
      return m.visible_cards >= 6 ? null : `${String(m.visible_cards)} cards inside the pane, not six`;
    case "rows":
      /*
       * "Rows — dense enough that the seeded fleet fits without scrolling"
       * (MAR-640), superseding MAR-630's "2–3 rows visible": that number was
       * measured against the wide 224px card MAR-630 shipped, and the whole
       * point of the dense anatomy is that a ~72px/56px row fits far more of
       * a fleet in the same two thirds of the pane. The issue's own bar is
       * "≥8 without scrolling, fixtures permitting" — this harness seeds at
       * most `FLEET` agents, so the bar it can actually check is that every
       * one of them is visible, which the fixture does permit.
       */
      return m.visible_cards >= FLEET
        ? null
        : `${String(m.visible_cards)} of ${String(FLEET)} rows inside the pane, not all of them`;
    case "spotlight": {
      /*
       * "Spotlight — one row of 3 (a centred card with its two neighbours)",
       * checked as the two separate claims it actually makes.
       *
       * The first is about the track: three columns have to fit across it.
       * That is the one MAR-634 moved, and it failed before — three 18rem
       * columns want 900px of a 667px pane, so the view could not have shown
       * three however it was scrolled.
       *
       * The second is about the frame: the centred card and every neighbour it
       * has. A track at rest has the first agent in the middle, and the first
       * agent has nothing to its left — demanding three there would be
       * demanding a card that does not exist, and the way to pass it would be
       * to seed a fixture that hides the resting position.
       */
      if (m.visible_rows !== 1) {
        return `${String(m.visible_rows)} rows in the spotlight, not one`;
      }
      if ((m.columns_fit ?? 0) < 3) {
        return `the track has room for ${String(m.columns_fit)} cards, not three`;
      }
      const neighbours = (m.centred_index > 0 ? 1 : 0)
        + (m.centred_index >= 0 && m.centred_index < FLEET - 1 ? 1 : 0);
      return m.visible_cards >= 1 + neighbours
        ? null
        : `${String(m.visible_cards)} cards around the centred one, not ${String(1 + neighbours)}`;
    }
  }
}

async function go(target: BrowserWindow, route: string): Promise<void> {
  const next = new URL(route, target.webContents.getURL()).toString();
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  await settle(1800);
}

/* ====================================================================== *
 * The scenes: MAR-640's controls, pressed (proving sweep, group C)
 *
 * The matrix above is thirty-six cold renders of a stored preference, and
 * that is the right shape for a *layout* claim — it is the shape this file's
 * header argues for at length. It is the wrong shape for the half of MAR-640
 * that is not a layout at all. "Counts match the store", "the badge updates
 * when an approval arrives", "↑/↓ moves selection in Rows" and MAR-639's
 * whole-card click-through are claims about what happens when somebody
 * *presses something*, and a cold render can no more prove those than a
 * photograph of a light switch proves the bulb works.
 *
 * So the scenes run after the matrix, never inside it, for two reasons:
 *
 * 1. **They change the store.** A pending approval has to exist for the badge
 *    to have anything to count, and a seventh agent seeded before frame one
 *    would silently move every count `shortfall()` gates — the exact "a
 *    capture seed can hide the fix" trap this repository has already paid
 *    for. After the last matrix frame, nothing downstream reads those counts.
 * 2. **They change persisted preferences.** The filter is stored and applied
 *    pre-paint, exactly like the view and the density, so a scene that left
 *    one set would mislabel a later frame in precisely the way this file's
 *    header refuses to allow.
 *
 * Every press here is a real one — `element.click()` for the controls and
 * `sendInputEvent` for the arrow keys, so the key travels Chromium's own
 * input pipeline rather than arriving as a synthetic object React was handed.
 * Each scene reads the page back *after* the press and records both sides, so
 * what is written down is a transition rather than a state that might always
 * have been that way.
 * ====================================================================== */

/** The agent that gives the work inbox something to hold. */
const NEEDS_YOU = "budget-approver";

/**
 * One pending, runner-enforceable approval — `electron/capture-actions.ts`'s
 * recipe, for its reason: `buildWorkInbox` counts pending `choices` and
 * `approval_requests` that `approvalIsEnforceable` accepts, and a row written
 * by hand could stage a request DASH would refuse to honour. The example's own
 * deadline is in the past and an expired request draws a different sentence,
 * so the one timestamp this moves is the one that decides which branch is on
 * screen.
 */
function seedWaitingWork(): void {
  importManifest(
    renamed("gmail-meeting-assistant.manifest.v2.example.json", NEEDS_YOU, "Budget Approver"),
  );
  const state = example("gmail-meeting-assistant.state.example.json");
  state["agent_id"] = NEEDS_YOU;
  state["observed_at"] = daysAgo(0);
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
  console.log(`[views] scenes: seeded ${NEEDS_YOU} with a pending approval`);
}

/** Run a snippet in the page and hand back whatever it returns. */
async function ask(target: BrowserWindow, what: string, script: string): Promise<unknown> {
  return within(what, 10_000, target.webContents.executeJavaScript(script));
}

/**
 * Press one of the rail's filter radios by the words on it, and say whether it
 * was found. A press that silently did nothing is the failure mode worth
 * naming: the frame after it would look exactly like the frame before.
 */
async function pressFilter(target: BrowserWindow, label: string): Promise<boolean> {
  const pressed = (await ask(
    target,
    `press the ${label} filter`,
    `(() => {
       const option = [...document.querySelectorAll(".fleet-filter-option")].find(
         (node) => (node.textContent ?? "").trim().startsWith(${JSON.stringify(label)}),
       );
       if (option === undefined) return false;
       const radio = option.querySelector("input");
       if (radio === null) return false;
       radio.click();
       return true;
     })()`,
  )) as boolean;
  await settle(900);
  return pressed;
}

/** What the fleet is showing right now, in the terms the scenes argue in. */
async function fleetState(target: BrowserWindow): Promise<unknown> {
  return ask(
    target,
    "read the fleet back",
    `(() => {
       const cards = [...document.querySelectorAll(".fleet-card")];
       const chosen = [...document.querySelectorAll(".fleet-filter-option")].find(
         (node) => node.querySelector("input")?.checked === true,
       );
       return {
         filter: chosen === undefined
           ? null
           : (chosen.querySelector("span:not(.fleet-filter-count)")?.textContent ?? "").trim(),
         filter_count: chosen === undefined
           ? null
           : Number(chosen.querySelector(".fleet-filter-count")?.textContent ?? "-1"),
         counts: [...document.querySelectorAll(".fleet-filter-option")].map((node) => ({
           label: (node.querySelector("span:not(.fleet-filter-count)")?.textContent ?? "").trim(),
           count: Number(node.querySelector(".fleet-filter-count")?.textContent ?? "-1"),
         })),
         drawn: cards.length,
         names: cards.map((card) => (card.querySelector(".fleet-name")?.textContent ?? "").trim()),
         favourited: cards
           .filter((card) => card.querySelector(".fleet-favourite.is-favourite") !== null)
           .map((card) => (card.querySelector(".fleet-name")?.textContent ?? "").trim()),
         selected_index: cards.findIndex((card) => card.classList.contains("is-selected")),
         selected_name: (() => {
           const card = cards.find((one) => one.classList.contains("is-selected"));
           return card === undefined ? null : (card.querySelector(".fleet-name")?.textContent ?? "").trim();
         })(),
         focus_is_a_pick: document.activeElement?.classList.contains("fleet-pick") === true,
         inbox_badge: document.querySelector(".sidebar-badge")?.textContent?.trim() ?? null,
       };
     })()`,
  );
}

/** The scene log, written beside the matrix's own measurements. */
const scenesLog: object[] = [];

function note(name: string, body: object): void {
  scenesLog.push({ scene: name, ...body });
  console.log(`[views] SCENE ${name} ${JSON.stringify(body)}`);
}

/**
 * One pass of every pressed claim, in one theme.
 *
 * Run per theme rather than once, because MAR-614's own text records that
 * light mode is the part Henrik said he likes and a density or filter pass
 * that works in dark and breaks light is a regression. The pass leaves the
 * fleet as it found it — filter back to All, the star pressed off again — so
 * the second theme starts from the same place the first did rather than
 * inheriting its favourite.
 */
async function scenePass(target: BrowserWindow, theme: string): Promise<void> {
  await go(target, "/");
  await resizeTo(target, 1280, 980);
  await choose(target, "grid", "comfortable");

  /* ---- MAR-640: the badge counts work that arrived ---- */
  const arrived = (await fleetState(target)) as { inbox_badge: string | null; counts: unknown };
  note(`inbox-badge-${theme}`, {
    claim: "MAR-640 — a live count of waiting work on the sidebar's Work inbox row",
    inbox_badge: arrived.inbox_badge,
    filter_counts: arrived.counts,
  });
  await shoot(target, `scene-inbox-badge-1280-${theme}`);

  /* ---- MAR-640: a filter draws exactly the number the rail promised ---- */
  const before = (await fleetState(target)) as { counts: { label: string; count: number }[] };
  const promised = before.counts.find((one) => one.label === "Needs action")?.count ?? -1;
  const found = await pressFilter(target, "Needs action");
  const after = (await fleetState(target)) as { drawn: number; names: string[]; filter: string | null };
  note(`filter-needs-action-${theme}`, {
    claim: "MAR-640 — filter counts match the store",
    control_found: found,
    /* The two halves of "the counts match": what the rail said before the
       press, and what the stage actually drew after it. */
    rail_promised: promised,
    stage_drew: after.drawn,
    matches: found && promised === after.drawn,
    filter_now: after.filter,
    names: after.names,
  });
  await shoot(target, `scene-filter-needs-action-1280-${theme}`);

  /* ---- MAR-640: the favourite star, pressed ---- */
  await pressFilter(target, "All");
  const starred = (await ask(
    target,
    "press a favourite star",
    `(() => {
       const card = [...document.querySelectorAll(".fleet-card")].find(
         (one) => one.querySelector(".fleet-favourite") !== null,
       );
       if (card === undefined) return null;
       const star = card.querySelector(".fleet-favourite");
       const name = (card.querySelector(".fleet-name")?.textContent ?? "").trim();
       const wasPressed = star.getAttribute("aria-pressed");
       star.click();
       return { name: name, was: wasPressed, label: star.getAttribute("aria-label") };
     })()`,
  )) as { name: string; was: string; label: string } | null;
  await settle(1200);
  const lit = (await fleetState(target)) as { favourited: string[] };
  note(`favourite-${theme}`, {
    claim: "MAR-640 — a star toggle on card hover, and Favourites as a filter",
    pressed_on: starred?.name ?? null,
    aria_pressed_before: starred?.was ?? null,
    aria_label_before: starred?.label ?? null,
    favourited_after: lit.favourited,
  });
  await shoot(target, `scene-favourite-pressed-1280-${theme}`);

  const favFound = await pressFilter(target, "Favourites");
  const only = (await fleetState(target)) as {
    drawn: number;
    names: string[];
    filter_count: number | null;
  };
  note(`filter-favourites-${theme}`, {
    claim: "MAR-640 — the Favourites filter draws the starred agent and nothing else",
    control_found: favFound,
    rail_promised: only.filter_count,
    stage_drew: only.drawn,
    matches: favFound && only.filter_count === only.drawn,
    names: only.names,
  });
  await shoot(target, `scene-filter-favourites-1280-${theme}`);

  /* ---- MAR-640: ↑/↓ moves the selection in Rows ---- */
  await pressFilter(target, "All");
  await choose(target, "rows", "comfortable");
  await ask(
    target,
    "focus the first row",
    `(() => {
       const pick = document.querySelector(".fleet-card .fleet-pick");
       if (pick !== null) pick.focus();
       return true;
     })()`,
  );
  await settle(400);
  const atRest = (await fleetState(target)) as { selected_index: number; selected_name: string | null };
  /*
   * A real key, through Chromium's input pipeline. `dispatchEvent` would
   * reach React's root listener too, but it would prove that React's handler
   * runs when handed an event — not that pressing Down on this page moves the
   * selection, which is the sentence MAR-640 actually wrote.
   */
  for (let press = 0; press < 2; press += 1) {
    target.webContents.sendInputEvent({ type: "keyDown", keyCode: "Down" });
    target.webContents.sendInputEvent({ type: "keyUp", keyCode: "Down" });
    await settle(500);
  }
  const moved = (await fleetState(target)) as {
    selected_index: number;
    selected_name: string | null;
    focus_is_a_pick: boolean;
  };
  note(`rows-arrow-keys-${theme}`, {
    claim: "MAR-640 — ↑/↓ moves selection in Rows, and focus follows it",
    selected_before: atRest.selected_index,
    name_before: atRest.selected_name,
    presses: 2,
    selected_after: moved.selected_index,
    name_after: moved.selected_name,
    moved: moved.selected_index !== atRest.selected_index,
    focus_followed: moved.focus_is_a_pick,
  });
  await shoot(target, `scene-rows-arrow-keys-1280-${theme}`);

  /* ---- MAR-639: the spotlight sizes with the stage, not against it ---- */
  /*
   * The issue's third bullet and the only one of its acceptance items the
   * cold matrix cannot reach: *"spotlight focused card measurably larger at
   * 80% scale than before."*
   *
   * The defect it names is mechanical. The track was a fixed `13rem` above
   * 901px, so turning the UI scale down grew the stage — more CSS pixels of
   * room — while the card stayed the same number of them. The fix sizes it
   * `clamp(14rem, 26vw, 22rem)`, which is a *proportion* of the viewport.
   *
   * "Than before" is a comparison against a build this session cannot run,
   * so it is not what is measured. What is measured is the property that
   * makes the fix a fix: at 80% scale the viewport is wider in CSS pixels,
   * and a card that sizes with the stage must therefore be wider too. A card
   * that came back to a fixed rem would report the identical width at both
   * scales, and that is the reading that would fail.
   *
   * `setZoomFactor` rather than the ui-scale.json preference: this is the
   * same knob MAR-614's control turns, and writing the person's stored
   * preference from a capture run is what `run()` above already refuses to
   * do. Pinned back to 1 afterwards for the same reason.
   */
  await choose(target, "spotlight", "comfortable");
  const spotlightAt = async (zoom: number): Promise<unknown> => {
    target.webContents.setZoomFactor(zoom);
    await settle(1200);
    return ask(
      target,
      `measure the spotlight at ${String(zoom)}`,
      `(() => {
         const track = document.querySelector(".row-list.fleet-grid");
         const centred = document.querySelector("li.is-centred");
         const style = track === null ? null : getComputedStyle(track);
         return {
           viewport: window.innerWidth,
           auto_columns: style === null ? null : style.gridAutoColumns,
           centred_width: centred === null
             ? null
             : Math.round(centred.getBoundingClientRect().width),
           track_width: track === null ? null : track.clientWidth,
         };
       })()`,
    );
  };
  const atFull = (await spotlightAt(1)) as { viewport: number; centred_width: number | null };
  await shoot(target, `scene-spotlight-scale-100-1280-${theme}`);
  const atEighty = (await spotlightAt(0.8)) as { viewport: number; centred_width: number | null };
  await shoot(target, `scene-spotlight-scale-80-1280-${theme}`);
  target.webContents.setZoomFactor(1);
  await settle(800);
  note(`spotlight-ui-scale-${theme}`, {
    claim: "MAR-639 — the spotlight card is sized from the viewport, so turning the UI scale down grows it instead of shrinking it",
    at_100: atFull,
    at_80: atEighty,
    /* The viewport really did grow, or the comparison below means nothing. */
    stage_grew: atEighty.viewport > atFull.viewport,
    card_grew_with_it:
      atFull.centred_width !== null
      && atEighty.centred_width !== null
      && atEighty.centred_width > atFull.centred_width,
    /* The reading that would mean the fixed track is back. */
    card_stayed_fixed: atFull.centred_width === atEighty.centred_width,
  });

  /* Leave it as it was found — see this function's own header. */
  await choose(target, "grid", "comfortable");
  await ask(
    target,
    "unstar",
    `(() => {
       const star = document.querySelector(".fleet-favourite.is-favourite");
       if (star === null) return false;
       star.click();
       return true;
     })()`,
  );
  await settle(1000);
  await pressFilter(target, "All");
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });
  seed();

  const window = await appWindowLoaded();
  window.setResizable(true);
  /*
   * This harness shares Electron's default user-data with other unpackaged
   * sessions, and MAR-614's scale lives there as zoomFactor. A leftover 1.2
   * made innerWidth 1066 at a 1280 content size, so every viewport label
   * would have been a lie. Pin 1 for the capture; do not write ui-scale.json,
   * which is the person's preference, not this run's.
   */
  window.webContents.setZoomFactor(1);
  await settle(1200);

  let mismatches = 0;
  const missed: string[] = [];

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

          /*
           * The fleet size is in the filename, because it is the one thing
           * about these frames that two runs into one directory would
           * otherwise disagree about silently — a three-agent grid and a
           * six-agent grid are the same view at the same width in the same
           * theme, and MAR-634 is the issue about telling them apart.
           */
          const name = `fleet${String(FLEET)}-${view}-${viewport.name}-${theme}-${density}`;
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
          measurements.push({
            fleet: FLEET,
            view,
            density,
            theme,
            viewport: viewport.name,
            ...(measured as object),
          });
          console.log(
            `[views] ${view}/${density} at ${viewport.name}/${theme} ` +
              `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
          );

          /*
           * Measured before the frame is taken, and recorded rather than
           * thrown. A shortfall is still worth photographing — it is the
           * picture of the defect — so this fails the *run* at the end and
           * leaves the evidence behind, which is the opposite of the label
           * mismatch above, where the image itself would be the lie.
           */
          const missing = shortfall(view, viewport.name, measured as Counted);
          if (missing !== null) {
            missed.push(`${name}: ${missing}`);
            console.error(`[views] COUNT ${name}: ${missing}`);
          }

          await shoot(window, name);
        }
      }
    }
  }

  /*
   * The pressed half, after the last cold frame and never before it — see the
   * scenes block's own header for both reasons. Skipped when the run was
   * narrowed to one view with `DASH_CAPTURE_VIEW`, because a re-shoot of the
   * spotlight should not also re-seed the store and re-press every control.
   */
  if (ONLY === undefined) {
    seedWaitingWork();
    for (const theme of THEMES) {
      nativeTheme.themeSource = theme;
      await settle(300);
      await scenePass(window, theme);
    }
  } else {
    console.log(`[views] scenes skipped — this run was narrowed to ${ONLY}`);
  }

  writeFileSync(
    path.join(OUT, `layout-fleet${String(FLEET)}.json`),
    `${JSON.stringify(
      {
        fleet: FLEET,
        views: VIEWS,
        captured_at: new Date().toISOString(),
        measurements,
        scenes: scenesLog,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  console.log(
    `\n[views] wrote ${String(written.length)} images and layout-fleet${String(FLEET)}.json to ${OUT}\n` +
      `[views] ${overflowed.length === 0 ? "no frame overflowed the page sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[views] ${mismatches === 0 ? "every frame's labels matched the document it photographed" : `${String(mismatches)} FRAMES REFUSED — the labels did not match`}\n` +
      `[views] ${missed.length === 0 ? `every 1280 frame met MAR-630's stated count at ${String(FLEET)} agents` : `${String(missed.length)} FRAMES MISSED THE COUNT:\n  ${missed.join("\n  ")}`}`,
  );

  app.exit(mismatches === 0 && missed.length === 0 ? 0 : 1);
}

void run().catch((error: unknown) => {
  console.error(`[views] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
