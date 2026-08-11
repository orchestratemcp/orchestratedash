/**
 * Screenshots of the deploy surface, in the real shell (MAR-577). **Not part of
 * the shipped shell.**
 *
 * `electron/capture.ts` walks every surface and photographs whatever the machine
 * happens to hold. It is the wrong harness for this feature for
 * `electron/capture-servers.ts`'s reason, twice over: **the store decides what
 * these surfaces draw.** Whether an agent can be sent to a server at all is a
 * fact about DASH's own folder for it, and whether a server is offered is a fact
 * about the host table. A run against one machine's store photographs one branch
 * of each and cannot say which one it got.
 *
 * So this points the same real renderer at a store this run seeds, and is run
 * once per scene:
 *
 * - `one-server`   — one saved server. The ordinary case, and the only scene
 *                    that also photographs the Servers page's own panel and
 *                    presses a real deploy.
 * - `two-servers`  — two saved servers, which is the only thing that makes the
 *                    agent page ask *which* one.
 * - `no-server`    — none, where the honest answer is that the agent already
 *                    runs on this computer and nothing is missing.
 * - `stranded`     — MAR-591. One saved server and two agents carrying
 *                    `dash_managed` connections DASH cannot send: one whose file
 *                    never says whether a run needs them (warned, still
 *                    pressable) and one whose file says it does (refused before
 *                    the press). Both entry points are photographed, because the
 *                    issue's requirement is that both say it.
 *
 * ## What is real here, and the two things that are not
 *
 * Real: the packaged renderer and its compiled stylesheet, the `dash-app://ui/`
 * routes, the views arriving over the read channel from `workspaceView()` and
 * `hostsView()`, the folder standing computed from real agent folders on disk,
 * `app/tokens.css` resolved against a `color-scheme` the operating system's own
 * signal moved, the density attribute written by pressing the real control, the
 * agent chosen by dispatching a real change on the real select, and — in
 * `one-server` — a deploy that goes all the way through preload, main,
 * `produceAgentFolderBundle` and `ssh`.
 *
 * Not real, and stated rather than left for a reader of the PNGs to infer:
 *
 * 1. **Whose data it is.** The store is a scratch directory this run seeded, so
 *    these are evidence of what the pages draw for a given store and evidence
 *    about nobody's actual machine.
 * 2. **The finished-deploy frame is not here.** `sent` needs a server that
 *    accepts a bundle, which is MAR-489's attended run and not something a
 *    harness may invent. `tests/deploy-render.test.tsx` covers that state, and a
 *    screenshot of it faked would be the exact substitution ADR 0002 amendment 1
 *    named. The in-flight and failed frames *are* real, because a seeded address
 *    in TEST-NET-1 black-holes rather than refusing — so `ssh` spends its connect
 *    timeout and the frame in between is a state the product actually enters.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-one-server'
 *     $env:DASH_CAPTURE_SCENE='one-server'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar577/one-server'
 *     pnpm exec electron dist/electron/capture-deploy.mjs
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
 *
 * ## What it leaves behind, said out loud
 *
 * Importing `./main.js` starts a **runner** against the scratch store, and
 * `app.exit(0)` does not stop it — main has no quit handler that would, because
 * "closing DASH leaves agents running" is the product's own behaviour and the
 * smoke depends on it. So each run leaves one live runner holding a scratch
 * store, exactly as `capture.ts` and `capture-servers.ts` already do and neither
 * says.
 *
 * It is harmless to anybody's records — the store is a temporary directory — and
 * it is **not** harmless to the next `pnpm verify:shell` on the same machine,
 * which an unrelated live runner has blocked before. AGENTS.md forbids
 * force-killing one, and its channel secret is in the OS vault rather than in
 * `runner.json`, so retiring it from outside is not a one-liner. Run this when
 * you are about to review images, not when you are about to run the gate, and
 * name the leftover pids in whatever you write afterwards.
 */

/*
 * `electron/smoke-identity.ts` is deliberately **not** imported, for
 * `electron/capture-servers.ts`'s reason: borrowing the app's name borrows its
 * single-instance lock, which would mean this could only run with DASH closed.
 * Launched as a bare file, Electron falls back to the name `Electron` and a
 * user-data directory of its own, so this runs beside a live DASH and cannot
 * touch its records — which matters most here, because this run *writes* to the
 * store it was handed.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { importManifest, saveHost } from "../lib/store.js";
import { dataDir } from "../lib/db.js";
import { createHostKey } from "./ssh-host.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar577");
const SCENE = process.env.DASH_CAPTURE_SCENE ?? "one-server";
/**
 * `all`, or `deploy` for the two pressed frames alone.
 *
 * A full scene is fifty-odd photographs and several minutes, and the pressed
 * frames are the ones most likely to need a second attempt — the first run of
 * this harness produced two of them that were the same picture. Re-shooting a
 * pair should not cost re-shooting everything, because that is how a reviewer
 * ends up keeping the first attempt's images beside the second attempt's.
 */
const ONLY = process.env.DASH_CAPTURE_ONLY ?? "all";

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

/**
 * The two agents this run needs, and the difference between them is the point.
 *
 * `news-scout` is imported with a registration and code, which is what makes its
 * folder standing `complete` and therefore sendable. `old-scout` is imported
 * with the author's document alone — exactly what DB migration 10 leaves behind
 * for every agent added before ADR 0008 — so its standing is `manifest_only` and
 * `MANIFEST_ONLY_DEPLOY_REFUSAL` is what both surfaces must say about it.
 */
const SENDABLE = "news-scout";
const MIGRATED = "old-scout";

/**
 * The two agents the `stranded` scene adds (MAR-591).
 *
 * Both are `complete` folders — sendable, in MAR-577's sense — and both carry
 * `dash_managed` connections DASH cannot send to a server. The difference
 * between them is the whole of MAR-591's rule:
 *
 * - `meeting-assistant` declares no `connection_requirements`, so its own file
 *   never says whether a run needs Gmail. DASH warns and the button stays
 *   pressable, which is the case every agent on a real machine is in today.
 * - `meeting-blocked` declares the same connections *and* MAR-569's block naming
 *   Gmail as required. DASH refuses before the press.
 *
 * A screenshot is the point here rather than a nicety: these lines are two
 * clauses each in a bulleted list, they are the longest sentences on the deploy
 * surface, and 375px is where that stops being theoretical.
 */
const STRANDED = "meeting-assistant";
const BLOCKED = "meeting-blocked";

/**
 * An address in TEST-NET-1 (RFC 5737), which is reserved for documentation and
 * routed nowhere.
 *
 * Chosen over `127.0.0.1` deliberately: a closed local port refuses immediately
 * and the in-flight state would last milliseconds, while this black-holes and
 * `ssh` spends its connect timeout — so the "putting it there" frame is a state
 * the product really sits in rather than one this harness had to stage.
 */
const NOWHERE = "192.0.2.1";
/** The same, for the scene that needs two records DASH will not call duplicates. */
const ALSO_NOWHERE = "192.0.2.2";

function scratchManifest(name: string, displayName: string): Record<string, unknown> {
  const source = JSON.parse(
    readFileSync(path.resolve(process.cwd(), "examples", "agent.manifest.example.json"), "utf8"),
  ) as Record<string, unknown>;
  const agent = source["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;
  return source;
}

/**
 * An agent with connections DASH holds, from the shipped example (MAR-591).
 *
 * `gmail-meeting-assistant.manifest.v2.example.json` rather than a document
 * written here, for `tests/folder-bundle.test.ts`'s reason: it already declares
 * two `dash_managed` sign-ins and passes every other rule, so what these images
 * show is the notice firing rather than a hand-made manifest wearing its name.
 */
function connectedManifest(
  name: string,
  displayName: string,
  requireGmail: boolean,
): Record<string, unknown> {
  const source = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const agent = source["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;
  if (requireGmail) {
    const agentDom = source["agent_dom"] as Record<string, unknown>;
    agentDom["connection_requirements"] = {
      requirements_version: 1,
      requirements: [
        {
          id: "gmail_access",
          name: "Your Gmail",
          connector_kind: "google_oauth_broker",
          connection_id: "gmail",
          why: "It reads the meeting requests this agent answers.",
        },
      ],
    };
  }
  return source;
}

/**
 * Seed the store this run was pointed at.
 *
 * Before the first navigation and after `app.whenReady()`, because every page
 * reads its view on mount: a page loaded before the rows exist is a photograph
 * of an empty state under a filename claiming otherwise.
 */
function seed(): void {
  const sendable = scratchManifest(SENDABLE, "News Scout");
  const sendableJson = JSON.stringify(sendable);
  importManifest(sendable, {
    manifestJson: sendableJson,
    registration: {
      agent_id: SENDABLE,
      manifest_path: "agent.manifest.json",
      command: "node",
      args: ["agent.mjs"],
      cwd: "code",
      env: {},
    },
    files: [
      { path: "agent.manifest.json", contents: sendableJson },
      { path: "agent.mjs", contents: "process.stdout.write('ready')\n" },
    ],
  });

  const migrated = scratchManifest(MIGRATED, "Old Scout");
  importManifest(migrated, { manifestJson: JSON.stringify(migrated) });

  // MAR-591. Only in the scene that is about them: elsewhere they would add two
  // agents to every picker on every frame and change what MAR-577's own images
  // are of.
  if (SCENE === "stranded") {
    for (const [name, label, required] of [
      [STRANDED, "Meeting Assistant", false],
      [BLOCKED, "Meeting Assistant (needs Gmail)", true],
    ] as const) {
      const manifest = connectedManifest(name, label, required);
      const json = JSON.stringify(manifest);
      importManifest(manifest, {
        manifestJson: json,
        registration: {
          agent_id: name,
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
    }
  }

  /*
   * Two records mean two addresses, and not for realism.
   * `saveHost` refuses a second record naming one address and one account
   * (MAR-574's own duplicate rule), so a scene seeded with the same address
   * twice dies at the seed — which it did, on the first attempt.
   */
  const servers: Array<{ host_id: string; label: string; address: string }> =
    SCENE === "no-server"
      ? []
      : SCENE === "two-servers"
        ? [
            { host_id: "scene-1", label: "My server", address: NOWHERE },
            { host_id: "scene-2", label: "The spare", address: ALSO_NOWHERE },
          ]
        : [{ host_id: "scene-1", label: "My server", address: NOWHERE }];

  for (const [index, server] of servers.entries()) {
    /*
     * A real key, minted by the same function `host.create` uses.
     *
     * The first run of this harness wrote a record with a key name and no key,
     * and the deploy failed at `assertHostKeyProtected` before `ssh` was ever
     * spawned — so the "in flight" frame and the "failed" frame were the same
     * picture under two names. That is worse than a missing image: it is a
     * mislabelled one. With a key present the push reaches the transport and
     * spends `ssh`'s connect timeout against an address that routes nowhere,
     * which is what makes the in-flight frame a state the product really enters.
     */
    createHostKey(dataDir, server.host_id);
    saveHost({
      host_id: server.host_id,
      label: server.label,
      address: server.address,
      port: 22,
      username: "root",
      key_name: server.host_id,
      /*
       * Pinned, so a deploy gets past the enrollment gate and reaches the
       * transport. Every real record has a null fingerprint today (MAR-572), so
       * this is the one place these images differ from what a person's own
       * Servers page shows — and it is what makes the in-flight frame reachable
       * at all, since an unconfirmed host is refused before `ssh` is spawned.
       */
      host_fingerprint: `SHA256:scene${String(index + 1)}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      added_at: "2026-08-09T09:00:00.000Z",
    });
  }
  console.log(`[deploy] seeded scene ${SCENE}: 2 agents, ${String(servers.length)} server(s)`);
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
  console.log(`[deploy] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * A maximized window ignores `setContentSize` and reports the screen's width
 * back, which on a 1280-wide display is indistinguishable from a successful
 * resize to 1280. That really happened to `electron/capture.ts` — three images
 * labelled with a viewport they were not taken at, which is worse than a missing
 * image.
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
  // Every DASH page reads its content across the IPC boundary after the first
  // paint, so a screenshot taken on `did-finish-load` is a picture of the boot
  // sequence — a real state, and not the one under review.
  await settle(1800);
}

/**
 * Press the density control, the way a person does.
 *
 * Not `setAttribute("data-density", …)`. A harness that wrote the attribute
 * would produce identical output whether or not the control worked, and the pair
 * of images would stop being a small proof as well as a picture.
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

/** Click a button by the words on it, which is the only handle a person has. */
async function clickByText(target: BrowserWindow, text: string): Promise<boolean> {
  const clicked = (await target.webContents.executeJavaScript(
    `(() => {
       const button = [...document.querySelectorAll("button")]
         .find((node) => node.textContent.trim().startsWith(${JSON.stringify(text)}));
       if (button === undefined || button.disabled) return false;
       button.click();
       return true;
     })()`,
  )) as boolean;
  await settle(500);
  return clicked;
}

/**
 * Choose an agent in the server card's picker, the way a person does.
 *
 * A real `change` on the real element rather than a prop written from outside —
 * this is the interaction the refusal is supposed to react to, so a harness that
 * bypassed it would photograph a state nothing had actually reached.
 */
async function chooseAgent(target: BrowserWindow, agent: string): Promise<string | null> {
  const chosen = (await target.webContents.executeJavaScript(
    `(() => {
       const select = document.querySelector('select[id^="deploy-agent-"]');
       if (select === null) return null;
       select.value = ${JSON.stringify(agent)};
       select.dispatchEvent(new Event("change", { bubbles: true }));
       return select.value;
     })()`,
  )) as string | null;
  await settle(400);
  return chosen;
}

/** Scroll the subject into the frame, so a viewport-sized image is of it. */
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
 * What a picture cannot settle: whether the page had to grow sideways, and
 * whether the sentence this whole issue is about is on the screen at all.
 *
 * The second half is the one worth having. A screenshot of a page that overflows
 * looks identical to one that does not, and a screenshot missing the refusal
 * looks identical to one where the refusal simply scrolled below the fold — so
 * both are counted rather than left to the reviewer's eye.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         /*
          * Which element is widest, not only by how much.
          *
          * The number alone has cost several sessions the same investigation.
          * It is per-element scrollWidth minus clientWidth, so anything that
          * clips itself reports its full content width as an "overflow" —
          * span.visually-hidden has produced a standing 150/175px red herring
          * for months, and MAR-609 moved it to 444 simply by giving the status
          * pill a longer screen-reader sentence. Nothing overflowed; a hidden
          * span got wordier.
          *
          * So the source travels with the number. A reviewer reading
          * "span.visually-hidden" next to 444 stops there; one reading 444 on
          * its own goes looking for a layout defect that is not there.
          * page_overflows below is still the question that matters — it asks
          * the document, and it is what a person would actually see.
          */
         let widest = 0;
         let widestSource = "none";
         for (const node of document.querySelectorAll("*")) {
           const gap = node.scrollWidth - node.clientWidth;
           if (gap > widest) {
             widest = gap;
             const cls = typeof node.className === "string" ? node.className.trim() : "";
             widestSource =
               node.tagName.toLowerCase() + (cls === "" ? "" : "." + cls.split(/\\s+/).join("."));
           }
         }
         const text = document.body.innerText;
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           deploy_sections: document.querySelectorAll(".deploy-section").length,
           deploy_panels: document.querySelectorAll(".deploy-panel").length,
           deploy_outcomes: document.querySelectorAll(".deploy-outcome").length,
           says_refusal: text.includes("build lives outside DASH"),
           says_runs_here: text.includes("runs on this computer"),
           /*
            * MAR-591's own three counters, and the second is the load-bearing
            * one. A notice that rendered blank, or one whose lines scrolled
            * below the fold, photographs exactly like a notice that is not
            * there — and the whole issue is a sentence being on screen before
            * somebody presses a button.
            */
           travel_notices: document.querySelectorAll(".travel-notice").length,
           travel_lines: document.querySelectorAll(".travel-notice li").length,
           travel_reasons: document.querySelectorAll(".travel-notice > p").length,
           /*
            * A phrase from the notice's own headlines, not a service name. The
            * first run of this scene looked for "Your Gmail" and read false on
            * twenty-four frames that all showed the notice: the label is the
            * *author's*, and the shipped example calls it "Gmail".
            */
           says_stranded:
             text.includes("cannot send to") || text.includes("stays on this computer"),
           deploy_button_disabled:
             [...document.querySelectorAll("button")].some(
               (node) => node.textContent.includes("Put") && node.disabled,
             ),
           widest_overflow: widest,
           widest_overflow_source: widestSource,
         };
       })()`,
    ),
  );
}

/* ---------------------------------------------------------------------- *
 * The surfaces this scene has
 * ---------------------------------------------------------------------- */

interface Surface {
  name: string;
  route: string;
  /** Run before each photograph, after the page has loaded at this width. */
  prepare?: (target: BrowserWindow) => Promise<void>;
  focus: string;
}

function surfaces(): Surface[] {
  const agentRoute = (agent: string): string => `/agents/detail?agent=${encodeURIComponent(agent)}`;
  const list: Surface[] = [
    {
      name: "agent-deploy",
      route: agentRoute(SENDABLE),
      focus: ".deploy-section",
    },
    /*
     * MAR-609's four, and every one of them is of an agent that has produced
     * nothing.
     *
     * That is not a limitation of this scene, it is the scene's value here. The
     * issue's closing note is that *"an agent with no output currently renders
     * a page full of prose"* and that whatever replaces it *"should be sized
     * for the empty case first — that is the state every new user meets."*
     * `SENDABLE` is imported with a manifest and a folder and has never run, so
     * these frames are that exact state, photographed at both themes and both
     * densities by the loop that owns them.
     *
     * Four rather than one because the page is now four distinct things and a
     * single top-of-page frame would prove only the first: the header and its
     * controls, the outputs area's empty state, the settings drawer somebody
     * has to press to see, and the record everything else folded into.
     */
    {
      name: "agent-overview",
      route: agentRoute(SENDABLE),
      // The header rather than the body: this frame is the answer to "you get
      // no overview", so its subject is the block that now carries the name,
      // the status, the controls and the four tiles.
      focus: ".agent-header",
    },
    {
      name: "agent-empty-outputs",
      route: agentRoute(SENDABLE),
      /*
       * Focused on the heading rather than the section, for the reason
       * MAR-591's `.travel-notice` frames record: at 375px a section-scoped
       * scroll puts the subject below the fold and files a photograph of
       * something else under its name. This empty state is two short lines and
       * it is the most-read copy on this page.
       */
      focus: "#outputs-heading",
    },
    {
      name: "agent-settings",
      route: agentRoute(SENDABLE),
      // Pressed, not URL-forced. The drawer is `useState` in the page and there
      // is no route to it, so a harness that could not click the button could
      // not photograph the feature — which makes the frame a check that the
      // button works as well as a picture of what it opens.
      prepare: async (target) => {
        await clickByText(target, "Settings");
      },
      focus: ".agent-settings",
    },
    {
      name: "agent-record",
      route: agentRoute(SENDABLE),
      /*
       * The disclosure opened, because a closed `<details>` photographs as one
       * grey line and would prove only that the summary exists. What is being
       * checked is that everything MAR-609 folded away is still *there* — the
       * permission receipt and the whole workspace record — which is the claim
       * that this was a move rather than a deletion.
       *
       * `open` is set directly rather than clicked: `<summary>` is not a
       * `<button>`, so `clickByText` cannot reach it, and setting the property
       * is what the element's own click does.
       */
      prepare: async (target) => {
        await target.webContents.executeJavaScript(
          `(() => {
             const box = document.querySelector("details.agent-record");
             if (box !== null) box.open = true;
             return box !== null;
           })()`,
        );
        await settle(300);
      },
      focus: ".agent-record",
    },
  ];
  if (SCENE === "one-server") {
    /*
     * Photographed in this scene only, and not because it is less important.
     * The refusal branch returns before the section looks at the host table at
     * all, so the other two scenes would produce the same image under a
     * different folder name — and a set of identical pictures filed as three
     * states is how a reviewer comes to believe three things were checked.
     */
    list.push({
      name: "agent-refused",
      route: agentRoute(MIGRATED),
      focus: ".deploy-section",
    });
    list.push({
      name: "servers-refused",
      route: "/settings/servers",
      prepare: async (target) => {
        await clickByText(target, "Put an agent here");
        await chooseAgent(target, MIGRATED);
      },
      focus: ".deploy-panel",
    });
    list.push({
      name: "servers-chosen",
      route: "/settings/servers",
      prepare: async (target) => {
        await clickByText(target, "Put an agent here");
        await chooseAgent(target, SENDABLE);
      },
      focus: ".deploy-panel",
    });
  }
  if (SCENE === "stranded") {
    /*
     * MAR-591's four, and they are four rather than two because the issue's own
     * requirement is that **both** entry points say it. A pair of images from
     * the agent page alone would prove the sentence exists and nothing about
     * whether the server card shows it.
     */
    /*
     * Focused on `.travel-notice` rather than on the section, unlike every
     * surface above. The first run of this scene scrolled to the section and the
     * notice was below the fold at 375 in all four frames — twelve photographs
     * of a receipt, filed under names claiming to show the thing this issue
     * added. `focus` exists to make a viewport-sized image be of its subject.
     */
    list.push({
      name: "agent-warned",
      route: agentRoute(STRANDED),
      focus: ".travel-notice",
    });
    list.push({
      name: "agent-blocked",
      route: agentRoute(BLOCKED),
      focus: ".travel-notice",
    });
    list.push({
      name: "servers-warned",
      route: "/settings/servers",
      prepare: async (target) => {
        await clickByText(target, "Put an agent here");
        await chooseAgent(target, STRANDED);
      },
      focus: ".travel-notice",
    });
    list.push({
      name: "servers-blocked",
      route: "/settings/servers",
      prepare: async (target) => {
        await clickByText(target, "Put an agent here");
        await chooseAgent(target, BLOCKED);
      },
      focus: ".travel-notice",
    });
  }
  return list;
}

/**
 * A deploy that really runs, photographed twice.
 *
 * Pressed on the agent's own page against a seeded address that routes nowhere,
 * so the whole path executes — preload, main's review and audit, the bundle
 * producer reading a real folder, `ssh` spending its connect timeout — and the
 * two frames are the two states DASH actually shows for it. The finished one is
 * absent for the reason in this file's header.
 */
async function pressDeploy(target: BrowserWindow, theme: string): Promise<void> {
  await go(target, `/agents/detail?agent=${encodeURIComponent(SENDABLE)}`);
  await resizeTo(target, 1280, 900);
  await scrollTo(target, ".deploy-section");
  if (!(await clickByText(target, "Put News Scout on"))) {
    console.log("[deploy] no deploy control to press — skipping the in-flight frames");
    return;
  }
  await scrollTo(target, ".deploy-outcome");
  await shoot(target, `deploy-inflight-1280-${theme}-comfortable`);

  // `ssh`'s connect timeout is ten seconds; wait past it for the answer rather
  // than photographing the same frame twice under two names.
  await settle(20_000);
  await scrollTo(target, ".deploy-outcome");
  const said = (await target.webContents.executeJavaScript(
    `document.querySelector(".deploy-outcome")?.innerText ?? null`,
  )) as string | null;
  console.log(`[deploy] the outcome now reads: ${JSON.stringify(said)}`);
  await shoot(target, `deploy-failed-1280-${theme}-comfortable`);
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

    for (const surface of ONLY === "deploy" ? [] : surfaces()) {
      for (const viewport of VIEWPORTS) {
        for (const density of DENSITIES) {
          await go(window, surface.route);
          const at = await resizeTo(window, viewport.width, viewport.height);
          // Reloaded after the resize as well: a page reads its view once, on
          // mount, and a layout settled at the previous width would be
          // photographed under this width's filename.
          await go(window, surface.route);

          if (density === "compact" && (await pressDensityToggle(window)) === null) {
            console.log(`[deploy] no density control at ${viewport.name} — compact frame skipped`);
            continue;
          }
          await surface.prepare?.(window);
          const focused = await scrollTo(window, surface.focus);
          const measured = await layout(window);
          measurements.push({
            scene: SCENE,
            surface: surface.name,
            viewport: viewport.name,
            theme,
            density,
            focused,
            ...(measured as object),
          });
          console.log(
            `[deploy] ${surface.name} ${viewport.name}/${theme}/${density} ` +
              `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
          );
          await shoot(window, `${surface.name}-${viewport.name}-${theme}-${density}`);

          if (density === "compact") {
            // Back to comfortable, so the next surface starts where this one
            // did — the preference is stored and survives navigation.
            await pressDensityToggle(window);
          }
        }
      }
    }

    if (SCENE === "one-server") {
      await pressDeploy(window, theme);
    }
  }

  // Not written by a `deploy`-only run: it would replace a full scene's
  // measurements with the two frames that run happened to take, which is a
  // record that reads as a scene nobody photographed.
  if (ONLY !== "deploy") {
    writeFileSync(
      path.join(OUT, "layout.json"),
      `${JSON.stringify({ scene: SCENE, captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
      "utf8",
    );
  }

  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  const refusals = measurements.filter(
    (entry) =>
      (entry as { surface: string }).surface.endsWith("refused") &&
      !(entry as { says_refusal: boolean }).says_refusal,
  );
  /*
   * MAR-591's own two, in the shape MAR-583's witness earned its keep in: a
   * frame filed under `agent-warned` that carries no notice, and a frame filed
   * under `agent-blocked` whose button is still pressable, are both pictures of
   * the feature not working that look exactly like pictures of it working.
   */
  const silent = measurements.filter((entry) => {
    const one = entry as { surface: string; travel_lines?: number };
    return (
      (one.surface.endsWith("warned") || one.surface.endsWith("blocked")) &&
      (one.travel_lines ?? 0) === 0
    );
  });
  const pressable = measurements.filter((entry) => {
    const one = entry as { surface: string; deploy_button_disabled?: boolean };
    return one.surface.endsWith("blocked") && one.deploy_button_disabled !== true;
  });
  console.log(
    `\n[deploy] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[deploy] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[deploy] ${refusals.length === 0 ? "every refusal frame carries the refusal" : `${String(refusals.length)} REFUSAL FRAMES DID NOT SAY IT`}\n` +
      `[deploy] ${silent.length === 0 ? "every stranded frame carries its lines" : `${String(silent.length)} STRANDED FRAMES SAID NOTHING`}\n` +
      `[deploy] ${pressable.length === 0 ? "no blocked frame left the deploy pressable" : `${String(pressable.length)} BLOCKED FRAMES LEFT IT PRESSABLE`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[deploy] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
