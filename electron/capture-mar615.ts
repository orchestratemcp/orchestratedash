/**
 * MAR-615's three surfaces, photographed in the real shell: the bottom strip,
 * the chief's composer, and the per-agent avatar picker. **Not part of the
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
 * ## MAR-696: the same question, a different collision
 *
 * The bordered `ChiefBand` this file's own history describes is gone, and with
 * it `.chief-band`/`.chief-glyph`/`.chief-chat`/`.chief-line` — deleted, not
 * repurposed, per `app/globals.css`'s own note. `measureComposer` (below,
 * renamed from `measureBand`) reads the surface that replaced it:
 * `.chief-composer`, incorporated into the page rather than floating over it,
 * with the chief's portrait perched *on* the field on purpose now
 * (`.chief-composer-o`) rather than standing beside it — so "zero overlap
 * with the composer" is no longer the right invariant; some overlap with
 * `.chief-input-wrap`, and with `.chief-input`'s own top padding, is the
 * design (the sprite's feet, not its whole body, land on the field). What
 * still must stay zero is `overlap_past_padding` below: how far the sprite
 * reaches past the padding into the row `.chief-input`'s text actually sits
 * on — the one part a costume must never cover, whichever field it perches on.
 *
 * So the images are only half of what this writes. `layout.json` carries the
 * portrait's rectangle and the textarea's, and the intersection of the two, at
 * every width, in both themes, and in both the collapsed and the expanded
 * state — each state's own frame forced explicitly per shot rather than
 * assumed to persist, `capture-fleet-views.ts`'s own lesson about a toggle
 * that survives navigation: a picture of that field can look perfectly fine
 * at 1280 and have the O through the typed text at 375; the numbers say
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
import { recordChiefTurn } from "../lib/chief/store.js";

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

  /*
   * MAR-706. Ten turns, through the same `recordChiefTurn` door the product
   * itself writes through — enough to overflow `.chief-room`'s own
   * `max-height: min(24rem, calc(100vh - 10rem))` at every viewport this
   * harness sweeps, so the "scrolled" scene below is actually scrolled
   * rather than showing a room that fit anyway.
   */
  for (let i = 1; i <= 10; i += 1) {
    recordChiefTurn({
      asked_at: daysAgo(10 - i),
      question: `How is Budget Digest doing after run ${String(i)}?`,
      answer: `Run ${String(i)} finished clean. Nothing flagged for review.`,
      failure: null,
      provider_id: null,
      model_id: null,
      tokens_in: null,
      tokens_out: null,
      amount_usd: null,
      receipt: [],
    });
  }

  console.log("[mar615] seeded 5 agents across 5 characters and 10 chief turns");
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
 * The measurement this harness exists for (renamed from `measureBand`,
 * MAR-696 — the box it used to measure is gone).
 *
 * `overlap_area` is the intersection of the chief's perched portrait with the
 * **textarea itself** — `.chief-input`, not the whole composer. Some overlap
 * is the design now, not a defect: `.chief-composer-o`'s own header explains
 * that the sprite's feet land inside the field's top padding on purpose, the
 * same way a standing figure's feet sink slightly into the ground it stands
 * on rather than floating a pixel above it. What must stay zero is
 * `overlap_past_padding` — the vertical reach of that overlap past
 * `--space-3` (the field's own top padding, `.chief-input`'s rule), which is
 * where `.chief-input`'s text actually starts. `overlap_with_field` is
 * reported alongside both and is *expected* to be positive — the perch
 * overlapping `.chief-input-wrap`'s own box is the whole point of the
 * `transform` below.
 */
async function measureComposer(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure composer",
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
         const oEl = document.querySelector(".chief-composer-o");
         const inputEl = document.querySelector(".chief-input");
         const o = box(oEl);
         const input = box(inputEl);
         const field = box(document.querySelector(".chief-input-wrap"));
         const room = box(document.querySelector(".chief-room"));
         const strip = document.querySelectorAll(".fleet-strip-o .o-avatar");
         let animated = 0;
         strip.forEach((el) => { if (el.classList.contains("is-action")) animated += 1; });
         /*
          * How far the O's own bottom edge reaches past where the field's
          * top padding ends — the boundary the input's text actually starts
          * at. Negative or zero means the sprite's feet stay inside the
          * padding (the design); positive means they have reached the text
          * row, which is the one number this harness refuses.
          */
         const padTop = inputEl === null ? null : parseFloat(getComputedStyle(inputEl).paddingTop);
         const overlapPastPadding =
           o === null || input === null || padTop === null
             ? null
             : Math.round(o.y + o.height - (input.y + padTop));
         return {
           viewport: window.innerWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           composer_found: document.querySelector(".chief-composer") !== null,
           composer_is_open: document.querySelector(".chief-composer.is-open") !== null,
           room_box: room,
           o_box: o,
           input_box: input,
           field_box: field,
           o_is_action: oEl === null ? null : oEl.classList.contains("is-action"),
           overlap_area: intersect(o, input),
           overlap_past_padding: overlapPastPadding,
           overlap_with_field: intersect(o, field),
           model_line_found: document.querySelector(".chief-model-line") !== null,
           room_heading_visible: (() => {
             const el = document.querySelector(".chief-room-heading");
             return el === null ? null : el.textContent;
           })(),
           strip_found: document.querySelector(".fleet-strip") !== null,
           strip_total: strip.length,
           strip_animated: animated,
         };
       })()`,
    ),
  );
}

/**
 * MAR-706. Whether the header — and its Close/Clear controls — stayed on
 * screen once `.chief-room-scroll` (the transcript's own scrolling child) was
 * pushed to its bottom. A screenshot alone cannot prove this as reliably as a
 * measured rectangle can: `head_visible`/`close_visible`/`clear_visible` ask
 * whether each element's box still sits inside `.chief-room`'s own box after
 * the scroll, which is false exactly when the header scrolled away with the
 * transcript rather than staying pinned above it.
 */
async function measureRoomPin(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure room pin",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const box = (el) => {
           if (el === null) return null;
           const r = el.getBoundingClientRect();
           return {
             x: Math.round(r.x), y: Math.round(r.y),
             width: Math.round(r.width), height: Math.round(r.height),
           };
         };
         const containedIn = (inner, outer) =>
           inner !== null && outer !== null &&
           inner.y >= outer.y - 1 && inner.y + inner.height <= outer.y + outer.height + 1;
         const room = box(document.querySelector(".chief-room"));
         const scroller = document.querySelector(".chief-room-scroll");
         return {
           scrolled: scroller === null ? null : scroller.scrollTop > 0,
           scroll_height: scroller === null ? null : scroller.scrollHeight,
           scroll_client_height: scroller === null ? null : scroller.clientHeight,
           head_visible: containedIn(box(document.querySelector(".chief-room-head")), room),
           close_visible: containedIn(box(document.querySelector(".chief-room-close")), room),
           clear_visible: containedIn(box(document.querySelector(".chief-room-clear")), room),
         };
       })()`,
    ),
  );
}

/** Scroll `.chief-room-scroll` to its own bottom, the way the newest-turn effect does. */
async function scrollRoomToBottom(target: BrowserWindow): Promise<void> {
  await within(
    "scroll room to bottom",
    5_000,
    target.webContents.executeJavaScript(
      `(() => {
         const scroller = document.querySelector(".chief-room-scroll");
         if (scroller !== null) scroller.scrollTop = scroller.scrollHeight;
       })()`,
    ),
  );
  await settle(400);
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
      /* ---- the fleet page: the composer, collapsed and expanded, and the strip ---- */
      await go(window, "/");
      await resizeTo(window, viewport.width, viewport.height);
      // Reloaded after the resize: a page reads its view once, on mount, and a
      // layout settled at the previous width would be filed under this one.
      await go(window, "/");

      const closed = await measureComposer(window);
      measurements.push({
        surface: "composer",
        state: "collapsed",
        viewport: viewport.name,
        theme,
        ...(closed as object),
      });
      console.log(`[mar615] composer collapsed ${viewport.name}/${theme} ${JSON.stringify(closed)}`);
      await scrollTo(window, ".chief-composer");
      await shoot(window, `composer-collapsed-${viewport.name}-${theme}`);

      await scrollTo(window, ".fleet-strip");
      await shoot(window, `strip-${viewport.name}-${theme}`);

      /*
       * ---- the same composer expanded (MAR-696) ----
       *
       * Forced per frame, not assumed to persist — `capture-fleet-views.ts`'s
       * own lesson about the density toggle applies here just as directly: a
       * navigation (`go`, above) unmounts the room, so every frame in this
       * loop presses focus again rather than trusting the previous frame's
       * state survived the reload.
       */
      await scrollTo(window, ".chief-composer");
      const focused = await focusComposer(window);
      const open = await measureComposer(window);
      measurements.push({
        surface: "composer",
        state: "expanded",
        viewport: viewport.name,
        theme,
        composer_focused: focused,
        ...(open as object),
      });
      console.log(`[mar615] composer expanded ${viewport.name}/${theme} ${JSON.stringify(open)}`);
      await shoot(window, `composer-expanded-${viewport.name}-${theme}`);

      /*
       * ---- MAR-706: the room scrolled to its latest turn, header still pinned ----
       *
       * One frame, not the full sweep: `seed()`'s ten turns overflow the room
       * at every viewport this loop visits, so 1280/light alone is enough to
       * prove the header stays put — the room's own CSS does not change per
       * viewport in a way that would make a wider or narrower frame behave
       * differently.
       */
      if (viewport.name === "1280" && theme === "light") {
        await scrollRoomToBottom(window);
        const pinned = await measureRoomPin(window);
        measurements.push({
          surface: "composer",
          state: "expanded-scrolled",
          viewport: viewport.name,
          theme,
          ...(pinned as object),
        });
        console.log(`[mar615] room scrolled ${viewport.name}/${theme} ${JSON.stringify(pinned)}`);
        await shoot(window, `composer-expanded-scrolled-${viewport.name}-${theme}`);
      }

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
  const composers = measurements.filter((entry) => (entry as { surface: string }).surface === "composer");
  const pickers = measurements.filter((entry) => (entry as { surface: string }).surface === "picker");
  const overTheText = composers.filter(
    (entry) => ((entry as Record<string, number>)["overlap_past_padding"] ?? 0) > 0,
  );
  const offTheField = composers.filter(
    (entry) => ((entry as Record<string, number>)["overlap_with_field"] ?? 0) <= 0,
  );
  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  const stillChief = composers.filter((entry) => (entry as { o_is_action: boolean }).o_is_action !== true);
  const expandedButClosed = composers.filter(
    (entry) =>
      (entry as { state: string }).state === "expanded" &&
      (entry as { composer_is_open: boolean }).composer_is_open !== true,
  );
  const stripGaps = composers.filter(
    (entry) =>
      ((entry as Record<string, number>)["strip_total"] ?? 0) !==
      ((entry as Record<string, number>)["strip_animated"] ?? -1),
  );
  const emptyPickers = pickers.filter(
    (entry) =>
      (entry as { state: string }).state === "open" &&
      ((entry as Record<string, number>)["option_count"] ?? 0) === 0,
  );
  const scrolledFrames = composers.filter((entry) => (entry as { state: string }).state === "expanded-scrolled");
  const notActuallyScrolled = scrolledFrames.filter((entry) => (entry as { scrolled: boolean }).scrolled !== true);
  const headerCarriedOff = scrolledFrames.filter(
    (entry) =>
      (entry as { head_visible: boolean }).head_visible !== true ||
      (entry as { close_visible: boolean }).close_visible !== true ||
      (entry as { clear_visible: boolean }).clear_visible !== true,
  );

  console.log(
    `\n[mar615] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[mar615] ${overTheText.length === 0 ? "the perched O never covers typed text" : `${String(overTheText.length)} FRAMES HAVE THE O OVER THE TEXTAREA`}\n` +
      `[mar615] ${offTheField.length === 0 ? "the O perches on the field in every frame" : `${String(offTheField.length)} FRAMES HAVE THE O NOT STANDING ON THE FIELD`}\n` +
      `[mar615] ${expandedButClosed.length === 0 ? "every expanded frame is actually open" : `${String(expandedButClosed.length)} EXPANDED FRAMES WERE NOT MARKED OPEN`}\n` +
      `[mar615] ${stillChief.length === 0 ? "the chief animates in every frame" : `${String(stillChief.length)} FRAMES DREW A STILL CHIEF`}\n` +
      `[mar615] ${stripGaps.length === 0 ? "every O in the strip animates" : `${String(stripGaps.length)} FRAMES HAD A STILL O IN THE STRIP`}\n` +
      `[mar615] ${emptyPickers.length === 0 ? "the picker drew its options" : `${String(emptyPickers.length)} OPEN PICKERS WERE EMPTY`}\n` +
      `[mar615] ${scrolledFrames.length > 0 && notActuallyScrolled.length === 0 ? "the scrolled scene actually scrolled" : `${String(notActuallyScrolled.length)} SCROLLED FRAMES DID NOT SCROLL (or the scene never ran)`}\n` +
      `[mar615] ${headerCarriedOff.length === 0 ? "the header, X, and Clear stayed on screen while scrolled" : `${String(headerCarriedOff.length)} SCROLLED FRAMES CARRIED THE HEADER OFF SCREEN`}\n` +
      `[mar615] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[mar615] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
