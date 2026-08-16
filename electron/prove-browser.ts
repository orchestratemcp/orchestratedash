/**
 * The controlled browser MAR-628 is actually about (ADR 0019).
 *
 * Not a release gate and not a test. This drives the **real** controller against
 * a **real** page in a **real** `WebContentsView` attached to DASH's own window,
 * writes the trail into a real store, and photographs the supervision surface
 * while the browser is on the page — which is the one claim no unit test in this
 * repository can make, because every part of it that matters is Chromium.
 *
 * ## Running it
 *
 * ```powershell
 * pnpm build:renderer; pnpm build:shell
 * $env:DASH_SHELL_URL='dash-app://ui/'
 * $env:DASH_DATA_DIR='C:\Users\<you>\AppData\Local\Temp\dash-mar628-proof'
 * $env:DASH_PROVE_BROWSER_URL='https://example.com/'
 * pnpm exec electron --user-data-dir=<isolated profile> dist/electron/prove-browser.mjs
 * ```
 *
 * `DASH_DATA_DIR` is **required and deliberately not defaulted**, on
 * `electron/prove-start.ts`'s exact terms: this harness runs as `Electron`
 * rather than as `orchestratedash`, so `app.getPath("userData")` resolves
 * somewhere that is not DASH's store. Unlike that harness it wants a *scratch*
 * directory rather than the installed one — it seeds an agent, and seeding one
 * into somebody's real fleet would leave a synthetic agent behind after a proof.
 *
 * `--user-data-dir` is the separate Chromium-level profile, isolated so a run
 * beside another worktree's does not fight it for a cache.
 *
 * ## What it proves and what it does not
 *
 * It proves the browser: a real page loaded, real text read out of it through
 * CDP in an isolated world, a real trail written, and a real Stop that destroyed
 * the view. It photographs DASH showing all of that.
 *
 * It does **not** prove the transport. `handle` is called directly rather than
 * through `runner/server.ts`'s `/browser/drain`, because standing up a runner
 * and a child process to carry a JSON line would prove the pipe, which is
 * already the same pipe the broker has used since MAR-458 and is covered by
 * types at both ends. What is new here, and what this exercises, is everything
 * downstream of the line being read.
 */
import "./main.js";
import { app } from "electron";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { agentStageHref } from "../app/_data/routes.js";
import {
  listBrowserActions,
  listBrowserSessions,
  listSessionlessBrowserActions,
} from "../lib/browser/store.js";
import { importManifest, ingestEvents } from "../lib/store.js";
import { appWindow } from "./app-window.js";
import { hostBrowserController, revokeBrowser } from "./browser-host.js";
import { browserViewBounds } from "./browser-view.js";

const AGENT = "synthetic-news-scout-browser";
const ARTICLE = process.env["DASH_PROVE_BROWSER_URL"] ?? "https://example.com/";
const RUN_ID = "mar628-proof";
const out = path.resolve(process.cwd(), process.env["DASH_CAPTURE_DIR"] ?? "qa-screenshots-mar628");

async function windowReady() {
  for (;;) {
    const window = appWindow();
    if (window !== null && !window.webContents.isLoading()) {
      return window;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function shoot(name: string): Promise<void> {
  const window = appWindow();
  if (window === null) {
    return;
  }
  // Retried once. `capturePage` fails deterministically on its first call after
  // a bounds change, and this harness changes bounds every time the panel
  // mounts. See `captureFrame` in `electron/browser-view.ts`.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const image = await window.webContents.capturePage();
      if (!image.isEmpty()) {
        writeFileSync(path.join(out, `${name}.png`), image.toPNG());
        return;
      }
    } catch {
      // Try once more.
    }
  }
}

interface Step {
  what: string;
  ok: boolean;
  detail: string;
}

const steps: Step[] = [];
function record(what: string, ok: boolean, detail: string): void {
  steps.push({ what, ok, detail });
  console.log(`[mar628] ${ok ? "PASS" : "FAIL"} ${what} — ${detail}`);
}

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true });

  /*
   * Seed the agent, with the origin taken from the page being proved.
   *
   * The manifest example declares `https://example.com`; a proof pointed at a
   * real publisher needs that publisher's origin instead. Rewriting it here
   * rather than shipping a second example keeps the *rule* under test — the
   * origin list comes from the manifest and DASH parses it — while letting the
   * page be somebody's real article.
   */
  const manifest = JSON.parse(
    JSON.stringify(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      (await import("../examples/news-scout-browser.manifest.v2.example.json", {
        with: { type: "json" },
      })).default,
    ),
  ) as Record<string, unknown>;
  const dom = manifest["agent_dom"] as Record<string, unknown>;
  dom["browser"] = {
    purpose:
      "Opens one cited article so a person can watch it being read, and reads the words on it.",
    origins: [new URL(ARTICLE).origin],
  };

  const imported = importManifest(manifest);
  record("1. the agent is in the store", imported.ok, imported.ok ? AGENT : JSON.stringify(imported));

  // A run to hang the trail on. Written through `ingestEvents`, which is the
  // same path a real agent's telemetry takes — a harness that inserted a `runs`
  // row directly would be proving something about SQL.
  const ingested = ingestEvents([
    {
      event_version: 1,
      agent: AGENT,
      run_id: RUN_ID,
      seq: 1,
      ts: new Date().toISOString(),
      type: "run_started",
    },
  ]);
  record("2. a run exists to attach the trail to", ingested.accepted === 1, JSON.stringify(ingested));

  const window = await windowReady();
  await window.webContents.loadURL(
    new URL(agentStageHref(AGENT, "run"), process.env["DASH_SHELL_URL"] ?? "dash-app://ui/").href,
  );
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await shoot("1-before-any-session");

  const controller = hostBrowserController();

  /* -- The refusal first, because a proof that only shows success is half a
     proof. An address outside the declared origin must be refused before any
     view exists. -- */
  const refused = await controller.handle(AGENT, {
    request_id: "proof-refused",
    operation: "browser.open",
    input: { url: "https://example.com.attacker.test/article" },
  });
  record(
    "3. an origin that only looks declared is refused",
    !refused.ok && refused.refusal === "origin_not_allowed",
    JSON.stringify(refused),
  );

  /* -- The real page. -- */
  const opened = await controller.handle(AGENT, {
    request_id: "proof-open",
    operation: "browser.open",
    input: { url: ARTICLE },
  });
  record(
    "4. a real page loaded in a real WebContentsView",
    opened.ok,
    opened.ok ? String(opened.result["title"]) : JSON.stringify(opened),
  );

  /*
   * Mid-fetch: the browser is on the page and the panel is around it.
   *
   * Scrolled to first, and that is not a cosmetic step. The panel reports its
   * own rectangle and main puts the `WebContentsView` there, so a panel below
   * the fold is a browser below the fold — correct behaviour, and a photograph
   * of it would show the surface with an empty space where the evidence is. The
   * scroll is `instant` so the shot below is not racing an animation.
   */
  // Longer than one poll interval. The panel reads at `LIVE_REFRESH_MS`, so a
  // photograph taken two seconds after the page loaded is a photograph of the
  // frame before the session existed — which is what the first two runs of this
  // harness produced, and how both of the panel's liveness bugs were found.
  await new Promise((resolve) => setTimeout(resolve, 7_000));
  await window.webContents.executeJavaScript(
    "document.querySelector('.browser-stage')?.scrollIntoView({ block: 'center', behavior: 'instant' })",
  );
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await shoot("2-supervision-surface-mid-fetch");

  /*
   * Where Chromium put the view, against where the panel said its stage was.
   *
   * This exists because a window screenshot cannot answer it:
   * `capturePage` on the window's own `webContents` does not composite child
   * `WebContentsView`s, so DASH photographs with an empty rectangle where the
   * browser is. Reading the bounds back is the stronger claim anyway — it is
   * what the compositor believes rather than what one capture path included.
   */
  const placed = browserViewBounds(controller.sessionFor(AGENT)?.session_id ?? "");
  const stage = (await window.webContents.executeJavaScript(
    "(() => { const el = document.querySelector('.browser-stage'); if (el === null) return null; " +
      "const r = el.getBoundingClientRect(); " +
      "return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()",
  )) as { x: number; y: number; width: number; height: number } | null;
  record(
    "5. the view is where the supervision panel says its stage is",
    placed !== null &&
      stage !== null &&
      stage.width > 0 &&
      Math.abs(placed.x - stage.x) <= 2 &&
      Math.abs(placed.y - stage.y) <= 2 &&
      Math.abs(placed.width - stage.width) <= 2,
    `view=${JSON.stringify(placed)} panel=${JSON.stringify(stage)}`,
  );

  const readBack = await controller.handle(AGENT, {
    request_id: "proof-read",
    operation: "browser.read",
    input: {},
  });
  const text = readBack.ok ? String(readBack.result["text"] ?? "") : "";
  record(
    "6. the words on the page came back as evidence",
    readBack.ok && text.length > 0,
    `${String(text.length)} characters, beginning ${JSON.stringify(text.slice(0, 60))}`,
  );

  record(
    "7. the run is marked as having read untrusted content",
    controller.hasReadUntrusted(AGENT),
    "a write or a spend in this run now needs a person",
  );

  /* -- The catalogue holds against an operation nobody built. -- */
  const invented = await controller.handle(AGENT, {
    request_id: "proof-evaluate",
    operation: "browser.evaluate",
    input: { expression: "document.cookie" },
  });
  record(
    "8. an operation DASH does not build is refused",
    !invented.ok && invented.refusal === "unknown_operation",
    JSON.stringify(invented),
  );

  await new Promise((resolve) => setTimeout(resolve, 6_000));
  await window.webContents.executeJavaScript(
    "document.querySelector('.browser-trail')?.scrollIntoView({ block: 'center', behavior: 'instant' })",
  );
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await shoot("3-trail-with-a-refusal-in-it");

  /* -- Stop. -- */
  await revokeBrowser(AGENT, "stopped_by_person");
  const afterStop = await controller.handle(AGENT, {
    request_id: "proof-after-stop",
    operation: "browser.open",
    input: { url: ARTICLE },
  });
  record(
    "9. Stop destroyed the view and refuses the rest of the run",
    !afterStop.ok && afterStop.refusal === "revoked",
    JSON.stringify(afterStop),
  );

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await shoot("4-after-stop");

  /* -- The trail, as DASH will read it back. -- */
  const sessions = listBrowserSessions(AGENT);
  const session = sessions[0];
  const actions = session === undefined ? [] : listBrowserActions(session.session_id);
  record(
    "10. the trail is readable back out of the store",
    session !== undefined && actions.length >= 3,
    JSON.stringify(
      actions.map((action) => [action.operation, action.decision, action.refusal, action.origin]),
    ),
  );

  /*
   * The refusal at step 3 is not in that list, and the reason is the second
   * thing this harness found. It was refused at step 7 of `handle`, before step
   * 8 opens a session, so it belongs to no session — and a surface that lists
   * sessions and then their actions rendered it nowhere at all. It was written
   * down and no person could see it, which is the exact failure the trail exists
   * to prevent, arrived at from the other direction.
   */
  const orphaned = listSessionlessBrowserActions(AGENT);
  record(
    "11. a refusal that preceded any session is still readable",
    orphaned.some(
      (action) => action.operation === "browser.open" && action.refusal === "origin_not_allowed",
    ),
    JSON.stringify(orphaned.map((action) => [action.operation, action.refusal, action.origin])),
  );

  /*
   * The frames the controller took, copied beside the window shots.
   *
   * These are the pictures of the page itself — `capturePage` on the *view's*
   * own `webContents`, which does include what the page painted. The window
   * shots show the surface around it. Neither alone is the whole picture and
   * saying so is cheaper than pretending one of them is.
   */
  if (session !== undefined) {
    const frameDir = path.join(process.env["DASH_DATA_DIR"] ?? "", "browser-frames", session.session_id);
    for (const action of actions) {
      if (action.frame_after === null) {
        continue;
      }
      try {
        copyFileSync(
          path.join(frameDir, action.frame_after),
          path.join(out, `page-${action.operation.replace(".", "-")}-${action.frame_after}`),
        );
      } catch {
        // A frame the controller could not take. The trail already says so.
      }
    }
  }

  writeFileSync(
    path.join(out, "proof.json"),
    `${JSON.stringify(
      {
        article: ARTICLE,
        agent: AGENT,
        run_id: RUN_ID,
        session: session ?? null,
        actions,
        refused_before_opening: orphaned,
        steps,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    `[mar628] ${String(steps.filter((step) => step.ok).length)}/${String(steps.length)} passed; ` +
      `images and proof.json in ${out}`,
  );
  app.exit(steps.every((step) => step.ok) ? 0 : 1);
});
