/**
 * Screenshots of the text pass (MAR-614). **Not part of the shipped shell.**
 *
 * Henrik, on the issue: *"Alot of the text are like documentation. And alot of
 * text could be hoover info or something."* That is a complaint about density,
 * and a photograph of a dense page looks exactly like a photograph of a calm one
 * until you put them side by side — so this harness measures the density as well
 * as photographing it, and the numbers are the part that can go red.
 *
 * ## The measure this issue is actually about
 *
 * Every existing capture harness measures **width**: did the page overflow, did
 * a tile clip. Not one of them can see a wall of prose, because prose that
 * explains does not overflow — it reflows, and pushes the thing you came to
 * press off the bottom of the screen. So the number that matters here is
 * `words_above_first_action`: how much reading DASH puts between a person
 * arriving on a surface and the first control they can touch.
 *
 * `visible_prose_words` counts the same text a different way, and both of them
 * skip anything inside a **closed** `<details>` — which a naive walk would
 * count, because a closed disclosure keeps its layout boxes and its
 * `textContent`. A pass that moved prose behind a disclosure and then measured
 * it as still on screen would report no change and be wrong about its own work.
 *
 * ## What is real here, and what is not
 *
 * Real: the packaged renderer and its stylesheet, the `dash-app://ui/` routes,
 * the real views over the read channel, and the geometry the compositor actually
 * laid out. Not real: whose data it is. The store is a scratch directory this run
 * seeded from the shipped examples, so no frame here is a picture of Henrik's
 * agents.
 *
 * ## Run it
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-text-pass'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar614-before'
 *     pnpm exec electron dist/electron/capture-text-pass.mjs
 *
 * From **PowerShell**, with a visible, unoccluded window; DASH may stay open.
 * `DASH_DATA_DIR` and `DASH_CAPTURE_DIR` are both required in practice rather
 * than in code: two runs of this file sharing either one would have the second
 * overwrite the first's evidence, which for a before/after pass destroys the
 * only thing the run was for.
 *
 * Never on the `electron .` path and named by no `package.json` script: it
 * produces evidence, never a verdict (ADR 0004).
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { importManifest } from "../lib/store.js";

const OUT = path.resolve(
  process.cwd(),
  process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar614",
);

/** The two widths MAR-614 names. Nothing here is about the tablet middle. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

/**
 * Both, and only on the fleet (MAR-614 phase 2).
 *
 * Phase 1 forced comfortable and said why: it was measuring prose, and prose
 * does not know what the density is. This phase moves the spacing scale itself,
 * so the setting that spends that scale has to be in the evidence — and the
 * fleet is where it is visible, because `--density-gap` is what sits between
 * cards and there is only one surface with a lot of cards.
 *
 * The other pages stay at comfortable. Photographing all six twice would double
 * the run to prove a composition `tests/tokens.test.ts` already pins
 * structurally: the compact block may declare nothing but `--density-*`, and
 * every value in it must be a step on the spacing scale.
 */
const DENSITIES = ["comfortable", "compact"] as const;

/** The three layouts, from `lib/views/fleet-view.ts`. */
const FLEET_VIEWS = ["grid", "rows", "spotlight"] as const;

/** Written before the reload that reads them — see `applySettings`. */
const DENSITY_KEY = "dash.density";
const FLEET_VIEW_KEY = "dash.fleetView";

/** The agent whose page is photographed. Seeded below. */
const AGENT = "meeting-assistant";

/**
 * The surfaces the scale pass touches away from the fleet.
 *
 * Phase 1 excluded the fleet because a parallel session owned those files.
 * Phase 2 owns the fleet card's copy and the scale under every page, so the
 * fleet is added below as its own matrix rather than as a seventh entry here —
 * it is the one surface with a view *and* a density to vary.
 */
const PAGES = [
  { name: "connections", path: "/settings" },
  { name: "servers", path: "/settings/servers" },
  { name: "add-agent", path: "/settings/add-agent" },
  { name: "notifications", path: "/settings/notifications" },
  { name: "preferences", path: "/settings/preferences" },
  /*
   * MAR-641. Six entries where there was one, because the agent page is six
   * views now.
   *
   * This harness measures how much text a surface spends. After the cockpit
   * landed, the single route sees a sixth of the agent page's copy — which
   * would not have failed anything. It would have reported a text-removal pass
   * that had gone brilliantly, and that is the worst way for a measurement to
   * be wrong.
   */
  { name: "agent", path: `/agents/detail?agent=${encodeURIComponent(AGENT)}` },
  { name: "agent-run", path: `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=run` },
  { name: "agent-output", path: `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=output` },
  { name: "agent-chat", path: `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=chat` },
  {
    name: "agent-settings",
    path: `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=settings`,
  },
  { name: "agent-logs", path: `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=logs` },
] as const;

function example(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.resolve(process.cwd(), "examples", name), "utf8"),
  ) as Record<string, unknown>;
}

/**
 * Seed the store this run was pointed at.
 *
 * Two agents rather than one, because the Connections page groups by service and
 * a single agent would photograph a page that has no grouping to do. Both come
 * from shipped examples, so nothing here is a fixture invented to flatter the
 * result.
 */
function seed(): void {
  const gmail = example("gmail-meeting-assistant.manifest.v2.example.json");

  const meeting = JSON.parse(JSON.stringify(gmail)) as {
    agent: { name: string; display_name?: string };
  };
  meeting.agent.name = AGENT;
  meeting.agent.display_name = "Meeting Assistant";
  importManifest(meeting);

  const managed = example("agent-managed.manifest.v2.example.json") as {
    agent: { name: string; display_name?: string };
  };
  managed.agent.name = "invoice-reviewer";
  managed.agent.display_name = "Invoice Reviewer";
  importManifest(managed);

  /*
   * Three more, so the fleet is a fleet (MAR-614 phase 2).
   *
   * Two agents cannot photograph this issue. The grid's track is three across,
   * and `spotlight` draws a centre card with a leaning neighbour on each side —
   * with two agents there is no middle, and `app/globals.css` has a note saying
   * exactly that ("a fleet of two has a card that can never be centred"). Five
   * is the smallest number that fills a grid row and leaves the carousel
   * something to lean.
   *
   * Still nothing invented: each is a shipped example under a different name, so
   * the cards differ in what they declare rather than in fixture prose written
   * to make the frames look better than the product.
   */
  const extras = [
    ["dash-managed.manifest.v2.example.json", "expense-sorter", "Expense Sorter"],
    ["dash-managed-secret.manifest.v2.example.json", "inbox-triage", "Inbox Triage"],
    ["gmail-meeting-assistant.manifest.v2.example.json", "news-scout", "News Scout"],
  ] as const;
  for (const [file, name, display] of extras) {
    const extra = JSON.parse(JSON.stringify(example(file))) as {
      agent: { name: string; display_name?: string };
    };
    extra.agent.name = name;
    extra.agent.display_name = display;
    importManifest(extra);
  }

  console.log("[text-pass] seeded 5 agents from the shipped examples");
}

/* ---------------------------------------------------------------------- *
 * The harness — the guards the other capture files earned the hard way
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
 * `capturePage()` fails outright on the first attempt after a shrink — that is
 * deterministic rather than flaky, so the retry is the normal path at 375px
 * rather than an error case.
 */
async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    console.log(
      `[text-pass]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(`capturePage retry for ${name}`, 20_000, target.webContents.capturePage());
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[text-pass] ${name}.png ${String(size.width)}x${String(size.height)}`);
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
  await settle(1500);
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
 * Force the ambient density to comfortable before the loop starts.
 *
 * `localStorage` lives in Electron's session partition rather than in
 * `DASH_DATA_DIR`, so it is shared with every other unpackaged capture process
 * that has ever run on this machine. A prior run leaving "compact" behind would
 * make every frame here a picture of a setting this issue is not about, at a
 * word count that is not the default one.
 */
async function ensureComfortable(target: BrowserWindow): Promise<void> {
  const current = (await target.webContents.executeJavaScript(
    `document.documentElement.getAttribute("data-density")`,
  )) as string | null;
  if (current === "compact") {
    console.log("[text-pass] ambient density was compact from a prior run — resetting");
    await pressDensityToggle(target);
  }
}

/**
 * Put the window into one density and one fleet view, deliberately.
 *
 * Written to `localStorage` and then **reloaded**, rather than by setting the
 * two attributes directly. Both settings are read by a pre-paint script that
 * runs before React hydrates — that is what stops a stored preference flashing
 * the default first — so `localStorage` is the real source and an attribute
 * written by hand is a value the next navigation quietly discards. Setting the
 * attribute too would photograph a state the app cannot actually be in.
 *
 * The caller navigates afterwards regardless, because a page reads its view once
 * on mount; this returns what the document ended up saying so a frame that was
 * filed under the wrong setting fails loudly instead of looking plausible.
 */
async function applySettings(
  target: BrowserWindow,
  density: string,
  view: string,
): Promise<{ density: string | null; view: string | null }> {
  await target.webContents.executeJavaScript(
    `(() => {
       window.localStorage.setItem(${JSON.stringify(DENSITY_KEY)}, ${JSON.stringify(density)});
       window.localStorage.setItem(${JSON.stringify(FLEET_VIEW_KEY)}, ${JSON.stringify(view)});
     })()`,
  );
  await within("reload for settings", 20_000, target.webContents.loadURL(target.webContents.getURL()));
  await settle(900);
  const seen = (await target.webContents.executeJavaScript(
    `({
       density: document.documentElement.getAttribute("data-density") || "comfortable",
       view: document.documentElement.getAttribute("data-fleet-view") || "grid",
     })`,
  )) as { density: string | null; view: string | null };
  if (seen.density !== density || seen.view !== view) {
    throw new Error(
      `asked for ${density}/${view} and the document reports ` +
        `${String(seen.density)}/${String(seen.view)}`,
    );
  }
  return seen;
}

/**
 * How much reading this surface asks for, and how far down the first thing you
 * can press is.
 *
 * Backslashes in this string are doubled. It lives inside a template literal,
 * where a lone `\s` is not an escape sequence and silently becomes the letter
 * `s` — a word-splitter that splits on "s" reports numbers that look plausible
 * and are nonsense. No backticks either: the first one would close the literal.
 *
 * Everything inside a **closed** `<details>` is skipped. A closed disclosure
 * keeps its layout boxes and its `textContent`, so a walk that trusted either
 * would count text nobody can read — which for this issue is not a rounding
 * error, it is the entire measurement inverted.
 */
async function measure(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure prose",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const main = document.querySelector("main") || document.body;

         const readable = (node) => {
           if (node.closest("details:not([open])") !== null) return false;
           if (node.closest(".visually-hidden") !== null) return false;
           if (node.getAttribute("aria-hidden") === "true") return false;
           if (node.closest("[aria-hidden='true']") !== null) return false;
           const style = window.getComputedStyle(node);
           if (style.display === "none" || style.visibility === "hidden") return false;
           const box = node.getBoundingClientRect();
           return box.width > 0 || box.height > 0;
         };

         const words = (text) =>
           text.split(/[\\s\\u00a0]+/).filter((piece) => piece.length > 0).length;

         /*
          * The text of one element that a person can actually read, which is
          * NOT its textContent.
          *
          * This harness already skipped whole paragraphs that were hidden, and
          * that was not enough by one level: a paragraph that is itself visible
          * and contains a hidden child reports the hidden child's words in its
          * own textContent. The first measured run of the text pass came back
          * showing the Connections page had gained eight words after four
          * explanations were moved off it — the moved text was still being
          * counted, from inside the very notes it had moved into.
          *
          * So this walks and asks the same readable() question of every element
          * on the way down. Text nodes under a hidden ancestor never reach the
          * total.
          */
         const visibleWords = (node) => {
           let count = 0;
           const walk = (element) => {
             for (const child of element.childNodes) {
               if (child.nodeType === 3) {
                 count += words(child.nodeValue || "");
                 continue;
               }
               if (child.nodeType !== 1) continue;
               if (!readable(child)) continue;
               walk(child);
             }
           };
           walk(node);
           return count;
         };

         /*
          * Prose, as distinct from labels. A paragraph is the unit this issue is
          * about: headings, chips, buttons and field labels are the surface
          * working, and counting them would drown the signal in words that are
          * doing their job.
          *
          * A list item counts only when it is a leaf. DASH draws its card lists
          * as ul/li, so an li that contains a card contains every paragraph in
          * that card — the first run of this harness counted the Connections
          * page at 1122 words when 479 of them were real and the rest were four
          * cards counted twice. A number that large and that wrong would have
          * made any after-figure meaningless.
          */
         const leafItem = (node) =>
           node.tagName !== "LI" ||
           node.querySelector("p, ul, ol, div, article, section, details") === null;
         const paragraphs = [...main.querySelectorAll("p, li")]
           .filter(leafItem)
           .filter(readable);
         const proseWords = paragraphs
           .map((node) => visibleWords(node))
           .reduce((sum, n) => sum + n, 0);
         const longest = paragraphs
           .map((node) => visibleWords(node))
           .reduce((most, n) => (n > most ? n : most), 0);

         /*
          * The first control a person can actually touch, and how much reading
          * sits above it. This is the number MAR-614 is about: prose that
          * explains does not overflow, it pushes.
          */
         const controls = [...main.querySelectorAll(
           "button, a[href], input, select, textarea, summary",
         )].filter(readable);
         const first = controls.length === 0 ? null : controls[0];
         const firstTop = first === null ? null : first.getBoundingClientRect().top;

         const aboveWords =
           first === null
             ? proseWords
             : paragraphs
                 .filter((node) => node.getBoundingClientRect().bottom <= firstTop)
                 .map((node) => visibleWords(node))
                 .reduce((sum, n) => sum + n, 0);

         /* The new affordance, counted so a frame can prove it arrived. */
         const info = [...main.querySelectorAll(".info-note")].filter(readable);

         return {
           /*
            * Every sentence this surface actually shows, in order.
            *
            * Kept because the count above is a verdict and this is the working:
            * a pass that reports "384 words fewer" and cannot say which 384 is
            * asking to be trusted. It also makes the honesty review possible at
            * all — the before and after lists diff, and a consent sentence that
            * went missing rather than moving is visible in that diff.
            */
           says: paragraphs
             .filter((node) => visibleWords(node) > 0)
             .map((node) => (node.textContent || "").trim()),
           reported_width: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           content_height: main.scrollHeight,
           visible_paragraphs: paragraphs.length,
           visible_prose_words: proseWords,
           longest_paragraph_words: longest,
           words_above_first_action: aboveWords,
           first_action_top: firstTop === null ? null : Math.round(firstTop),
           first_action_within_viewport: firstTop === null ? null : firstTop <= window.innerHeight,
           info_notes: info.length,
         };
       })()`,
    ),
  );
}

/**
 * Keep the sentence list on one theme only.
 *
 * Both themes render identical copy, so writing it twice would double the file
 * and put two copies of every sentence in front of anyone diffing the before
 * against the after — which is the one job this list has.
 */
function measured0(raw: unknown, keepSays: boolean): Record<string, unknown> {
  const entry = { ...(raw as Record<string, unknown>) };
  if (!keepSays) {
    delete entry["says"];
  }
  return entry;
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });
  seed();

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
        await go(window, page.path);
        await resizeTo(window, viewport.width, viewport.height);
        // Reloaded after the resize: a page reads its view once, on mount, and a
        // layout computed at the previous width would be filed under this one.
        await go(window, page.path);

        const measured = measured0(await measure(window), theme === "light");
        measurements.push({
          page: page.name,
          theme,
          ...measured,
          // After the spread, not before: the measurement carries its own
          // `viewport` (the width the page reports) and would otherwise
          // silently overwrite the label this frame is filed under.
          viewport: viewport.name,
        });
        console.log(
          `[text-pass] ${page.name}/${viewport.name}/${theme} ` +
            JSON.stringify({ ...measured, says: undefined }),
        );
        await shoot(window, `${page.name}-${viewport.name}-${theme}`);
      }
    }
  }

  /*
   * The fleet, in every shape it has (MAR-614 phase 2).
   *
   * Three views times two densities is the matrix `lib/views/fleet-view.ts`
   * names in its own header — *"the capture matrix below is view × density
   * rather than a list of six named looks"* — because the two settings compose
   * and a person can hold any pair of them.
   *
   * This is the surface Henrik photographed when he wrote *"The text is to big.
   * The spacing to wide."*, so it is the one where the before and after have to
   * be readable side by side rather than merely measured.
   */
  for (const view of FLEET_VIEWS) {
    for (const density of DENSITIES) {
      for (const theme of THEMES) {
        nativeTheme.themeSource = theme;
        await settle(300);
        for (const viewport of VIEWPORTS) {
          await go(window, "/");
          await resizeTo(window, viewport.width, viewport.height);
          await applySettings(window, density, view);
          await go(window, "/");

          const measured = measured0(await measure(window), theme === "light");
          const name = `fleet-${view}-${density}-${viewport.name}-${theme}`;
          measurements.push({
            page: `fleet-${view}`,
            theme,
            density,
            fleet_view: view,
            ...measured,
            viewport: viewport.name,
          });
          console.log(`[text-pass] ${name} ${JSON.stringify({ ...measured, says: undefined })}`);
          await shoot(window, name);
        }
      }
    }
  }

  /* Back to the default, so the note-open frames below are not filed under
     whatever the last fleet frame happened to leave behind. */
  await applySettings(window, "comfortable", "grid");

  /*
   * A note actually open, which is the one state the loop above cannot reach.
   *
   * Every frame so far photographs the notes closed, and a closed note is
   * `display: none` — it proves the pass made the page calmer and proves nothing
   * at all about the thing the pass added. Two claims need an open one: that the
   * explanation is really reachable, and that a panel opening near a right-hand
   * edge does not become the reason the page scrolls sideways. The second is a
   * real risk of any absolutely positioned popover and is exactly the class of
   * defect MAR-491 measured rather than eyeballed.
   *
   * Opened with `focus()` rather than a synthetic hover: `:focus-within` is what
   * the stylesheet keys on for keyboard and touch, so this exercises the path
   * those two actually take.
   */
  for (const theme of THEMES) {
    nativeTheme.themeSource = theme;
    await settle(300);
    for (const viewport of VIEWPORTS) {
      await go(window, "/settings");
      await resizeTo(window, viewport.width, viewport.height);
      await go(window, "/settings");

      const opened = (await window.webContents.executeJavaScript(
        `(() => {
           const mark = document.querySelector(".info-note-mark");
           if (mark === null) return null;
           mark.focus();
           const root = document.documentElement;
           const body = mark.parentElement.querySelector(".info-note-body");
           const box = body === null ? null : body.getBoundingClientRect();
           return {
             note_visible: body !== null && window.getComputedStyle(body).display !== "none",
             note_right: box === null ? null : Math.round(box.right),
             note_within_width: box === null ? null : box.right <= window.innerWidth,
             page_overflows_while_open: root.scrollWidth > root.clientWidth,
           };
         })()`,
      )) as Record<string, unknown> | null;

      if (opened === null) {
        console.log(`[text-pass] no note to open at ${viewport.name}/${theme}`);
        continue;
      }
      await settle(300);
      measurements.push({ page: "note-open", theme, viewport: viewport.name, ...opened });
      console.log(`[text-pass] note-open/${viewport.name}/${theme} ${JSON.stringify(opened)}`);
      await shoot(window, `note-open-${viewport.name}-${theme}`);
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
  const buried = measurements.filter(
    (entry) =>
      (entry as { first_action_within_viewport: boolean | null })
        .first_action_within_viewport === false,
  );
  const pages = measurements.filter(
    (entry) => (entry as { visible_prose_words?: number }).visible_prose_words !== undefined,
  );
  const totalProse = pages.reduce(
    (sum, entry) => sum + (entry as { visible_prose_words: number }).visible_prose_words,
    0,
  );
  const totalAbove = pages.reduce(
    (sum, entry) => sum + (entry as { words_above_first_action: number }).words_above_first_action,
    0,
  );
  const openNotes = measurements.filter(
    (entry) => (entry as { note_visible?: boolean }).note_visible !== undefined,
  );
  const badNotes = openNotes.filter(
    (entry) =>
      !(entry as { note_visible: boolean }).note_visible ||
      (entry as { note_within_width: boolean }).note_within_width === false ||
      (entry as { page_overflows_while_open: boolean }).page_overflows_while_open,
  );

  console.log(
    `\n[text-pass] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[text-pass] ${overflowed.length === 0 ? "no frame overflowed sideways" : `${String(overflowed.length)} FRAMES OVERFLOWED`}\n` +
      `[text-pass] ${buried.length === 0 ? "the first action is on screen in every frame" : `${String(buried.length)} FRAMES BURY THE FIRST ACTION BELOW THE FOLD`}\n` +
      `[text-pass] ${String(totalProse)} visible prose words across ${String(pages.length)} page frames\n` +
      `[text-pass] ${String(totalAbove)} of them above the first action\n` +
      `[text-pass] ${
        openNotes.length === 0
          ? "no note was opened — this run proves nothing about the affordance"
          : badNotes.length === 0
            ? `${String(openNotes.length)} notes opened, all readable and none overflowing`
            : `${String(badNotes.length)} OPENED NOTES ARE UNREADABLE OR OVERFLOW`
      }`,
  );

  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error(`[text-pass] failed: ${error instanceof Error ? error.message : String(error)}`);
  app.exit(1);
});
