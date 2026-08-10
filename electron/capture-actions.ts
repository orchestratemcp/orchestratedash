/**
 * The fleet as character select, photographed in the real shell (MAR-587
 * Phase B). **Not part of the shipped shell.**
 *
 * `electron/capture-glance.ts` is the harness this is built on, and it is built
 * on it for the same reason it existed: a run against whatever store a machine
 * happens to hold photographs one arrangement and cannot say which one it got.
 * Here the arrangement that matters is **which characters are on screen**, and
 * a character is assigned by hashing an agent's name — so this run seeds five
 * agents whose names were chosen to land on a scene:
 *
 * | agent           | character | sheet | what its card says (MAR-586)  |
 * | --------------- | --------- | ----- | ----------------------------- |
 * | `budget-digest` | knight    | yes   | needs your approval           |
 * | `deal-finder`   | medic     | —     | not connected                 |
 * | `ledger-notes`  | ninja     | yes   | new output                    |
 * | `news-scout`    | explorer  | —     | overdue                       |
 * | `uptime-sorter` | wizard    | yes   | nothing needs you             |
 *
 * `agentsView` sorts by name, so that table is also the order they appear in —
 * animated, still, animated, still, animated. That interleaving is the point
 * rather than a coincidence: **three of eleven characters have sheets, and the
 * fleet must not put them first.** A set of images where every moving O stood
 * at the top would look like a ranking of agents, which is the exact thing this
 * feature is forbidden to be.
 *
 * ## What a screenshot cannot do, and what is done instead
 *
 * **A photograph cannot show motion.** That is stated here rather than papered
 * over, and it is why the still frames are only half of what this writes:
 *
 * 1. `layout.json` records `background-position` sampled across a loop, so a
 *    reader can see the eight steps advance in numbers.
 * 2. Two frames of the same page are captured with each loop parked on frame 0
 *    and frame 4 — the sprite's own `currentTime`, set through the Web
 *    Animations API, not a second animation invented by the harness — so the
 *    props are visibly in two different places in two otherwise identical
 *    images.
 * 3. The window is hidden and the play state re-read, which is the pause clause
 *    proven rather than asserted.
 * 4. `prefers-reduced-motion: reduce` is emulated through the DevTools protocol
 *    — the closest thing to the operating system's own signal that a harness
 *    can reach — and the fleet is photographed still, on frame 0.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-actions'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar587'
 *     pnpm exec electron dist/electron/capture-actions.mjs
 *
 * Every line is load-bearing and each has cost a session before:
 * `build:renderer` first because `build:shell` only *copies* `out/`;
 * `DASH_SHELL_URL` because without it an unpackaged main loads loopback and
 * every page fails to connect; PowerShell because under Git Bash the runner
 * cannot read its own user identity and the shell renders empty; a visible
 * window because `capturePage()` never resolves against a compositor that is
 * not compositing.
 *
 * Never on the `electron .` path and named by no `package.json` script, on
 * `electron/capture.ts`'s terms: this produces evidence, never a verdict.
 *
 * ## What it leaves behind, said out loud
 *
 * Importing `./main.js` starts a **runner** against the scratch store, and
 * `app.exit(0)` does not stop it. Each run leaves one live runner holding a
 * scratch store, exactly as the other capture harnesses do. Harmless to
 * anybody's records, and **not** harmless to the next `pnpm verify:shell` on
 * this machine — run this when you are about to review images, not when you are
 * about to run the gate, and name the leftover pids in whatever you write.
 */

/*
 * `electron/smoke-identity.ts` is deliberately not imported: borrowing the
 * app's name borrows its single-instance lock, which would mean this could only
 * run with DASH closed. Launched as a bare file, Electron falls back to its own
 * name and user-data directory, so this runs beside a live DASH and cannot
 * touch its records.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { putAgentDomState } from "../lib/agent-dom/store.js";
import { importManifest, ingestArtifacts, ingestEvents, recordAgentLook } from "../lib/store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar587");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

/**
 * The scene, in the order `agentsView` will sort it into.
 *
 * The names are not decorative. `oFor` hashes an agent's name to a character
 * (`lib/brand/o-cast.ts`), so these five were chosen to put a knight, a medic, a
 * ninja, an explorer and a wizard on screen in that order — three with sheets
 * and two without, alternating.
 */
const NEEDS_YOU = "budget-digest"; /* knight  — animated */
const NOT_CONNECTED = "deal-finder"; /* medic   — still    */
const NEW_OUTPUT = "ledger-notes"; /* ninja   — animated */
const OVERDUE = "news-scout"; /* explorer— still    */
const ALL_CLEAR = "uptime-sorter"; /* wizard  — animated */

/** What the page must show, in the order it must show it. */
const EXPECTED_ORDER = [NEEDS_YOU, NOT_CONNECTED, NEW_OUTPUT, OVERDUE, ALL_CLEAR];
const EXPECTED_ANIMATED = 3;

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

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Seed the store this run was pointed at.
 *
 * MAR-586's five answers, under MAR-587's five names, and both halves matter:
 * the chips have to be on these cards for the images to show that the costume
 * did not take their place. Everything goes in through the ordinary doors —
 * `importManifest`, `ingestEvents`, `ingestArtifacts`, `putAgentDomState` —
 * rather than by writing rows, so nothing here can stage a state the product
 * cannot reach.
 */
function seed(): void {
  /* Needs your approval — a pending, runner-enforced request. Knight. */
  const helper = renamed(
    "gmail-meeting-assistant.manifest.v2.example.json",
    NEEDS_YOU,
    "Budget Digest",
  );
  importManifest(helper);
  const state = example("gmail-meeting-assistant.state.example.json");
  state["agent_id"] = NEEDS_YOU;
  state["observed_at"] = daysAgo(0);
  /*
   * The one moved timestamp, and it is the same one MAR-586 moved: the
   * example's deadline is in July, an expired request draws a different
   * sentence on purpose, and the branch worth photographing is the live one.
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

  /* Not connected — a declared key DASH could hold and does not. Medic. */
  importManifest(
    renamed("dash-managed-secret.manifest.v2.example.json", NOT_CONNECTED, "Deal Finder"),
  );

  /* New output — an artifact arrived and nobody has opened the page. Ninja. */
  importManifest(renamed("agent.manifest.example.json", NEW_OUTPUT, "Ledger Notes"));
  ingestArtifacts({
    artifact_version: 1,
    agent: NEW_OUTPUT,
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

  /* Overdue — a schedule declaring three days, and a run five days ago. Explorer. */
  importManifest(renamed("dash-managed.manifest.v2.example.json", OVERDUE, "News Scout"));
  const startedAt = daysAgo(5);
  ingestEvents([
    {
      event_version: 1,
      agent: OVERDUE,
      run_id: "run-scout-1",
      seq: 0,
      ts: startedAt,
      type: "run_started",
    },
    {
      event_version: 1,
      agent: OVERDUE,
      run_id: "run-scout-1",
      seq: 1,
      ts: startedAt,
      type: "run_completed",
      status: "ok",
    },
  ]);

  /* Nothing needs you — imported, looked at, asked nothing of. Wizard. */
  importManifest(renamed("agent.manifest.example.json", ALL_CLEAR, "Uptime Sorter"));
  recordAgentLook(ALL_CLEAR, new Date().toISOString());

  console.log(
    "[actions] seeded 5 agents: knight, medic, ninja, explorer, wizard — three with sheets, alternating",
  );
}

/* ---------------------------------------------------------------------- *
 * The harness — the same guards `electron/capture-glance.ts` earned
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
const proofs: Record<string, unknown> = {};

async function shoot(target: BrowserWindow, name: string): Promise<void> {
  const image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[actions] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * A maximized window ignores `setContentSize` and reports the screen's width
 * back, which is indistinguishable from a successful resize — three images
 * labelled with a viewport they were not taken at.
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
  // Every DASH page reads its content across the IPC boundary after first
  // paint, so a screenshot taken on `did-finish-load` is a picture of the boot
  // sequence — a real state, and not the one under review.
  await settle(1800);
}

/**
 * Press the density control, the way a person does.
 *
 * Not `setAttribute("data-density", …)`. A harness that wrote the attribute
 * would produce identical output whether or not the control worked.
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
 * Four claims, and none of them is legible from a PNG. That the page does not
 * overflow sideways — an overflowing screenshot looks exactly like one that
 * fits. That exactly three of five characters animate and the other two are the
 * same `<img>` they were before this issue. That the order on screen is the
 * name order rather than the sheets-first order. And that MAR-586's chips are
 * all still there and still links, because "the costume did not take the
 * meaning's place" is the promise this whole feature rests on.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         /*
          * Named, not just counted. "Something on this page is 150px wider than
          * its box" is a number a reviewer can do nothing with; the element and
          * its own overflow-x is the difference between a defect and a clip
          * that was asked for. A visible overflow-x is the one that actually
          * scrolls a person sideways.
          */
         const gaps = [...document.querySelectorAll("*")]
           .map((node) => ({
             at: node.tagName.toLowerCase() + (node.className && typeof node.className === "string" ? "." + node.className.trim().split(/\\s+/).join(".") : ""),
             gap: node.scrollWidth - node.clientWidth,
             overflow_x: getComputedStyle(node).overflowX,
           }))
           .filter((entry) => entry.gap > 0)
           .sort((a, b) => b.gap - a.gap);
         const widest = gaps.length === 0 ? 0 : gaps[0].gap;
         const scrolls = gaps.filter((entry) => entry.overflow_x !== "hidden" && entry.overflow_x !== "clip");

         const cards = [...document.querySelectorAll(".fleet-card")];
         const order = cards.map((card) => (card.querySelector(".card-head code") || {}).textContent || "");
         const portraits = [...document.querySelectorAll(".fleet-portrait > .o-avatar")];
         const animated = portraits.filter((node) => node.classList.contains("is-action"));
         const stills = portraits.filter((node) => node.tagName === "IMG" && !node.classList.contains("is-action"));

         const sprite = animated[0];
         const style = sprite ? getComputedStyle(sprite) : null;

         const chips = [...document.querySelectorAll(".glance .chip")];
         const links = chips.filter((node) => node.tagName === "A" && node.getAttribute("href"));
         const clear = chips.filter(
           (node) => node.textContent.trim().toLowerCase() === "nothing needs you",
         );

         /* The costume sits above the meaning, on every card, at every width. */
         const misplaced = cards.filter((card) => {
           const tile = card.querySelector(".fleet-portrait");
           const glance = card.querySelector(".glance");
           if (tile === null || glance === null) return false;
           return tile.getBoundingClientRect().bottom > glance.getBoundingClientRect().top + 1;
         });

         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           widest_overflow: widest,
           widest_overflow_at: gaps.slice(0, 3),
           /* The ones that put a scrollbar under somebody's fleet. */
           sideways_scrollers: scrolls.slice(0, 3),
           cards: cards.length,
           order: order,
           animated: animated.length,
           stills: stills.length,
           sprite_width: sprite ? Math.round(sprite.getBoundingClientRect().width) : 0,
           sprite_background_size: style ? style.backgroundSize : null,
           sprite_image_rendering: style ? style.imageRendering : null,
           sprite_animation_name: style ? style.animationName : null,
           sprite_animation_duration: style ? style.animationDuration : null,
           sprite_play_state: style ? style.animationPlayState : null,
           chips: chips.length,
           chip_links: links.length,
           /* Every chip is a link or the all-clear chip. Anything else cannot be pressed. */
           inert_chips: chips.length - links.length - clear.length,
           portrait_below_chips: misplaced.length,
         };
       })()`,
    ),
  );
}

/**
 * The loop, in numbers, because a photograph cannot show it.
 *
 * `background-position` is read from the *computed* style, which for a running
 * CSS animation is the animated value — so these samples are the sprite's real
 * position at eight moments about a quarter-second apart. Distinct values are a
 * loop that is running; one value repeated is a loop that is not.
 */
async function sampleLoop(target: BrowserWindow): Promise<unknown> {
  return within(
    "sample the loop",
    20_000,
    target.webContents.executeJavaScript(
      `(async () => {
         const sprite = document.querySelector(".fleet-portrait > .o-avatar.is-action");
         if (sprite === null) return { sampled: 0 };
         const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
         const seen = [];
         for (let i = 0; i < 10; i += 1) {
           seen.push(getComputedStyle(sprite).backgroundPosition);
           await wait(230);
         }
         return { sampled: seen.length, positions: seen, distinct: [...new Set(seen)].length };
       })()`,
    ),
  );
}

/**
 * Park every loop on one frame, through the sprite's own animation.
 *
 * `getAnimations()` returns the CSS animation the stylesheet started; pausing it
 * and setting `currentTime` moves it to a frame rather than replacing it with
 * something the harness made up. That distinction is the whole value of the two
 * images this produces: they are the same animation at two of its own moments.
 */
async function parkOnFrame(target: BrowserWindow, frame: number): Promise<number> {
  const parked = (await target.webContents.executeJavaScript(
    `(() => {
       const step = 1800 / 8;
       const found = document.getAnimations().filter((a) => a.animationName === "o-action");
       for (const animation of found) {
         animation.pause();
         /* The middle of the step, so a rounding error cannot land on a boundary. */
         animation.currentTime = ${String(frame)} * step + step / 2;
       }
       return found.length;
     })()`,
  )) as number;
  await settle(400);
  return parked;
}

async function releaseFrames(target: BrowserWindow): Promise<void> {
  await target.webContents.executeJavaScript(
    `(() => {
       for (const animation of document.getAnimations()) {
         if (animation.animationName === "o-action") animation.play();
       }
       return true;
     })()`,
  );
  await settle(200);
}

/**
 * The pause clause, proven rather than asserted.
 *
 * Hiding the window is the real signal — `document.visibilityState` goes to
 * `hidden`, `WindowVisibility` writes the attribute, and the stylesheet stops
 * the loops. `executeJavaScript` still answers on a hidden window, which is
 * what makes this measurable at all; only `capturePage` needs a compositor.
 */
async function proveHiddenPause(target: BrowserWindow): Promise<unknown> {
  const read = `(() => {
       const sprite = document.querySelector(".fleet-portrait > .o-avatar.is-action");
       return {
         visibility: document.visibilityState,
         attribute: document.documentElement.getAttribute("data-window"),
         play_state: sprite === null ? null : getComputedStyle(sprite).animationPlayState,
       };
     })()`;

  const before = (await target.webContents.executeJavaScript(read)) as object;
  target.hide();
  await settle(1200);
  const hidden = (await within("read while hidden", 8000, target.webContents.executeJavaScript(read))) as object;
  target.show();
  await settle(1200);
  const after = (await target.webContents.executeJavaScript(read)) as object;
  return { before, hidden, after };
}

/**
 * `prefers-reduced-motion: reduce`, as close to the operating system's own
 * signal as a harness can get.
 *
 * The DevTools protocol's media emulation is what Chromium's own rendering path
 * reads, so `app/tokens.css` resolves `--motion-idle` to `0ms` exactly as it
 * would for somebody who asked Windows for less motion — and the sprite falls
 * back to its base `background-position`, which is frame 0: the character
 * standing with its prop. Nothing in `app/globals.css` mentions reduced motion;
 * the token layer is the whole mechanism, and this is what tests that claim.
 */
async function emulateReducedMotion(target: BrowserWindow, on: boolean): Promise<void> {
  const { debugger: cdp } = target.webContents;
  if (!cdp.isAttached()) {
    cdp.attach("1.3");
  }
  await cdp.sendCommand("Emulation.setEmulatedMedia", {
    features: on ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [],
  });
  await settle(500);
}

async function readReducedMotion(target: BrowserWindow): Promise<unknown> {
  return target.webContents.executeJavaScript(
    `(() => {
       const sprite = document.querySelector(".fleet-portrait > .o-avatar.is-action");
       const style = sprite === null ? null : getComputedStyle(sprite);
       return {
         matches: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
         token: getComputedStyle(document.documentElement).getPropertyValue("--motion-idle").trim(),
         animation_duration: style === null ? null : style.animationDuration,
         background_position: style === null ? null : style.backgroundPosition,
         sprite_visible: sprite === null ? false : sprite.getBoundingClientRect().width > 0,
       };
     })()`,
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
          console.log(`[actions] no density control at ${viewport.name} — compact frame skipped`);
          continue;
        }
        const focused = await scrollTo(window, ".fleet-card");
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
          `[actions] fleet ${viewport.name}/${theme}/${density} ` +
            `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
        );
        await shoot(window, `fleet-${viewport.name}-${theme}-${density}`);

        if (density === "compact") {
          await pressDensityToggle(window);
        }
      }
    }

    /*
     * One tall frame per theme with all five cards in it.
     *
     * `capturePage()` photographs the viewport, and this feature's claim is
     * about what a person sees *across* a fleet — three animated characters and
     * two still ones, interleaved. A reviewer should not have to assemble that
     * from four images and trust they came from one page. The width is still
     * 1280; only the height is unreal, and the filename says so.
     */
    await go(window, "/");
    await resizeTo(window, 1280, 2600);
    await go(window, "/");
    await shoot(window, `fleet-all-cards-1280x2600-${theme}-comfortable`);

    /*
     * The same page twice, with the loops parked on two of their own frames.
     * This is the closest a still image gets to showing motion, and the reason
     * it is honest is that the frames are the sprite's, set through its own
     * animation rather than drawn by the harness.
     */
    for (const frame of [0, 4] as const) {
      const parked = await parkOnFrame(window, frame);
      proofs[`parked_frame_${String(frame)}_${theme}`] = parked;
      await shoot(window, `fleet-loop-frame${String(frame)}-1280x2600-${theme}-comfortable`);
    }
    await releaseFrames(window);

    /*
     * And still, for somebody who asked Windows for less motion. Same page,
     * same store, one media feature different.
     */
    await emulateReducedMotion(window, true);
    await go(window, "/");
    const reduced = await readReducedMotion(window);
    proofs[`reduced_motion_${theme}`] = reduced;
    console.log(`[actions] reduced motion ${theme}: ${JSON.stringify(reduced)}`);
    await shoot(window, `fleet-reduced-motion-1280x2600-${theme}-comfortable`);
    await emulateReducedMotion(window, false);
  }

  /*
   * The two things a picture cannot hold at all: that the loop advances on its
   * own, and that it stops when nobody can see it.
   */
  nativeTheme.themeSource = "dark";
  await go(window, "/");
  await resizeTo(window, 1280, 900);
  await go(window, "/");
  proofs["loop_samples"] = await sampleLoop(window);
  console.log(`[actions] loop samples: ${JSON.stringify(proofs["loop_samples"])}`);
  proofs["hidden_pause"] = await proveHiddenPause(window);
  console.log(`[actions] hidden pause: ${JSON.stringify(proofs["hidden_pause"])}`);

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), expected_order: EXPECTED_ORDER, measurements, proofs }, null, 2)}\n`,
    "utf8",
  );

  /*
   * The claims these images are supposed to support, checked rather than left
   * to a reviewer's eye. Each of these has a picture that looks correct while
   * being wrong.
   */
  const overflowed = measurements.filter((entry) => (entry as { page_overflows: boolean }).page_overflows);
  const miscast = measurements.filter(
    (entry) => (entry as { animated: number }).animated !== EXPECTED_ANIMATED,
  );
  const reordered = measurements.filter(
    (entry) => JSON.stringify((entry as { order: string[] }).order) !== JSON.stringify(EXPECTED_ORDER),
  );
  const chipless = measurements.filter((entry) => ((entry as { chips: number }).chips ?? 0) === 0);
  const inert = measurements.filter((entry) => ((entry as Record<string, number>)["inert_chips"] ?? 0) > 0);
  const covered = measurements.filter(
    (entry) => ((entry as Record<string, number>)["portrait_below_chips"] ?? 0) > 0,
  );

  console.log(
    `[actions] wrote ${String(written.length)} image(s) to ${OUT}; ` +
      `${String(overflowed.length)} frame(s) overflowed sideways; ` +
      `${String(miscast.length)} frame(s) with the wrong number of animated characters; ` +
      `${String(reordered.length)} frame(s) where the fleet was reordered; ` +
      `${String(chipless.length)} frame(s) with no glance chips; ` +
      `${String(inert.length)} frame(s) where a chip was not a link; ` +
      `${String(covered.length)} frame(s) where the costume displaced the chips`,
  );
  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error("[actions] failed", error);
  app.exit(1);
});
