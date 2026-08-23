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

import { app, BrowserWindow, nativeTheme, shell } from "electron";

import { readFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { putAgentDomState } from "../lib/agent-dom/store.js";
import { importManifest, ingestArtifacts, ingestEvents } from "../lib/store.js";
import { fingerprintItems } from "../lib/brief/fingerprint.js";
import { agentExportsPath } from "../lib/agent-exports.js";

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

/** MAR-691. `digest-scout-1`'s deep dive, seeded below and asserted after. */
const DEEP_DIVE_HEADING_TEXT = "A closer look";
const DEEP_DIVE_TEXT =
  "Item 1 reports a supervisor for long-running agents; item 2 reports " +
  "permission brokers replacing token pass-through. Read together, both " +
  "point the same way: less trust handed to an agent up front, more of " +
  "it checked at the moment it is spent. A model could just as easily " +
  "have written https://not-a-real-source.example into this paragraph.";

/** MAR-698. Embedded in `DEEP_DIVE_TEXT` above — model prose, never DASH's. */
const MODEL_PROSE_URL = "https://not-a-real-source.example";

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
  const manifest = example("agent.manifest.example.json") as Record<string, unknown> & {
    agent: { name: string; display_name?: string };
  };
  manifest.agent.name = AGENT;
  manifest.agent.display_name = "News Scout";
  /*
   * MAR-668. A declared panel, because the duplication this issue is about
   * cannot be photographed without one.
   *
   * The shipped example declares none, so before this the Output stage's frame
   * showed DASH's card and nothing under it — a picture that looks identical
   * whether the fix is in or out. The first two of these sections are the
   * exact pair the real competitor scout declares, and they are what drew the
   * briefing a second and a third time: a `report` bound to the digest role
   * and an `outputs` section over the same role. The `note` is the control — a
   * section that draws no artifact body must be untouched by the fix.
   *
   * `latest_brief` is MAR-674 packet 5a's own addition, not the real scout's —
   * it binds to the `brief` role so the author's panel has somewhere to draw
   * the brief artifact `seed()` adds below. Without it `PanelArtifactBody`
   * would compile a `case "brief"` that this harness never exercises, because
   * `newestOfRole`/`context.artifacts.filter` only surface an artifact to a
   * panel section whose `artifact_role` names its `kind`.
   */
  manifest["agent_dom"] = {
    ...((manifest["agent_dom"] as Record<string, unknown> | undefined) ?? {}),
    panel: {
      panel_version: 1,
      title: "What the scout found",
      sections: [
        {
          id: "latest_briefing",
          type: "report",
          label: "Latest briefing",
          artifact_role: "digest",
        },
        {
          id: "latest_brief",
          type: "report",
          label: "Written up",
          artifact_role: "brief",
        },
        {
          id: "everything",
          type: "outputs",
          label: "Everything it produced",
          artifact_role: "digest",
        },
        {
          id: "about",
          type: "note",
          label: "About this scout",
          text: "It only runs when you ask it to. Nothing happens on a timer.",
        },
        /*
         * MAR-620. `draft` is an `ArtifactKind` this agent never produces, so
         * this section resolves to `record === null` and `StatedEmpty` draws
         * — the empty-state disclosure this issue gated is unreachable
         * without a section that stays genuinely empty on a store that
         * otherwise has four digests and a brief.
         */
        {
          id: "draft_note",
          type: "report",
          label: "Draft in progress",
          artifact_role: "draft",
        },
      ],
    },
  };
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
  /**
   * Shared by every digest below and by the brief seeded after them —
   * `fingerprintItems` has to run over the exact same list `run-scout-0`'s
   * digest carries, or `resolveBriefCitations` reads the join as a `mismatch`
   * and the brief draws with no citations, same as a real drift would.
   */
  const digestItems = [
    {
      headline: "A supervisor for long-running agents lands in beta",
      summary: "One paragraph of a digest, which is the thing a person opened this page to read.",
      source_name: "Hacker News",
      source_url: "https://hn.algolia.com/api/v1/search",
      item_url: "https://hn.algolia.com/api/v1/search?query=supervisor",
    },
    {
      headline: "Permission brokers replace token pass-through",
      summary: "A second item, so the open card is visibly a report rather than a line.",
      source_name: "Hacker News",
      source_url: "https://hn.algolia.com/api/v1/search",
      item_url: "https://hn.algolia.com/api/v1/search?query=brokers",
    },
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
      items: digestItems,
      /*
       * MAR-691. `digest-scout-1` only, not `digest-scout-0` — the brief
       * above is fingerprinted against `digest-scout-0`'s own item list, and
       * a deep dive on that same artifact would leave one screenshot
       * standing for two different fixes. `digest-scout-1` is never the
       * stage's default open card and never the brief's citation source, so
       * it is free to carry the deep dive without disturbing either.
       */
      ...(index === 1
        ? {
            deep_dive: {
              state: "written",
              model: "openai/gpt-5-mini",
              text: DEEP_DIVE_TEXT,
            },
          }
        : {}),
    })),
  );
  console.log(`[cockpit] ${String(accepted.accepted)} artifact(s) accepted`);

  /*
   * MAR-674 packet 5a. A `brief` derived from `digest-scout-0` — the run
   * `latest_briefing` and the telemetry below both already treat as "this
   * run" — so both `outputs.tsx`'s Output stage and `panel.tsx`'s
   * `latest_brief` section have a brief artifact to draw. `derived_from`
   * carries `fingerprintItems(digestItems)` over the identical list rather
   * than a value copied by hand, on `lib/brief/fingerprint.ts`'s own
   * warning: a drift between the hash and the list it describes turns a
   * correct brief into an uncited one, silently.
   */
  const briefAccepted = ingestArtifacts([
    {
      artifact_version: 2,
      agent: AGENT,
      run_id: "run-scout-0",
      artifact_id: "brief-scout-0",
      kind: "brief",
      title: "What the scout found today",
      generated_at: daysAgo(0),
      document: {
        model: "openai/gpt-5-mini",
        sections: [
          {
            heading: "Agent supervision is moving fast",
            paragraphs: [
              {
                body: "A supervisor for long-running agents landed in beta this week, aimed at exactly the failure mode DASH's own approval flow exists to catch.",
                items: [0],
              },
              {
                body: "Permission brokers are replacing token pass-through as the default way an agent reaches a provider, rather than holding a credential itself.",
                items: [1],
              },
            ],
          },
        ],
      },
      derived_from: {
        artifact_id: "digest-scout-0",
        run_id: "run-scout-0",
        item_count: digestItems.length,
        items_digest: fingerprintItems(digestItems),
      },
    },
  ]);
  if (briefAccepted.accepted !== 1) {
    // Silent here would mean a schema drift produces a picture of the
    // "Show what arrived" disclosure instead of the brief, which is exactly
    // the wrong-page failure this harness's own header warns against.
    throw new Error(`the seeded brief was refused: ${JSON.stringify(briefAccepted.rejected)}`);
  }
  console.log(`[cockpit] ${String(briefAccepted.accepted)} brief artifact(s) accepted`);

  /*
   * Telemetry for the newest run, so the Run stage has a feed, meters and a
   * step list rather than its empty sentences. `cost_usd` and the token counts
   * are on the step events because that is where telemetry v1 puts them — see
   * `lib/views/agent-feed.ts`, which omits any meter whose field never arrived
   * rather than drawing a zero.
   *
   * **The steps are named with `component_id` and the names come from this
   * manifest's own `planned_route`** (MAR-680). They were `step_id` and
   * `step_label` — two fields telemetry v1 does not define and nothing reads —
   * so every step line in the feed rendered as the run-level verb, and the
   * progress panel this issue added would have photographed eight declared
   * steps all reading "Not started" beside a finished run. A seed whose fields
   * no renderer reads produces a picture of the wrong page.
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
      component_id: "email_read",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 2,
      ts: startedAt,
      type: "step_completed",
      component_id: "email_read",
      status: "ok",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 3,
      ts: startedAt,
      type: "step_started",
      component_id: "schema_validation",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 4,
      ts: startedAt,
      type: "step_completed",
      component_id: "schema_validation",
      status: "ok",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 5,
      ts: startedAt,
      type: "step_started",
      component_id: "intent_classifier",
    },
    {
      event_version: 1,
      agent: AGENT,
      run_id: "run-scout-0",
      seq: 6,
      ts: startedAt,
      type: "step_completed",
      component_id: "intent_classifier",
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
      seq: 7,
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

  console.log(`[cockpit] seeded ${AGENT}: 4 digests, 1 brief, 1 run of telemetry, 1 snapshot`);
}

/** MAR-664's own agent, for the About scene below. */
const PLAN_AGENT = "competitor-scout";

/**
 * The real installed competitor scout's own six-step `planned_route`, copied
 * by value rather than read off this machine's real store — a capture
 * harness seeds a scratch store and must not reach outside it.
 *
 * The richest plan DASH holds: four fixed steps and two AI ones at different
 * declared strengths, which is what makes the About panel worth
 * photographing rather than a one-step manifest that would draw the same
 * frame regardless of what this issue built.
 */
function seedPlanAgent(): void {
  const manifest = example("agent.manifest.example.json") as Record<string, unknown> & {
    agent: { name: string; display_name?: string; goal: string };
  };
  manifest.agent.name = PLAN_AGENT;
  manifest.agent.display_name = "Competitor scout";
  manifest.agent.goal =
    "Watches public sources for what competing agent products ship and for what people praise, " +
    "complain about and ask for, and writes a briefing where every claim links to where it came from.";
  manifest["planned_route"] = [
    { step: 1, component_id: "public_source_fetch", risk_level: "low", model_tier: "none" },
    { step: 2, component_id: "signal_sort", risk_level: "low", model_tier: "none" },
    {
      step: 3,
      component_id: "digest_curate",
      risk_level: "medium",
      model_tier: "small",
      default_model_level: "cheap",
    },
    {
      step: 4,
      component_id: "deep_dive_synthesis",
      risk_level: "medium",
      model_tier: "standard",
      default_model_level: "standard",
    },
    { step: 5, component_id: "competitor_choice", risk_level: "low", model_tier: "none" },
    { step: 6, component_id: "report_file_write", risk_level: "high", model_tier: "none" },
  ];
  const imported = importManifest(manifest);
  if (!imported.ok) {
    throw new Error(`the plan agent's manifest was refused: ${JSON.stringify(imported)}`);
  }
  console.log(`[cockpit] seeded ${PLAN_AGENT}: 6-step plan, no runs`);
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
          *
          * **Scoped to DASH's own part of the stage** (MAR-668). MAR-646's rule
          * is about what DASH's components draw beside a rail DASH also draws;
          * the author's declared region is somebody else's box, and an
          * \`outputs\` section in it is the author asking to present their whole
          * history. Counting theirs here would make this number fire on a
          * manifest rather than on a DASH regression, and the alarm would be
          * read as the second and ignored. MAR-668's own number is
          * \`panel_bodies\` below.
          */
         const own = stage === null ? null : stage.cloneNode(true);
         if (own !== null) {
           for (const box of own.querySelectorAll(".agent-panel")) box.remove();
         }
         const stageText = own === null ? "" : own.textContent || "";
         const repeated = railTitles.filter((title) => stageText.includes(title));

         /*
          * MAR-668's number: how many artifact **bodies** the author's declared
          * region draws. Henrik's report was *"Now it renders the output 3
          * times"* — one card from DASH and two from the manifest — and the
          * body is the thing that was three times, not the title.
          *
          * Zero is the fixed state for an artifact the stage already drew. A
          * digest the stage did *not* draw still renders in full here, which is
          * the author keeping their ability to present.
          */
         const panelBodies = stage === null
           ? 0
           : [...stage.querySelectorAll(".agent-panel .digest-items")].filter(readable).length;

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
           /*
            * MAR-668's number, beside MAR-646's. Zero on the Output stage means
            * the briefing is drawn once, by DASH, and the author's sections
            * that resolve the same artifact are pointers to it.
            */
           panel_bodies: panelBodies,
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

  /*
   * MAR-697 / MAR-698. Both features end at `shell.openPath` or
   * `shell.openExternal` — a real PDF reader or a real browser launched on
   * the machine this runs on, which is not a thing a capture harness may
   * do, doubly so with a real DASH possibly open beside it. Both are
   * recorded rather than performed: what crosses this boundary is proof
   * enough (the exact path or URL main decided to open), and the OS-level
   * launch itself is exactly the part MAR-740 already found broken for one
   * character class, so a harness that actually launched it would be
   * exercising the one thing not being claimed here.
   */
  const openPathCalls: string[] = [];
  const openExternalCalls: string[] = [];
  shell.openPath = (async (target: string) => {
    openPathCalls.push(target);
    return "";
  }) as typeof shell.openPath;
  shell.openExternal = (async (url: string) => {
    openExternalCalls.push(url);
    return undefined;
  }) as typeof shell.openExternal;

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

  /*
   * MAR-668's scene: the author's region, which is below the fold.
   *
   * `panel_bodies` already counts the thing that matters and the loop above
   * records it on every frame. What a number cannot answer is whether the card
   * left behind *reads* as a pointer — a three-line box with a dashed edge, or
   * an output that failed to load. That distinction has no measurement and is
   * the whole reason this repository takes screenshots; four DASH defects in a
   * row have had no overflow to measure.
   *
   * Scrolled rather than resized, because the panel's position under DASH's own
   * card is MAR-641's placement and is the thing being photographed.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  await go(window, `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=output`);
  await within(
    "scroll the Output stage to the author's region",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".agent-panel")?.scrollIntoView({ block: "start" })`,
    ),
  );
  await settle(400);
  await shoot(window, "agent-output-author-panel");

  /*
   * MAR-674 packet 5a's scene: a `brief` artifact in frame in BOTH renderers.
   * `tests/brief-render.test.tsx` already asserts the document and its links
   * render in each through `renderToStaticMarkup` — real evidence, and not a
   * photograph. This is the photograph that assertion has been standing in
   * for: whether `case "brief"` actually draws, in the packaged renderer,
   * rather than only compiling. The two-renderers trap is exactly why one
   * capture without the other would prove nothing — a build that added the
   * case to `outputs.tsx` and forgot `panel.tsx` compiles clean either way.
   *
   * ONE FRAME CANNOT SHOW BOTH RENDERERS DRAWING THE SAME BRIEF IN FULL, AND
   * THAT IS MAR-668'S OWN RULE RATHER THAN A LIMIT OF THIS HARNESS. The Output
   * stage draws exactly one card in full — `resolveOpenCard`, MAR-646 — and
   * `page.tsx` tells the author's panel which artifact_id that was, so
   * `PanelArtifactCard` yields the body for exactly that one (`panel.tsx`
   * :414). Point both at the same brief and the panel photograph would only
   * ever show the yield sentence, which exercises `describeArtifactRole`
   * rather than `PanelArtifactBody`'s `case "brief"` — not the branch this
   * proof is about. So the two shots below open DIFFERENT cards on purpose,
   * via the `output` query param `app/_data/routes.ts` defines: the first
   * opens the brief so `outputs.tsx` draws it, the second opens a digest so
   * the brief is NOT the stage's open card and `panel.tsx` draws it instead
   * of yielding to a copy that, in this second shot, is not there.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  const briefOpenRoute =
    `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=output&output=${encodeURIComponent("brief-scout-0")}`;
  await go(window, briefOpenRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, briefOpenRoute);
  await settle(400);
  await shoot(window, "agent-output-brief-outputs-area");

  const digestOpenRoute =
    `/agents/detail?agent=${encodeURIComponent(AGENT)}&stage=output&output=${encodeURIComponent("digest-scout-0")}`;
  await go(window, digestOpenRoute);
  const at = await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, digestOpenRoute);
  await within(
    "scroll the author's panel to the brief section",
    5_000,
    window.webContents.executeJavaScript(
      `[...document.querySelectorAll(".agent-panel-section h3")].find((el) => el.textContent === "Written up")?.scrollIntoView({ block: "center" })`,
    ),
  );
  await settle(400);
  const panelBriefCard = await within(
    "confirm the panel drew the brief's body rather than yielding to it",
    5_000,
    window.webContents.executeJavaScript(
      `Boolean([...document.querySelectorAll(".agent-panel-section")]
        .find((el) => el.querySelector("h3")?.textContent === "Written up")
        ?.querySelector(".output-card:not(.is-elsewhere)"))`,
    ),
  );
  console.log(
    `[cockpit] panel drew the brief's body rather than yielding (window reports ${String(at)}px): ${String(panelBriefCard)}`,
  );
  if (panelBriefCard !== true) {
    throw new Error(
      "the author's panel yielded the brief instead of drawing it — the open card must not be brief-scout-0 here",
    );
  }
  await shoot(window, "agent-output-brief-author-panel");

  /*
   * MAR-664's scene: the About disclosure, closed and then open, on the
   * scout with the richest plan DASH holds. One viewport, one theme — this
   * is not asking whether the frame's layout survives every width the way
   * the loop above is; it is asking whether the goal and the plan actually
   * render inside the disclosure, which is true or false regardless of size.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  seedPlanAgent();
  const planRoute = `/agents/detail?agent=${encodeURIComponent(PLAN_AGENT)}&stage=overview`;
  await go(window, planRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, planRoute);

  await shoot(window, "agent-about-closed");
  /*
   * `.open` is a boolean IDL property and reads `false` when the attribute is
   * absent — never `null` or `undefined` — so the closed check has to compare
   * against `false` explicitly rather than lean on `??`, which a missing
   * element would also produce and which this line must tell apart from a
   * present-but-closed one.
   */
  const closedOpenAttr = await within(
    "read the About disclosure before opening it",
    5_000,
    window.webContents.executeJavaScript(
      `(() => { const el = document.querySelector(".cockpit-about"); return el === null ? "missing" : el.open; })()`,
    ),
  );

  /*
   * `<details>` opened by dispatching a real click on the summary rather than
   * setting `.open` in script — a closed `<details>` keeps its layout boxes,
   * and the thing worth proving here is that a person's own press reveals the
   * goal and the plan, not that the DOM property can be flipped.
   */
  await within(
    "open the About disclosure",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".cockpit-about > summary")?.click()`,
    ),
  );
  await settle(400);
  const openOpenAttr = await within(
    "read the About disclosure after opening it",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".cockpit-about")?.open ?? null`,
    ),
  );
  const aboutText = await within(
    "read the About panel's text",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".cockpit-about-panel")?.textContent ?? ""`,
    ),
  );
  await shoot(window, "agent-about-open");

  console.log(
    `[cockpit] about: closed.open=${JSON.stringify(closedOpenAttr)} open.open=${JSON.stringify(openOpenAttr)} ` +
      `panel_words=${String(String(aboutText).split(/\s+/).filter(Boolean).length)}`,
  );
  measurements.push({
    stage: "about",
    theme: "light",
    viewport: VIEWPORT.name,
    closed_before_press: closedOpenAttr === false,
    open_after_press: openOpenAttr === true,
    goal_in_panel: String(aboutText).includes(
      "Watches public sources for what competing agent products ship",
    ),
    steps_in_panel: ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5", "Step 6"].every((label) =>
      String(aboutText).includes(label),
    ),
  });

  /*
   * MAR-635's own scene: the live feed and telemetry panel, with real
   * recorded facts behind every number — the busy half of the bar
   * `electron/capture-deploy.ts`'s `agent-feed`/`agent-commands` surfaces
   * only ever photograph empty, because that harness's own agent has never
   * run. `run-scout-0`'s eight telemetry-v1 events (seeded above, used by
   * the STAGES loop's own `run` stage) give this store a run with a model,
   * token counts and a cost — this scrolls past `RunProgress`'s step list
   * to the feed and telemetry grid underneath it.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  const feedRoute = `${agentRoute}&stage=run`;
  await go(window, feedRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, feedRoute);
  await within(
    "scroll to the live feed and telemetry grid",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".agent-command-grid")?.scrollIntoView({ block: "start" })`,
    ),
  );
  await settle(400);
  const feedFacts = (await within(
    "read the live feed and telemetry panel",
    5_000,
    window.webContents.executeJavaScript(
      `(() => {
         const grid = document.querySelector(".agent-command-grid");
         if (grid === null) return { found: false };
         return { found: true, text: grid.textContent ?? "" };
       })()`,
    ),
  )) as { found: boolean; text?: string };
  await shoot(window, "agent-run-feed-telemetry");
  console.log(`[cockpit] MAR-635 feed/telemetry: ${JSON.stringify(feedFacts)}`);
  measurements.push({
    stage: "run-feed-telemetry",
    theme: "light",
    viewport: VIEWPORT.name,
    grid_found: feedFacts.found,
    // The exact step name and model telemetry v1 recorded on run-scout-0's
    // seeded events, not a placeholder — proof the numbers point at a fact.
    feed_shows_recorded_step: (feedFacts.text ?? "").includes("Intent classifier"),
    telemetry_shows_recorded_model: (feedFacts.text ?? "").includes("openai/gpt-5-mini"),
    telemetry_shows_recorded_cost: (feedFacts.text ?? "").includes("0.0041")
      || (feedFacts.text ?? "").replace(/[,.]/g, "").includes("0041"),
  });

  /*
   * MAR-620's scene: the empty-state disclosure.
   *
   * `draft_note` (seeded above) is a `report` section bound to `draft`, a
   * kind this agent never produces, so `StatedEmpty` draws unconditionally
   * on every frame in this store — the one section here that stays
   * genuinely empty beside four digests and a brief.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  const disclosureRoute = `${agentRoute}&stage=output`;
  await go(window, disclosureRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, disclosureRoute);
  await within(
    "scroll to the empty-state disclosure",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".agent-panel-empty-disclosure")?.scrollIntoView({ block: "center" })`,
    ),
  );
  await settle(400);
  const disclosureClosed = (await within(
    "read the empty-state disclosure before opening it",
    5_000,
    window.webContents.executeJavaScript(
      `(() => {
         const el = document.querySelector(".agent-panel-empty-disclosure");
         if (el === null) return { found: false };
         return { found: true, open: el.open, summary: el.querySelector("summary")?.textContent ?? null };
       })()`,
    ),
  )) as { found: boolean; open?: boolean; summary?: string | null };
  await shoot(window, "agent-output-empty-disclosure-closed");
  await within(
    "open the empty-state disclosure with a real click on its summary",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".agent-panel-empty-disclosure > summary")?.click()`,
    ),
  );
  await settle(400);
  const disclosureOpen = (await within(
    "read the empty-state disclosure and its revealed meaning",
    5_000,
    window.webContents.executeJavaScript(
      `(() => {
         const el = document.querySelector(".agent-panel-empty-disclosure");
         if (el === null) return { found: false };
         return { found: true, open: el.open, text: el.textContent ?? "" };
       })()`,
    ),
  )) as { found: boolean; open?: boolean; text?: string };
  await shoot(window, "agent-output-empty-disclosure-open");
  console.log(
    `[cockpit] MAR-620 disclosure: closed=${JSON.stringify(disclosureClosed)} open.open=${String(disclosureOpen.open)}`,
  );
  measurements.push({
    stage: "empty-disclosure",
    theme: "light",
    viewport: VIEWPORT.name,
    disclosure_found: disclosureClosed.found,
    closed_before_press: disclosureClosed.open === false,
    summary_is_dash_fixed_string: disclosureClosed.summary === "DASH explains this empty section",
    open_after_press: disclosureOpen.open === true,
    meaning_revealed: (disclosureOpen.text ?? "").length > (disclosureClosed.summary ?? "").length,
  });

  /*
   * MAR-691's scene: `digest-scout-1`'s deep dive, drawn on both renderers.
   *
   * The first shot opens `digest-scout-1` directly, so `outputs.tsx`'s own
   * card draws it. The second opens the brief instead, so `digest-scout-1`
   * is "elsewhere" on the stage and the panel's `everything` outputs
   * section draws its own full body rather than yielding — the same
   * two-renderers trap MAR-668's brief scene above already argues, applied
   * to the deep dive rather than the brief.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  const deepDiveOpenRoute = `${agentRoute}&stage=output&output=${encodeURIComponent("digest-scout-1")}`;
  await go(window, deepDiveOpenRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, deepDiveOpenRoute);
  await settle(400);
  const stageDeepDive = String(
    await within(
      "read the Output stage's own deep dive",
      5_000,
      window.webContents.executeJavaScript(`document.querySelector(".cockpit-stage")?.textContent ?? ""`),
    ),
  );
  await shoot(window, "agent-output-deep-dive-stage");

  const deepDiveElsewhereRoute = `${agentRoute}&stage=output&output=${encodeURIComponent("brief-scout-0")}`;
  await go(window, deepDiveElsewhereRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, deepDiveElsewhereRoute);
  await within(
    "scroll to the everything section",
    5_000,
    window.webContents.executeJavaScript(
      `[...document.querySelectorAll(".agent-panel-section h3")].find((el) => el.textContent === "Everything it produced")?.scrollIntoView({ block: "start" })`,
    ),
  );
  await settle(400);
  const panelDeepDive = String(
    await within(
      "read the author panel's deep dive",
      5_000,
      window.webContents.executeJavaScript(`document.querySelector(".agent-panel")?.textContent ?? ""`),
    ),
  );
  await shoot(window, "agent-output-deep-dive-panel");
  console.log(
    `[cockpit] MAR-691 deep dive: stage_heading=${String(stageDeepDive.includes(DEEP_DIVE_HEADING_TEXT))} ` +
      `stage_text=${String(stageDeepDive.includes(DEEP_DIVE_TEXT))} ` +
      `panel_heading=${String(panelDeepDive.includes(DEEP_DIVE_HEADING_TEXT))} ` +
      `panel_text=${String(panelDeepDive.includes(DEEP_DIVE_TEXT))}`,
  );
  measurements.push({
    stage: "deep-dive-stage",
    theme: "light",
    viewport: VIEWPORT.name,
    heading_present: stageDeepDive.includes(DEEP_DIVE_HEADING_TEXT),
    text_present: stageDeepDive.includes(DEEP_DIVE_TEXT),
  });
  measurements.push({
    stage: "deep-dive-panel",
    theme: "light",
    viewport: VIEWPORT.name,
    heading_present: panelDeepDive.includes(DEEP_DIVE_HEADING_TEXT),
    text_present: panelDeepDive.includes(DEEP_DIVE_TEXT),
  });

  /*
   * MAR-698's scene: a digest's own collected links, clicked for real.
   *
   * `digest-scout-0` carries no deep dive, so this is unrelated to the
   * scene above. `LinkOut` intercepts the press and hands the address to
   * main through `open.link`; `shell.openExternal` is stubbed above, so
   * what proves the wiring is the exact URL that arrived there and the
   * window's own address staying put — never a real browser launched on
   * this machine.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  const digestOpenRouteForLinks = `${agentRoute}&stage=output&output=${encodeURIComponent("digest-scout-0")}`;
  await go(window, digestOpenRouteForLinks);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, digestOpenRouteForLinks);
  await settle(400);
  const urlBeforeClick = window.webContents.getURL();
  const linkFacts = (await within(
    "read the first collected item's anchor before pressing it",
    5_000,
    window.webContents.executeJavaScript(
      `(() => {
         const a = document.querySelector(".cockpit-stage .output-card a[href^='https://']");
         if (a === null) return { found: false };
         return { found: true, href: a.getAttribute("href"), rel: a.getAttribute("rel"), text: a.textContent };
       })()`,
    ),
  )) as { found: boolean; href?: string | null; rel?: string | null; text?: string | null };
  await shoot(window, "agent-output-link-before-click");
  await within(
    "press the collected item's link for real",
    5_000,
    window.webContents.executeJavaScript(
      `document.querySelector(".cockpit-stage .output-card a[href^='https://']")?.click()`,
    ),
  );
  await settle(400);
  const urlAfterClick = window.webContents.getURL();
  console.log(
    `[cockpit] MAR-698 link: href=${JSON.stringify(linkFacts.href)} rel=${JSON.stringify(linkFacts.rel)} ` +
      `openExternalCalls=${JSON.stringify(openExternalCalls)} url_unchanged=${String(urlBeforeClick === urlAfterClick)}`,
  );
  measurements.push({
    stage: "outbound-link",
    theme: "light",
    viewport: VIEWPORT.name,
    anchor_found: linkFacts.found,
    anchor_rel_noreferrer_noopener: linkFacts.rel === "noreferrer noopener",
    window_did_not_navigate: urlBeforeClick === urlAfterClick,
    open_external_called_once: openExternalCalls.length === 1,
    open_external_url_matches_anchor: openExternalCalls[0] === linkFacts.href,
  });

  /*
   * MAR-698's other half: a citation reference, and the control that proves
   * model prose stays linkless.
   *
   * `brief-scout-0`'s two paragraphs cite `digestItems[0]`/`[1]`, both
   * carrying `item_url`, so `BriefParagraphBody` must draw a real anchor
   * under "Written from" (`.brief-cited`, `app/_components/digest.tsx`).
   * `DEEP_DIVE_TEXT` (seeded on `digest-scout-1`, MAR-691) now carries a URL
   * a model wrote — proving it stays text is this issue's other stated bar,
   * and nothing above exercises it.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  const citationRoute = `${agentRoute}&stage=output&output=${encodeURIComponent("brief-scout-0")}`;
  await go(window, citationRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, citationRoute);
  await settle(400);
  const citationFacts = (await within(
    "read the brief's own Written-from citation before pressing it",
    5_000,
    window.webContents.executeJavaScript(
      `(() => {
         const a = document.querySelector(".cockpit-stage .output-card .brief-cited a[href^='https://']");
         if (a === null) return { found: false };
         return { found: true, href: a.getAttribute("href"), rel: a.getAttribute("rel") };
       })()`,
    ),
  )) as { found: boolean; href?: string | null; rel?: string | null };
  await shoot(window, "agent-output-brief-citation-link");

  const proseRoute = `${agentRoute}&stage=output&output=${encodeURIComponent("digest-scout-1")}`;
  await go(window, proseRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, proseRoute);
  await settle(400);
  const proseFacts = (await within(
    "confirm the model's own URL in the deep dive drew no anchor",
    5_000,
    window.webContents.executeJavaScript(
      `(() => {
         const text = document.querySelector(".cockpit-stage")?.textContent ?? "";
         const anchored = [...document.querySelectorAll(".cockpit-stage a")]
           .some((a) => a.getAttribute("href") === ${JSON.stringify(MODEL_PROSE_URL)});
         return { url_present_as_text: text.includes(${JSON.stringify(MODEL_PROSE_URL)}), anchored };
       })()`,
    ),
  )) as { url_present_as_text: boolean; anchored: boolean };
  await shoot(window, "agent-output-deep-dive-prose-url");

  console.log(
    `[cockpit] MAR-698 citation: href=${JSON.stringify(citationFacts.href)} rel=${JSON.stringify(citationFacts.rel)} ` +
      `prose_url_present=${String(proseFacts.url_present_as_text)} prose_url_anchored=${String(proseFacts.anchored)}`,
  );
  measurements.push({
    stage: "outbound-citation",
    theme: "light",
    viewport: VIEWPORT.name,
    citation_anchor_found: citationFacts.found,
    citation_rel_noreferrer_noopener: citationFacts.rel === "noreferrer noopener",
    model_prose_url_present: proseFacts.url_present_as_text,
    model_prose_url_stayed_unanchored: proseFacts.url_present_as_text && !proseFacts.anchored,
  });

  /*
   * MAR-697's scene: Save as PDF, for real, into `exports/<agent>/`.
   *
   * The brief is the only artifact kind `outputs.tsx` shows the export
   * button for. `shell.openPath` is stubbed above — the same auto-open
   * `exportBriefAsPdf` performs after every save — so this proves the save
   * half only: a real PDF lands on disk at the folder MAR-697 chose, and
   * the Output stage's own list (`ExportsList`) reads it back after the
   * page's refresh key bumps. What this scene deliberately does NOT do is
   * press the resulting "Saved files" entry to reopen it — that is
   * `openAgentExport`, the exact path MAR-740 found broken for a title
   * carrying an em dash, and is left to the session fixing it.
   */
  nativeTheme.themeSource = "light";
  await settle(300);
  const exportRoute = `${agentRoute}&stage=output&output=${encodeURIComponent("brief-scout-0")}`;
  await go(window, exportRoute);
  await resizeTo(window, VIEWPORT.width, VIEWPORT.height);
  await go(window, exportRoute);
  await settle(400);
  const exportsBefore = (await within(
    "confirm no Saved files section exists yet",
    5_000,
    window.webContents.executeJavaScript(`document.querySelector(".agent-exports") === null`),
  )) as boolean;
  await shoot(window, "agent-output-exports-before-save");
  await within(
    "press Save as PDF for real",
    5_000,
    window.webContents.executeJavaScript(
      `[...document.querySelectorAll(".output-footer button")].find((b) => b.textContent === "Save as PDF")?.click()`,
    ),
  );
  const feedback = (await within(
    "wait for and read the save feedback notice",
    10_000,
    (async () => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const found: string | null = await window.webContents.executeJavaScript(
          `document.querySelector(".notice")?.textContent ?? null`,
        );
        if (found !== null) return found;
        await settle(200);
      }
      return null;
    })(),
  )) as string | null;
  await settle(400);
  await shoot(window, "agent-output-exports-feedback");

  // A store read, not a screenshot: the folder MAR-697 chose, read directly
  // off disk rather than trusted from the page's own sentence about it.
  const exportsFolder = agentExportsPath(process.env.DASH_DATA_DIR ?? "", AGENT);
  let savedFiles: string[] = [];
  try {
    savedFiles = readdirSync(exportsFolder);
  } catch {
    savedFiles = [];
  }
  const pdfMagicOk = savedFiles.length > 0
    ? readFileSync(path.join(exportsFolder, savedFiles[0] as string)).subarray(0, 5).toString("latin1") === "%PDF-"
    : false;

  // Reloaded so the page's own poll of the folder is what draws the list
  // below, not a stale render from before the save.
  await go(window, exportRoute);
  await settle(600);
  const exportsAfter = (await within(
    "read the Saved files list after the save",
    5_000,
    window.webContents.executeJavaScript(
      `(() => {
         const section = document.querySelector(".agent-exports");
         if (section === null) return { found: false };
         const rows = [...section.querySelectorAll(".export-row .export-open")].map((el) => el.textContent);
         return { found: true, heading: section.querySelector("h2")?.textContent ?? null, rows };
       })()`,
    ),
  )) as { found: boolean; heading?: string | null; rows?: string[] };
  await shoot(window, "agent-output-exports-after-save");

  console.log(
    `[cockpit] MAR-697 export: feedback=${JSON.stringify(feedback)} savedFiles=${JSON.stringify(savedFiles)} ` +
      `pdfMagicOk=${String(pdfMagicOk)} openPathCalls=${JSON.stringify(openPathCalls)} exportsAfter=${JSON.stringify(exportsAfter)}`,
  );
  measurements.push({
    stage: "exports-save",
    theme: "light",
    viewport: VIEWPORT.name,
    exports_section_absent_before_save: exportsBefore,
    feedback_ok: (feedback ?? "").startsWith("Saved"),
    file_written_to_disk: savedFiles.length > 0,
    file_is_a_real_pdf: pdfMagicOk,
    open_path_called_with_the_saved_file:
      openPathCalls.length > 0 && savedFiles.length > 0 && (openPathCalls[0] ?? "").endsWith(savedFiles[0] as string),
    exports_list_shows_it_after_reload: (exportsAfter.rows ?? []).length > 0,
    // Deliberately not exercised — MAR-740's own bug, left to its fix session.
    click_to_reopen_exercised: false,
  });

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
  /*
   * MAR-668's own claim, checked the same way and for the same reason: a
   * screenshot of a page that draws one briefing looks exactly like a
   * screenshot of a page that draws three, until you hold them up together.
   *
   * The author's region may draw a body — an artifact the stage did not show is
   * theirs to present in full. What it may not do is draw the body of the one
   * the stage is already showing, and on this seed the stage always shows the
   * newest, so the fixed number here is zero on every frame.
   */
  const restated = measurements.filter(
    (entry) => ((entry as Record<string, number>)["panel_bodies"] ?? 0) > 0,
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
      // MAR-664's own scene, appended below — it is not one of `STAGES` and
      // was not put through `measure()`, so it carries no verdict for this
      // check to read.
      (entry as { stage: string }).stage !== "about" &&
      !(entry as { overview_action_visible: boolean }).overview_action_visible,
  );
  const about = measurements.find((entry) => (entry as { stage: string }).stage === "about") as
    | { closed_before_press: boolean; open_after_press: boolean; goal_in_panel: boolean; steps_in_panel: boolean }
    | undefined;
  if (about !== undefined && (!about.closed_before_press || !about.open_after_press || !about.goal_in_panel || !about.steps_in_panel)) {
    console.log(`[cockpit] the About scene did not prove what it set out to: ${JSON.stringify(about)}`);
  }
  console.log(
    `[cockpit] wrote ${String(written.length)} image(s) to ${OUT}; ` +
      `${String(doubled.length)} frame(s) draw the rail's list twice; ` +
      `${String(restated.length)} frame(s) draw a briefing DASH already drew; ` +
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
