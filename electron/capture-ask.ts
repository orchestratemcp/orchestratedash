/**
 * Screenshots of the conversation, in the real shell (MAR-545). **Not part of
 * the shipped shell.**
 *
 * `electron/capture.ts` walks every surface and photographs whatever the machine
 * happens to hold. It is the wrong harness for this feature for
 * `electron/capture-models.ts`'s reason, at the same sharpness: **this section
 * has five states and which one is drawn depends on the vault, on a settings row
 * and on what the agent has saved.** A run against one person's store
 * photographs whichever state it happens to be in and cannot say which.
 *
 * So this points the same real renderer at a store this run seeds, one agent per
 * state:
 *
 * - `answered`      — a key, a model, saved reports, and a conversation with a
 *                     good answer, a failed question and their costs
 * - `no-key`        — declares a model provider and DASH holds no key for it
 * - `no-model`      — a key is held and nobody has named a model to ask under
 * - `nothing-saved` — a key and a model, and the agent has found nothing yet
 * - `no-provider`   — the agent has no model provider at all
 *
 * ## What is real here, and the four things that are not
 *
 * Real: the packaged renderer and its compiled stylesheet, the `dash-app://ui/`
 * routes, `workspaceView()` arriving over the read channel, every sentence
 * composed by `lib/copy/ask.ts` from rows this run wrote through the ordinary
 * doors, and `app/tokens.css` resolved against a `color-scheme` the operating
 * system's own signal moved.
 *
 * Not real, and stated rather than left for a reader of the PNGs to infer:
 *
 * 1. **Whose data it is.** The store is a scratch directory this run seeded.
 * 2. **No key is in the vault**, exactly as in MAR-583's harness: `held` is a
 *    row in `connection_secrets` written through `recordSecretReference` with a
 *    masked hint, and there is no credential behind it.
 * 3. **NO MODEL PROVIDER HAS BEEN CONTACTED, AND NOBODY HAS BEEN CHARGED.** The
 *    answers in these images were written by this file. `recordExchange` is the
 *    same door `electron/ask-host.ts` writes through, so what is photographed is
 *    a real rendering of a real row — and the row was not produced by asking
 *    anybody anything. **Pressing Ask in these images would fail**, and this
 *    harness does not press it.
 * 4. **The amounts are invented for the scene.** `$0.0031` here is a number this
 *    file wrote into `amount_usd`, not one OpenRouter stated. What the images
 *    prove is that a stated amount is drawn and attributed; that a real provider
 *    states one is `docs/adr/0012-talking-to-an-agent.md`'s reading of its
 *    documentation, and is not proven anywhere.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-ask'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar545'
 *     pnpm exec electron dist/electron/capture-ask.mjs
 *
 * Every line is load-bearing and each has cost a session before — see
 * `electron/capture-models.ts`'s header, which argues all five.
 *
 * ## What it leaves behind, said out loud
 *
 * Importing `./main.js` starts a **runner** against the scratch store, and
 * `app.exit(0)` does not stop it. Each run leaves one live runner holding a
 * scratch store, exactly as every other capture harness already does.
 */

/*
 * `electron/smoke-identity.ts` is deliberately **not** imported, for
 * `electron/capture-glance.ts`'s reason: borrowing the app's name borrows its
 * single-instance lock, which would mean this could only run with DASH closed.
 */
import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, nativeTheme } from "electron";

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { recordExchange } from "../lib/ai/ask-store.js";
import { writeAgentModelChoice } from "../lib/ai/model-store.js";
import { connectionSecretName } from "../lib/connection-credentials.js";
import { maskSecret, recordSecretReference } from "../lib/secret-refs.js";
import { importManifest, ingestArtifacts, ingestEvents } from "../lib/store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar545");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;
const DENSITIES = ["comfortable", "compact"] as const;

const ANSWERED = "answered";
const NO_KEY = "no-key";
const NO_MODEL = "no-model";
const NOTHING_SAVED = "nothing-saved";
const NO_PROVIDER = "no-provider";

const CONNECTION = "models";
const FIELD = "key";

const SCENES: ReadonlyArray<{ agent: string; label: string }> = [
  { agent: ANSWERED, label: "answered" },
  { agent: NO_KEY, label: "no-key" },
  { agent: NO_MODEL, label: "no-model" },
  { agent: NOTHING_SAVED, label: "nothing-saved" },
  { agent: NO_PROVIDER, label: "no-provider" },
];

/* ---------------------------------------------------------------------- *
 * The scene
 * ---------------------------------------------------------------------- */

/** One agent, optionally declaring a model provider. `scene`'s twin next door. */
function scene(name: string, displayName: string, withProvider: boolean): Record<string, unknown> {
  const manifest = JSON.parse(
    readFileSync(
      path.resolve(process.cwd(), "examples", "dash-managed.manifest.v2.example.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;

  const agent = manifest["agent"] as Record<string, unknown>;
  agent["name"] = name;
  agent["display_name"] = displayName;

  manifest["planned_route"] = [
    { step: 1, component_id: "public_feed_fetch", risk_level: "low", model_tier: "none" },
    {
      step: 2,
      component_id: "digest_write",
      risk_level: "low",
      model_tier: "small",
      default_model_level: "cheap",
    },
  ];

  (manifest["agent_dom"] as Record<string, unknown>)["connections"] = withProvider
    ? [
        {
          id: CONNECTION,
          provider: "openrouter",
          label: "Your model provider",
          purpose: "Turn the day's articles into a digest",
          ownership: "dash_managed",
          capabilities: [{ id: "model.completion", label: "Write the digest", access: "write" }],
          fields: [
            {
              id: FIELD,
              label: "API key",
              purpose: "So DASH can reach the provider on this agent's behalf",
              kind: "secret",
              required: true,
              help: "Your OpenRouter account has a keys page.",
            },
          ],
          validation_action: { id: "check", label: "Check", behavior: "test" },
        },
      ]
    : [];
  return manifest;
}

/** Import one scene, and fail the run if the store refused it. */
function importScene(manifest: Record<string, unknown>): void {
  const imported = importManifest(manifest);
  if (!imported.ok) {
    throw new Error(`the seeded manifest was refused: ${(imported.errors ?? []).join("; ")}`);
  }
}

/** One digest, through the door the runner's artifacts arrive by. */
function saveReport(agentName: string, runId: string, at: string): void {
  const accepted = ingestArtifacts([
    {
      artifact_version: 1,
      kind: "digest",
      agent: agentName,
      run_id: runId,
      artifact_id: `digest-${runId}`,
      title: `Morning briefing, ${at.slice(0, 10)}`,
      generated_at: at,
      items: [
        {
          headline: "Chip makers brace for new tariffs",
          summary: "The rate rises in September, and two suppliers have already warned on margins.",
          source_name: "Example Wire",
          item_url: "https://example.test/chips",
          published_at: at,
        },
        {
          headline: "Regulator opens an inquiry into model pricing",
          summary: "Three providers have been asked for their rate cards.",
          source_name: "Example Daily",
          item_url: "https://example.test/inquiry",
          published_at: at,
        },
      ],
    },
  ]);
  if (accepted.accepted !== 1) {
    throw new Error(`the seeded report was refused for ${agentName}`);
  }
}

function seed(): void {
  const now = new Date().toISOString();

  const holdKeyFor = (agentName: string): void => {
    recordSecretReference({
      agent: agentName,
      connection_id: CONNECTION,
      field_id: FIELD,
      secret_name: connectionSecretName(agentName, CONNECTION, FIELD),
      masked_hint: maskSecret("sk-or-v1-capture-scene-only-2f8c"),
      backend: "file",
    });
  };

  /* 1. Everything present, and a conversation that has happened. */
  importScene(scene(ANSWERED, "AI news scout", true));
  holdKeyFor(ANSWERED);
  writeAgentModelChoice(ANSWERED, "openrouter", "openai/gpt-5-mini", now);
  saveReport(ANSWERED, "run-1", "2026-08-09T06:00:00.000Z");
  saveReport(ANSWERED, "run-2", "2026-08-10T06:00:00.000Z");

  const cited = [
    {
      index: 1,
      headline: "Chip makers brace for new tariffs",
      source_name: "Example Wire",
      item_url: "https://example.test/chips",
      report_title: "Morning briefing, 2026-08-10",
      run_id: "run-2",
      artifact_id: "digest-run-2",
    },
    {
      index: 2,
      headline: "Regulator opens an inquiry into model pricing",
      source_name: "Example Daily",
      item_url: "https://example.test/inquiry",
      report_title: "Morning briefing, 2026-08-09",
      run_id: "run-1",
      artifact_id: "digest-run-1",
    },
  ];

  /*
   * An answer, written by this file. See point 3 of the header: this is the same
   * door `electron/ask-host.ts` writes through, and nothing was asked to produce
   * it. The amount is invented for the scene.
   */
  recordExchange({
    agent: ANSWERED,
    asked_at: "2026-08-10T09:00:00.000Z",
    question: "What have you found about tariffs?",
    answer:
      "Two of your saved reports mention tariffs. The newest one says chip makers expect a rate " +
      "rise in September, and that two suppliers have already warned about their margins. An " +
      "earlier report notes a regulator has opened an inquiry into model pricing, which is a " +
      "separate matter. Nothing you have saved says what the new rate will be.",
    failure: null,
    basis: "matched",
    provider_id: "openrouter",
    model_id: "openai/gpt-5-mini",
    tokens_in: 1240,
    tokens_out: 96,
    amount_usd: 0.0031,
    citations: cited,
  });

  /* The failed half of the pair, so both outcomes are in the picture. */
  recordExchange({
    agent: ANSWERED,
    asked_at: "2026-08-10T09:04:00.000Z",
    question: "And what about shipping costs?",
    answer: null,
    failure: "provider_refused",
    basis: "newest",
    provider_id: "openrouter",
    model_id: null,
    tokens_in: null,
    tokens_out: null,
    amount_usd: null,
    citations: [],
  });

  /*
   * And what the agent says its own runs cost — telemetry v1's `cost_usd`, which
   * `lib/views/ask.ts` is the first thing in DASH to read. Seeded because the
   * first run of this harness photographed sixty frames without that sentence in
   * any of them: the scenes had reports and no events, so the one line these
   * images are meant to prove is attributed was never drawn.
   *
   * Two runs, each reporting a cost on its own completion event, exactly as the
   * frozen contract carries it.
   */
  const reported = ingestEvents([
    {
      event_version: 1,
      agent: ANSWERED,
      run_id: "run-1",
      seq: 1,
      ts: "2026-08-09T06:00:10.000Z",
      type: "run_completed",
      status: "ok",
      model: "openai/gpt-5-mini",
      tokens_in: 4200,
      tokens_out: 610,
      cost_usd: 0.0142,
    },
    {
      event_version: 1,
      agent: ANSWERED,
      run_id: "run-2",
      seq: 1,
      ts: "2026-08-10T06:00:10.000Z",
      type: "run_completed",
      status: "ok",
      model: "openai/gpt-5-mini",
      tokens_in: 3900,
      tokens_out: 580,
      cost_usd: 0.0131,
    },
  ]);
  if (reported.accepted !== 2) {
    throw new Error("the seeded run events were refused");
  }

  /* 2. A provider declared and no key held. */
  importScene(scene(NO_KEY, "Unconnected scout", true));
  saveReport(NO_KEY, "run-1", "2026-08-10T06:00:00.000Z");

  /* 3. A key held and no model named. */
  importScene(scene(NO_MODEL, "Unrouted scout", true));
  holdKeyFor(NO_MODEL);
  saveReport(NO_MODEL, "run-1", "2026-08-10T06:00:00.000Z");

  /* 4. Everything set up and nothing found yet. */
  importScene(scene(NOTHING_SAVED, "Fresh scout", true));
  holdKeyFor(NOTHING_SAVED);
  writeAgentModelChoice(NOTHING_SAVED, "openrouter", "openai/gpt-5-mini", now);

  /* 5. No model provider at all, which is every agent shipped today. */
  importScene(scene(NO_PROVIDER, "Plain scout", false));
  saveReport(NO_PROVIDER, "run-1", "2026-08-10T06:00:00.000Z");

  console.log("[ask] seeded 5 agents: answered, no-key, no-model, nothing-saved, no-provider");
}

/* ---------------------------------------------------------------------- *
 * The harness — the same guards `electron/capture-models.ts` earned
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

/** Photograph the window, retrying a compositor that was not ready. */
async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let last: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const image = await within(
        `capturePage for ${name}`,
        20_000,
        target.webContents.capturePage(),
      );
      writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
      const size = image.getSize();
      written.push(name);
      console.log(`[ask] ${name}.png ${String(size.width)}x${String(size.height)}`);
      return;
    } catch (error: unknown) {
      last = error;
      console.log(`[ask] ${name} did not compose on attempt ${String(attempt + 1)}; retrying`);
      await settle(700);
    }
  }
  throw new Error(`could not photograph ${name}: ${String(last)}`);
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

/**
 * Put the page into one density, by pressing the control until it is there.
 *
 * **Not a blind toggle**, and the first run of this harness is why. Density is a
 * stored preference that survives a navigation, so a harness that clicked once
 * per frame flipped it every time and labelled half the images with the density
 * they were not taken at — a set of forty-eight photographs where every filename
 * saying `compact` was a coin toss. `resizeTo` guards the same class of lie
 * about width, and this is the same guard for the other axis.
 *
 * Still a click rather than an attribute write, for `openSources`' reason: the
 * picture stays a small proof that the control is reachable.
 *
 * Null when there is no control on this page at all, which the caller reports
 * rather than photographs.
 */
async function setDensity(target: BrowserWindow, want: string): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const at = (await target.webContents.executeJavaScript(
      `document.documentElement.getAttribute("data-density")`,
    )) as string | null;
    if (at === want) {
      return at;
    }
    const pressed = (await target.webContents.executeJavaScript(
      `(() => {
         const button = document.querySelector("button.density-toggle");
         if (button === null) return null;
         button.click();
         return document.documentElement.getAttribute("data-density");
       })()`,
    )) as string | null;
    if (pressed === null) {
      return null;
    }
    await settle(350);
  }
  return (await target.webContents.executeJavaScript(
    `document.documentElement.getAttribute("data-density")`,
  )) as string | null;
}

/**
 * Open the sources disclosure, the way a person does.
 *
 * Not `setAttribute("open", "")`, for `openSteps`' reason: a harness that set the
 * attribute would produce identical output whether or not the summary was
 * reachable, and the picture would stop being a small proof as well as an image.
 */
async function openSources(target: BrowserWindow): Promise<boolean> {
  const opened = (await target.webContents.executeJavaScript(
    `(() => {
       const summary = document.querySelector("details.ask-sources > summary");
       if (summary === null) return false;
       summary.click();
       return document.querySelector("details.ask-sources").open === true;
     })()`,
  )) as boolean;
  await settle(350);
  return opened;
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
 * Five things, and three of them are this feature's whole argument.
 *
 * **`says_artifact`** is MAR-545's own acceptance criterion, measured: somebody
 * who has never heard the word must not meet it, and a reviewer skimming
 * forty-eight images will not catch one occurrence at 375px in dark.
 *
 * **`input_drawn` against `blocked_next_action`** is "never a dead input": every
 * frame has either a box to type in or a sentence saying what to do instead, and
 * a frame with neither is the defect this rule exists to prevent.
 *
 * **`answer_is_text`** is the safety property. The answer in these scenes
 * contains no markup, but a future component that rendered one as HTML would
 * make `.ask-answer` contain an element — so the count of child elements is read
 * rather than the text.
 *
 * `innerText` is lower-cased before it is searched, which is MAR-586's harness's
 * recorded correction.
 */
async function layout(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure layout",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const root = document.documentElement;
         /*
          * The widest element-level overflow, and which element it is.
          * A number on its own has been misread before: a visually-hidden
          * span clips itself by however long its text is, which looks like a
          * layout defect and is not one. Naming the node turns a figure a
          * reviewer has to remember the meaning of into one they can check.
          */
         let widest = 0;
         let widestSelector = null;
         for (const node of document.querySelectorAll("*")) {
           const gap = node.scrollWidth - node.clientWidth;
           if (gap > widest) {
             widest = gap;
             widestSelector =
               node.tagName.toLowerCase() +
               (node.className && typeof node.className === "string"
                 ? "." + node.className.trim().split(" ").filter(Boolean).join(".")
                 : "");
           }
         }
         const section = document.querySelector("section.ask");
         const answers = [...document.querySelectorAll(".ask-answer")];
         const text = section === null ? "" : section.innerText.toLowerCase();
         return {
           viewport: window.innerWidth,
           density: root.getAttribute("data-density"),
           page_overflows: root.scrollWidth > root.clientWidth,
           section_drawn: section !== null,
           input_drawn: document.querySelector("textarea.ask-input") !== null,
           blocked_next_action: document.querySelector(".ask-next, section.ask button") !== null,
           turns: document.querySelectorAll(".ask-turn").length,
           answers: answers.length,
           // No element inside an answer, ever. See the note above.
           answer_is_text: answers.every((node) => node.children.length === 0),
           sources_open:
             document.querySelector("details.ask-sources") === null
               ? null
               : document.querySelector("details.ask-sources").open === true,
           cited_links: document.querySelectorAll(".ask-sources a").length,
           says_charged: text.includes("charged"),
           says_agents_own_figure: text.includes("not something dash watched"),
           // MAR-545's acceptance criterion, measured rather than eyeballed.
           says_artifact: text.includes("artifact"),
           says_run_id: text.includes("run_id"),
           widest_overflow: widest,
           widest_overflow_node: widestSelector,
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
        for (const item of SCENES) {
          const route = `/agents/detail?agent=${encodeURIComponent(item.agent)}`;
          await go(window, route);
          const at = await resizeTo(window, viewport.width, viewport.height);
          // Reloaded after the resize as well: a page reads its view once, on
          // mount, and a layout settled at the previous width would be
          // photographed under this width's filename.
          await go(window, route);

          const at_density = await setDensity(window, density);
          if (at_density === null) {
            console.log(`[ask] no density control at ${viewport.name} — ${density} frame skipped`);
            continue;
          }
          if (at_density !== density) {
            // Loudly, rather than a frame filed under a density it is not in.
            throw new Error(
              `the page would not go to ${density} at ${viewport.name}; it reports ${at_density}`,
            );
          }

          const sources = await openSources(window);
          const focused = await scrollTo(window, "section.ask");
          const measured = await layout(window);
          measurements.push({
            scene: item.label,
            agent: item.agent,
            viewport: viewport.name,
            theme,
            density,
            sources_opened: sources,
            focused,
            ...(measured as object),
          });
          console.log(
            `[ask] ${item.label} ${viewport.name}/${theme}/${density} ` +
              `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
          );
          await shoot(window, `ask-${item.label}-${viewport.name}-${theme}-${density}`);
        }
      }
    }
  }

  writeFileSync(
    path.join(OUT, "layout.json"),
    `${JSON.stringify({ captured_at: new Date().toISOString(), measurements }, null, 2)}\n`,
    "utf8",
  );

  /*
   * The claims these images are supposed to support, checked rather than left to
   * a reviewer's eye over forty-eight frames.
   */
  const seen = measurements as Array<Record<string, boolean | number | string | null>>;
  const overflowed = seen.filter((entry) => entry["page_overflows"] === true);
  const missing = seen.filter((entry) => entry["section_drawn"] !== true);
  const dead = seen.filter(
    (entry) => entry["input_drawn"] !== true && entry["blocked_next_action"] !== true,
  );
  const markup = seen.filter((entry) => entry["answer_is_text"] !== true);
  const jargon = seen.filter(
    (entry) => entry["says_artifact"] === true || entry["says_run_id"] === true,
  );

  console.log(
    `[ask] wrote ${String(written.length)} image(s) to ${OUT}; ` +
      `${String(overflowed.length)} frame(s) overflowed sideways; ` +
      `${String(missing.length)} frame(s) with no conversation section; ` +
      `${String(dead.length)} frame(s) with neither an input nor a next action; ` +
      `${String(markup.length)} frame(s) where an answer was not plain text; ` +
      `${String(jargon.length)} frame(s) using DASH's own filing words`,
  );
  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error("[ask] failed", error);
  app.exit(1);
});
