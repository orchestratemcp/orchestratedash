/**
 * MAR-615's three surfaces, photographed in the real shell: the bottom strip,
 * the chief's spotlight, and the per-agent avatar picker. **Not part of the
 * shipped shell.**
 *
 * ## Why a harness of its own
 *
 * `electron/capture-actions.ts` already photographs the fleet *cards* for
 * MAR-587, and it is the right harness for that claim. This one exists for a
 * claim that did not exist when it was written: MAR-615 vendored the rest of
 * the cast's idle sheets and gave the chief a portrait, and then MAR-648 landed
 * a composer on the chief's band. Those two met for the first time in this
 * branch's merge, on one element, and the question a reviewer actually has is
 * whether they **compose or overlap** — which no test in this repository can
 * answer, because every render test here is `renderToStaticMarkup` and none of
 * them lay anything out.
 *
 * So the images are only half of what this writes. `layout.json` carries the
 * portrait's rectangle and the composer's, and the intersection of the two, at
 * every width and in both states. A picture of that band can look perfectly
 * fine at 1280 and have the baton through the textarea at 375; the numbers say
 * which, and they say it the same way whether or not anybody looks closely.
 *
 * ## Density is not swept here, deliberately
 *
 * MAR-615's claim is about costume and placement, neither of which is a density
 * decision, and a density sweep on this harness would double every frame to
 * re-prove something `capture-actions.ts` and `capture-settings-polish.ts`
 * already hold. Every frame here is **comfortable**, forced rather than
 * assumed: `localStorage` lives in Electron's session partition and survives
 * between capture runs, so a prior run's compact setting would otherwise be
 * photographed under a comfortable filename.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open —
 * `smoke-identity.js` is deliberately not imported, so this borrows neither the
 * app's single-instance lock nor its user-data directory.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     mkdir '…\scratch-mar615'
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-mar615'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar615/after'
 *     pnpm exec electron dist/electron/capture-mar615.mjs --user-data-dir=…\ud-mar615
 *
 * **`DASH_DATA_DIR` must already exist, and this harness cannot create it for
 * you.** `lib/db.ts` resolves it to a SQLite path at *import* time, and
 * `import "./main.js"` is hoisted above every statement in this file — so by
 * the time any line here could run, the store has already been opened or
 * already failed. A missing directory fails that open, and because it happens
 * during module load the failure surfaces as an Electron **error dialog**
 * rather than on stdout: the run then sits at zero CPU with an empty log, no
 * capture directory, and a window titled *Error*, which reads exactly like a
 * hang. It cost this session one run.
 *
 * `--user-data-dir` is not optional when more than one worktree of this
 * repository exists on the machine: without it two runs share Electron's
 * default profile and collide, and the loser leaves a stale log that makes a
 * dead run look like a successful one.
 *
 * `build:renderer` before `build:shell` because `build:shell` only *copies*
 * `out/` — skip the first and this photographs the previous build's pages.
 * `DASH_SHELL_URL` because an unpackaged main otherwise loads loopback and
 * every page fails to connect. PowerShell because under Git Bash the runner
 * cannot read its own user identity and the shell renders empty. A visible
 * window because `capturePage()` never resolves against a compositor that is
 * not compositing.
 *
 * ## What it leaves behind, said out loud
 *
 * Importing `./main.js` starts a runner against the scratch store, and
 * `app.exit(0)` does not stop it. This leaves one live runner holding a scratch
 * store, exactly as every other capture harness here does — harmless to
 * anybody's records, and not harmless to the next `pnpm verify:shell` on this
 * machine. Run it when you are about to review images, not when you are about
 * to run the gate, and name the leftover pid in whatever you write.
 *
 * Never on the `electron .` path and named by no `package.json` script, on
 * `electron/capture.ts`'s terms: this produces evidence, never a verdict.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { importManifest, ingestArtifacts, recordAgentLook } from "../lib/store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar615");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

/*
 * Five agents whose names hash to five different characters, so the strip and
 * the picker are photographed with a cast rather than with one costume five
 * times. `oFor` in `lib/brand/o-cast.ts` does the hashing; these names are
 * `capture-actions.ts`'s, reused unchanged so the two harnesses' images are
 * comparable to each other.
 */
const KNIGHT = "budget-digest";
const MEDIC = "deal-finder";
const NINJA = "ledger-notes";
const EXPLORER = "news-scout";
const WIZARD = "uptime-sorter";

/** The agent whose settings stage the picker is photographed on. */
const SUBJECT = KNIGHT;

function example(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.resolve(process.cwd(), "examples", name), "utf8")) as Record<
    string,
    unknown
  >;
}

/** The same document under a name this scene chose, so five rows are five agents. */
function renamed(file: string, name: string, displayName: string): Record<string, unknown> {
  const manifest = example(file);
  const agent = manifest["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;
  return manifest;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Seed the scratch store this run was pointed at.
 *
 * Everything goes in through the ordinary doors — `importManifest`,
 * `ingestArtifacts`, `recordAgentLook` — rather than by writing rows, so
 * nothing here can stage a state the product cannot reach. In particular the
 * avatars are **not** set: `importManifest` assigns the costume on the way in,
 * which is the only path that ever assigns one, and a harness that wrote the
 * column directly would be photographing an arrangement DASH cannot produce.
 */
function seed(): void {
  importManifest(renamed("gmail-meeting-assistant.manifest.v2.example.json", KNIGHT, "Budget Digest"));
  importManifest(renamed("dash-managed-secret.manifest.v2.example.json", MEDIC, "Deal Finder"));
  importManifest(renamed("agent.manifest.example.json", NINJA, "Ledger Notes"));
  importManifest(renamed("dash-managed.manifest.v2.example.json", EXPLORER, "News Scout"));
  importManifest(renamed("agent.manifest.example.json", WIZARD, "Uptime Sorter"));

  /* One agent with something to show, so the chief has a sentence worth saying
     rather than the all-clear for every row. */
  ingestArtifacts({
    artifact_version: 1,
    agent: NINJA,
    run_id: "run-ledger-1",
    artifact_id: "digest-ledger-1",
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
  recordAgentLook(WIZARD, new Date().toISOString());

  console.log("[mar615] seeded 5 agents across 5 characters");
}

/* ---------------------------------------------------------------------- *
 * The harness — `capture-settings-polish.ts`'s guards, unchanged
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
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    /* Deterministic rather than flaky: the first `capturePage` after a shrink
       fails on this platform and the retry succeeds. */
    console.log(
      `[mar615]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(`capturePage retry for ${name}`, 20_000, target.webContents.capturePage());
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[mar615] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

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
  await settle(1200);
}

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

/** Read the ambient density and press only if it disagrees with comfortable. */
async function ensureComfortable(target: BrowserWindow): Promise<void> {
  const current = (await target.webContents.executeJavaScript(
    `document.documentElement.getAttribute("data-density")`,
  )) as string | null;
  if (current === "compact") {
    console.log("[mar615] ambient density was compact from a prior run — resetting");
    await pressDensityToggle(target);
  }
}

/**
 * The measurement this harness exists for.
 *
 * `overlap_area` is the intersection of the chief's portrait with the composer,
 * in CSS pixels. Zero is the passing answer and the only one: these are two
 * elements of one band and neither is allowed to sit on the other. It is
 * reported alongside both rectangles rather than as a bare verdict, because a
 * number greater than zero needs to be readable as *which way* they collided.
 *
 * `strip_animated` and `strip_total` are the bottom strip's own claim — every
 * O in it now has a vendored sheet, so the two should agree. They are counted
 * from `is-action` on the avatar rather than from the sheet manifest, which is
 * the difference between "the file exists" and "this page is drawing it".
 */
async function measureBand(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure band",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const box = (el) => {
           if (el === null) return null;
           const r = el.getBoundingClientRect();
           return {
             x: Math.round(r.x), y: Math.round(r.y),
             width: Math.round(r.width), height: Math.round(r.height),
           };
         };
         const intersect = (a, b) => {
           if (a === null || b === null) return null;
           const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
           const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
           return w > 0 && h > 0 ? w * h : 0;
         };
         const glyph = box(document.querySelector(".chief-glyph"));
         const chat = box(document.querySelector(".chief-chat"));
         const line = box(document.querySelector(".chief-line"));
         const strip = document.querySelectorAll(".fleet-strip-o .o-avatar");
         let animated = 0;
         strip.forEach((el) => { if (el.classList.contains("is-action")) animated += 1; });
         return {
           viewport: window.innerWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           band_found: document.querySelector(".chief-band") !== null,
           chief_is_open: document.querySelector(".fleet-stage.chief-is-open") !== null,
           glyph_box: glyph,
           chat_box: chat,
           line_box: line,
           glyph_is_action: (() => {
             const el = document.querySelector(".chief-glyph");
             return el === null ? null : el.classList.contains("is-action");
           })(),
           overlap_area: intersect(glyph, chat),
           overlap_with_line: intersect(glyph, line),
           strip_found: document.querySelector(".fleet-strip") !== null,
           strip_total: strip.length,
           strip_animated: animated,
         };
       })()`,
    ),
  );
}

/** The picker's own count: every option drawn, and how many of them animate. */
async function measurePicker(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure picker",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const options = document.querySelectorAll(".avatar-picker-option");
         let animated = 0;
         options.forEach((el) => {
           const o = el.querySelector(".o-avatar");
           if (o !== null && o.classList.contains("is-action")) animated += 1;
         });
         const field = document.querySelector(".agent-avatar-field");
         return {
           viewport: window.innerWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           field_found: field !== null,
           picker_open: document.querySelector(".avatar-picker") !== null,
           option_count: options.length,
           option_animated: animated,
           pressed_count: document.querySelectorAll('.avatar-picker-option[aria-pressed="true"]').length,
         };
       })()`,
    ),
  );
}

/** Focus the chief's composer the way a person does — which is what opens it. */
async function focusComposer(target: BrowserWindow): Promise<boolean> {
  const focused = (await target.webContents.executeJavaScript(
    `(() => {
       const input = document.querySelector("textarea.chief-input");
       if (input === null) return false;
       input.focus();
       return document.activeElement === input;
     })()`,
  )) as boolean;
  await settle(600);
  return focused;
}

/** Open the avatar picker by pressing the control that opens it. */
async function openPicker(target: BrowserWindow): Promise<boolean> {
  const opened = (await target.webContents.executeJavaScript(
    `(() => {
       const field = document.querySelector(".agent-avatar-field");
       if (field === null) return false;
       const button = field.querySelector("button.button-link");
       if (button === null) return false;
       button.click();
       return true;
     })()`,
  )) as boolean;
  await settle(700);
  return opened;
}

async function scrollTo(target: BrowserWindow, selector: string): Promise<boolean> {
  const found = (await target.webContents.executeJavaScript(
    `(() => {
       const el = document.querySelector(${JSON.stringify(selector)});
       if (el === null) return false;
       el.scrollIntoView({ block: "center", behavior: "instant" });
       return true;
     })()`,
  )) as boolean;
  await settle(500);
  return found;
}

const AGENT_ROUTE = `/agents/detail?agent=${encodeURIComponent(SUBJECT)}&stage=settings`;

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });
  seed();

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);
  await go(window, "/");
  await ensureComfortable(window);

  for (const theme of THEMES) {
    // The operating system's own signal, not a stylesheet override.
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const viewport of VIEWPORTS) {
      /* ---- the fleet page: the spotlight and the strip ---- */
      await go(window, "/");
      await resizeTo(window, viewport.width, viewport.height);
      // Reloaded after the resize: a page reads its view once, on mount, and a
      // layout settled at the previous width would be filed under this one.
      await go(window, "/");

      const closed = await measureBand(window);
      measurements.push({
        surface: "spotlight",
        state: "composer-closed",
        viewport: viewport.name,
        theme,
        ...(closed as object),
      });
      console.log(`[mar615] spotlight closed ${viewport.name}/${theme} ${JSON.stringify(closed)}`);
      await scrollTo(window, ".chief-band");
      await shoot(window, `spotlight-closed-${viewport.name}-${theme}`);

      await scrollTo(window, ".fleet-strip");
      await shoot(window, `strip-${viewport.name}-${theme}`);

      /* ---- the same band with the composer focused ---- */
      await scrollTo(window, ".chief-band");
      const focused = await focusComposer(window);
      const open = await measureBand(window);
      measurements.push({
        surface: "spotlight",
        state: "composer-focused",
        viewport: viewport.name,
        theme,
        composer_focused: focused,
        ...(open as object),
      });
      console.log(`[mar615] spotlight open ${viewport.name}/${theme} ${JSON.stringify(open)}`);
      await shoot(window, `spotlight-open-${viewport.name}-${theme}`);

      /* ---- the avatar picker, shut and open ---- */
      await go(window, AGENT_ROUTE);
      await scrollTo(window, ".agent-avatar-field");
      const shut = await measurePicker(window);
      measurements.push({
        surface: "picker",
        state: "closed",
        viewport: viewport.name,
        theme,
        ...(shut as object),
      });
      await shoot(window, `picker-closed-${viewport.name}-${theme}`);

      const opened = await openPicker(window);
      await scrollTo(window, ".agent-avatar-field");
      const wide = await measurePicker(window);
      measurements.push({
        surface: "picker",
        state: "open",
        viewport: viewport.name,
        theme,
        opened,
        ...(wide as object),
      });
      console.log(`[mar615] picker ${viewport.name}/${theme} ${JSON.stringify(wide)}`);
      await shoot(window, `picker-open-${viewport.name}-${theme}`);
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  /*
   * The claims these images are supposed to support, checked rather than left
   * to a reviewer's eye. Each of these has a picture that looks correct while
   * being wrong.
   */
  const bands = measurements.filter((entry) => (entry as { surface: string }).surface === "spotlight");
  const pickers = measurements.filter((entry) => (entry as { surface: string }).surface === "picker");
  const collided = bands.filter((entry) => ((entry as Record<string, number>)["overlap_area"] ?? 0) > 0);
  const onTheLine = bands.filter(
    (entry) => ((entry as Record<string, number>)["overlap_with_line"] ?? 0) > 0,
  );
  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  const stillChief = bands.filter((entry) => (entry as { glyph_is_action: boolean }).glyph_is_action !== true);
  const stripGaps = bands.filter(
    (entry) =>
      ((entry as Record<string, number>)["strip_total"] ?? 0) !==
      ((entry as Record<string, number>)["strip_animated"] ?? -1),
  );
  const emptyPickers = pickers.filter(
    (entry) =>
      (entry as { state: string }).state === "open" &&
      ((entry as Record<string, number>)["option_count"] ?? 0) === 0,
  );

  console.log(
    `\n[mar615] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[mar615] ${collided.length === 0 ? "portrait and composer never overlap" : `${String(collided.length)} FRAMES OVERLAP THE COMPOSER`}\n` +
      `[mar615] ${onTheLine.length === 0 ? "portrait never overlaps the chief's sentence" : `${String(onTheLine.length)} FRAMES OVERLAP THE LINE`}\n` +
      `[mar615] ${stillChief.length === 0 ? "the chief animates in every frame" : `${String(stillChief.length)} FRAMES DREW A STILL CHIEF`}\n` +
      `[mar615] ${stripGaps.length === 0 ? "every O in the strip animates" : `${String(stripGaps.length)} FRAMES HAD A STILL O IN THE STRIP`}\n` +
      `[mar615] ${emptyPickers.length === 0 ? "the picker drew its options" : `${String(emptyPickers.length)} OPEN PICKERS WERE EMPTY`}\n` +
      `[mar615] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[mar615] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
