/**
 * Screenshots of the folder-update surface, in the real shell (MAR-584).
 * **Not part of the shipped shell.**
 *
 * `electron/capture.ts` photographs whatever the machine happens to hold, which
 * is the wrong harness here for `electron/capture-deploy.ts`'s reason and a
 * sharper version of it: **what this section draws is decided entirely by a
 * disagreement between two things on disk.** A run against a real store
 * photographs an agent whose folder nobody has touched, which is one of five
 * states and the least interesting one.
 *
 * So this points the same real renderer at a store this run seeds, and is run
 * once per scene:
 *
 * - `unchanged` — a folder that still holds the bytes DASH accepted.
 * - `changed`   — two sources added and a schedule arrived, which is Henrik's
 *                 own sentence for the whole feature.
 * - `invalid`   — an edit that is legal JSON and not an agent, so the contract
 *                 checker's own words are on screen and nothing is offered.
 * - `behind`    — the same agent, changed, with a server DASH pushed it to
 *                 before the change (ADR 0010).
 *
 * ## What is real here, and the one thing that is not
 *
 * Real: the packaged renderer and its compiled stylesheet, the `dash-app://ui/`
 * routes, `workspaceView()` arriving over the read channel, the agent folder on
 * disk, the registration's recorded baseline, **the button press** — every frame
 * with a report in it was produced by clicking "Check for changes" and letting
 * it go through preload, main's review and audit, `readStoredFileDigests` and
 * `describeFolderChanges` — `app/tokens.css` resolved against a `color-scheme`
 * the operating system's own signal moved, and the density attribute written by
 * pressing the real control.
 *
 * Not real, and stated rather than left for a reader of the PNGs to infer:
 * **whose data it is.** The store is a scratch directory this run seeded, and
 * the edits were made by this file rather than by Claude Code. What that costs
 * is nothing about the surface — DASH cannot tell which editor wrote a file, and
 * that is the point of comparing bytes — but a reader should not take these for
 * photographs of somebody's machine.
 *
 * The `behind` scene's deploy row is a real `agent_deploys` record written by
 * `recordAgentDeploy`, with digests that genuinely disagree with the agent's
 * current baseline. What is *not* proven by that frame is a push to a real
 * server, which is MAR-489's attended run.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-changed'
 *     $env:DASH_CAPTURE_SCENE='changed'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar584/changed'
 *     pnpm exec electron dist/electron/capture-folder.mjs
 *
 * Every line is load-bearing and each has cost a session before — see
 * `electron/capture-deploy.ts`'s header for what each one prevents. A fresh
 * `DASH_DATA_DIR` **per scene** matters more here than there: the scenes differ
 * only in what is on disk, so re-using a directory photographs the previous
 * scene under this one's name.
 *
 * Never on the `electron .` path and named by no `package.json` script, on
 * `electron/capture.ts`'s own terms: this produces evidence, never a verdict.
 *
 * ## What it leaves behind, said out loud
 *
 * Importing `./main.js` starts a **runner** against the scratch store, and
 * `app.exit(0)` does not stop it. Each run leaves one live runner holding a
 * scratch store, exactly as the other capture harnesses do. Run this when you
 * are about to review images, not when you are about to run the gate, and name
 * the leftover processes in whatever you write afterwards.
 */

/*
 * `electron/smoke-identity.ts` is deliberately not imported, for
 * `electron/capture-deploy.ts`'s reason: borrowing the app's name borrows its
 * single-instance lock, which would mean this could only run with DASH closed.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  agentFolderCodePath,
  agentFolderManifestPath,
  storedFileDigests,
} from "../lib/agent-folders.js";
import { dataDir } from "../lib/db.js";
import { writeRegistration } from "../lib/registration.js";
import { importManifest, recordAgentDeploy, saveHost } from "../lib/store.js";
import { createHostKey } from "./ssh-host.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar584");
const SCENE = process.env.DASH_CAPTURE_SCENE ?? "changed";

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

const AGENT = "news-scout";
const TITLE = "News Scout";

/** The three the scout ships with, as its sources file holds them. */
const ORIGINAL_SOURCES = [
  { name: "Google News", url: "https://news.example/rss", format: "rss" },
  { name: "Hacker News", url: "https://hn.example/search", format: "hn_algolia" },
  { name: "arXiv", url: "https://arxiv.example/query", format: "atom" },
];

/** What an editor asked for: two more sites to watch. */
const EDITED_SOURCES = [
  ...ORIGINAL_SOURCES,
  { name: "Ars Technica", url: "https://ars.example/rss", format: "rss" },
  { name: "The Verge", url: "https://verge.example/rss", format: "rss" },
];

const PROGRAM = "process.stdout.write('ready')\n";

function sourcesJson(sources: unknown): string {
  return `${JSON.stringify({ sources }, null, 2)}\n`;
}

/**
 * The **v2** example, and that is load-bearing rather than incidental.
 *
 * `agent.manifest.example.json` is a v1 document with no Agent DOM block in it,
 * so it has no trigger — and half of the sentence this whole issue is about is
 * *"and changes the schedule"*, which lives in `agent_dom.trigger`. The first
 * run of this harness used the v1 example and produced a scene where the
 * schedule half was simply absent, with no error: the manifest was edited, the
 * edit changed nothing, and the frames looked correct.
 */
function scratchManifest(over: { schedule?: boolean } = {}): Record<string, unknown> {
  const source = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "examples", "agent-managed.manifest.v2.example.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const agent = source["agent"] as Record<string, unknown>;
  agent["name"] = AGENT;
  agent["display_name"] = TITLE;
  agent["goal"] = "Reads the news sources you choose and writes you a short summary.";
  if (over.schedule === true) {
    const dom = source["agent_dom"] as Record<string, unknown>;
    dom["trigger"] = {
      type: "schedule",
      label: "every morning",
      expected_interval_seconds: 86_400,
    };
  }
  return source;
}

/**
 * Seed the store this run was pointed at, then stage this scene's edit.
 *
 * The import and the registration are the ordinary handoff path's two writes in
 * the order `lib/handoff-flow.ts` performs them, so the baseline recorded here
 * is the same baseline a real "Open in DASH" records. Only after that does the
 * scene reach into the folder — which is the whole shape of the feature: DASH
 * accepted something, and then something outside DASH changed it.
 */
function seed(): void {
  const manifest = scratchManifest();
  const manifestJson = JSON.stringify(manifest);
  const files = [
    { path: "agent.manifest.json", contents: manifestJson },
    { path: "agent.mjs", contents: PROGRAM },
    { path: "sources.json", contents: sourcesJson(ORIGINAL_SOURCES) },
  ];

  importManifest(manifest, {
    manifestJson,
    registration: {
      agent_id: AGENT,
      manifest_path: "agent.manifest.json",
      command: "node",
      args: ["agent.mjs"],
      cwd: "code",
      env: {},
    },
    files,
  });

  writeRegistration(dataDir, {
    registration: {
      agent_id: AGENT,
      manifest_path: agentFolderManifestPath(dataDir, AGENT),
      command: "node",
      args: ["agent.mjs"],
      cwd: agentFolderCodePath(dataDir, AGENT),
      env: {},
    },
    ownership: {
      owner: "dash_handoff",
      display_name: TITLE,
      summary: "Reads the news sources you choose.",
      registered_at: "2026-08-09T09:00:00.000Z",
    },
    manifestJson,
    storedManifestPath: agentFolderManifestPath(dataDir, AGENT),
    acceptedFiles: storedFileDigests(files),
    acceptedSources: ORIGINAL_SOURCES.map((source) => source.name),
  });

  const sourcesPath = path.join(agentFolderCodePath(dataDir, AGENT), "sources.json");

  if (SCENE === "changed" || SCENE === "behind") {
    // Two sources added and a schedule arrived — the two halves of the sentence
    // the issue was opened for, and they come from two different files, which
    // is the reason the detector reads both.
    writeFileSync(sourcesPath, sourcesJson(EDITED_SOURCES), "utf8");
    writeFileSync(
      agentFolderManifestPath(dataDir, AGENT),
      JSON.stringify(scratchManifest({ schedule: true }), null, 2),
      "utf8",
    );
  }

  if (SCENE === "invalid") {
    /*
     * Legal JSON, and not an agent. The goal is gone, which is a required
     * property — so this reaches the schema rather than the parser, and the
     * frame shows the contract checker's own pointer rather than "that file is
     * not valid JSON".
     */
    const broken = scratchManifest();
    delete (broken["agent"] as Record<string, unknown>)["goal"];
    writeFileSync(
      agentFolderManifestPath(dataDir, AGENT),
      JSON.stringify(broken, null, 2),
      "utf8",
    );
  }

  if (SCENE === "behind") {
    createHostKey(dataDir, "scene-1");
    saveHost({
      host_id: "scene-1",
      label: "My server",
      address: "192.0.2.1",
      port: 22,
      username: "root",
      key_name: "scene-1",
      host_fingerprint: "SHA256:scene1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      added_at: "2026-08-07T09:00:00.000Z",
    });
    /*
     * A real record of a real shape, with digests that genuinely disagree with
     * what this agent is now. Written directly rather than by pushing, because
     * pushing needs a server that accepts a bundle — MAR-489's attended run —
     * and a harness may not invent one. What this frame proves is the sentence
     * DASH derives from its own record, which is the part ADR 0010 is about.
     */
    recordAgentDeploy(
      {
        agent: AGENT,
        host_id: "scene-1",
        manifest_sha256: "0".repeat(64),
        files_sha256: "1".repeat(64),
      },
      "2026-08-07T09:05:00.000Z",
    );
  }

  console.log(`[folder] seeded scene ${SCENE}`);
}

/* ---------------------------------------------------------------------- *
 * The harness — the same guards `electron/capture-deploy.ts` earned
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

async function shoot(target: BrowserWindow, name: string): Promise<void> {
  const image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[folder] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

/** A maximized window reports the screen's width back — see `capture-deploy.ts`. */
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
  await settle(700);
  return clicked;
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
 * `report_present` is the one that matters: a frame taken before the answer came
 * back looks exactly like a frame of a surface that never produced one, and
 * three of these scenes are entirely about the answer. `says_*` counts the
 * scene's own sentence for the same reason `capture-deploy.ts` counts its
 * refusal — a sentence that scrolled below the fold and a sentence that was
 * never rendered are the same photograph.
 *
 * `innerText` uppercases nothing here, but it is worth remembering that it
 * reflects `text-transform`: these are all sentence-case paragraphs rather than
 * chips, which is why a plain `includes` is safe.
 *
 * `says_schedule` looks for the sentence a *newly added* schedule produces,
 * which is what these scenes stage. The changed-schedule line has different
 * words, and a measurement written against those would have read false on a
 * frame that was perfectly correct — the failure mode this whole block exists
 * to prevent, one level up.
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
         const text = document.body.innerText;
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           folder_sections: document.querySelectorAll(".folder-update").length,
           report_present: document.querySelectorAll(".folder-report").length,
           sent_servers: document.querySelectorAll(".sent-server").length,
           says_unchanged: text.includes("is the one DASH accepted"),
           says_changed: text.includes("has been changed since DASH accepted it"),
           says_sources: text.includes("It now reads 2 more sources"),
           says_schedule: text.includes("It now runs on its own"),
           says_invalid: text.includes("cannot be read as an agent"),
           says_untouched: text.includes("still the version you approved"),
           says_not_watching: text.includes("does not watch this folder"),
           says_behind: text.includes("That copy is not this agent any more"),
           says_not_asked: text.includes("has not asked"),
           widest_overflow: widest,
         };
       })()`,
    ),
  );
}

/* ---------------------------------------------------------------------- *
 * The surfaces this scene has
 * ---------------------------------------------------------------------- */

const ROUTE = `/agents/detail?agent=${encodeURIComponent(AGENT)}`;

interface Surface {
  name: string;
  prepare?: (target: BrowserWindow) => Promise<void>;
  focus: string;
}

function surfaces(): Surface[] {
  /*
   * The press happens per frame, after the resize and the reload, because both
   * of those reset the component's state — a report captured before a resize
   * would not be on screen after it, and the filename would claim a width the
   * picture never showed an answer at.
   */
  const check = async (target: BrowserWindow): Promise<void> => {
    if (!(await clickByText(target, "Check for changes"))) {
      console.log("[folder] no check control to press at this width");
      return;
    }
    // The whole path runs behind this: preload, main's review and audit, the
    // folder read, the digest walk and the comparison. It is fast, and waiting
    // past it is cheaper than photographing a pending button.
    await settle(900);
  };

  const list: Surface[] = [
    { name: "folder-before", focus: ".folder-update" },
    { name: "folder-checked", prepare: check, focus: ".folder-report" },
  ];
  if (SCENE === "behind") {
    // Photographed in this scene only: the block draws nothing at all when DASH
    // has never sent this agent anywhere, so the other scenes would produce the
    // same picture under a different name.
    list.push({ name: "sent-servers", focus: ".sent-servers" });
  }
  return list;
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

    for (const surface of surfaces()) {
      for (const viewport of VIEWPORTS) {
        for (const density of DENSITIES) {
          await go(window, ROUTE);
          const at = await resizeTo(window, viewport.width, viewport.height);
          // Reloaded after the resize as well: a page reads its view once, on
          // mount, and a layout settled at the previous width would be
          // photographed under this width's filename.
          await go(window, ROUTE);

          if (density === "compact" && (await pressDensityToggle(window)) === null) {
            console.log(`[folder] no density control at ${viewport.name} — compact frame skipped`);
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
            `[folder] ${surface.name} ${viewport.name}/${theme}/${density} ` +
              `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
          );
          await shoot(window, `${surface.name}-${viewport.name}-${theme}-${density}`);

          if (density === "compact") {
            await pressDensityToggle(window);
          }
        }
      }
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ scene: SCENE, captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  /*
   * A checked frame with no report in it is the failure this harness is most
   * likely to produce and least likely to be noticed for: the picture looks like
   * a perfectly good screenshot of the section before anybody pressed anything.
   */
  const silent = measurements.filter(
    (entry) =>
      (entry as { surface: string }).surface === "folder-checked" &&
      (entry as { report_present: number }).report_present === 0,
  );
  console.log(
    `\n[folder] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[folder] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[folder] ${silent.length === 0 ? "every checked frame carries an answer" : `${String(silent.length)} CHECKED FRAMES HAD NO ANSWER`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[folder] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
