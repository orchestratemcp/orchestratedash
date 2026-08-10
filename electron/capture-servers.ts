/**
 * Screenshots of the Servers route, in the real shell (MAR-574). **Not part of
 * the shipped shell.**
 *
 * `electron/capture.ts` walks every surface and photographs whatever the machine
 * happens to hold. That is the right harness for surfaces whose content is
 * incidental, and the wrong one for this page, because **the store is the
 * subject**: /settings/servers is a two-state route and which state it draws is decided
 * entirely by whether a host record exists. A run against one machine's store
 * photographs one of the two states and cannot say which one it got.
 *
 * So this points the same real renderer at a store the run chooses, and is run
 * twice — once against a store with servers in it, once against an empty one.
 *
 * ## What is real here, and the one thing that is not
 *
 * Real: the packaged renderer, its compiled stylesheet, the bundled faces, the
 * `dash-app://ui/settings/servers` route itself, the view arriving over the read channel
 * from `hostsView()`, `app/tokens.css` resolved against a `color-scheme` the
 * operating system's own signal moved, the density attribute written by pressing
 * the real control, and the viewport arithmetic at each width.
 *
 * Not real: **whose data it is.** The store is a scratch directory this run was
 * pointed at, so these images are evidence of what the page draws for a given
 * store — which is exactly the claim a two-state page needs — and evidence about
 * nobody's actual machine. Written here rather than left for a reader of the
 * PNGs to work out, because a screenshot with an unstated caveat is how a
 * `merged` claim quietly becomes a `proven` one.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open —
 * see the note on identity below.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\a-store-with-servers'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar574/manage'
 *     pnpm exec electron dist/electron/capture-servers.mjs
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
 */

/*
 * `electron/smoke-identity.ts` is deliberately **not** imported, for
 * `electron/capture-panel.ts`'s reason stated one page over: borrowing the app's
 * name borrows its **single-instance lock**, which would mean this could only
 * run with DASH closed. Launched as a bare file, Electron falls back to the name
 * `Electron` and a user-data directory of its own, so this runs beside a live
 * DASH and cannot touch its records — which matters more here than anywhere,
 * because the store this run points at is one it was handed.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar574");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

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
  console.log(`[servers] ${name}.png ${String(size.width)}x${String(size.height)}`);
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
 * Press the density control, the way a person does.
 *
 * Not `setAttribute("data-density", …)`. A harness that wrote the attribute
 * would produce identical-looking output whether or not the control worked, and
 * the pair of images would stop being a small proof as well as a picture.
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

/**
 * Press a saved server's own check control, the way a person does.
 *
 * Off by default and switched on with `DASH_CAPTURE_CHECK=1`, because pressing
 * it makes DASH **sign in to a real machine** — which is the right thing for a
 * person to do on their own server and the wrong thing for a screenshot harness
 * to do to somebody's, unprompted. Point the run at a store whose address is
 * this computer and the probe fails locally, reaching nothing: a genuine refusal
 * state, produced by the real renderer → preload → main → ssh path rather than
 * by a fixture standing in for it.
 *
 * Returns the standing chip's text, so the log says which state was photographed
 * rather than leaving a reader to work it out from the picture.
 */
async function pressCheck(target: BrowserWindow): Promise<string | null> {
  const found = (await target.webContents.executeJavaScript(
    `(() => {
       const button = [...document.querySelectorAll(".server-card button")]
         .find((node) => node.textContent.trim() === "Check this server");
       if (button === undefined) return null;
       button.click();
       return "pressed";
     })()`,
  )) as string | null;
  if (found === null) {
    return null;
  }
  // The probe opens an ssh child with a ten-second connect timeout, so this
  // waits for the answer rather than photographing the "Checking..." frame —
  // which is a real state, and not the one this run is for.
  await settle(14_000);
  return (await target.webContents.executeJavaScript(
    `document.querySelector(".server-card .chip")?.textContent ?? null`,
  )) as string | null;
}

/**
 * What a picture cannot settle: whether the page had to grow sideways.
 *
 * MAR-491's rule is that a record list reflows rather than scrolling the page,
 * and a screenshot of a page that overflows looks identical to one that does not
 * — the overflow is off the right-hand edge of the frame. So it is measured, and
 * the run says so in its last line.
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
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           server_cards: document.querySelectorAll(".server-card").length,
           wizard_cards: document.querySelectorAll(".wizard-card").length,
           hosting_notes: document.querySelectorAll(".hosting-note").length,
           widest_overflow: widest,
         };
       })()`,
    ),
  );
}

async function go(target: BrowserWindow, route: string): Promise<void> {
  const next = new URL(route, target.webContents.getURL()).toString();
  await within(`load ${route}`, 20_000, target.webContents.loadURL(next));
  // Every DASH page reads its content across the IPC boundary after the first
  // paint, so a screenshot taken on `did-finish-load` is a picture of the boot
  // sequence — a real state, and not the one under review.
  await settle(1600);
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);

  for (const theme of THEMES) {
    // The operating system's own signal, not a stylesheet override.
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const viewport of VIEWPORTS) {
      await go(window, "/settings/servers");
      const at = await resizeTo(window, viewport.width, viewport.height);
      // Reloaded after the resize as well: the page reads its view once, on
      // mount, and a card list laid out at the previous width would be
      // photographed under this width's filename.
      await go(window, "/settings/servers");
      console.log(`[servers] /settings/servers at ${viewport.name}/${theme} (window reports ${String(at)}px)`);

      for (const density of ["comfortable", "compact"] as const) {
        if (density === "compact" && (await pressDensityToggle(window)) === null) {
          console.log(`[servers] no density control at ${viewport.name} — compact frame skipped`);
          continue;
        }
        const measured = await layout(window);
        measurements.push({ viewport: viewport.name, theme, density, ...(measured as object) });
        console.log(`[servers]   ${density} ${JSON.stringify(measured)}`);
        await shoot(window, `servers-${viewport.name}-${theme}-${density}`);
      }

      // Back to comfortable, so the next frame starts where this one did.
      await pressDensityToggle(window);

      /*
       * The state a person is actually looking for — did it work? — reached by
       * pressing the control rather than by drawing what it would say. Once per
       * theme at the widest frame: the answer is one card's worth of copy and
       * the narrow widths have already shown how a card reflows.
       */
      if (process.env.DASH_CAPTURE_CHECK === "1" && viewport.name === "1280") {
        const chip = await pressCheck(window);
        if (chip === null) {
          console.log("[servers] no saved server to check — skipping the checked frame");
        } else {
          console.log(`[servers] checked: the card now reads "${chip}"`);
          await shoot(window, `servers-checked-1280-${theme}-comfortable`);
        }
      }
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  console.log(
    `\n[servers] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[servers] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[servers] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
