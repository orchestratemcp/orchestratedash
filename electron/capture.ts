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
 * Run it with **`pnpm build:renderer` and then `pnpm build:shell`**, then
 * `DASH_SHELL_URL=dash-app://ui/ electron dist/electron/capture.mjs`. It is
 * never on the `electron .` path and no `package.json` script names it, for ADR
 * 0004's reason: this is evidence, not a gate, and it must not be able to fail a
 * release.
 *
 * **`DASH_SHELL_URL` is not optional and this line used to omit it.** Unpackaged,
 * `main.ts` loads `http://127.0.0.1:3000` — so without it the run needs a dev
 * server up, and a session that has just closed DASH to free the single-instance
 * lock does not have one: every load fails `ERR_CONNECTION_REFUSED` and the
 * harness reports "no agents in this store", blaming the store for a missing
 * server. `dash-app://ui/` is the packaged renderer's own scheme and is what
 * `scripts/verify-shell.mjs` passes for ADR 0004's reason — the evidence should
 * depend on this repository and this machine, not on what a developer happens to
 * have running.
 *
 * ## It answers questions as well as taking pictures (MAR-501, MAR-502, MAR-503)
 *
 * The three BRAND issues state `proven` bars that no wall of screenshots meets:
 * reduced motion honoured, a missing sprite costing no layout and no
 * information, a visible focus ring on every character, activation landing on
 * the right workspace, the off switch surviving, and the bound holding. Each is
 * a question with an answer, so each is asked after the image loop and the
 * answers are written to `cast-witness.json`. A witness that fails does not fail
 * the run — ADR 0004: evidence, never a verdict — but it is named in the last
 * line so a run with a red one in it cannot be read as a promotion.
 *
 * **Both builds, in that order, and this line used to say only the second one.**
 * `build:shell` copies whatever is already in `out/`; it does not produce it. A
 * run after `build:shell` alone photographs the *previous* export, and the
 * failure is silent in the worst way — MAR-498 added a route, ran only
 * `build:shell`, and got a full set of images of a page that did not exist yet:
 * 1280×2200 of background colour, no error anywhere. Every surface in `SURFACES`
 * is a page in the export, so this is not a hazard peculiar to new routes.
 */

import "./smoke-identity.js";
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
 * The strip's own constants rather than this harness's copy of them.
 *
 * The first draft wrote `"dash.fleet-strip"` and the real key is
 * `"dash.fleetStrip"`, so the off-switch witness would have read `null` from
 * storage and reported it — a harness disagreeing with the thing it is
 * measuring, which is `firstAgentName`'s lesson three functions down arriving
 * again. Importing them means a rename breaks the build instead.
 */
import { FLEET_STRIP_ATTRIBUTE, FLEET_STRIP_STORAGE_KEY } from "../lib/views/fleet-strip";
import { importManifest } from "../lib/store";
import { recordSecretReference } from "../lib/secret-refs";
import {
  recordFleetAccountAssignment,
  recordFleetConnection,
  recordFleetGrant,
} from "../lib/fleet/store";

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
 * MAR-643's opt-in state for the existing `settings-connections` scene.
 *
 * A scene, not another harness: the real shell, route, read channel, themes,
 * resizing, and capture loop below remain the authority. This only gives a
 * scratch store the state the issue is about. The guard prevents an accidental
 * run from writing fixtures into the person's ordinary DASH store.
 */
function seedMar643Scene(): void {
  if (process.env.DASH_CAPTURE_SCENE !== "mar643-multi-account") {
    return;
  }
  if (process.env.DASH_DATA_DIR === undefined) {
    throw new Error("DASH_CAPTURE_SCENE=mar643-multi-account requires a scratch DASH_DATA_DIR");
  }

  const gmail = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as {
    agent: { name: string; display_name?: string };
    agent_dom: { connections: Array<Record<string, unknown>> };
  };
  gmail.agent.name = "meeting-assistant";
  gmail.agent.display_name = "Meeting Assistant";
  importManifest(gmail);

  const scout = JSON.parse(JSON.stringify(gmail)) as typeof gmail;
  scout.agent.name = "news-scout";
  scout.agent.display_name = "News Scout";
  const scoutConnection = scout.agent_dom.connections[0];
  if (scoutConnection !== undefined) {
    scoutConnection["id"] = "mail";
  }
  importManifest(scout);

  const at = "2026-08-16T08:00:00.000Z";
  for (const account of [
    { id: "account-1", hint: "he••••@gmail.com", isDefault: true },
    { id: "account-2", hint: "wo••••@gmail.com", isDefault: false },
  ]) {
    recordFleetConnection(
      {
        provider: "google-gmail",
        account_id: account.id,
        connector_kind: "google_oauth_broker",
        field_id: "sign_in",
        secret_name: `dash.fleet.google-gmail.${account.id}.sign_in`,
        masked_hint: account.hint,
        account_hint: account.hint,
        scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
        backend: "os_keychain",
        is_default: account.isDefault,
      },
      at,
    );
  }

  for (const assignment of [
    { agent: "meeting-assistant", account: "account-1", connection: "gmail" },
    { agent: "news-scout", account: "account-2", connection: "mail" },
  ]) {
    recordFleetGrant("google-gmail", assignment.agent, "granted", at);
    recordFleetAccountAssignment("google-gmail", assignment.agent, assignment.account, at);
    recordSecretReference({
      agent: assignment.agent,
      connection_id: assignment.connection,
      field_id: "gmail-account",
      secret_name: `dash.connection.${assignment.agent}.${assignment.connection}.gmail-account`,
      masked_hint:
        assignment.account === "account-1" ? "he••••@gmail.com" : "wo••••@gmail.com",
      backend: "os_keychain",
    });
  }

  console.log("[capture] seeded MAR-643: two Gmail accounts assigned to two agents");
}

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
  { name: "work", path: "/work", density: false, tall: false },
  /*
   * Settings' four tabs (MAR-592).
   *
   * Listed individually, and each is photographed at the route it actually
   * has — a tab held in React state would have made this harness learn to
   * click, and MAR-577 already paid for what a harness that clicks gets wrong.
   *
   * Two of the four were already in this matrix under their old addresses. The
   * other two are new to it, which is the honest consequence of Notifications
   * and Add agent becoming surfaces a person reaches by pressing a tab: the
   * strip above them is now part of what a screenshot of them has to show.
   */
  { name: "settings-connections", path: "/settings", density: false, tall: true },
  /*
   * MAR-642. The sixth tab: the three model keys, and the model DASH gives an
   * agent nobody has configured.
   *
   * `tall` because the page's two halves are stacked — the default's dropdown
   * above, the key cards below — and the failure worth photographing is the
   * one a viewport frame hides: a person who came to add a key finding the
   * cards below the fold under a setting they cannot use yet.
   */
  { name: "settings-ai", path: "/settings/ai", density: false, tall: true },
  {
    name: "settings-notifications",
    path: "/settings/notifications",
    density: false,
    tall: false,
  },
  /* MAR-498. `tall` because the wizard's last step carries the deploy receipt
     under the probe's own answer, and a viewport frame shows the probe. */
  { name: "settings-servers", path: "/settings/servers", density: false, tall: true },
  { name: "settings-add-agent", path: "/settings/add-agent", density: false, tall: false },
  /*
   * MAR-599. The fifth tab, and `density: true` for the reason `agents`
   * carries the same flag: this is a page whose whole subject is what the two
   * density-affected surfaces look like, so photographing only comfortable
   * would leave the setting on this page more evidenced by prose than by a
   * picture.
   */
  { name: "settings-preferences", path: "/settings/preferences", density: true, tall: false },
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

/* ---------------------------------------------------------------------- *
 * The cast's own witnesses (MAR-501, MAR-502, MAR-503)
 * ---------------------------------------------------------------------- *
 *
 * The three BRAND issues each state a `proven` bar that a wall of screenshots
 * does not meet. MAR-500's note put it exactly: the witnessed render "belongs to
 * the first BRAND-03/04/05 slice", and what it names is not more pictures — it
 * is *reduced motion honoured*, *a missing asset costing no layout and no
 * information*, *a visible focus ring on every character*, and *activation
 * landing on the right workspace*.
 *
 * None of those is a picture. Each is a question with an answer, so each is
 * asked here and the answers are written to `cast-witness.json` beside the
 * images — which is the same argument `electron/capture.ts` already makes about
 * being a script: a thing somebody checked once on a machine nobody else has is
 * not evidence the next person can refresh.
 *
 * They run against the same window as everything above, after the image loop, so
 * nothing they do to the page can reach a photograph that is already written.
 */

interface Witness {
  name: string;
  ok: boolean;
  detail: string;
}

const witnesses: Witness[] = [];

function record(name: string, ok: boolean, detail: string): void {
  witnesses.push({ name, ok, detail });
  console.log(`[capture] ${ok ? "witness" : "NOT WITNESSED"} ${name}: ${detail}`);
}

/**
 * Ask the renderer what a media feature currently resolves to, having changed it
 * the way the browser itself changes it.
 *
 * `Emulation.setEmulatedMedia` over the DevTools protocol, not a stylesheet
 * override and not a class on `<html>`. That distinction is the same one this
 * harness already makes about `nativeTheme`: what is under test is whether
 * `app/tokens.css`'s `@media (prefers-reduced-motion: reduce)` block is
 * *evaluated*, so the input to the media engine is what has to move. Writing
 * `--motion-fast: 0ms` from the harness would prove that CSS variables exist.
 *
 * There is no Electron API for this and there is no OS call either — on Windows
 * the signal is a Settings toggle. CDP is how the browser's own device-mode
 * does it, and it drives the identical code path.
 */
async function underReducedMotion<T>(
  target: BrowserWindow,
  value: "reduce" | "no-preference",
  work: () => Promise<T>,
): Promise<T> {
  const { debugger: cdp } = target.webContents;
  if (!cdp.isAttached()) {
    cdp.attach("1.3");
  }
  await cdp.sendCommand("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value }],
  });
  await settle(200);
  try {
    return await work();
  } finally {
    await cdp.sendCommand("Emulation.setEmulatedMedia", { features: [] });
    await settle(150);
  }
}

/**
 * A CSS duration in milliseconds, whatever unit it came back in.
 *
 * The first draft of this witness compared the computed value against the
 * string `"0ms"` and reported the product broken twice, in both themes, on a
 * stylesheet that was doing exactly the right thing: `app/tokens.css` declares
 * `0ms` and `160ms`, and `getComputedStyle` hands back `0s` and `.16s`. A
 * witness that reads a normalised value as a failure is worse than no witness,
 * because the next person deletes it instead of the defect.
 */
function millis(value: string): number | null {
  const match = /^\s*([\d.]+)\s*(ms|s)\s*$/.exec(value);
  if (match === null) {
    return null;
  }
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/** The two durations the whole reduced-motion argument rests on. */
async function motionTokens(target: BrowserWindow): Promise<{ fast: string; normal: string }> {
  return (await within(
    "read motion tokens",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const s = getComputedStyle(document.documentElement);
         return { fast: s.getPropertyValue("--motion-fast").trim(),
                  normal: s.getPropertyValue("--motion-normal").trim() };
       })()`,
    ),
  )) as { fast: string; normal: string };
}

/**
 * MAR-501/502/503's shared reduced-motion clause, and the honest reading of it.
 *
 * All three issues say the same thing in slightly different words: the cast is
 * static, so there is nothing for `prefers-reduced-motion` to switch off, and
 * what has to hold is that the tokens any future motion would spend are zeroed
 * and that turning the preference on takes nothing away.
 *
 * So this asserts a **pair**. Zero under `reduce` alone would also be true of a
 * stylesheet that had lost its `not (prefers-reduced-motion: reduce)` block and
 * was zeroing the tokens for everybody — which is a real regression that reads
 * as a pass. The characters are counted on both sides for the same reason: a
 * page that rendered nothing would report `0ms` very convincingly.
 */
async function witnessReducedMotion(target: BrowserWindow, theme: string): Promise<void> {
  const ordinary = await underReducedMotion(target, "no-preference", async () => ({
    tokens: await motionTokens(target),
    cast: await castCensus(target),
  }));

  const reduced = await underReducedMotion(target, "reduce", async () => {
    const answer = { tokens: await motionTokens(target), cast: await castCensus(target) };
    await shoot(target, `witness-reduced-motion-${theme}`);
    return answer;
  });

  const zeroed = millis(reduced.tokens.fast) === 0 && millis(reduced.tokens.normal) === 0;
  const movesWhenAsked =
    (millis(ordinary.tokens.fast) ?? 0) > 0 && (millis(ordinary.tokens.normal) ?? 0) > 0;
  const keptEverything =
    reduced.cast.avatars === ordinary.cast.avatars &&
    reduced.cast.standing === ordinary.cast.standing &&
    reduced.cast.avatars > 0;

  record(
    `reduced-motion/${theme}`,
    zeroed && movesWhenAsked && keptEverything,
    `reduce → --motion-fast: ${reduced.tokens.fast}, --motion-normal: ${reduced.tokens.normal}; ` +
      `no-preference → ${ordinary.tokens.fast} / ${ordinary.tokens.normal}; ` +
      `${String(reduced.cast.avatars)} avatars and ${String(reduced.cast.standing)} standing under ` +
      `reduce vs ${String(ordinary.cast.avatars)} / ${String(ordinary.cast.standing)} without it`,
  );
}

/** Who is on screen, in the two counts every witness below compares. */
async function castCensus(
  target: BrowserWindow,
): Promise<{ avatars: number; standing: number; boxes: string[] }> {
  return (await within(
    "cast census",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const all = [...document.querySelectorAll(".o-avatar")];
         return {
           avatars: all.length,
           standing: document.querySelectorAll(".fleet-strip .o-avatar").length,
           boxes: all.map((i) => i.clientWidth + "x" + i.clientHeight),
         };
       })()`,
    ),
  )) as { avatars: number; standing: number; boxes: string[] };
}

/**
 * The missing-asset clause all three issues carry: no layout shift, no lost
 * information.
 *
 * The sprites are pointed at a name that is not in the export, and the images
 * genuinely fail to load — which is the condition under test rather than a
 * drawing of it. That is checked rather than assumed: an `<img>` that is
 * `complete` with `naturalWidth === 0` has been fetched and has no pixels, and
 * if any image still has pixels this reports itself as not witnessed instead of
 * quietly measuring an unbroken page.
 *
 * Layout shift is measured against `main`'s own rectangle and the strip's
 * height, taken before and after. Information is measured by counting the
 * controls and their accessible names — MAR-503's point is that a missing sprite
 * must cost a picture and never a position, a name, or a way into the workspace.
 */
async function witnessMissingAsset(target: BrowserWindow, theme: string): Promise<void> {
  const before = (await target.webContents.executeJavaScript(
    `(() => {
       const main = document.querySelector("main");
       const strip = document.querySelector(".fleet-strip");
       return {
         main: main === null ? null : Math.round(main.getBoundingClientRect().height),
         strip: strip === null ? null : Math.round(strip.getBoundingClientRect().height),
         links: document.querySelectorAll(".fleet-strip-o").length,
         names: [...document.querySelectorAll(".fleet-strip-o")].map((a) => (a.textContent ?? "").trim()),
         boxes: [...document.querySelectorAll(".o-avatar")].map((i) => i.clientWidth + "x" + i.clientHeight),
       };
     })()`,
  )) as Record<string, unknown>;

  const after = (await target.webContents.executeJavaScript(
    `(async () => {
       const imgs = [...document.querySelectorAll(".o-avatar")];
       for (const img of imgs) {
         img.setAttribute("data-real-src", img.getAttribute("src"));
         img.setAttribute("src", "/o/1x/__absent-for-this-witness__.png");
       }
       await new Promise((r) => setTimeout(r, 700));
       const main = document.querySelector("main");
       const strip = document.querySelector(".fleet-strip");
       return {
         main: main === null ? null : Math.round(main.getBoundingClientRect().height),
         strip: strip === null ? null : Math.round(strip.getBoundingClientRect().height),
         links: document.querySelectorAll(".fleet-strip-o").length,
         names: [...document.querySelectorAll(".fleet-strip-o")].map((a) => (a.textContent ?? "").trim()),
         boxes: imgs.map((i) => i.clientWidth + "x" + i.clientHeight),
         really_broken: imgs.every((i) => i.complete && i.naturalWidth === 0),
         any_pixels_left: imgs.some((i) => i.naturalWidth > 0),
       };
     })()`,
  )) as Record<string, unknown>;

  await shoot(target, `witness-missing-asset-${theme}`);

  // Put the real sprites back before anything else looks at this page.
  await target.webContents.executeJavaScript(
    `(() => {
       for (const img of document.querySelectorAll(".o-avatar[data-real-src]")) {
         img.setAttribute("src", img.getAttribute("data-real-src"));
         img.removeAttribute("data-real-src");
       }
     })()`,
  );
  await settle(500);

  const sameBoxes = JSON.stringify(before["boxes"]) === JSON.stringify(after["boxes"]);
  const sameNames = JSON.stringify(before["names"]) === JSON.stringify(after["names"]);
  const noShift = before["main"] === after["main"] && before["strip"] === after["strip"];

  record(
    `missing-asset/${theme}`,
    after["really_broken"] === true &&
      after["any_pixels_left"] === false &&
      sameBoxes &&
      sameNames &&
      noShift &&
      before["links"] === after["links"],
    `every sprite fetched and empty: ${String(after["really_broken"])}; ` +
      `boxes unchanged: ${String(sameBoxes)} (${JSON.stringify(after["boxes"])}); ` +
      `main ${String(before["main"])}→${String(after["main"])}px, ` +
      `strip ${String(before["strip"])}→${String(after["strip"])}px; ` +
      `${String(after["links"])} controls keeping their names: ${String(sameNames)}`,
  );
}

/**
 * A real focus ring, reached the way a keyboard reaches it.
 *
 * `element.focus()` is not this. Chromium only paints `:focus-visible` for
 * focus it believes came from the keyboard, so a programmatic call would
 * measure an outline the user will never see — the exact shape of the mistake
 * MAR-440's skip link shipped, where the property held and the pixels did not.
 * So Tab is sent as a real input event and the ring is measured off whatever the
 * browser decided to focus.
 */
async function witnessFocusRing(target: BrowserWindow, theme: string): Promise<void> {
  await target.webContents.executeJavaScript(
    `(() => { document.body.focus(); if (document.activeElement) document.activeElement.blur(); })()`,
  );

  const total = (await target.webContents.executeJavaScript(
    `document.querySelectorAll(".fleet-strip-o").length`,
  )) as number;

  const rings: string[] = [];
  let reached = 0;
  // A bounded sweep: enough Tabs to cross the chrome, the page and the strip.
  for (let press = 0; press < 120 && reached < total; press += 1) {
    target.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    target.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await settle(40);
    const focused = (await target.webContents.executeJavaScript(
      `(() => {
         const el = document.activeElement;
         if (el === null || !el.classList.contains("fleet-strip-o")) return null;
         const s = getComputedStyle(el);
         return {
           name: (el.textContent ?? "").trim(),
           style: s.outlineStyle,
           width: s.outlineWidth,
           colour: s.outlineColor,
           visible: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0,
         };
       })()`,
    )) as { name: string; style: string; width: string; colour: string; visible: boolean } | null;
    if (focused !== null) {
      reached += 1;
      if (focused.visible) {
        rings.push(`${focused.name}: ${focused.width} ${focused.style}`);
      } else {
        rings.push(`${focused.name}: NO RING (${focused.style} ${focused.width})`);
      }
      if (reached === 1) {
        await shoot(target, `witness-focus-ring-${theme}`);
      }
    }
  }

  record(
    `focus-ring/${theme}`,
    reached === total && total > 0 && rings.every((r) => !r.includes("NO RING")),
    `${String(reached)} of ${String(total)} characters reached by Tab; ${rings.join("; ")}`,
  );
}

/**
 * Activation lands on the right workspace — by keyboard, which is the half a
 * click test would not cover.
 *
 * The destination is compared against the agent the focused control actually
 * names, rather than against a name written into this harness: the strip's order
 * is `agents` order and a harness holding its own copy of that would agree with
 * the strip on the day it was written and never again.
 */
async function witnessActivation(target: BrowserWindow, home: string): Promise<void> {
  /*
   * It focuses its own target, and that is a fix rather than a precaution.
   *
   * The first draft read whatever `witnessFocusRing` happened to leave focused,
   * which worked until a workspace witness was added between them: the run
   * navigated twice, the focus went with the old document, and this reported
   * "no character was focused" — a witness failing because of the order the
   * witnesses run in, which is the least useful kind of red there is.
   */
  await target.webContents.executeJavaScript(
    `(() => { if (document.activeElement) document.activeElement.blur(); })()`,
  );
  for (let press = 0; press < 120; press += 1) {
    const onOne = (await target.webContents.executeJavaScript(
      `document.activeElement !== null && document.activeElement.classList.contains("fleet-strip-o")`,
    )) as boolean;
    if (onOne) {
      break;
    }
    target.webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    target.webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await settle(40);
  }

  const intended = (await target.webContents.executeJavaScript(
    `(() => {
       const el = document.activeElement;
       if (el === null || !el.classList.contains("fleet-strip-o")) return null;
       return { name: (el.textContent ?? "").replace(/^Open\\s+/, "").trim(), href: el.getAttribute("href") };
     })()`,
  )) as { name: string; href: string } | null;

  if (intended === null) {
    record("activation", false, "no character was focused when activation was attempted");
    return;
  }

  target.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  target.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
  await settle(1500);

  const landed = target.webContents.getURL();
  const shows = (await target.webContents.executeJavaScript(
    `(() => {
       const heading = document.querySelector("main h1, main h2");
       return heading === null ? null : (heading.textContent ?? "").trim();
     })()`,
  )) as string | null;

  const arrived = landed.includes(encodeURIComponent(intended.name)) || landed.includes(intended.name);
  record(
    "activation",
    arrived,
    `Enter on "${intended.name}" (href ${intended.href}) landed on ${landed}` +
      `${shows === null ? "" : `, showing "${shows}"`}`,
  );

  await go(target, home);
}

/**
 * The strip's off switch, and what this does and does not witness.
 *
 * The button is clicked — the real control, the same discipline the density
 * toggle is driven with — and the document is then **reloaded**, so the setting
 * has to survive by the only route it has: `FleetStripScript` reading
 * `localStorage` before the first paint. That is the mechanism MAR-503's
 * "remembered per user" clause names, and reloading is the honest way to test it
 * inside one process.
 *
 * It is NOT an app restart, and this note is here so nobody reads it as one. A
 * process restart witnesses the same pre-paint script over the same storage; the
 * difference between the two is whether Chromium's storage layer was torn down
 * in between, which is a Chromium property rather than a DASH one.
 */
async function witnessStripOff(target: BrowserWindow, home: string): Promise<void> {
  const off = (await target.webContents.executeJavaScript(
    `(() => {
       const button = document.querySelector("button.fleet-strip-toggle");
       if (button === null) return { found: false };
       button.click();
       return { found: true,
                attribute: document.documentElement.getAttribute(${JSON.stringify(FLEET_STRIP_ATTRIBUTE)}),
                stored: window.localStorage.getItem(${JSON.stringify(FLEET_STRIP_STORAGE_KEY)}) };
     })()`,
  )) as { found: boolean; attribute?: string | null; stored?: string | null };

  if (!off.found) {
    record("strip-off", false, "no fleet-strip toggle on the page");
    return;
  }

  await settle(400);
  await within("reload for strip-off", 20_000, target.webContents.reload() as unknown as Promise<void>);
  await settle(1800);

  const afterReload = (await target.webContents.executeJavaScript(
    `(() => ({
       attribute: document.documentElement.getAttribute(${JSON.stringify(FLEET_STRIP_ATTRIBUTE)}),
       stored: window.localStorage.getItem(${JSON.stringify(FLEET_STRIP_STORAGE_KEY)}),
       standing: document.querySelectorAll(".fleet-strip .o-avatar").length,
       recoverable: document.querySelector("button.fleet-strip-toggle") !== null,
     }))()`,
  )) as { attribute: string | null; stored: string | null; standing: number; recoverable: boolean };

  record(
    "strip-off",
    afterReload.attribute === "hidden" && afterReload.standing === 0 && afterReload.recoverable,
    `clicked off (stored ${String(off.stored)}); after a reload the document says ` +
      `${String(afterReload.attribute)} with ${String(afterReload.standing)} standing, ` +
      `and the way back is ${afterReload.recoverable ? "still on screen" : "GONE"}`,
  );

  // Back on, so the machine is left as it was found.
  await target.webContents.executeJavaScript(
    `(() => { const b = document.querySelector("button.fleet-strip-toggle"); if (b !== null) b.click(); })()`,
  );
  await settle(400);
  await go(target, home);
}

/**
 * The bound, exercised rather than assumed — and it is the weakest witness here,
 * so it says so in its own detail string.
 *
 * MAR-503's `proven` bar asks for **10+ agents** staying bounded with an
 * overflow count. This machine's store has four, and seeding six more into a
 * real user's records to take a screenshot would be a worse thing to do than
 * leaving the claim unproven. What is reachable is the bound itself: narrow the
 * row until four characters no longer fit and read the count that appears.
 *
 * That exercises the same `fleetStripSlots` branch a large fleet would, at the
 * same 50px whole-number rule, and it is not the same claim. The distinction is
 * recorded rather than smoothed over.
 */
async function witnessOverflow(target: BrowserWindow): Promise<void> {
  /*
   * The window's own floor is lifted first, because it is what stops this.
   * `setContentSize` below a `BrowserWindow`'s `minWidth` is clamped silently,
   * so a sweep down to 180px can spend every step at whatever the floor is and
   * report that the bound was never reached — a fact about the window manager
   * dressed up as a fact about the strip.
   */
  target.setMinimumSize(120, 300);
  const widths = [340, 300, 260, 220, 180, 150];
  for (const width of widths) {
    try {
      await resizeTo(target, width, 700);
    } catch {
      continue;
    }
    await settle(500);
    const strip = (await target.webContents.executeJavaScript(
      `(() => {
         const s = document.querySelector(".fleet-strip");
         if (s === null) return null;
         const more = s.querySelector(".fleet-strip-more");
         return {
           standing: s.querySelectorAll(".o-avatar").length,
           overflow: more === null ? null : (more.textContent ?? "").trim(),
           row_overflows: (() => {
             const row = s.querySelector(".fleet-strip-row");
             return row === null ? false : row.scrollWidth > row.clientWidth + 1;
           })(),
         };
       })()`,
    )) as { standing: number; overflow: string | null; row_overflows: boolean } | null;

    if (strip !== null && strip.overflow !== null) {
      await shoot(target, `witness-overflow-${String(width)}`);
      const fleetSize = strip.standing + Number(/\+(\d+)/.exec(strip.overflow)?.[1] ?? 0);
      record(
        "overflow-bound",
        !strip.row_overflows,
        `at ${String(width)}px the strip stands ${String(strip.standing)} and says "${strip.overflow}", ` +
          `row scrolls: ${String(strip.row_overflows)}. NOTE: this exercises the bound with a ` +
          `${String(fleetSize)}-agent store, which is NOT MAR-503's "10+ agents" clause`,
      );
      return;
    }
  }
  const fleet = await castCensus(target);
  record(
    "overflow-bound",
    false,
    `${String(fleet.standing)} agents still fit at ${String(widths[widths.length - 1])}px — the ` +
      `bound was never reached, so nothing here witnesses it`,
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
  seedMar643Scene();

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

  const mar643 = process.env.DASH_CAPTURE_SCENE === "mar643-multi-account";
  const surfaces = mar643
    ? SURFACES.filter((surface) => surface.name === "settings-connections")
    : SURFACES;
  const viewports = mar643
    ? VIEWPORTS.filter((viewport) => viewport.name === "375" || viewport.name === "1280")
    : VIEWPORTS;

  for (const theme of THEMES) {
    // The OS's own signal, not a stylesheet override. `followTheme` in main.ts
    // repaints the title-bar overlay from this too, so the chrome in the image
    // is the chrome a user with this OS setting would get.
    nativeTheme.themeSource = theme;
    await settle(250);

    for (const surface of surfaces) {
      const route =
        surface.path ??
        (agent === null ? null : `/agents/detail?agent=${encodeURIComponent(agent)}`);
      if (route === null) {
        continue;
      }
      await go(window, route);

      for (const viewport of viewports) {
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

  /*
   * The witnesses, last and on the fleet page.
   *
   * After every image is written, because two of them deliberately break the
   * page — a sprite that cannot load, a strip switched off — and a photograph
   * taken afterwards would be a picture of the harness's own experiment. The
   * fleet page is where all four surfaces the cast appears on are represented at
   * once: cards, the strip, and a workspace one Enter away.
   */
  console.log("\n[capture] ── the cast's own witnesses ──");
  await resizeTo(window, 1280, 860);
  await go(window, "/");

  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    await settle(300);
    await witnessReducedMotion(window, theme);
    await witnessMissingAsset(window, theme);
    await witnessFocusRing(window, theme);
  }

  /*
   * The workspace portrait, on its own page (MAR-502).
   *
   * The fleet page carries eight avatars and every one of them is 50px, so the
   * witnesses above establish MAR-501 and MAR-503's clause and say nothing at
   * all about the 100px portrait — which is a different element, at a different
   * size, in a different layout, and is the one MAR-502's own missing-asset
   * clause is about. Repeating two of the three here is cheaper than a claim
   * that quietly covers one surface and is written as if it covered two.
   *
   * The focus-ring witness is not repeated, deliberately: the portrait is
   * decorative and is not a control, so there is nothing there to focus and a
   * ring around it would be the defect rather than the evidence.
   */
  if (agent !== null) {
    const workspace = `/agents/detail?agent=${encodeURIComponent(agent)}`;
    for (const theme of THEMES) {
      nativeTheme.themeSource = theme;
      await settle(300);
      await go(window, workspace);
      await witnessReducedMotion(window, `workspace-${theme}`);
      await witnessMissingAsset(window, `workspace-${theme}`);
    }
    await go(window, "/");
  }

  // Once, not per theme: these change where the window is or what it stores,
  // and neither answer can differ by palette.
  nativeTheme.themeSource = "dark";
  await settle(200);
  await witnessActivation(window, "/");
  await witnessStripOff(window, "/");
  await witnessOverflow(window);

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(
    path.join(OUT, "cast-witness.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), witnesses }, null, 2)}\n`,
    "utf8",
  );

  const failed = witnesses.filter((w) => !w.ok);
  console.log(
    `\n[capture] wrote ${String(written.length)} images, layout.json and cast-witness.json to ${OUT}`,
  );
  console.log(
    `[capture] ${String(witnesses.length - failed.length)}/${String(witnesses.length)} witnesses passed` +
      (failed.length === 0 ? "" : ` — NOT witnessed: ${failed.map((w) => w.name).join(", ")}`),
  );
  /*
   * A failed witness does not fail the run, and that is ADR 0004 rather than
   * leniency: this harness produces evidence, never a verdict, and must not be
   * able to fail a release. What it must do is say so loudly enough that nobody
   * reads a run with a red witness in it as a promotion.
   */
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
