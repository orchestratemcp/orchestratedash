/**
 * Screenshots of the three MAR-599 fixes: Servers and Notifications' single
 * headings, and the new Preferences tab. **Not part of the shipped shell.**
 *
 * ## Why this is its own harness rather than a scene on `electron/capture.ts`
 *
 * `capture.ts` already carries a `settings-preferences` scene — future runs of
 * the full surface sweep will photograph it — but `capture.ts` imports
 * `smoke-identity.js` first, which calls `app.setName("orchestratedash")` so
 * its single-instance lock and its default `userData` path match the
 * installed app's. That is exactly right for a normal session and exactly
 * wrong for this one: this branch was cut to run **beside** an attended test
 * on the real store, in its own worktree, and a capture process claiming the
 * real app's identity would either fight that test for the single-instance
 * lock or, if `DASH_DATA_DIR` were forgotten even once, write into its store.
 *
 * So this harness is `capture-connectors.ts`'s shape — no `smoke-identity`
 * import, a scratch store this run seeds itself, `DASH_CAPTURE_DIR` chosen by
 * the caller — applied to the three pages this issue actually touched.
 * Connections is not reshot here: `capture-connectors.ts` already covers it,
 * including the fleet card whose button this issue moved back above the fold.
 * Add agent is untouched and under Henrik's hold, so it is not reshot either.
 *
 * ## Run it
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-settings-polish'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar599'
 *     pnpm exec electron dist/electron/capture-settings-polish.mjs
 *
 * From **PowerShell**, with a visible, unoccluded window. Never on the
 * `electron .` path and named by no `package.json` script, for ADR 0004's
 * reason: this produces evidence, never a verdict.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(
  process.cwd(),
  process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar599",
);

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

/** The three pages this issue touched. */
const PAGES = [
  { name: "servers", path: "/settings/servers" },
  { name: "notifications", path: "/settings/notifications" },
  { name: "preferences", path: "/settings/preferences" },
] as const;

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

const written: string[] = [];
const measurements: object[] = [];

async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    console.log(
      `[settings-polish]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(
      `capturePage retry for ${name}`,
      20_000,
      target.webContents.capturePage(),
    );
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[settings-polish] ${name}.png ${String(size.width)}x${String(size.height)}`);
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

/**
 * The check this issue is actually about: does the heading repeat the tab,
 * and — on Servers and Notifications — is the page's own `<h1>` on screen at
 * all, rather than the document root's horizontal overflow, which is the axis
 * every existing capture harness already measured and the axis this defect
 * was never on.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const h1 = document.querySelector("main h1, h1");
         const tab = document.querySelector(".settings-tab.is-active");
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           heading_text: h1 === null ? null : h1.textContent,
           active_tab_text: tab === null ? null : tab.textContent,
           heading_repeats_tab: h1 !== null && tab !== null && h1.textContent === tab.textContent,
           density_toggle_found: document.querySelector("button.density-toggle") !== null,
         };
       })()`,
    ),
  );
}

/**
 * Force the ambient density to comfortable before the loop starts.
 *
 * `localStorage` lives in Electron's session partition, not in
 * `DASH_DATA_DIR` — so it is shared by every unpackaged capture process that
 * ever ran against this machine's default `Electron` userData directory,
 * regardless of which scratch SQLite store each one pointed at. A prior run
 * left "compact" behind once and the very first "comfortable" frame here was
 * captured compact — a wrong label nobody would have caught from the image
 * alone, because the layout is legitimately the same shape at both settings.
 * This reads the actual attribute and presses the control only if it
 * disagrees with what the loop is about to assume.
 */
async function ensureComfortable(target: BrowserWindow): Promise<void> {
  const current = (await target.webContents.executeJavaScript(
    `document.documentElement.getAttribute("data-density")`,
  )) as string | null;
  if (current === "compact") {
    console.log("[settings-polish] ambient density was compact from a prior run — resetting");
    await pressDensityToggle(target);
  }
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);
  await go(window, PAGES[0].path);
  await ensureComfortable(window);

  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const page of PAGES) {
      for (const viewport of VIEWPORTS) {
        for (const density of DENSITIES) {
          await go(window, page.path);
          await resizeTo(window, viewport.width, viewport.height);
          await go(window, page.path);

          if (density === "compact" && (await pressDensityToggle(window)) === null) {
            console.log(
              `[settings-polish] no density control at ${page.name}/${viewport.name} — compact skipped`,
            );
            continue;
          }

          const measured = await layout(window);
          measurements.push({ page: page.name, viewport: viewport.name, theme, density, ...(measured as object) });
          console.log(
            `[settings-polish] ${page.name}/${viewport.name}/${theme}/${density} ${JSON.stringify(measured)}`,
          );
          await shoot(window, `${page.name}-${viewport.name}-${theme}-${density}`);

          if (density === "compact") {
            await pressDensityToggle(window);
          }
        }
      }
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  const overflowed = measurements.filter((entry) => (entry as { page_overflows: boolean }).page_overflows);
  const repeated = measurements.filter(
    (entry) => (entry as { heading_repeats_tab: boolean }).heading_repeats_tab,
  );
  console.log(
    `\n[settings-polish] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[settings-polish] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[settings-polish] ${repeated.length === 0 ? "no heading repeats its active tab" : `${String(repeated.length)} HEADINGS REPEAT THEIR TAB`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[settings-polish] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
