/**
 * The cockpit, de-duplicated (MAR-646). **Not part of the shipped shell.**
 *
 * ## Why none of the eleven harnesses already here could take this picture
 *
 * `electron/capture-deploy.ts` photographs all six stages already, and every
 * frame it takes is of `news-scout`: an agent imported with a manifest and a
 * folder that has **never run**. That is the right subject for MAR-609's
 * empty-case rule and it is the wrong one for this issue, because an agent that
 * has produced nothing has an empty rail — and a duplication between a rail and
 * a stage cannot be photographed with the rail empty. `capture-text-pass.ts`
 * has the same problem for the same reason: its agent comes from a manifest and
 * nothing else.
 *
 * So this one seeds a single agent that has actually *done things* — four
 * outputs across four runs, a run's worth of telemetry, an approval and a
 * choice waiting on a person — and photographs each of the six stages beside
 * the rail that indexes it.
 *
 * ## The measure, which is the half a photograph cannot settle
 *
 * A screenshot of a page that says something twice looks exactly like a
 * screenshot of a page that says it once, until you have both and hold them up
 * together. So each frame is measured as well as photographed, and the number
 * this issue turns on is `repeated_titles`: **how many of the outputs the rail
 * indexes are also drawn inside the stage beside it.** One is a pointer
 * resolving to its target and is the point of the rail. More than one is the
 * index drawn twice, which is what MAR-646 was filed on.
 *
 * `visible_words` is the same walk `capture-text-pass.ts` uses, and it is
 * borrowed rather than reinvented for the reason that harness records: a naive
 * count reads text inside a **closed** `<details>` and inside
 * `.visually-hidden`, so a pass that moved prose behind a disclosure would
 * measure it as gone and be wrong about its own work. MAR-646 deletes rather
 * than folds, and this is the number that can tell the difference.
 *
 * ## What is real here, and the three things that are not
 *
 * Real: the packaged renderer and its compiled stylesheet, the `dash-app://ui/`
 * routes, `workspaceView()` arriving over the read channel, `resolveAgentStage`
 * deciding what an address means, and the geometry the compositor actually laid
 * out.
 *
 * Not real, and said here rather than left for a reader of the PNGs to infer:
 *
 * 1. **Whose data it is.** The store is a scratch directory this run seeded.
 * 2. **The agent never ran.** Its outputs and its telemetry were written
 *    through `ingestArtifacts` and `ingestEvents` — the same doors a real
 *    runner posts through, so what is drawn is a real rendering of real rows —
 *    and no process produced them. No source was fetched and no model was
 *    contacted.
 * 3. **The approval is not enforceable.** It is a seeded Agent DOM snapshot.
 *    Pressing Approve in these images would reach a runner that is not there.
 *    This harness does not press it.
 *
 * ## Run it, twice
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open —
 * `electron/smoke-identity.ts` is deliberately not imported, so this claims
 * neither the installed app's single-instance lock nor its user-data path.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-cockpit-before'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar646-before'
 *     pnpm exec electron dist/electron/capture-cockpit.mjs --user-data-dir=…\ud-before
 *
 * Every line is load-bearing and each has cost a session before:
 * `build:renderer` first because `build:shell` only *copies* `out/`;
 * `DASH_SHELL_URL` because without it an unpackaged main loads loopback and
 * every page fails to connect; PowerShell because under Git Bash the runner
 * cannot read its own user identity and the shell renders empty; a visible
 * window because `capturePage()` never resolves against a compositor that is
 * not compositing; `--user-data-dir` because two capture runs sharing
 * Electron's default profile collide, and a stale log then makes a dead run
 * look successful.
 *
 * A **fresh `DASH_DATA_DIR` per run**, and that one is this file's own: `seed()`
 * imports a manifest and posts artifacts, and a second run against the same
 * store would double every list it is trying to count.
 *
 * ## What it leaves behind, said out loud
 *
 * Importing `./main.js` starts a **runner** against the scratch store, and
 * `app.exit(0)` does not stop it. Each run leaves one live runner holding a
 * scratch store, exactly as the other capture harnesses do. Harmless to
 * anybody's records, and **not** harmless to the next `pnpm verify:shell` on
 * this machine — run this when you are about to review images, not when you are
 * about to run the gate, and name the leftover pids in whatever you write.
 *
 * Never on the `electron .` path and named by no `package.json` script, on
 * `electron/capture.ts`'s terms: this produces evidence, never a verdict.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { putAgentDomState } from "../lib/agent-dom/store.js";
import { importManifest, ingestArtifacts, ingestEvents } from "../lib/store.js";

const OUT = path.resolve(
  process.cwd(),
  process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar646",
);

/**
 * 1280 only, which is the width MAR-646's acceptance names.
 *
 * The other harnesses argue every pass at three widths because they are about
 * layout. This one is about whether two blocks say the same thing, which is
 * true or false at every width — and under 900px the rail becomes a strip above
 * the stage, so a narrow frame would show the pair stacked rather than side by
 * side and would make the comparison harder to read rather than broader.
 */
const VIEWPORT = { name: "1280", width: 1280, height: 900 } as const;

/**
 * MAR-658. A second pass, narrow, and about a different question than the one
 * above: not whether two blocks repeat each other, but whether the header
 * band's new fifth action cell (Overview) actually fits.
 *
 * This harness's agent is the busiest one seeded anywhere in `electron/` — four
 * outputs and a two-item queue, so the rail is never empty here the way it is
 * on `capture-deploy.ts`'s never-run agent — which makes it the tightest real
 * case for the header's height budget, not the loosest. `measure()` reports the
 * new cell's own box rather than trusting the screenshot alone: MAR-615's
 * composer clipped at 375px while every render test, `typecheck` and
 * `brand:check` stayed green, because none of them lay anything out.
 */
const NARROW = { name: "375", width: 375, height: 812 } as const;

const THEMES = ["light", "dark"] as const;

/** Every part of an agent, from `AGENT_STAGES`. Seven when Health arrives. */
const STAGES = ["overview", "run", "output", "chat", "settings", "logs"] as const;

/** The one agent this scene is about. */
const AGENT = "news-scout";

function example(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.resolve(process.cwd(), "examples", name), "utf8"),
  ) as Record<string, unknown>;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * One agent that has done things.
 *
 * Everything goes in through the ordinary doors — `importManifest`,
 * `ingestArtifacts`, `ingestEvents`, `putAgentDomState` — rather than by
 * writing rows. A seed that reached past the validators could stage a state the
 * product cannot actually reach, and a photograph of one of those is worse than
 * no photograph.
 *
 * **Four outputs, not two.** Two can be read as a coincidence in a screenshot;
 * four is unmistakably a list, which is what the Output stage used to draw
 * beside the rail's list of the same four.
 */
function seed(): void {
  const manifest = example("agent.manifest.example.json") as {
    agent: { name: string; display_name?: string };
  };
  manifest.agent.name = AGENT;
  manifest.agent.display_name = "News Scout";
  const imported = importManifest(manifest);
  if (!imported.ok) {
    throw new Error(`the seeded manifest was refused: ${JSON.stringify(imported)}`);
  }

  const days = [0, 1, 2, 3];
  const titles = [
    "AI agent news for today",
    "AI agent news for yesterday",
    "AI agent news for Monday",
    "AI agent news for Sunday",
  ];
  const accepted = ingestArtifacts(
    days.map((day, index) => ({
      artifact_version: 1,
      agent: AGENT,
      run_id: `run-scout-${String(index)}`,
      artifact_id: `digest-scout-${String(index)}`,
      kind: "digest",
      title: titles[index] ?? "Digest",
      generated_at: daysAgo(day),
      sources_fetched: [
        {
          source_name: "Hacker News",
          source_url: "https://hn.algolia.com/api/v1/search",
          status: "ok",
          item_count: 2,
        },
      ],
      items: [
        {
          headline: "A supervisor for long-running agents lands in beta",
          summary:
            "One paragraph of a digest, which is the thing a person opened this page to read.",
          source_name: "Hacker News",
          source_url: "https://hn.algolia.com/api/v1/search",
        },
        {
          headline: "Permission brokers replace token pass-through",
          summary: "A second item, so the open card is visibly a report rather than a line.",
          source_name: "Hacker News",
          source_url: "https://hn.algolia.com/api/v1/search",
        },
      ],
    })),
  );
  console.log(`[cockpit] ${String(accepted.accepted)} artifact(s) accepted`);

  /*
   * Telemetry for the newest run, so the Run stage has a feed and meters rather
   * than its two empty sentences. `cost_usd` and the token counts are on the
   * step events because that is where telemetry v1 puts them — see
   * `lib/views/agent-feed.ts`, which omits any meter whose field never arrived
   * rather than drawing a zero.
   */
  const startedAt = daysAgo(0);
  const reported = ingestEvents([
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 0,
      ts: startedAt,
      type: "run_started",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 1,
      ts: startedAt,
      type: "step_started",
      step_id: "fetch",
      step_label: "Public feed fetch",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 2,
      ts: startedAt,
      type: "step_completed",
      step_id: "fetch",
      step_label: "Public feed fetch",
      status: "ok",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 3,
      ts: startedAt,
      type: "step_started",
      step_id: "write",
      step_label: "Write the digest",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 4,
      ts: startedAt,
      type: "step_completed",
      step_id: "write",
      step_label: "Write the digest",
      status: "ok",
      model: "openai/gpt-5-mini",
      tokens_in: 1420,
      tokens_out: 310,
      cost_usd: 0.0041,
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 5,
      ts: startedAt,
      type: "run_completed",
      status: "ok",
    },
  ]);
  console.log(`[cockpit] ${String(reported.accepted)} run event(s) accepted`);

  /*
   * A queue with something in it, so the rail's Action needed panel and the
   * Overview stage's cards are both on screen — which is the pair MAR-646 asks
   * to be checked for looking like the same block twice.
   *
   * The expiries are moved forward and nothing else is. The shipped example's
   * deadline is in the past, and an expired request is a real state with its own
   * sentence and no controls; the branch worth photographing here is the live
   * one. Same single edit `electron/capture-glance.ts` makes, for the same
   * reason.
   */
  const state = example("gmail-meeting-assistant.state.example.json");
  state["agent_id"] = AGENT;
  state["observed_at"] = daysAgo(0);
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  for (const request of (state["approval_requests"] ?? []) as Array<Record<string, unknown>>) {
    request["expires_at"] = soon;
  }
  for (const choice of (state["choices"] ?? []) as Array<Record<string, unknown>>) {
    choice["expires_at"] = soon;
  }
  const put = putAgentDomState(state);
  if (!put.ok) {
    throw new Error(`the seeded snapshot was refused: ${put.errors.join("; ")}`);
  }

  console.log(`[cockpit] seeded ${AGENT}: 4 outputs, 1 run of telemetry, 1 snapshot`);
}

/* ---------------------------------------------------------------------- *
 * The harness — the guards the other capture files earned the hard way
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

/**
 * Photograph the window, and try twice.
 *
 * `capturePage()` fails outright on the first attempt after a shrink — that is
 * deterministic rather than flaky, so the retry is a normal path rather than an
 * error case.
 */
async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    console.log(
      `[cockpit]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(`capturePage retry for ${name}`, 20_000, target.webContents.capturePage());
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  written.push(name);
  console.log(`[cockpit] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * A maximized window ignores `setContentSize` and reports the screen's width
 * back, which on a 1280-wide display is indistinguishable from a successful
 * resize — images labelled with a viewport they were not taken at, which is
 * worse than a missing image.
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
 * What the frame and the stage each say, counted.
 *
 * The one number this issue turns on is `repeated_titles`. Everything else is
 * context for reading it: a stage can always be made to stop repeating the rail
 * by drawing nothing at all, and `visible_words` beside `stage_output_titles`
 * is what shows that a stage kept its content while losing the copy of the
 * index.
 */
async function measure(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure the frame",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         const stage = document.querySelector(".cockpit-stage");
         const rail = document.querySelector(".cockpit-rail");

         /*
          * Readable, which is NOT "in the markup". A closed <details> keeps its
          * layout boxes and its textContent, and .visually-hidden clips itself
          * rather than collapsing — so both would be counted by a naive walk,
          * and a pass that folded prose away instead of deleting it would
          * measure as a triumph. MAR-646 deletes; this is what can tell.
          */
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

         const text = (node) => (node.textContent || "").trim();
         const railTitles = rail === null
           ? []
           : [...rail.querySelectorAll(".rail-output-title")].map(text);
         const railWork = rail === null
           ? []
           : [...rail.querySelectorAll(".rail-work-item")].map(text);

         /*
          * Every title the stage draws, wherever it draws it — the open card's
          * heading and the summary of a dated disclosure alike. A query that
          * looked only at open cards would have reported the defect as absent
          * while it was on the screen.
          */
         const stageText = stage === null ? "" : stage.textContent || "";
         const repeated = railTitles.filter((title) => stageText.includes(title));

         /*
          * MAR-658. The fifth header cell, scoped to the action grid so the
          * rail's own "stage=overview#work-…" link (a different control, with
          * a different job) cannot be the one this finds.
          */
         const overviewAction = document.querySelector(
           '.cockpit-action-grid a[href*="stage=overview"]',
         );
         const overviewBox = overviewAction === null
           ? null
           : overviewAction.getBoundingClientRect();

         return {
           reported_width: window.innerWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           widest_overflow: [...document.querySelectorAll("*")]
             .map((node) => node.scrollWidth - node.clientWidth)
             .reduce((most, gap) => (gap > most ? gap : most), 0),
           stage_label: stage === null ? null : stage.getAttribute("aria-label"),
           /* The index, which is the frame's job and stays whole. */
           rail_titles: railTitles,
           rail_work: railWork,
           rail_count: rail === null || rail.querySelector(".rail-count") === null
             ? null
             : text(rail.querySelector(".rail-count")),
           /*
            * THE NUMBER. One is a pointer resolving to its target. More than one
            * is the rail's list drawn a second time inside the stage beside it.
            */
           repeated_titles: repeated.length,
           repeated: repeated,
           stage_headings: stage === null
             ? []
             : [...stage.querySelectorAll("h2, h3")].filter(readable).map(text),
           stage_sections: stage === null ? 0 : stage.querySelectorAll("section.section").length,
           stage_cards: stage === null ? 0 : stage.querySelectorAll(".output-card").length,
           dated_entries: document.querySelectorAll(".output-history-entry").length,
           tiles: document.querySelectorAll(".agent-tile").length,
           stage_words: stage === null ? 0 : visibleWords(stage),
           frame_words: visibleWords(document.body) - (stage === null ? 0 : visibleWords(stage)),
           /*
            * MAR-658. Whether the back-to-Overview cell is actually there and
            * actually has room, not merely present in the markup — the
            * distinction MAR-615's clipped composer is the standing reason to
            * keep checking for.
            */
           overview_action_present: overviewAction !== null,
           overview_action_box: overviewBox === null
             ? null
             : { width: overviewBox.width, height: overviewBox.height, top: overviewBox.top },
           overview_action_visible: overviewAction !== null
             && readable(overviewAction)
             && overviewBox.width > 0
             && overviewBox.height > 0,
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

  const agentRoute = `/agents/detail?agent=${encodeURIComponent(AGENT)}`;

  for (const theme of THEMES) {
    // The operating system's own signal, not a stylesheet override.
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const stage of STAGES) {
      const route = `${agentRoute}&stage=${stage}`;
      await go(window, route);
      const at = await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
      // Reloaded after the resize as well: a page reads its view once, on
      // mount, and a layout settled at the previous width would be
      // photographed under this width's filename.
      await go(window, route);

      const measured = await measure(window);
      measurements.push({ stage, theme, viewport: VIEWPORT.name, ...(measured as object) });
      console.log(
        `[cockpit] ${stage}/${theme} (window reports ${String(at)}px) ${JSON.stringify(measured)}`,
      );
      await shoot(window, `agent-${stage}-${VIEWPORT.name}-${theme}`);
    }

    /*
     * And the address with no stage in it, which is what a fleet card is.
     *
     * Photographed because MAR-646 moved it: `resolveAgentStage` sends an agent
     * that has produced something to its output rather than to an overview that
     * no longer draws one. That is the half of this packet that could be got
     * wrong without any duplication being visible — a subtraction that left the
     * news on no landing page at all would be MAR-576 again, and this frame is
     * where a reviewer sees which page a link actually opens.
     */
    await go(window, agentRoute);
    await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
    await go(window, agentRoute);
    const landing = await measure(window);
    measurements.push({ stage: "(no stage named)", theme, viewport: VIEWPORT.name, ...(landing as object) });
    console.log(`[cockpit] landing/${theme} ${JSON.stringify(landing)}`);
    await shoot(window, `agent-landing-${VIEWPORT.name}-${theme}`);

    /*
     * MAR-658's scene: the same six stages, narrow, on the same busy agent —
     * asking not whether a block repeats, but whether the header's new fifth
     * action cell has room. Every stage, because the cell is frame furniture
     * that is supposed to be on all of them; Output gets no special treatment
     * here, which is the point — it is not a special case any more.
     */
    for (const stage of STAGES) {
      const route = `${agentRoute}&stage=${stage}`;
      await go(window, route);
      const at = await resizeTo(window, NARROW.width, NARROW.height);
      await go(window, route);

      const measured = await measure(window);
      measurements.push({ stage, theme, viewport: NARROW.name, ...(measured as object) });
      console.log(
        `[cockpit] ${stage}/${theme}/${NARROW.name} (window reports ${String(at)}px) ` +
          `${JSON.stringify(measured)}`,
      );
      await shoot(window, `agent-${stage}-${NARROW.name}-${theme}`);
    }

    // Back to the wide viewport before the next theme's wide pass, so a
    // resize failure reads as "would not resize to 1280" and not as a
    // leftover 375px window silently answering `at` for the next theme.
    await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), agent: AGENT, measurements }, null, 2)}\n`,
    "utf8",
  );

  /*
   * The claim these images are supposed to support, checked rather than left to
   * the reviewer's eye. A frame where the stage draws two of the rail's outputs
   * is a frame showing the defect, and filing it as evidence of the fix is
   * exactly the mistake a set of screenshots makes easy.
   */
  const doubled = measurements.filter(
    (entry) => ((entry as Record<string, number>)["repeated_titles"] ?? 0) > 1,
  );
  const overflowed = measurements.filter(
    (entry) => (entry as { page_overflows: boolean }).page_overflows,
  );
  /*
   * MAR-658. Every real stage — not the synthetic "(no stage named)" landing
   * entry, which the six real ones already cover — must show the cell that
   * takes a reader back to Overview, at both widths this harness now shoots.
   */
  const missingOverviewAction = measurements.filter(
    (entry) =>
      (entry as { stage: string }).stage !== "(no stage named)" &&
      !(entry as { overview_action_visible: boolean }).overview_action_visible,
  );
  console.log(
    `[cockpit] wrote ${String(written.length)} image(s) to ${OUT}; ` +
      `${String(doubled.length)} frame(s) draw the rail's list twice; ` +
      `${String(overflowed.length)} frame(s) overflowed sideways; ` +
      `${String(missingOverviewAction.length)} frame(s) had no visible way back to Overview`,
  );
  if (missingOverviewAction.length > 0) {
    console.log(
      "[cockpit] missing on:",
      missingOverviewAction.map((entry) => {
        const e = entry as { stage: string; theme: string; viewport: string };
        return `${e.stage}/${e.theme}/${e.viewport}`;
      }),
    );
  }
  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error("[cockpit] failed", error);
  app.exit(1);
});
