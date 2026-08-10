/**
 * Screenshots of the Connections page as connector tiles (MAR-570). **Not part
 * of the shipped shell.**
 *
 * `electron/capture.ts` photographs whatever store the machine happens to hold,
 * and this page's whole subject is a relationship *between* agents: two of them
 * needing one service. No shipped example produces that — the four v2 examples
 * name four different providers — so a run against any real store photographs
 * the case this issue is not about.
 *
 * So this seeds a store the run chooses, the way `electron/capture-servers.ts`
 * and `electron/capture-deploy.ts` do, and shoots the three tiles that matter
 * together:
 *
 * - **Gmail**, needed by two agents — the shared tile, with the disclosure that
 *   one sign-in serves both;
 * - **Calendar**, needed by one — the same tile shape with nothing shared, which
 *   is what proves the disclosure is conditional rather than decoration;
 * - **a connection DASH does not hold at all** — `not_dash_held`, drawn as an
 *   ordinary state with no button, not as a fault.
 *
 * ## What is real here, and the two things that are not
 *
 * Real: the packaged renderer and its stylesheet, the `dash-app://ui/settings`
 * route, `connectionsView()` over the read channel, `buildConnectorTiles`
 * grouping by provider, `also_connects` computed on the trusted side, the
 * density attribute written by pressing the real control, and the receipt opened
 * by clicking the real disclosure.
 *
 * Not real, and stated rather than left to be inferred:
 *
 * 1. **Whose data it is.** The store is a scratch directory this run seeded.
 * 2. **The connected frames are a seeded record, not a Google grant.** A tile
 *    reads "connected" from DASH's own secret reference, so writing one makes
 *    the chip true without a consent screen. That is enough to photograph
 *    `partly_connected` — the state a boolean would lose — and it is **not**
 *    evidence that a sign-in works, which is proof 7's job and MAR-468's.
 *    Nothing here photographs a real grant and nothing here should be read as
 *    one.
 *
 * ## Run it
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-connectors'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar570'
 *     pnpm exec electron dist/electron/capture-connectors.mjs
 *
 * From **PowerShell**, with a visible, unoccluded window; DASH may stay open.
 * Every line is load-bearing for the reasons `electron/capture-deploy.ts` lists.
 *
 * It leaves a live runner holding the scratch store, exactly as the other three
 * capture harnesses do — see that file's header. Shoot images before you plan to
 * run `pnpm verify:shell`, not after.
 *
 * Never on the `electron .` path and named by no `package.json` script: it
 * produces evidence, never a verdict, and ADR 0004 keeps things that cannot fail
 * a release out of the gate.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { importManifest } from "../lib/store.js";
import { recordSecretReference } from "../lib/secret-refs.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar570");

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

/** The two agents that must land on one Gmail tile, and the one that must not. */
const SHARER_A = "news-scout";
const SHARER_B = "meeting-assistant";
const OUTSIDER = "invoice-reviewer";

function example(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.resolve(process.cwd(), "examples", name), "utf8"),
  ) as Record<string, unknown>;
}

/**
 * Seed the store this run was pointed at.
 *
 * The second Gmail agent is the shipped meeting assistant with its Calendar
 * connection removed and its Gmail connection **renamed** — from `gmail` to
 * `mail`. That rename is the point: the tiles group on `provider`, and a fixture
 * that reused the id would produce the right picture whether or not that rule
 * held.
 */
function seed(): void {
  const gmail = example("gmail-meeting-assistant.manifest.v2.example.json");
  const meeting = JSON.parse(JSON.stringify(gmail)) as {
    agent: { name: string; display_name?: string };
    agent_dom: { connections: Array<Record<string, unknown>> };
  };
  meeting.agent.name = SHARER_B;
  meeting.agent.display_name = "Meeting Assistant";
  importManifest(meeting);

  const scout = JSON.parse(JSON.stringify(gmail)) as {
    agent: { name: string; display_name?: string; goal?: string };
    agent_dom: { connections: Array<Record<string, unknown>> };
  };
  scout.agent.name = SHARER_A;
  scout.agent.display_name = "News Scout";
  scout.agent_dom.connections = scout.agent_dom.connections.filter(
    (one) => one["provider"] === "google-gmail",
  );
  const mail = scout.agent_dom.connections[0];
  if (mail !== undefined) {
    mail["id"] = "mail";
    mail["purpose"] = "Read the morning mail so the digest can quote it";
  }
  importManifest(scout);

  const invoice = example("agent-managed.manifest.v2.example.json") as {
    agent: { name: string; display_name?: string };
  };
  invoice.agent.name = OUTSIDER;
  invoice.agent.display_name = "Invoice Reviewer";
  importManifest(invoice);

  console.log("[connectors] seeded 3 agents: 2 share Gmail, 1 keeps its own sign-in");
}

/**
 * Make one agent's Gmail read as connected, so `partly_connected` can be drawn.
 *
 * A secret **reference**, which is DASH's own record of holding something, and
 * deliberately not a vault write or a receipt: this exists to photograph a chip,
 * and a fixture that also invented a grant would be a picture of a consent
 * nobody gave. The tile's own capability detail still reads "waiting for you",
 * which is the honest state for a record with no receipt behind it.
 */
function seedOneConnected(): void {
  recordSecretReference({
    agent: SHARER_B,
    connection_id: "gmail",
    field_id: "gmail-account",
    secret_name: `dash.connection.${SHARER_B}.gmail.gmail-account`,
    masked_hint: "he••••@example.com",
    backend: "os_keychain",
  });
  console.log("[connectors] seeded one held record, so the Gmail tile reads partly connected");
}

/* ---------------------------------------------------------------------- *
 * The harness — the guards `electron/capture.ts` earned the hard way
 * ---------------------------------------------------------------------- */

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

/**
 * Photograph the window, and try twice.
 *
 * `capturePage()` needs a compositing window, and on a desktop where something
 * else takes focus mid-run it fails outright — which killed a run of this
 * harness after two frames. `electron/capture.ts` learned this and retries; so
 * does this. The second attempt is given a beat to let the compositor come back
 * rather than being fired immediately at the same wall.
 */
async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    console.log(
      `[connectors]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
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
  console.log(`[connectors] ${name}.png ${String(size.width)}x${String(size.height)}`);
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
  await settle(1800);
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

/** Open the first tile's receipt, the way a person does. */
async function openReceipt(target: BrowserWindow): Promise<boolean> {
  const opened = (await target.webContents.executeJavaScript(
    `(() => {
       const summary = document.querySelector(".connector-receipt > summary");
       if (summary === null) return false;
       summary.click();
       return true;
     })()`,
  )) as boolean;
  await settle(700);
  return opened;
}

/**
 * What a picture cannot settle.
 *
 * The overflow half is MAR-491's rule — a screenshot of a page that grew
 * sideways looks identical to one that did not. The rest is this issue's own
 * claims counted rather than eyeballed: how many tiles were drawn, whether the
 * shared disclosure is present, and whether the provider id this page groups on
 * ever reached the screen.
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
         /*
          * The tiles' own overflow, measured separately from the page's.
          *
          * page_overflows was the only check here and it was too weak in
          * exactly the way proof 6j was: at 375px the grid held a 448px column,
          * the tile ran off the right-hand edge behind its own scroll
          * container, and the document root reported no overflow at all while
          * text was visibly clipped in the photograph. A check that cannot see
          * the defect it is named for is worse than no check, because the log
          * says the page is fine.
          *
          * No backticks in this comment: it lives inside a template literal,
          * and the first one closed it.
          */
         const tiles = [...document.querySelectorAll(".connector-tile")];
         const tileOverflow = tiles
           .map((node) => node.scrollWidth - node.clientWidth)
           .reduce((most, gap) => (gap > most ? gap : most), 0);
         const grid = document.querySelector(".connector-grid");
         const gridOverflow = grid === null ? 0 : grid.scrollWidth - grid.clientWidth;
         const text = document.body.innerText;
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           tile_overflow: tileOverflow,
           grid_overflow: gridOverflow,
           tiles_fit: tileOverflow === 0 && gridOverflow === 0,
           tiles: document.querySelectorAll(".connector-tile").length,
           // Keyed on the durable half of the sentence rather than its whole
           // wording: this check went red once because the copy was tightened
           // and the harness was still grepping the old draft, which is a
           // harness disagreeing with the thing it measures.
           says_shared: text.includes("One sign-in connects"),
           says_needed_by: (text.match(/Needed by/g) ?? []).length,
           leaks_provider_id: text.includes("google-gmail"),
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
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const viewport of VIEWPORTS) {
      for (const density of DENSITIES) {
        await go(window, "/settings");
        const at = await resizeTo(window, viewport.width, viewport.height);
        // Reloaded after the resize as well: a page reads its view once, on
        // mount, and a grid laid out at the previous width would be
        // photographed under this width's filename.
        await go(window, "/settings");

        if (density === "compact" && (await pressDensityToggle(window)) === null) {
          console.log(`[connectors] no density control at ${viewport.name} — compact skipped`);
          continue;
        }

        const measured = await layout(window);
        measurements.push({ viewport: viewport.name, theme, density, ...(measured as object) });
        console.log(
          `[connectors] ${viewport.name}/${theme}/${density} (window reports ${String(at)}px) ` +
            JSON.stringify(measured),
        );
        await shoot(window, `connectors-${viewport.name}-${theme}-${density}`);

        if (density === "compact") {
          await pressDensityToggle(window);
        }
      }
    }

    /*
     * The receipt, opened by clicking it. Once per theme at the widest frame:
     * what is behind the disclosure is MAR-533's card, which has its own
     * screenshots, and the claim being evidenced here is only that it is still
     * reachable in one click.
     */
    await go(window, "/settings");
    await resizeTo(window, 1280, 900);
    if (await openReceipt(window)) {
      await shoot(window, `connectors-receipt-1280-${theme}-comfortable`);
    } else {
      console.log("[connectors] no receipt to open — skipping that frame");
    }
  }

  /*
   * One agent connected, so `partly_connected` can be photographed. Last,
   * because it changes the store every frame above was taken against.
   */
  seedOneConnected();
  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    await settle(300);
    await go(window, "/settings");
    await resizeTo(window, 1280, 900);
    await go(window, "/settings");
    const measured = await layout(window);
    measurements.push({ viewport: "1280", theme, density: "comfortable", partly: true, ...(measured as object) });
    console.log(`[connectors] partly ${theme} ${JSON.stringify(measured)}`);
    await shoot(window, `connectors-partly-1280-${theme}-comfortable`);
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  const overflowed = measurements.filter(
    (entry) =>
      (entry as { page_overflows: boolean }).page_overflows ||
      !(entry as { tiles_fit: boolean }).tiles_fit,
  );
  const leaked = measurements.filter(
    (entry) => (entry as { leaks_provider_id: boolean }).leaks_provider_id,
  );
  const unshared = measurements.filter(
    (entry) => !(entry as { says_shared: boolean }).says_shared,
  );
  console.log(
    `\n[connectors] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[connectors] ${overflowed.length === 0 ? "no frame overflowed sideways, page or tile" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[connectors] ${leaked.length === 0 ? "no frame printed the provider id" : `${String(leaked.length)} FRAMES LEAKED THE PROVIDER ID`}\n` +
      `[connectors] ${unshared.length === 0 ? "every frame carries the shared-grant sentence" : `${String(unshared.length)} FRAMES LACKED THE SHARED SENTENCE`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[connectors] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
