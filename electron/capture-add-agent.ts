/**
 * Screenshots of MAR-598's Add agent page. **Not part of the shipped shell.**
 *
 * ## Why this is its own harness rather than a scene on `electron/capture.ts`
 *
 * `electron/capture-settings-polish.ts`'s reason, verbatim, and this file is
 * that one's shape applied to the page it deliberately left out. `capture.ts`
 * imports `smoke-identity.js` first, which calls `app.setName("orchestratedash")`
 * so its single-instance lock and default `userData` match the installed app's.
 * That is right for a normal session and wrong for this one: this runs beside a
 * live DASH, in its own worktree, and a capture process claiming the real app's
 * identity would either fight it for the lock or — if `DASH_DATA_DIR` were
 * forgotten once — write into the real store.
 *
 * It is also not a fourth entry on `capture-settings-polish.ts`'s `PAGES`. That
 * harness is MAR-599's evidence and its own header records that Add agent was
 * excluded because it was under Henrik's hold. Adding this page to it would
 * relabel a merged issue's screenshots as covering something they never did.
 *
 * ## What the scenes are, and why the disclosures are two of them
 *
 * The whole claim of this issue is an **order**: choosing a folder leads, and
 * the two terminal commands are still reachable underneath. A closed disclosure
 * photographs as a one-line summary, so a sweep that only ever shot the page as
 * it loads would prove the first half and say nothing about the second. Each
 * disclosure therefore gets a frame with it open.
 *
 * ## Run it
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-add-agent'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar598'
 *     pnpm exec electron dist/electron/capture-add-agent.mjs
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

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar598");

const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

const ADD_AGENT = "/settings/add-agent";

/**
 * The three states of the one page this issue touched.
 *
 * `open` names which disclosure to expand before the shot — by its summary text,
 * because the markup carries no id and matching on the words a person reads is
 * the check that fails if the copy silently changes.
 */
const SCENES = [
  { name: "add-agent", open: null },
  /*
   * MAR-879. The builder's setup line, which is a disclosure for the same
   * reason the two below are: it is done once. A sweep that only shot the page
   * as it loads would photograph three headings and prove nothing about the one
   * path that has something to reveal.
   */
  {
    name: "add-agent-assistant",
    open: "The builder is a plugin for your coding assistant",
  },
  { name: "add-agent-scaffold", open: "Building an agent from scratch?" },
  { name: "add-agent-plan", open: "I have a plan file instead of a folder" },
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
    // Deterministic rather than flaky: the first attempt after a shrink fails,
    // and showing the window then retrying is what gets the frame.
    console.log(
      `[add-agent]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(`capturePage retry for ${name}`, 20_000, target.webContents.capturePage());
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[add-agent] ${name}.png ${String(size.width)}x${String(size.height)}`);
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
 * Expand one disclosure, found by the words on its own summary.
 *
 * The summary text is passed in as a plain string and compared with `includes`
 * rather than interpolated into a selector or a regular expression. A template
 * literal carrying a pattern is how an injected page script silently split on
 * the letter s once already; there is no pattern here at all.
 */
async function openDisclosure(target: BrowserWindow, summary: string): Promise<boolean> {
  const opened = (await target.webContents.executeJavaScript(
    `(() => {
       const wanted = ${JSON.stringify(summary)};
       for (const element of document.querySelectorAll("details")) {
         const label = element.querySelector("summary");
         if (label !== null && label.textContent.includes(wanted)) {
           element.open = true;
           return true;
         }
       }
       return false;
     })()`,
  )) as boolean;
  await settle(500);
  return opened;
}

/**
 * The checks this issue is actually about.
 *
 * `primary_is_choose_folder` is the claim in one boolean: the page's first
 * control says "Choose a folder". `command_above_fold` is its inverse and the
 * defect being repaired — a terminal command in the first screenful. Both are
 * read from the rendered document rather than inferred from the image, because
 * a screenshot proves what a page looks like and a measurement proves what is
 * on it.
 *
 * `page_overflows` is kept from the harness this follows. It is the axis every
 * existing capture measures, and the one this page could newly break: the
 * receipt contains a folder path, which is a single unbreakable token.
 *
 * ## Why the command block is found by asking its disclosure, not by geometry
 *
 * Two geometric versions of this measurement were written before this one and
 * **both reported the defect being repaired on a page that did not have it.**
 *
 * The first used `getBoundingClientRect().top`, on the assumption that a closed
 * disclosure's contents are `display: none` and therefore have an all-zero rect
 * — a top of zero being above every fold there has ever been. The second used
 * `getClientRects().length`, on the assumption that an element with no boxes has
 * no rects. Twelve frames failed identically both times.
 *
 * The assumption is out of date. Current Chromium implements a closed
 * `<details>` with `content-visibility: hidden` rather than `display: none`, so
 * the contents keep their layout boxes and answer both questions as though they
 * were on screen. What is actually being asked is whether the disclosure holding
 * the commands is open, so that is what is asked. A measurement that agrees with
 * the screenshots is worth more than one that is clever about pixels.
 *
 * The explanation lives here rather than beside the line, because the line is
 * inside a template literal and a backtick in a comment closes it — the same
 * class of trap as a regular expression's backslashes in an injected script.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const h1 = document.querySelector("main h1, h1");
         const primary = document.querySelector("main button.button-primary");
         const pre = document.querySelector("main pre");
         const holder = pre === null ? null : pre.closest("details");
         const shown = pre !== null && (holder === null || holder.open === true);
         const preTop = shown ? pre.getBoundingClientRect().top : null;
         return {
           viewport: window.innerWidth,
           // Read back from the document rather than trusted from the loop, so a
           // frame labelled compact that is not one shows up in the record.
           // "comfortable" is the *absence* of the attribute — the script in the
           // document head only writes it for compact — so an unset value is
           // named here rather than left as a null a reader has to interpret.
           density: root.getAttribute("data-density") === "compact" ? "compact" : "comfortable",
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           heading_text: h1 === null ? null : h1.textContent,
           primary_label: primary === null ? null : primary.textContent,
           // MAR-879. The page offers three doors now, so the claim is no
           // longer "the first control chooses a folder" — it is that all three
           // are on the page and the folder chooser is still one of them. The
           // old boolean is kept beside the new ones so a reader comparing this
           // record with MAR-598's can see which claim changed and when.
           primary_is_choose_folder:
             primary !== null && primary.textContent.trim() === "Choose a folder",
           path_headings: Array.from(document.querySelectorAll("main .add-agent-path > h2")).map(
             (heading) => heading.textContent,
           ),
           paths_offered: document.querySelectorAll("main .add-agent-path").length,
           command_visible: shown,
           command_above_fold: preTop !== null && preTop < window.innerHeight,
           agent_links: document.querySelectorAll("main a[href^='/agents']").length,
         };
       })()`,
    ),
  );
}

/**
 * Force the ambient density to comfortable before the loop starts.
 *
 * `localStorage` lives in Electron's session partition, not in `DASH_DATA_DIR`,
 * so it is shared by every unpackaged capture process that ever ran against this
 * machine's default `Electron` userData directory. A prior run left "compact"
 * behind once and the first "comfortable" frame was captured compact — a wrong
 * label nobody would catch from the image alone. This reads the attribute and
 * presses the control only if it disagrees with what the loop assumes.
 */
async function ensureComfortable(target: BrowserWindow): Promise<void> {
  const current = (await target.webContents.executeJavaScript(
    `document.documentElement.getAttribute("data-density")`,
  )) as string | null;
  if (current === "compact") {
    console.log("[add-agent] ambient density was compact from a prior run — resetting");
    await pressDensityToggle(target);
  }
}

/**
 * The same page at the two UI scales MAR-879 names (MAR-879).
 *
 * ## Why this is a zoom factor and never a preference
 *
 * DASH's UI scale is `webContents.setZoomFactor` — `applyUiScale` in
 * `electron/main.ts` sets it and *also* writes the chosen value into the user's
 * profile. This calls only the first half, deliberately. The audit that
 * produced this packet was taken at 80%, and the packet's own rule is that DASH
 * must not answer that by changing a setting somebody chose; a harness that
 * proved the fix by writing the preference would be demonstrating the defect it
 * was photographing.
 *
 * Two widths rather than three and one density rather than two, because the
 * question this pass answers is narrower than the sweep above it: whether the
 * three doors and their prose survive a scale change. `page_overflows` is the
 * measurement that can go red, and 375 at 80% is a wider layout than 375 at
 * 100%, which the sweep has already shot.
 *
 * The zoom is put back to 1 afterwards for the same reason the density is: the
 * next thing to run against this profile should not inherit it.
 */
async function scaleSweep(target: BrowserWindow): Promise<void> {
  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    for (const viewport of [VIEWPORTS[0], VIEWPORTS[1]] as const) {
      for (const scale of [0.8, 1] as const) {
        /*
         * Back to 1 before measuring the window, and it cost a run to learn.
         *
         * `resizeTo` sets the *content* size in device-independent pixels and
         * then checks `window.innerWidth`, which is in CSS pixels — and zoom is
         * exactly the ratio between them. At 0.8 a 1280-wide window reports
         * 1599, the check never converges, and the harness dies with "the page
         * reports 1599px" on the second pass rather than the first. So the
         * window is resized unzoomed and zoomed afterwards, which is also the
         * order a person does it in.
         */
        target.webContents.setZoomFactor(1);
        await go(target, ADD_AGENT);
        await resizeTo(target, viewport.width, viewport.height);
        target.webContents.setZoomFactor(scale);
        await go(target, ADD_AGENT);
        await settle(600);
        const measured = await layout(target);
        measurements.push({
          scene: "add-agent-scale",
          ui_scale: scale,
          theme,
          labelled: "comfortable",
          disclosure_opened: null,
          ...(measured as object),
        });
        await shoot(target, `add-agent-scale${String(scale * 100)}-${viewport.name}-${theme}`);
      }
    }
  }
  target.webContents.setZoomFactor(1);
  await settle(300);
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);
  await go(window, ADD_AGENT);
  await ensureComfortable(window);

  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const scene of SCENES) {
      for (const viewport of VIEWPORTS) {
        for (const density of DENSITIES) {
          // Reloaded before and after the resize, for the reason
          // `capture-settings-polish.ts` does it: a page that was laid out at
          // the previous width and then had its window changed under it is not
          // the page this width produces.
          await go(window, ADD_AGENT);
          await resizeTo(window, viewport.width, viewport.height);
          await go(window, ADD_AGENT);

          if (density === "compact" && (await pressDensityToggle(window)) === null) {
            console.log(
              `[add-agent] no density control at ${scene.name}/${viewport.name} — compact skipped`,
            );
            continue;
          }

          const opened = scene.open === null ? null : await openDisclosure(window, scene.open);
          if (opened === false) {
            console.log(
              `[add-agent] DISCLOSURE NOT FOUND at ${scene.name}/${viewport.name}/${theme}/${density}`,
            );
          }

          const measured = await layout(window);
          measurements.push({
            scene: scene.name,
            viewport: viewport.name,
            theme,
            // What the filename claims, kept beside what the document reported —
            // the spread below carries `density`, read back from the page — so
            // the two can be compared rather than one silently overwriting the
            // other.
            labelled: density,
            disclosure_opened: opened,
            ...(measured as object),
          });
          console.log(
            `[add-agent] ${scene.name}/${viewport.name}/${theme}/${density} ${JSON.stringify(measured)}`,
          );
          await shoot(window, `${scene.name}-${viewport.name}-${theme}-${density}`);

          if (density === "compact") {
            await pressDensityToggle(window);
          }
        }
      }
    }
  }

  await scaleSweep(window);

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  const overflowed = measurements.filter((m) => (m as { page_overflows: boolean }).page_overflows);
  /*
   * MAR-879's claim, where MAR-598's used to be.
   *
   * MAR-598 asserted that the page's first control says "Choose a folder",
   * because the defect then was a page led by two terminal commands. The page
   * offers three doors now, so the claim that has to hold on every frame is
   * that all three are on it and the folder chooser is still one of them —
   * demoting a path and deleting it look identical in a screenshot, which is
   * the reason this harness exists at all.
   */
  const threeDoors = measurements.filter(
    (m) => (m as { paths_offered: number }).paths_offered !== 3,
  );
  const folderDoorMissing = measurements.filter(
    (m) =>
      !(m as { path_headings: string[] }).path_headings.some((heading) =>
        heading.includes("folder"),
      ),
  );
  const commandsAbove = measurements.filter(
    (m) => (m as { scene: string; command_above_fold: boolean }).scene === "add-agent" &&
      (m as { command_above_fold: boolean }).command_above_fold,
  );
  const listed = measurements.filter((m) => (m as { agent_links: number }).agent_links > 0);
  const disclosuresMissed = measurements.filter(
    (m) => (m as { disclosure_opened: boolean | null }).disclosure_opened === false,
  );
  /*
   * Every frame's filename checked against the document it actually
   * photographed.
   *
   * This is the one defect in this whole harness that an image cannot reveal:
   * the layout is legitimately the same shape at both densities, so a frame
   * named `-comfortable` that was captured compact looks entirely correct and is
   * simply mislabelled. It has happened before, from a density left behind in
   * the session partition by an unrelated run.
   */
  const mislabelled = measurements.filter(
    (m) => (m as { density: string; labelled: string }).density !== (m as { labelled: string }).labelled,
  );

  console.log(
    `\n[add-agent] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[add-agent] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[add-agent] ${threeDoors.length === 0 ? "every frame offers all three doors" : `${String(threeDoors.length)} FRAMES DO NOT OFFER THREE DOORS`}\n` +
      `[add-agent] ${folderDoorMissing.length === 0 ? "every frame still offers the folder chooser" : `${String(folderDoorMissing.length)} FRAMES LOST THE FOLDER DOOR`}\n` +
      `[add-agent] ${commandsAbove.length === 0 ? "no closed-page frame shows a command block" : `${String(commandsAbove.length)} FRAMES SHOW A COMMAND BLOCK UNPROMPTED`}\n` +
      `[add-agent] ${listed.length === 0 ? "no frame lists agents on the add page" : `${String(listed.length)} FRAMES LIST AGENTS`}\n` +
      `[add-agent] ${disclosuresMissed.length === 0 ? "every disclosure scene opened" : `${String(disclosuresMissed.length)} DISCLOSURES NOT FOUND`}\n` +
      `[add-agent] ${mislabelled.length === 0 ? "every frame's density matches its filename" : `${String(mislabelled.length)} FRAMES ARE MISLABELLED`}`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[add-agent] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
