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
 * once per scene.
 *
 * ## The scenes (MAR-871)
 *
 * `DASH_CAPTURE_SCENE`, and the run seeds the store itself rather than being
 * handed one — `electron/capture-deploy.ts`'s shape, adopted here so a frame's
 * filename and its contents cannot drift apart:
 *
 * - `no-server`  — nothing saved. The wizard's first step, which is where a
 *                  person who has never had a server begins.
 * - `saved`      — one record, nothing asked. The card in `never_checked`, and
 *                  the state every visit opens in.
 * - `deployed`   — one record DASH has already sent an agent to. The only scene
 *                  in which "what is on this server" and the page's own table
 *                  have anything to draw.
 *
 * Every scene with a card also photographs the **setup recipe**, opened by
 * pressing the real control: the five numbered steps MAR-871 added, which the
 * attended run of 2026-09-05 found had no route back to them at all once a
 * server was enrolled.
 *
 * With `DASH_CAPTURE_CHECK=1` the run also presses the card's own **Check now**,
 * which signs in for real. Pointed at a seeded address in TEST-NET-1 it
 * black-holes rather than refusing, so the probe spends `ssh`'s connect timeout
 * and the card lands in a genuine `unreachable` state produced by the real
 * renderer → preload → main → `ssh` path.
 *
 * ## The states this harness cannot photograph, and why it fakes none of them
 *
 * **Your server is up** (`no_runner_there`) and **a server with agents on it**
 * (`reachable`) are both *answers a machine gave*. There is no seeded standing
 * and there could not be one: a standing is what a server said, it is held in
 * the window rather than in the store (ADR 0015), and a scratch store cannot
 * produce one. `electron/capture-deploy.ts` made the same ruling for the same
 * reason — *"a faked screenshot of it would be the substitution ADR 0002
 * amendment 1 named"* — and `tests/server-card-render.test.tsx` covers both
 * states over the real component instead.
 *
 * **Two records for one machine** cannot be seeded either, and that refusal is
 * the feature: `saveHost` throws on a second record naming one address and one
 * account (MAR-574), so a scene that seeded a duplicate would die at the seed.
 * The wizard's duplicate warning and the control it now gates are covered by
 * `tests/host-wizard-render.test.tsx`.
 *
 * Both gaps need an attended run against a real host, which is MAR-871's own
 * owner-run proof line.
 *
 * ## What is real here, and the one thing that is not
 *
 * Real: the packaged renderer, its compiled stylesheet, the bundled faces, the
 * `dash-app://ui/settings/servers` route itself, the view arriving over the read channel
 * from `hostsView()`, `app/tokens.css` resolved against a `color-scheme` the
 * operating system's own signal moved, the density attribute written by pressing
 * the real control, and the viewport arithmetic at each width.
 *
 * Not real: **whose data it is.** The store is a scratch directory this run
 * seeds, so these images are evidence of what the page draws for a given store
 * — which is exactly the claim a two-state page needs — and evidence about
 * nobody's actual machine. Written here rather than left for a reader of the
 * PNGs to work out, because a screenshot with an unstated caveat is how a
 * `merged` claim quietly becomes a `proven` one.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window, and with a
 * **scratch** `DASH_DATA_DIR` — this run *writes* to the store it is pointed
 * at, so it must never be handed the real one.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-servers-saved'
 *     $env:DASH_CAPTURE_SCENE='saved'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar-871/saved'
 *     pnpm exec electron dist/electron/capture-servers.mjs --user-data-dir=…\scratch-udd
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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { importManifest, recordAgentDeploy, saveHost } from "../lib/store.js";
import { dataDir } from "../lib/db.js";
import { createHostKey } from "./ssh-host.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar574");
const SCENE = process.env.DASH_CAPTURE_SCENE ?? "saved";

/**
 * An address that black-holes rather than refusing.
 *
 * TEST-NET-1, the same choice `electron/capture-deploy.ts` makes and for the
 * same reason: a refused connection answers instantly and a check against it
 * would photograph the failure without ever passing through the state in
 * between. This one spends `ssh`'s connect timeout, so **Check now** produces a
 * real in-flight frame and then a real `no_answer_at_address` card.
 */
const NOWHERE = "192.0.2.1";
const SEEDED_AGENT = "news-scout-mar871";

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

/* ---------------------------------------------------------------------- *
 * The store this run photographs (MAR-871)
 * ---------------------------------------------------------------------- */

/**
 * Seed the scratch store this run was pointed at.
 *
 * After `app.whenReady()` and before the first navigation, because every page
 * reads its view on mount: a page loaded before the rows exist is a photograph
 * of an empty state under a filename claiming otherwise —
 * `electron/capture-deploy.ts` learned that one first.
 *
 * Idempotent by accident rather than by design: `saveHost` refuses a second
 * record for one address and account, so a second run against the same scratch
 * directory would throw. Give each scene its own directory.
 */
function seed(): void {
  if (SCENE === "no-server") {
    console.log("[servers] seeded scene no-server: nothing at all");
    return;
  }

  /*
   * A real key, minted by the same function `host.create` uses. Without one the
   * probe refuses at `assertHostKeyProtected` before `ssh` is ever spawned, and
   * the checked frame would be a picture of a local refusal rather than of a
   * server that did not answer.
   */
  createHostKey(dataDir, "scene-1");
  saveHost({
    host_id: "scene-1",
    label: "My server",
    address: NOWHERE,
    port: 22,
    username: "root",
    key_name: "scene-1",
    /*
     * Null, which is what every real record has (MAR-572) and therefore what
     * the identity section in the overflow should be photographed drawing.
     */
    host_fingerprint: null,
    added_at: "2026-09-05T17:25:14.195Z",
  });

  if (SCENE === "deployed") {
    /*
     * An agent DASH holds, and DASH's own record of having sent it there.
     *
     * The deploy row is the *only* seeded fact behind "what is on this server",
     * and it is DASH's memory of its own outbound act (ADR 0010). There is no
     * seeded sighting and there could not be one — see the header. So this
     * frame shows the cold half of the reconciliation, which is also the half
     * every person meets on every freshly opened window.
     */
    const manifest = JSON.parse(
      readFileSync(
        path.resolve(process.cwd(), "examples", "agent.manifest.example.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const agent = manifest["agent"] as Record<string, unknown>;
    agent["name"] = SEEDED_AGENT;
    agent["display_name"] = "News Scout";
    const json = JSON.stringify(manifest);
    importManifest(manifest, {
      manifestJson: json,
      registration: {
        agent_id: SEEDED_AGENT,
        manifest_path: "agent.manifest.json",
        command: "node",
        args: ["agent.mjs"],
        cwd: "code",
        env: {},
      },
      files: [
        { path: "agent.manifest.json", contents: json },
        { path: "agent.mjs", contents: "process.stdout.write('ready')\n" },
      ],
    });
    recordAgentDeploy(
      {
        agent: SEEDED_AGENT,
        host_id: "scene-1",
        manifest_sha256: "scene-manifest-digest",
        files_sha256: "scene-files-digest",
      },
      "2026-09-05T17:53:02.016Z",
    );
  }

  console.log(
    `[servers] seeded scene ${SCENE}: 1 server` +
      (SCENE === "deployed" ? ", 1 agent, 1 deploy record" : ""),
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
    // MAR-871 renamed it. One refresh on the card, replacing both "Check this
    // server" and the restart section's own "Ask the server".
    `(() => {
       const button = [...document.querySelectorAll(".server-card button")]
         .find((node) => node.textContent.trim() === "Check now");
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
  /*
   * Scoped to the card's head since MAR-606. `.server-card .chip` used to be
   * unambiguous; the card now also draws a chip per agent inside
   * `.host-contents`, and while the standing still happens to come first in the
   * document, a selector relying on that would start reporting an agent's
   * standing as the server's the first time somebody reordered the card.
   */
  return (await target.webContents.executeJavaScript(
    `document.querySelector(".server-card .card-head .chip")?.textContent ?? null`,
  )) as string | null;
}

/**
 * Open the recipe, the way a person does (MAR-871).
 *
 * Two presses and both are real: the overflow's own summary, then the control
 * inside it, then the button that fetches the snippet from main. Nothing here
 * writes an attribute or sets state — a harness that opened the disclosure by
 * hand would photograph identical-looking output whether or not the control
 * worked, which is `pressDensityToggle`'s argument one function up.
 *
 * Returns how many numbered steps ended up on screen, so the log says what was
 * photographed rather than leaving a reader to count them in the picture.
 */
async function openTheRecipe(target: BrowserWindow): Promise<number> {
  const steps = (await target.webContents.executeJavaScript(
    `(() => {
       const card = document.querySelector(".server-card");
       if (card === null) return 0;
       const more = card.querySelector("details.server-more");
       if (more !== null) more.open = true;
       const setUp = [...card.querySelectorAll("button")]
         .find((node) => /Set up this server|Set it up again/.test(node.textContent.trim()));
       if (setUp === undefined) return 0;
       setUp.click();
       return 1;
     })()`,
  )) as number;
  if (steps === 0) {
    return 0;
  }
  await settle(400);
  // And the snippet itself, which main composes at request time.
  await target.webContents.executeJavaScript(
    `(() => {
       const button = [...document.querySelectorAll(".setup-panel button")]
         .find((node) => node.textContent.trim() === "Show the setup text");
       if (button !== undefined) button.click();
     })()`,
  );
  await settle(1400);
  return (await target.webContents.executeJavaScript(
    `document.querySelectorAll(".setup-step").length`,
  )) as number;
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
           /*
            * MAR-605. The summary above the list, read out rather than counted.
            *
            * It used to say "1 server is connected" above a card whose own body
            * said DASH could not get in, and no counter here would have caught
            * that — a count of one is a count of one either way. What catches it
            * is the sentence itself in the log, beside the chip below it, so a
            * reader of the run can see whether the two agree.
            */
           page_summary: document.querySelector(".page-summary")?.textContent?.trim() ?? null,
           /*
            * MAR-871. Which of the seven situations the card decided it is in,
            * and how many controls it drew on its own face — the two numbers
            * this packet is about. The attended run met a card offering five at
            * once; "one card, one state, one primary action" is a claim a
            * reader of these frames can now check without counting pixels.
            *
            * Scoped to the card's own button row, so the overflow's contents
            * and any open panel's controls are excluded by construction.
            */
           card_state:
             [...(document.querySelector(".server-card")?.classList ?? [])]
               .find((one) => one.startsWith("is-")) ?? null,
           primary_actions: [
             ...(document.querySelectorAll(".server-card > .button-row > *") ?? []),
           ].map((node) => (node.textContent ?? "").trim()),
           /*
            * The standing chip's own document text, never innerText: chips are
            * uppercased by the stylesheet as typography, so a harness grepping
            * rendered text for "Answering" reads false while the word is in the
            * middle of the picture.
            *
            * NOTE: no backticks in this block. It is all one template literal in
            * the .ts file and a backtick in a comment closes it.
            */
           standing_chip:
             document.querySelector(".server-card .card-head .chip")?.textContent?.trim() ?? null,
           /* MAR-606, on this page. Absent until DASH has sent something here. */
           host_contents: document.querySelectorAll(".host-content").length,
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
  seed();

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
       * The recipe, at every width and theme (MAR-871).
       *
       * Every width, unlike the checked frame below: these are five numbered
       * steps carrying a command line and a shell snippet, which are the two
       * widths DASH does not control on this page, and 375 is where a person on
       * a small window meets them.
       */
      const steps = await openTheRecipe(window);
      if (steps === 0) {
        console.log(`[servers] no card at ${viewport.name} — recipe frame skipped`);
      } else {
        console.log(`[servers]   recipe: ${String(steps)} steps on screen`);
        await shoot(window, `servers-recipe-${viewport.name}-${theme}-comfortable`);
        // Back to the card as it opens, so the next frame is not of an open
        // disclosure under a filename that does not say so.
        await go(window, "/settings/servers");
      }

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
