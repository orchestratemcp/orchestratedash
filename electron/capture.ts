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

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const image = await target.webContents.capturePage();
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, image.toPNG());
  const size = image.getSize();
  const css = (await target.webContents.executeJavaScript(
    `({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })`,
  )) as { w: number; h: number; dpr: number };
  written.push(name);
  console.log(
    `[capture] ${name}.png ${String(size.width)}x${String(size.height)} ` +
      `(css ${String(css.w)}x${String(css.h)} @${String(css.dpr)}x)`,
  );
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
 * strip that scrolls on purpose, or how far. MAR-491 measured the tables and
 * recorded that the chrome itself was fine, so the chrome's own numbers belong
 * beside the images rather than in a sentence somebody has to trust.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return await target.webContents.executeJavaScript(
    `(() => {
       const root = document.documentElement;
       const toggle = document.querySelector("button.density-toggle");
       const rect = toggle === null ? null : toggle.getBoundingClientRect();
       let scroller = null;
       for (let el = toggle === null ? null : toggle.parentElement; el !== null; el = el.parentElement) {
         if (el.scrollWidth > el.clientWidth + 1) { scroller = el; break; }
       }
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
           element: scroller.tagName.toLowerCase() + "." + String(scroller.className || "").trim().split(/\\s+/).join("."),
           client_width: scroller.clientWidth,
           scroll_width: scroller.scrollWidth,
         },
       };
     })()`,
  );
}

async function densityNow(target: BrowserWindow): Promise<string> {
  return (await target.webContents.executeJavaScript(
    `document.documentElement.getAttribute("data-density") ?? "comfortable"`,
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

  for (const theme of THEMES) {
    // The OS's own signal, not a stylesheet override. `followTheme` in main.ts
    // repaints the title-bar overlay from this too, so the chrome in the image
    // is the chrome a user with this OS setting would get.
    nativeTheme.themeSource = theme;
    await settle(250);

    for (const viewport of VIEWPORTS) {
      window.setContentSize(viewport.width, viewport.height);
      await settle(400);

      const before = await densityNow(window);
      const measured = await layout(window);
      measurements.push({ viewport: viewport.name, theme, ...(measured as object) });
      console.log(`[capture]   layout ${JSON.stringify(measured)}`);
      await shoot(window, `${viewport.name}-${theme}-${before}`);

      const pressed = await pressDensityToggle(window);
      if (pressed === null) {
        console.log(`[capture] no density control at ${viewport.name}/${theme}`);
        continue;
      }
      await settle(400);
      await shoot(window, `${viewport.name}-${theme}-${pressed.density ?? "unknown"}`);
      console.log(`[capture]   toggle now reads "${pressed.label}"`);

      // Back to the default, so each viewport starts where the last one did.
      await pressDensityToggle(window);
      await settle(200);
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
