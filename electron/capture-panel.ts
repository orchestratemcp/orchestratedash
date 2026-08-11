/**
 * Screenshots of the declarative panel, in the real shell (MAR-554). **Not part
 * of the shipped shell.**
 *
 * `electron/capture.ts` photographs DASH's *surfaces* — it walks routes that
 * exist and shoots what the store happens to hold. The panel has no route yet:
 * ADR 0008 slice 3 builds the renderer, slice 5 and MAR-548 are what put a
 * declared panel in front of it, and "merged" is the ceiling until a real
 * manifest declares one. So there is nothing on any route for the surface
 * harness to find, and a session that shipped this renderer with no picture of
 * it would be shipping the exact thing MAR-491 and MAR-440 both cost two days
 * each to learn about — see `screenshots-find-what-measurements-cannot`.
 *
 * ## What this photographs, exactly, and what it therefore does not prove
 *
 * It boots the real app the same way `electron/capture.ts` does — same first two
 * imports in the same order, so the app name, the user-data directory and the
 * store resolve exactly as they do under `electron .` — loads the packaged
 * renderer, and then **replaces the contents of `<main>` with the panel's own
 * markup**, rendered here by the same components the product would render.
 *
 * So what is in these images is real in every way that matters for a design
 * review and one way that it is not:
 *
 * - **Real**: the packaged renderer's compiled stylesheet, the bundled Space
 *   Grotesk and JetBrains Mono faces, `app/tokens.css` resolved by Chromium
 *   against a `color-scheme` the operating system's own signal moved, the
 *   density attribute written by *pressing the real control*, the window
 *   chrome, the sidebar, the cast strip, and the actual viewport arithmetic at
 *   each width.
 * - **Not real**: the route. Nothing navigated to a page that drew this; the
 *   markup was injected. **These images are not evidence that the workspace
 *   renders a panel**, because it does not yet — that is the integration step
 *   this slice records rather than performs.
 *
 * That distinction is written here rather than left for a reader of the PNGs to
 * work out, because a screenshot with an unstated caveat is how a `merged`
 * claim quietly becomes a `proven` one.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open —
 * see the note on identity below:
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar554'
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     pnpm exec electron dist/electron/capture-panel.mjs
 *
 * All four lines are load-bearing and each has cost a session before:
 * `build:renderer` first because `build:shell` only *copies* `out/`;
 * `DASH_SHELL_URL` because without it an unpackaged main loads loopback and
 * every page fails to connect; PowerShell because under Git Bash the runner
 * cannot read its own user identity; a visible window because `capturePage()`
 * never resolves against a compositor that is not compositing.
 *
 * Never on the `electron .` path and named by no `package.json` script, on
 * `electron/capture.ts`'s own terms: this produces evidence, never a verdict,
 * and ADR 0004 keeps things that cannot fail a release out of the gate.
 */

/*
 * `electron/smoke-identity.ts` is deliberately **not** imported, and the reason
 * is the mirror image of why `electron/smoke.ts` and `electron/capture.ts` do
 * import it.
 *
 * Those two are proofs *about the store*: the smoke asserts a refusal lands in
 * the real user-data directory, and the surface capture photographs whatever
 * agents a machine actually has. Borrowing the app's name is what points them at
 * the right directory.
 *
 * This harness reads nothing from the store. Every panel below is built from a
 * fixture, so the real user-data directory is a place it has no business in —
 * and taking the app's name would take the app's **single-instance lock** with
 * it, which means this could only ever run with DASH closed. Launched as a bare
 * file, Electron falls back to the name `Electron` and a user-data directory of
 * its own, so this runs happily beside a live DASH and cannot touch its records.
 * That is a property worth keeping: `never-force-kill-electron` is a lesson this
 * project has already paid for once.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";
/*
 * The **browser** server build, in a Node process, on purpose.
 *
 * `react-dom/server` resolves to `server.node.js`, which is CommonJS and reaches
 * `util` through a dynamic `require` that an esbuild ESM bundle cannot honour —
 * the whole harness died on load with "Dynamic require of util is not
 * supported". The browser build has no Node dependency at all, and
 * `renderToStaticMarkup` is a pure string function in both: it streams nothing
 * and touches no socket, so the Node build's only advantage here is one this
 * file has no use for.
 */
import { renderToStaticMarkup } from "react-dom/server.browser";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { AgentPanel } from "../app/_components/panel.js";
import { buildPanelView, type PanelDashFacts } from "../lib/views/panel.js";
import type { DigestArtifact } from "../lib/contracts.js";
import type { RunArtifactRecord } from "../lib/store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar554");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

/* ---------------------------------------------------------------------- *
 * What is photographed
 * ---------------------------------------------------------------------- */

const AGENT = "ai-agent-news";

/**
 * A digest with enough in it to exercise every cell rule at once.
 *
 * Deliberately imperfect: the second item has no score and the third has no
 * publish date, so the table draws absent cells beside real ones. A fixture in
 * which every value was present would photograph the one case that never
 * happens.
 */
const digest = {
  artifact_version: 1,
  kind: "digest",
  agent: AGENT,
  run_id: "run-mar554-capture",
  artifact_id: "digest-2026-08-05",
  title: "AI agent news for 5 August",
  generated_at: "2026-08-05T21:14:02.000Z",
  headline_count: 6,
  sources_fetched: [
    {
      source_name: "Hacker News",
      source_url: "https://hn.algolia.com/api/v1/search",
      status: "ok",
      item_count: 6,
    },
  ],
  items: [
    {
      headline: "A supervisor for long-running agents lands in beta",
      summary: "The first release that watches an agent rather than starting one.",
      source_name: "Hacker News",
      score: 412,
      published_at: "2026-08-05T09:00:00.000Z",
    },
    {
      headline: "Declarative panels beat embedded code, three teams find",
      source_name: "Hacker News",
      published_at: "2026-08-04T17:30:00.000Z",
    },
    {
      headline: "Local-first tooling keeps growing without a cloud tier",
      source_name: "Lobsters",
      score: 188,
    },
  ],
} as unknown as DigestArtifact;

const RECORDS: RunArtifactRecord[] = [
  { artifact: digest, received_at: "2026-08-05T21:14:08.412Z", stored_bytes: 4210 },
];

/**
 * The same digest, grouped by a model (MAR-619).
 *
 * A scene rather than a harness, on `capture-deploy.ts`'s recorded terms: the
 * curated form renders through `DigestBody`, which the panel's `report` section
 * already draws, so photographing it is a fixture and two `STATES` entries
 * rather than a second boot of the app.
 *
 * **The third item is deliberately in no group.** That is the case only a
 * photograph settles: the remainder heading and the group rule have to read as
 * one structure rather than as two digests stacked, and nothing in the
 * repository measures "these two blocks look like the same page".
 *
 * The overview and the group sentences are invented for the scene, in
 * `capture-ask.ts`'s sense — they are the *shape* of what a model returns, and
 * no model wrote them.
 */
const curatedDigest = {
  ...digest,
  artifact_id: "digest-2026-08-05-curated",
  curation: {
    state: "curated",
    overview:
      "Two things happened today: tooling that watches agents rather than starting them, and a " +
      "quieter argument about how agents should describe themselves.",
    model: "openai/gpt-5-mini",
    groups: [
      {
        label: "Watching agents, not launching them",
        summary: "Supervision is arriving as a product rather than as a feature of a framework.",
        items: [0],
      },
      {
        label: "How agents describe themselves",
        summary: "One report on teams moving from embedded code to declared panels.",
        items: [1],
      },
    ],
  },
} as unknown as DigestArtifact;

const CURATED_RECORDS: RunArtifactRecord[] = [
  { artifact: curatedDigest, received_at: "2026-08-05T21:14:08.412Z", stored_bytes: 5120 },
];

/**
 * And the same digest with the summary refused (MAR-619).
 *
 * `not_connected` of the six, because it is the one a person is most likely to
 * meet: the scout ships declaring a model provider and nobody has connected a
 * key yet. What the photograph is for is the **proportion** — a notice about a
 * missing summary must not dominate a digest that is otherwise complete, which
 * is the failure mode of every degraded state that was written and never looked
 * at.
 */
const refusedDigest = {
  ...digest,
  artifact_id: "digest-2026-08-05-refused",
  curation: { state: "not_curated", reason: "not_connected" },
} as unknown as DigestArtifact;

const REFUSED_RECORDS: RunArtifactRecord[] = [
  { artifact: refusedDigest, received_at: "2026-08-05T21:14:08.412Z", stored_bytes: 4230 },
];

const FACTS: PanelDashFacts = {
  run_count: 12,
  last_run_at: "2026-08-05T21:14:02.000Z",
  last_run_status: "completed",
};

const EVERY_SECTION = [
  { id: "latest_digest", type: "report", label: "Latest roundup", artifact_role: "digest" },
  {
    id: "headline_rows",
    type: "table",
    label: "What it found",
    source_role: "digest",
    columns: [
      { key: "headline", label: "Headline", kind: "text" },
      { key: "source_name", label: "Source", kind: "text" },
      { key: "score", label: "Score", kind: "number" },
      { key: "published_at", label: "Published", kind: "timestamp" },
    ],
  },
  {
    id: "at_a_glance",
    type: "metrics",
    label: "At a glance",
    items: [
      {
        id: "headline_count",
        label: "Headlines gathered",
        source: { kind: "artifact_field", artifact_role: "digest", field: "headline_count" },
      },
      { id: "times_run", label: "Times run", source: { kind: "dash_fact", fact: "run_count" } },
      { id: "last_run", label: "Last run", source: { kind: "dash_fact", fact: "last_run_at" } },
      {
        id: "verdict",
        label: "How it went",
        source: { kind: "dash_fact", fact: "last_run_verdict" },
      },
    ],
  },
  { id: "every_output", type: "outputs", label: "Everything it made", max_items: 3 },
  {
    id: "author_note",
    type: "note",
    label: "About this agent",
    text: "It only runs when you ask it to. Nothing happens on a timer, and it never sends anything on your behalf.",
  },
];

function manifest(panel: unknown): unknown {
  return { agent: { name: AGENT }, agent_dom: { panel } };
}

/**
 * The four states worth a photograph, and why these four.
 *
 * `full` and `empty` are the same declaration against an agent that has produced
 * something and one that has not, which is the pair that shows whether the
 * stated empty states hold their own on the page or read as a broken panel.
 * `skew` and `unreadable` are the two one-card renders, and both are shot
 * because they are the two surfaces most likely to be written once and never
 * looked at.
 */
const STATES = [
  {
    name: "full",
    view: () =>
      buildPanelView(manifest({ panel_version: 1, title: "Newsroom", sections: EVERY_SECTION }), {
        artifacts: RECORDS,
        facts: FACTS,
      }),
    everyWidth: true,
  },
  {
    name: "empty",
    view: () =>
      buildPanelView(manifest({ panel_version: 1, title: "Newsroom", sections: EVERY_SECTION }), {
        artifacts: [],
        facts: { run_count: 0, last_run_at: null, last_run_status: null },
      }),
    everyWidth: true,
  },
  {
    name: "newer-version",
    view: () =>
      buildPanelView(
        manifest({
          panel_version: 9,
          title: "Newsroom",
          sections: [{ id: "orbit", type: "orbit_map", label: "Orbit map" }],
        }),
        { artifacts: RECORDS, facts: FACTS },
      ),
    everyWidth: false,
  },
  {
    name: "unreadable",
    view: () =>
      buildPanelView(manifest({ panel_version: 1, sections: [{ id: "x", type: "reprot" }] }), {
        artifacts: RECORDS,
        facts: FACTS,
      }),
    everyWidth: false,
  },
  /*
   * MAR-619's two, at every width.
   *
   * `everyWidth` on both, and that is the point of shooting them at all: the
   * group rule is a left border with padding inside a card that is already
   * indented, and 375px is where an indent inside an indent stops being a
   * structure and starts being a column of text three words wide. The
   * `full` scene above is the control — same digest, no curation block, so a
   * reviewer can see what the grouping added and what it displaced.
   */
  {
    name: "curated",
    view: () =>
      buildPanelView(manifest({ panel_version: 1, title: "Newsroom", sections: EVERY_SECTION }), {
        artifacts: CURATED_RECORDS,
        facts: FACTS,
      }),
    everyWidth: true,
  },
  {
    name: "not-curated",
    view: () =>
      buildPanelView(manifest({ panel_version: 1, title: "Newsroom", sections: EVERY_SECTION }), {
        artifacts: REFUSED_RECORDS,
        facts: FACTS,
      }),
    everyWidth: true,
  },
] as const;

/* ---------------------------------------------------------------------- *
 * The harness — the same guards `electron/capture.ts` earned the hard way
 * ---------------------------------------------------------------------- */

function settle(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Every await here, bounded and named.
 *
 * A capture run that hangs prints nothing and looks exactly like a slow one.
 * `capturePage()` against a window that is not compositing and
 * `executeJavaScript()` against a page that navigated underneath it are the two
 * that can genuinely never return.
 */
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
  const css = (await within(
    `measure ${name}`,
    10_000,
    target.webContents.executeJavaScript(
      `({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio })`,
    ),
  )) as { w: number; h: number; dpr: number };
  console.log(
    `[panel] ${name}.png ${String(size.width)}x${String(size.height)} ` +
      `(css ${String(css.w)}x${String(css.h)} @${String(css.dpr)}x)`,
  );
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * `setContentSize` is a request to the window manager, not a guarantee, and a
 * maximized or snapped window ignores it outright and reports the screen's width
 * back — which on a 1280-wide display is indistinguishable from a successful
 * resize to 1280. That really happened to `electron/capture.ts`: three images
 * were labelled with a viewport they were not taken at, which is worse than a
 * missing image because a mislabelled screenshot is evidence for a claim nobody
 * checked.
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
 * itself would produce identical-looking output whether or not the control
 * worked, and the pair of images would stop being a small proof as well as a
 * picture. Same discipline `electron/capture.ts` states at more length.
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
 * Put the panel on the page.
 *
 * `<main>`'s children are replaced rather than appended to, so the panel is
 * photographed with the page's own margins, the real chrome above it and the
 * cast strip below — and with nothing else competing for the frame.
 *
 * The markup is passed as a JSON literal, which is the only safe way to move a
 * string into `executeJavaScript`. Note what that does *not* need to guard
 * against: the markup came from `renderToStaticMarkup`, so every author string
 * in it is already an escaped text node — which is the panel's own property
 * rather than this harness's, and one more place it holds.
 */
async function mount(target: BrowserWindow, markup: string): Promise<void> {
  await within(
    "mount the panel",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const main = document.querySelector("main");
         if (main === null) return false;
         main.innerHTML = ${JSON.stringify(markup)};
         return true;
       })()`,
    ),
  );
  await settle(250);
}

/**
 * The two numbers a screenshot cannot be argued with about.
 *
 * MAR-491's own measurement, pointed at the one table this product now has.
 * The claim the table makes is that it scrolls **inside its own box** and the
 * page does not — so both are read, at every width, and a run in which
 * `page_overflows` is ever true is a run that has found the defect MAR-491 was
 * filed for arriving again.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return await within(
    "layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const wrap = document.querySelector(".agent-panel-table-wrap");
         const widest = [...document.querySelectorAll("main *, main")].reduce((worst, el) => {
           const over = el.scrollWidth - el.clientWidth;
           if (over <= 1) return worst;
           if (worst !== null && worst.overflow_by >= over) return worst;
           return {
             element: el.tagName.toLowerCase() + (String(el.className || "").trim() === "" ? "" : "." + String(el.className).trim().split(/\\s+/).join(".")),
             client_width: el.clientWidth,
             scroll_width: el.scrollWidth,
             overflow_by: over,
           };
         }, null);
         return {
           viewport: root.clientWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           panel_sections: document.querySelectorAll(".agent-panel-section").length,
           stated_empties: document.querySelectorAll(".agent-panel-empty").length,
           attribution_marks: document.querySelectorAll(".agent-panel-attribution-mark").length,
           controls_inside_panel: document.querySelectorAll(".agent-panel button, .agent-panel input, .agent-panel select, .agent-panel textarea").length,
           table: wrap === null ? null : {
             client_width: wrap.clientWidth,
             scroll_width: wrap.scrollWidth,
             scrolls_inside_its_own_box: wrap.scrollWidth > wrap.clientWidth + 1,
           },
           widest_scroller: widest,
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
  await settle(1400);
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });

  const window = await appWindowLoaded();
  window.setResizable(true);
  await settle(1200);

  for (const theme of THEMES) {
    // The operating system's own signal, not a stylesheet override. What is
    // photographed is the path a user's OS preference actually takes through
    // `resolveTheme` and `app/tokens.css`, and `followTheme` in main.ts repaints
    // the Windows title-bar overlay from it too.
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const state of STATES) {
      const markup = renderToStaticMarkup(AgentPanel({ view: state.view() }));
      const widths = state.everyWidth ? VIEWPORTS : [VIEWPORTS[0]];

      for (const viewport of widths) {
        // Reloaded per frame: `mount` replaced the page's own content, and a
        // second mount onto an already-emptied `<main>` would photograph
        // whatever the last one left behind.
        await go(window, "/");
        const at = await resizeTo(window, viewport.width, viewport.height);
        await mount(window, markup);
        console.log(
          `[panel] ${state.name} at ${viewport.name}/${theme} (window reports ${String(at)}px)`,
        );

        for (const density of ["comfortable", "compact"] as const) {
          if (density === "compact" && (await pressDensityToggle(window)) === null) {
            console.log(`[panel] no density control at ${viewport.name} — compact frame skipped`);
            continue;
          }
          const measured = await layout(window);
          measurements.push({
            state: state.name,
            viewport: viewport.name,
            theme,
            density,
            ...(measured as object),
          });
          console.log(`[panel]   ${density} ${JSON.stringify(measured)}`);
          await shoot(window, `panel-${state.name}-${viewport.name}-${theme}-${density}`);
        }

        // Back to comfortable, so the next frame starts where this one did.
        await pressDensityToggle(window);
      }
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  /*
   * The three claims the images alone cannot settle, read off the same runs.
   *
   * A picture shows the table fits; it does not show whether the page had to
   * grow sideways for it to. A picture shows no buttons; it does not show that
   * none exist. These are counted at every width in both themes and reported as
   * one line, because a run that quietly lost one of them would otherwise look
   * exactly like a run that passed.
   */
  const overflowed = measurements.filter((entry) => (entry as { page_overflows: boolean }).page_overflows);
  const withControls = measurements.filter(
    (entry) => (entry as { controls_inside_panel: number }).controls_inside_panel > 0,
  );
  console.log(
    `\n[panel] wrote ${String(written.length)} images and layout.json to ${OUT}\n` +
      `[panel] page overflowed horizontally in ${String(overflowed.length)} of ${String(measurements.length)} frames\n` +
      `[panel] controls found inside the panel region: ${String(withControls.length)} frames`,
  );
}

void run().then(
  () => {
    app.quit();
  },
  (error: unknown) => {
    console.error(`[panel] failed: ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  },
);
