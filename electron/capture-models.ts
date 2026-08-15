/**
 * Screenshots of the model-choice section, in the real shell (MAR-583). **Not
 * part of the shipped shell.**
 *
 * `electron/capture.ts` walks every surface and photographs whatever the machine
 * happens to hold. It is the wrong harness for this feature for
 * `electron/capture-glance.ts`'s reason, at the same sharpness: **this section
 * has four states and which one is drawn depends on what is in the vault.** A
 * run against one person's store photographs whichever state that store happens
 * to be in and cannot say which, so a set of images from it would prove one
 * branch and be filed as proof of the feature.
 *
 * So this points the same real renderer at a store this run seeds, with one
 * agent per state:
 *
 * - `plan-writer`    — a key is held; every step matched to what it asked for
 * - `single-model`   — a key is held; one model named, so the steps are set aside
 * - `unconnected`    — the plan needs a model and DASH holds no key for it
 * - `own-model`      — the plan needs a model and DASH is not what chooses it
 *
 * A fifth agent is deliberately absent from the list because the state it is in
 * is *nothing at all*: an agent whose plan uses no model draws no section, and
 * `tests/model-render.test.tsx` asserts the empty string rather than staging a
 * photograph of a blank space.
 *
 * ## What is real here, and the three things that are not
 *
 * Real: the packaged renderer and its compiled stylesheet, the `dash-app://ui/`
 * routes, `workspaceView()` arriving over the read channel, every sentence
 * composed by `lib/ai/model-choice.ts` from rows this run wrote through the
 * ordinary doors, the levels read off each manifest's own `planned_route`, and
 * `app/tokens.css` resolved against a `color-scheme` the operating system's own
 * signal moved.
 *
 * Not real, and stated rather than left for a reader of the PNGs to infer:
 *
 * 1. **Whose data it is.** The store is a scratch directory this run seeded, so
 *    these are evidence of what the section draws for a given store and evidence
 *    about nobody's actual machine.
 * 2. **No key is in the vault.** `held` is a row in `connection_secrets`, and
 *    this run writes one through `recordSecretReference` with a masked hint —
 *    the same door `connect` writes it through, and the only fact the section
 *    reads. There is no credential behind it, so **pressing "See what OpenRouter
 *    offers" in these images would fail**, and this harness does not press it.
 *    What a real provider answers is not something a screenshot can establish and
 *    `tests/model-choice.test.ts` drives that path against a scripted probe.
 * 3. **The manifests are built here**, not added to `examples/`. MAR-582's
 *    argument still holds: a shipped example declaring a model provider would
 *    advertise a connection whose only operation lists models, and DASH still
 *    has no completion call.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window. DASH may stay open.
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-models'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-mar583'
 *     pnpm exec electron dist/electron/capture-models.mjs
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
 * `app.exit(0)` does not stop it. Each run leaves one live runner holding a
 * scratch store, exactly as every other capture harness already does. Harmless
 * to anybody's records and **not** harmless to the next `pnpm verify:shell` on
 * the same machine.
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

import { connectionSecretName } from "../lib/connection-credentials.js";
import { maskSecret, recordSecretReference } from "../lib/secret-refs.js";
import { importManifest } from "../lib/store.js";
import { writeAgentModelChoice, writeStepLevelOverride } from "../lib/ai/model-store.js";

const OUT = path.resolve(process.cwd(), process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-mar583");

/** The three widths every DASH design pass is argued at. */
const VIEWPORTS = [
  { name: "1280", width: 1280, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

const MATCHED = "plan-writer";
const NAMED = "single-model";
const UNCONNECTED = "unconnected";
const OWN_MODEL = "own-model";

const CONNECTION = "models";
const FIELD = "key";

/** Which agents get a section, and what each one is a photograph of. */
const SCENES: ReadonlyArray<{ agent: string; label: string }> = [
  { agent: MATCHED, label: "matched" },
  { agent: NAMED, label: "named" },
  { agent: UNCONNECTED, label: "unconnected" },
  { agent: OWN_MODEL, label: "own" },
];

/* ---------------------------------------------------------------------- *
 * The scene
 * ---------------------------------------------------------------------- */

/**
 * One agent with a plan that needs a model, and a connection for one.
 *
 * Built from the shipped v1 example so the rest of the document is a manifest
 * the validator already accepts — the thing under test has to be the section,
 * not a schema failure wearing its name. The route is replaced with three steps
 * that between them cover every level, because the whole argument for putting
 * the choice per step is that one agent legitimately needs different strengths.
 */
function scene(
  name: string,
  displayName: string,
  options: { ownership?: string } = {},
): Record<string, unknown> {
  /*
   * The **v2** example, not the v1 one. `agent_dom` requires seven blocks —
   * a runtime, a trigger, locations, control, memory — and hand-building them
   * here would be this harness carrying a second copy of a contract it does not
   * own. Only the two things this scene is about are replaced.
   *
   * The first draft of this function built `agent_dom` by hand from the v1
   * example and every import was refused; the run still produced 24 images, of a
   * page saying it had no such agent. That is exactly the failure `section_drawn`
   * is measured for, and it is why it is measured.
   */
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
    {
      step: 1,
      component_id: "public_feed_fetch",
      risk_level: "low",
      model_tier: "none",
    },
    {
      step: 2,
      component_id: "article_extract",
      risk_level: "low",
      model_tier: "small",
      default_model_level: "cheap",
    },
    {
      step: 3,
      component_id: "digest_write",
      risk_level: "low",
      model_tier: "frontier",
      default_model_level: "frontier",
    },
  ];
  // The example's own connections are replaced rather than appended to, so each
  // scene has exactly one and the picture is of this feature.
  (manifest["agent_dom"] as Record<string, unknown>)["connections"] =
    options.ownership === undefined
      ? []
      : [
          {
            id: CONNECTION,
            provider: "openrouter",
            label: "Your model provider",
            purpose: "Turn the day's articles into a digest",
            ownership: options.ownership,
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
        ];
  return manifest;
}

/**
 * Import one scene, and fail the run if the store refused it.
 *
 * The first draft did not check, and produced a full set of images of a page
 * saying it had no such agent. A seed that can fail silently is a seed that
 * produces evidence of the wrong thing under the right filename.
 */
function importScene(manifest: Record<string, unknown>): void {
  const imported = importManifest(manifest);
  if (!imported.ok) {
    throw new Error(
      `the seeded manifest was refused: ${(imported.errors ?? []).join("; ")}`,
    );
  }
}

/**
 * Seed the store this run was pointed at.
 *
 * Before the first navigation and after `app.whenReady()`, because every page
 * reads its view on mount: a page loaded before the rows exist is a photograph
 * of an empty state under a filename claiming otherwise.
 *
 * Everything goes in through the ordinary doors — `importManifest`,
 * `recordSecretReference`, `writeAgentModelChoice`, `writeStepLevelOverride`.
 * A seed that wrote rows directly would be able to stage a state the product
 * cannot actually reach.
 */
function seed(): void {
  const now = new Date().toISOString();

  /*
   * A held key, as `connect` records one: the vault name, and a hint
   * `maskSecret` produced. `recordSecretReference` refuses anything that is not
   * already masked, so this door cannot be used to put a value in the row even
   * by mistake. There is **no credential** behind it — see the header.
   */
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

  /* 1. A key is held and every step runs at what its plan asked for. */
  importScene(scene(MATCHED, "Plan Writer", { ownership: "dash_managed" }));
  holdKeyFor(MATCHED);
  // One step moved off its plan's answer, so the "you changed this" chip and the
  // way back to the declared level are both in the picture.
  writeStepLevelOverride(MATCHED, 2, "standard", now);

  /* 2. A key is held and one model is named for the whole agent. */
  importScene(scene(NAMED, "Single Model", { ownership: "dash_managed" }));
  holdKeyFor(NAMED);
  writeAgentModelChoice(NAMED, "openrouter", "anthropic/claude-sonnet-5", now);

  /* 3. The plan needs a model and DASH holds no key for it. */
  importScene(scene(UNCONNECTED, "Unconnected", { ownership: "dash_managed" }));

  /* 4. The plan needs a model and DASH is not what chooses it. */
  importScene(scene(OWN_MODEL, "Own Model", { ownership: "agent_managed" }));

  console.log("[models] seeded 4 agents: matched, named, unconnected, own");
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

/**
 * Photograph the window, retrying a compositor that was not ready.
 *
 * `capturePage()` rejects with `UnknownVizError` when Chromium's compositor has
 * not produced a frame for the surface yet. On this machine that is not
 * occasional and not random: **every frame taken after the window shrinks fails
 * on the first attempt and succeeds on the second**, so all sixteen of the 768
 * and 375 frames retry once and none of the 1280 ones do. A longer `settle` did
 * not fix it, which is what says the wait is for a frame rather than for time.
 *
 * Recorded here rather than smoothed away, because a later harness copying this
 * one should know the retry is load-bearing at two of the three widths.
 *
 * Bounded, and it fails loudly at the end. A harness that swallowed this would
 * write a short set of images and report success, which is the one outcome worse
 * than a failed run.
 */
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
      console.log(`[models] ${name}.png ${String(size.width)}x${String(size.height)}`);
      return;
    } catch (error: unknown) {
      last = error;
      console.log(`[models] ${name} did not compose on attempt ${String(attempt + 1)}; retrying`);
      await settle(700);
    }
  }
  throw new Error(`could not photograph ${name}: ${String(last)}`);
}

/**
 * Resize, and do not go on until the page agrees it happened.
 *
 * A maximized window ignores `setContentSize` and reports the screen's width
 * back, which on a 1280-wide display is indistinguishable from a successful
 * resize — three images labelled with a viewport they were not taken at, which
 * is worse than a missing image.
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
 * Open the step disclosure, the way a person does.
 *
 * Not `setAttribute("open", "")`. A harness that set the attribute would produce
 * identical output whether or not the summary was reachable, and the picture
 * would stop being a small proof as well as an image. `pressDensityToggle` makes
 * the same argument for the same reason.
 */
async function openSteps(target: BrowserWindow): Promise<boolean> {
  const opened = (await target.webContents.executeJavaScript(
    `(() => {
       const summary = document.querySelector("details.model-steps > summary");
       if (summary === null) return false;
       summary.click();
       return document.querySelector("details.model-steps").open === true;
     })()`,
  )) as boolean;
  await settle(350);
  return opened;
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
 * What a picture cannot settle.
 *
 * Three things. A screenshot of a page that overflows looks identical to one
 * that does not. A screenshot of a `select` looks identical to a screenshot of a
 * `select` with one option in it, so the options are counted. And the recommended
 * option being *first* is the whole novice-first claim of this section — a
 * reviewer's eye cannot tell first from second in a closed dropdown, so the
 * index is read rather than looked at.
 *
 * `innerText` is lower-cased before it is searched, which is the correction
 * MAR-586's harness recorded: the chip class uppercases its text and
 * `innerText` returns what was *rendered*, so a harness grepping for chip copy
 * reads false while the chip is in the picture.
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
         const section = document.querySelector("section.model-choice");
         const picker = document.querySelector("#model-picker-select");
         const groups = picker === null ? [] : [...picker.querySelectorAll("optgroup")];
         const options = picker === null ? [] : [...picker.options];
         const steps = [...document.querySelectorAll(".model-step")];
         const text = document.body.innerText.toLowerCase();
         return {
           viewport: window.innerWidth,
           page_scroll_width: root.scrollWidth,
           page_overflows: root.scrollWidth > root.clientWidth,
           section_drawn: section !== null,
           picker_drawn: picker !== null,
           option_count: options.length,
           // The novice-first claim, measured: the recommended option is index 0
           // and its value is empty, which is what an unset choice resolves to.
           recommended_first: options.length > 0 && options[0].value === "",
           first_group: groups.length === 0 ? null : groups[0].label,
           chosen: picker === null ? null : picker.value,
           step_rows: steps.length,
           steps_disabled: steps.filter((node) => node.querySelector("select[disabled]")).length,
           says_set_aside: text.includes("set aside"),
           says_you_changed: text.includes("you changed this"),
           says_connect: text.includes("connections page"),
           says_dash_does_not_choose: text.includes("dash does not choose"),
           // No amount, anywhere on the page. MAR-299 owns spend; this section
           // must not have grown a figure DASH derived.
           says_an_amount: /[$€£]|\\d+\\.\\d\\s*(usd|per)|per token/.test(text),
           widest_overflow: widest,
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
    // The operating system's own signal, not a stylesheet override.
    nativeTheme.themeSource = theme;
    await settle(300);

    for (const viewport of VIEWPORTS) {
      for (const item of SCENES) {
        /* MAR-641. The model picker is on the cockpit's Settings stage. */
        const route = `/agents/detail?agent=${encodeURIComponent(item.agent)}&stage=settings`;
        await go(window, route);
        const at = await resizeTo(window, viewport.width, viewport.height);
        // Reloaded after the resize as well: a page reads its view once, on
        // mount, and a layout settled at the previous width would be
        // photographed under this width's filename.
        await go(window, route);

        const opened = await openSteps(window);
        const focused = await scrollTo(window, "section.model-choice");
        const measured = await layout(window);
        measurements.push({
          scene: item.label,
          agent: item.agent,
          viewport: viewport.name,
          theme,
          steps_open: opened,
          focused,
          ...(measured as object),
        });
        console.log(
          `[models] ${item.label} ${viewport.name}/${theme} ` +
            `(window reports ${String(at)}px) ${JSON.stringify(measured)}`,
        );
        await shoot(window, `models-${item.label}-${viewport.name}-${theme}`);
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
   * the reviewer's eye. A frame with no section, a dropdown whose first option
   * is a model, or a figure on the page would each otherwise be filed as
   * evidence of the opposite of what this issue argued.
   */
  const seen = measurements as Array<Record<string, boolean | number | string | null>>;
  const overflowed = seen.filter((entry) => entry["page_overflows"] === true);
  const missing = seen.filter((entry) => entry["section_drawn"] !== true);
  const notRecommendedFirst = seen.filter(
    (entry) => entry["picker_drawn"] === true && entry["recommended_first"] !== true,
  );
  const amounts = seen.filter((entry) => entry["says_an_amount"] === true);

  console.log(
    `[models] wrote ${String(written.length)} image(s) to ${OUT}; ` +
      `${String(overflowed.length)} frame(s) overflowed sideways; ` +
      `${String(missing.length)} frame(s) with no model section; ` +
      `${String(notRecommendedFirst.length)} frame(s) where the recommended option was not first; ` +
      `${String(amounts.length)} frame(s) showing an amount`,
  );
  app.exit(0);
}

void run().catch((error: unknown) => {
  console.error("[models] failed", error);
  app.exit(1);
});
