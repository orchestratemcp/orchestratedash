/**
 * Screenshots of the real shell (MAR-440, MAR-436, MAR-420). **Not part of the
 * shipped shell.**
 *
 * PRs #41 and #42 both said, in as many words, that nobody had seen this design
 * pass rendered by an Electron window — the previous session could measure the
 * DOM at three widths and could not photograph any of it. This is that gap
 * closed, and it is a script rather than a session of hand-taken screenshots for
 * the same reason `electron/smoke.ts` is: a picture somebody took once is not
 * evidence the next person can refresh.
 *
 * ## It boots the real thing
 *
 * Same first two imports as the smoke harness and in the same order, so the app
 * name, the user-data directory and the store all resolve exactly as they do
 * under `electron .`. `main.ts` then starts the app normally and this file only
 * watches — it creates no window, loads no URL and overrides no startup step.
 * A screenshot of a reconstruction would be a picture of a different program.
 *
 * ## What it does not fake
 *
 * The theme is moved with `nativeTheme.themeSource`, which is the same signal
 * the operating system sends, rather than by writing `[data-theme]` — so what is
 * photographed is the path a user's OS preference actually takes through
 * `resolveTheme` and `app/tokens.css`.
 *
 * Density is changed by **clicking the real control**, not by setting
 * `[data-density]`. That makes each pair of images a small proof as well as a
 * picture: the toggle was found, it was pressed, and the attribute moved. A
 * harness that set the attribute itself would produce identical-looking output
 * whether or not the button worked at all.
 *
 * Run it with `pnpm build:shell` first, then
 * `electron dist/electron/capture.mjs`. It is never on the `electron .` path and
 * no `package.json` script names it, for ADR 0004's reason: this is evidence,
 * not a gate, and it must not be able to fail a release.
 */

import "./smoke-identity.js";
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(
  process.cwd(),
  process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-wave1",
);

/**
 * The three widths both PRs are argued at.
 *
 * Heights are the ordinary companions of each width rather than anything
 * meaningful — what is under review is what the layout does as it narrows.
 */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 860 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

/**
 * The surfaces photographed, and why it is more than one now.
 *
 * The first wave shot the fleet page alone, because MAR-440 and MAR-420 were
 * about the chrome and the chrome is on every page. MAR-491 is about what a
 * *record list* does in a narrow window, and MAR-491's own report names three
 * of them — the fleet, Runs and Connections — so a wave that photographed one
 * of the three is a wave that argues about a third of the issue. MAR-501, -502
 * and -503 add the same requirement from the other side: the workspace portrait
 * and the bottom strip are not on the fleet page alone either.
 *
 * `density` marks the two pages worth photographing at both densities. Every
 * surface is measured at both, and `layout.json` carries all of it — what the
 * flag decides is only whether a second *image* is written, because the
 * interesting compact/comfortable difference is a list of cards and both of
 * these are one.
 *
 * The workspace's agent is resolved at runtime from the fleet page's own
 * markup: this harness photographs whatever store the machine has, and a
 * hardcoded agent name would produce a "that agent is not here" page on any
 * machine but the one it was written on.
 */
const SURFACES = [
  { name: "agents", path: "/", density: true, tall: false },
  { name: "runs", path: "/runs", density: false, tall: false },
  { name: "connections", path: "/connections", density: false, tall: true },
  { name: "work", path: "/work", density: false, tall: false },
  /* MAR-498. `tall` because the wizard's last step carries the deploy receipt
     under the probe's own answer, and a viewport frame shows the probe. */
  { name: "hosts", path: "/hosts", density: false, tall: true },
  { name: "workspace", path: null, density: true, tall: true },
] as const;

/**
 * The height a `tall` surface gets one extra photograph at (MAR-533).
 *
 * Every image above is a *viewport*, which is the right unit for the question
 * those PRs asked — what does the layout do as it narrows. It is the wrong unit
 * for reviewing a card that is taller than a window: MAR-533's capability card
 * answers four questions and a 860px frame shows one and a half of them, so the
 * first review of it was of its header.
 *
 * So one extra frame per theme, at the widest viewport only, in a window tall
 * enough to hold the whole thing. It is evidence rather than a measurement —
 * nothing is asserted against this height, and `layout.json` still records only
 * the three real viewports, because a 2200px-tall window is not a window anybody
 * has.
 */
const TALL_HEIGHT = 2200;

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every await in this harness, bounded and named.
 *
 * A capture run that hangs prints nothing and looks exactly like a slow one,
 * which is how an earlier attempt spent ten minutes producing a splash and no
 * explanation. The two calls that can genuinely never return are
 * `capturePage()` — which needs the window to be compositing, and a window on a
 * locked or headless desktop is not — and `executeJavaScript()` against a page
 * that navigated underneath it. Both now fail with the step's own name in the
 * message, which is the difference between "the harness is broken" and "this
 * machine cannot photograph a window right now".
 */
function within<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} did not finish within ${String(ms)}ms`)), ms),
    ),
  ]);
}

/** Resolve once a window has loaded, whether or not it already had. */
async function painted(target: BrowserWindow): Promise<void> {
  if (!target.webContents.isLoading()) {
    return;
  }
  await new Promise<void>((resolve) => {
    target.webContents.once("did-finish-load", () => resolve());
    target.webContents.once("did-fail-load", () => resolve());
  });
}

/** The app window, once it has painted. The splash is not it; see `app-window.ts`. */
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

/**
 * Both sizes, because they differ and only one of them is the design.
 *
 * The image comes out at the display's device pixel ratio — 2x here — so a
 * 1280-wide layout is a 2560-wide PNG. Printing the CSS viewport beside it stops
 * a reader concluding the window was twice the width it was reviewed at.
 */
async function shoot(target: BrowserWindow, name: string): Promise<void> {
  /*
   * One retry, because the compositor occasionally answers `UnknownVizError`
   * and then answers properly a moment later. A run that lost its last eight
   * images to one transient frame is a run somebody has to take again from the
   * beginning, and the second attempt costs a second.
   */
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error) {
    console.log(
      `[capture]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    await settle(1000);
    /*
     * The retry has to check the window is still there, and this is not
     * defensive — it is the failure that actually happened.
     *
     * The splash's whole lifetime ends on the app window's `ready-to-show`. A
     * `UnknownVizError` on the first attempt costs a second of settling, and on
     * a warm start that second is longer than the splash has left: the retry
     * then throws `Object has been destroyed`, which nothing caught, and a run
     * that had 47 images left to take ended on the first one.
     *
     * `shoot` returning without writing is right rather than a workaround. The
     * caller for a destroyed splash already has a branch saying the start was
     * warm; every other caller holds the app window, which is alive for the
     * whole run by construction.
     */
    if (target.isDestroyed() || target.webContents.isDestroyed()) {
      console.log(`[capture]   ${name} vanished before it could be photographed — skipping it`);
      return;
    }
    try {
      image = await within(
        `capturePage retry for ${name}`,
        20_000,
        target.webContents.capturePage(),
      );
    } catch (retryError) {
      /*
       * The check above is not enough on its own, and the reason is a race
       * rather than an oversight: the splash is closed by the app window's
       * `ready-to-show` handler, which can run between `isDestroyed()`
       * answering false and `capturePage()` reaching the compositor. The
       * observed failure was `Object has been destroyed` thrown out of the
       * retry, unhandled, ending a run that had 47 images left to take.
       *
       * A frame nobody could take is not a failed run. Every caller but one
       * holds the app window, which is alive for the whole run by
       * construction; the one that does not holds the splash, whose whole
       * lifetime is the startup this is trying to photograph.
       */
      console.log(
        `[capture]   gave up on ${name}: ` +
          `${retryError instanceof Error ? retryError.message : String(retryError)}`,
      );
      return;
    }
  }
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, image.toPNG());
  const size = image.getSize();
  written.push(name);

  /*
   * The image is already on disk, so nothing below may throw.
   *
   * The CSS size is printed because the image comes out at the display's device
   * pixel ratio and a 1280-wide layout is a 2560-wide PNG — without it a reader
   * concludes the window was twice the width it was reviewed at. It is a
   * caption, not the evidence, and the splash is the one target that can close
   * between its own photograph and its own measurement. That really happened,
   * and it ended a run holding a written PNG it then threw away the rest of.
   */
  let caption = "";
  try {
    if (!target.isDestroyed() && !target.webContents.isDestroyed()) {
      const css = (await within(
        `measure ${name}`,
        10_000,
        target.webContents.executeJavaScript(
          `({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })`,
        ),
      )) as { w: number; h: number; dpr: number };
      caption = ` (css ${String(css.w)}x${String(css.h)} @${String(css.dpr)}x)`;
    }
  } catch {
    caption = " (the window closed before it could be measured)";
  }

  console.log(`[capture] ${name}.png ${String(size.width)}x${String(size.height)}${caption}`);
}

/**
 * Press the density control and report what it did. Null when it is not there.
 *
 * The label is read on a later turn than the click, deliberately. `data-density`
 * is written synchronously by the handler, but the button's own text comes from
 * React state and is a render behind — reading both at once reported the
 * *previous* label beside the new density, which made an honest log look like a
 * control whose copy never changes.
 */
async function pressDensityToggle(
  target: BrowserWindow,
): Promise<{ density: string | null; label: string } | null> {
  const pressed = (await target.webContents.executeJavaScript(
    `(() => {
       const button = document.querySelector("button.density-toggle");
       if (button === null) return { found: false, density: null };
       button.click();
       return { found: true, density: document.documentElement.getAttribute("data-density") };
     })()`,
  )) as { found: boolean; density: string | null };
  if (!pressed.found) {
    return null;
  }
  const density = pressed.density;
  await settle(250);
  const label = (await target.webContents.executeJavaScript(
    `((button) => button === null ? "" : (button.textContent ?? "").trim())(document.querySelector("button.density-toggle"))`,
  )) as string;
  return { density, label };
}

/**
 * The few numbers a screenshot cannot be argued with about.
 *
 * A picture shows the density control is missing at 375px; it does not show
 * whether the page overflowed, whether the control is merely scrolled out of a
 * strip that scrolls on purpose, or how far.
 *
 * `widest_scroller` is MAR-491's own measurement, generalised. That issue was
 * filed with three numbers — a 341px container holding 1425px of table — and
 * they were taken by hand at one width on one page. Reporting the widest
 * horizontally-scrolling element on *every* surface at *every* width is the
 * form of that measurement a later session can re-take, and it is the one that
 * would notice a new list arriving as a scroller. `null` is the answer a page
 * with nothing to scroll gives, which is the answer MAR-491 wants.
 *
 * The element is described by tag and class rather than by a selector path,
 * because the useful question is "what kind of thing is it?" — a `.table-wrap`,
 * a `nav.app-nav` that scrolls on purpose, a `.fleet-strip-row` that clips.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return await within(
    "layout",
    10_000,
    target.webContents.executeJavaScript(
    `(() => {
       const root = document.documentElement;
       const describe = (el) => el.tagName.toLowerCase() + (String(el.className || "").trim() === "" ? "" : "." + String(el.className).trim().split(/\\s+/).join("."));
       const toggle = document.querySelector("button.density-toggle");
       const rect = toggle === null ? null : toggle.getBoundingClientRect();
       let scroller = null;
       for (let el = toggle === null ? null : toggle.parentElement; el !== null; el = el.parentElement) {
         if (el.scrollWidth > el.clientWidth + 1) { scroller = el; break; }
       }
       let widest = null;
       for (const el of document.querySelectorAll("main *, main")) {
         const over = el.scrollWidth - el.clientWidth;
         if (over > 1 && (widest === null || over > widest.overflow_by)) {
           widest = {
             element: describe(el),
             client_width: el.clientWidth,
             scroll_width: el.scrollWidth,
             overflow_by: over,
           };
         }
       }
       const strip = document.querySelector(".fleet-strip");
       return {
         viewport: root.clientWidth,
         page_scroll_width: root.scrollWidth,
         page_overflows: root.scrollWidth > root.clientWidth,
         density_toggle: rect === null ? null : {
           left: Math.round(rect.left),
           right: Math.round(rect.right),
           fully_visible: rect.left >= 0 && rect.right <= root.clientWidth,
         },
         density_toggle_scroller: scroller === null ? null : {
           element: describe(scroller),
           client_width: scroller.clientWidth,
           scroll_width: scroller.scrollWidth,
         },
         widest_scroller: widest,
         avatars: [...document.querySelectorAll("main .o-avatar")].map((img) => ({
           src: img.getAttribute("src"),
           rendered: img.clientWidth + "x" + img.clientHeight,
           decorative: img.getAttribute("alt") === "" && img.getAttribute("aria-hidden") === "true",
         })),
         fleet_strip: strip === null ? null : {
           height: Math.round(strip.getBoundingClientRect().height),
           standing: strip.querySelectorAll(".o-avatar").length,
           overflow: (strip.querySelector(".fleet-strip-more") || {}).textContent ?? null,
           overlaps_main: (() => {
             const main = document.querySelector("main");
             if (main === null) return false;
             const a = main.getBoundingClientRect(), b = strip.getBoundingClientRect();
             return b.top < a.bottom - 1;
           })(),
         },
       };
     })()`,
    ),
  );
}

/**
 * Move the window to a route, the way a link would.
 *
 * `loadURL` against the current origin rather than a path: the packaged
 * renderer is served from its own scheme and the developer path is loopback, so
 * resolving against whatever is already loaded is the one form of this that
 * works in both hosts. Same rule `lib/views/` obeys — the difference between
 * the two hosts should be where data comes from and nowhere else.
 */
async function go(target: BrowserWindow, route: string): Promise<void> {
  const current = target.webContents.getURL();
  const next = new URL(route, current).toString();
  console.log(`[capture] → ${next}`);
  /*
   * `loadURL` and nothing else. Its promise already settles on the page's own
   * `did-finish-load`, and following it with `painted()` deadlocks against the
   * developer path: Next's dev client keeps a connection open, `isLoading()`
   * stays true after the document is complete, and the harness waits for an
   * event that has already been and gone. Twenty seconds of nothing, which is
   * exactly the failure the timeouts above exist to name.
   */
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  /*
   * Long enough for the view to arrive, not for anything else. Every page here
   * reads its content across the IPC boundary after the first paint, so a
   * screenshot taken on `did-finish-load` is a picture of `ViewLoading` — which
   * is a real state and not the one under review.
   */
  await settle(1200);
}

/**
 * The first agent's name, read off the fleet page rather than out of the store.
 *
 * This harness photographs whatever store the machine it runs on has. A
 * hardcoded name would produce "that agent is not here" everywhere but here,
 * and a picture of an empty state labelled `workspace` is worse than no picture
 * because it looks like a finding.
 */
async function firstAgentName(target: BrowserWindow): Promise<string | null> {
  /*
   * `.row-card h3 code` and not the identity row the avatars added. The first
   * version of this read `.row-card .agent-identity code`, which is MAR-501's
   * markup, and on a branch without it the harness reported "no agents in this
   * store" and skipped the whole workspace surface — twelve missing images and
   * a sentence blaming the store for a selector. A harness that photographs
   * whatever this repository currently renders must key on the oldest thing on
   * the card that names the agent, which is its heading.
   */
  return (await target.webContents.executeJavaScript(
    `(() => {
       const first = document.querySelector(".row-card h3 code");
       return first === null ? null : first.textContent;
     })()`,
  )) as string | null;
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * `setContentSize` is a request to the window manager, not a guarantee, and a
 * fixed wait after it is a bet. It was lost: one run wrote
 * `connections-375-…png` at 767 CSS pixels and then spent two more surfaces at
 * the wrong width, so three images were labelled with a viewport they were not
 * taken at — which is worse than a missing image, because a mislabelled
 * screenshot is evidence for a claim nobody checked.
 *
 * The tolerance is two pixels: `setContentSize` sets the *content* box and the
 * page reports `innerWidth` after device-pixel rounding, so 1280 has always
 * come back as 1279 on this display.
 */
async function resizeTo(target: BrowserWindow, width: number, height: number): Promise<number> {
  /*
   * A maximized or snapped window ignores `setContentSize` outright, and the
   * previous run's last state is whatever the window manager left behind. This
   * is cheap and it is the difference between a run and a run that stops at the
   * second viewport.
   */
  const deadline = Date.now() + 8000;
  let seen = 0;
  while (Date.now() < deadline) {
    /*
     * All of it, every pass. A maximized or snapped window ignores
     * `setContentSize` outright and reports the screen's width back, which on a
     * 1280-wide display is indistinguishable from a successful resize to 1280 —
     * so the first viewport "worked" and the second could not. `restore()`
     * covers snapped and minimized as well as maximized, and the request is
     * re-issued rather than sent once, because a window manager that dropped
     * the first one will usually take the second.
     */
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
      // Settled, then one more beat for the layout the new width produces.
      await settle(450);
      return seen;
    }
  }
  const [contentWidth, contentHeight] = target.getContentSize();
  throw new Error(
    `window would not resize to ${String(width)}px — the page reports ${String(seen)}px, ` +
      `the window reports ${String(contentWidth)}x${String(contentHeight)}, ` +
      `maximized=${String(target.isMaximized())} fullscreen=${String(target.isFullScreen())} ` +
      `resizable=${String(target.isResizable())}`,
  );
}

async function densityNow(target: BrowserWindow): Promise<string> {
  return (await within(
    "read density",
    10_000,
    target.webContents.executeJavaScript(
      `document.documentElement.getAttribute("data-density") ?? "comfortable"`,
    ),
  )) as string;
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });

  /*
   * The splash first, and immediately — its lifetime ends when the app window
   * is ready to show. Same observation smoke.ts's proof 1c makes, and the same
   * reason it has to happen before anything else is awaited.
   */
  const atReady = BrowserWindow.getAllWindows();
  const splash = atReady[0];
  if (splash === undefined) {
    console.log("[capture] no splash window was open at ready — nothing to photograph");
  } else {
    await painted(splash);
    // Just enough for the first frame, and no more. The splash closes on the app
    // window's `ready-to-show`, so on a warm start — store already migrated, a
    // runner already up to adopt — the whole startup can finish inside a longer
    // wait and there is nothing left to photograph.
    await settle(50);
    if (splash.isDestroyed()) {
      console.log(
        "[capture] the splash closed before it could be photographed — this was a " +
          "warm start. For a cold one, stop the runner from the UI (`runner.stop`, " +
          "see runner/README.md) and run this again.",
      );
    } else {
      await shoot(splash, "splash");
    }
  }

  const window = await appWindowLoaded();
  window.setResizable(true);

  /*
   * Resolved once, from the fleet page, before the loop below needs it. The
   * workspace route carries an agent in its query string (`agentWorkspaceHref`
   * builds the same link the fleet cards do), and this is the only way for a
   * harness to name one on a machine it has never seen.
   */
  /*
   * After a wait, not on `did-finish-load`. The fleet page reads its agents
   * across the IPC boundary *after* it first paints, so asking immediately gets
   * the answer "no agents" from a page that has not looked yet — which would
   * silently skip the workspace surface on a machine that has plenty.
   */
  await settle(1500);
  const agent = await firstAgentName(window);
  if (agent === null) {
    console.log("[capture] no agents in this store — the workspace surface will be skipped");
  }

  for (const theme of THEMES) {
    // The OS's own signal, not a stylesheet override. `followTheme` in main.ts
    // repaints the title-bar overlay from this too, so the chrome in the image
    // is the chrome a user with this OS setting would get.
    nativeTheme.themeSource = theme;
    await settle(250);

    for (const surface of SURFACES) {
      const route =
        surface.path ??
        (agent === null ? null : `/agents/detail?agent=${encodeURIComponent(agent)}`);
      if (route === null) {
        continue;
      }
      await go(window, route);

      for (const viewport of VIEWPORTS) {
        const at = await resizeTo(window, viewport.width, viewport.height);
        console.log(`[capture] ${surface.name} at ${viewport.name}/${theme} (window reports ${String(at)}px)`);

        const before = await densityNow(window);
        const measured = await layout(window);
        measurements.push({ surface: surface.name, viewport: viewport.name, theme, ...(measured as object) });
        console.log(`[capture]   ${surface.name} ${viewport.name}/${theme} ${JSON.stringify(measured)}`);
        await shoot(window, `${surface.name}-${viewport.name}-${theme}-${before}`);

        const pressed = await pressDensityToggle(window);
        if (pressed === null) {
          console.log(`[capture] no density control at ${viewport.name}/${theme}`);
          continue;
        }
        await settle(400);
        /*
         * Measured at both densities on every surface and photographed at both
         * on two of them. The numbers are what would catch a density that had
         * started hiding something; the second image is only worth the bytes
         * where there is a list of cards to see spread out or drawn together.
         */
        const compact = await layout(window);
        measurements.push({
          surface: surface.name,
          viewport: viewport.name,
          theme,
          density: pressed.density,
          ...(compact as object),
        });
        if (surface.density) {
          await shoot(window, `${surface.name}-${viewport.name}-${theme}-${pressed.density ?? "unknown"}`);
        }
        console.log(`[capture]   toggle now reads "${pressed.label}"`);

        // Back to the default, so each viewport starts where the last one did.
        await pressDensityToggle(window);
        await settle(200);
      }

      /*
       * The whole-surface frame, last and only where a card is taller than a
       * window. After the viewport loop rather than inside it, so the three
       * measured widths are untouched and this cannot be mistaken for one of
       * them — the file name says `full` and the height is in the log.
       */
      if (surface.tall) {
        try {
          const wide = VIEWPORTS[0];
          await resizeTo(window, wide.width, TALL_HEIGHT);
          await shoot(window, `${surface.name}-${wide.name}-${theme}-full`);
        } catch (error) {
          // A window manager that refuses a 2200px-tall window is a machine that
          // cannot produce this extra frame, not a failed run. Every measured
          // image is already written.
          console.log(
            `[capture] no full-height frame for ${surface.name}/${theme}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `\n[capture] wrote ${String(written.length)} images and layout.json to ${OUT}`,
  );
}

void run().then(
  () => {
    app.quit();
  },
  (error: unknown) => {
    console.error(`[capture] failed: ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  },
);
