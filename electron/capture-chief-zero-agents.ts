/**
 * MAR-742 roadmap item 2 proof: the chief's room, in a store with **zero
 * agents**. **Not part of the shipped shell.**
 *
 * Henrik, 2026-08-24: *"Chief is our orchestrator and he should always be
 * reachable and active"* — before this packet the fleet page skipped
 * `FleetList` (and, with it, the chief's composer) whenever `agents.length
 * === 0`, on the assumption `lib/copy/chief.ts` used to state outright: that
 * this state "is not supposed to reach this band at all". This harness proves
 * the opposite is now true, on a store this run seeds with **nothing at
 * all** — no `importManifest`, no artifacts, no prior chief turns — which is
 * the one thing every other capture harness in this repository deliberately
 * avoids leaving behind.
 *
 * ## What it proves
 *
 * 1. `chief-composer` is present in the DOM on a cold `/` load with zero
 *    agents — the gate this packet removed from `app/page.tsx`.
 * 2. A real, non-standing question ("what agents do I have?") is accepted and
 *    answered from records, honestly: the answer names the fleet as empty and
 *    says how to add an agent (`lib/chief/records-answer.ts`'s
 *    `undeclaredAnswer`, `lib/copy/chief.ts`'s `CHIEF_WAITING`).
 * 3. Whether a model answered instead — only possible if this exact scratch
 *    `DASH_DATA_DIR` already carries a connected AI key, which this harness
 *    never adds (Henrik's instruction: prove what is there, never provision a
 *    key to make a nicer screenshot). A fresh directory has none, so this run
 *    is expected to prove the records-only path; `answered_from` in the
 *    written transcript says which it actually got.
 *
 * ## Run it
 *
 * From **PowerShell**, with a visible, unoccluded window, against a
 * directory that does not exist yet (this harness creates it — unlike
 * `capture-mar615.ts`, there is no manifest import racing `lib/db.ts`'s
 * import-time open, so an empty directory is exactly the starting state the
 * claim needs).
 *
 *     pnpm build:renderer
 *     pnpm build:shell
 *     $env:DASH_SHELL_URL='dash-app://ui/'
 *     $env:DASH_DATA_DIR='…\scratch-chief-zero-agents'
 *     $env:DASH_CAPTURE_DIR='qa-screenshots-chief-zero-agents'
 *     pnpm exec electron dist/electron/capture-chief-zero-agents.mjs --user-data-dir=…\ud-chief-zero-agents
 *
 * `--user-data-dir` matters the moment more than one worktree of this
 * repository is on the machine — see `capture-mar615.ts`'s own note on a
 * stale log faking a successful run. PowerShell because under Git Bash the
 * runner cannot read its own user identity and the shell renders empty.
 *
 * ## What it leaves behind
 *
 * One live runner holding the scratch store `app.exit(0)` does not stop —
 * `capture-mar615.ts`'s own note applies unchanged. Harmless to anybody's
 * records; not harmless to the next `pnpm verify:shell` on this machine. Run
 * it with DASH closed, and never on the `electron .` path.
 */

import "./main.js";
import { appWindow } from "./app-window.js";

import { app, BrowserWindow } from "electron";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.resolve(
  process.cwd(),
  process.env.DASH_CAPTURE_DIR ?? "qa-screenshots-chief-zero-agents",
);

const QUESTION = "what agents do I have?";

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

async function shoot(target: BrowserWindow, name: string): Promise<void> {
  let image;
  try {
    image = await within(`capturePage for ${name}`, 20_000, target.webContents.capturePage());
  } catch (error: unknown) {
    // The same deterministic first-shot-after-resize failure `capture-mar615.ts`
    // documents; there is no resize here, but the retry costs nothing and keeps
    // this harness matching that one's proven shape.
    console.log(
      `[chief-zero-agents]   retrying ${name} after ${error instanceof Error ? error.message : String(error)}`,
    );
    target.show();
    target.focus();
    await settle(1500);
    image = await within(`capturePage retry for ${name}`, 20_000, target.webContents.capturePage());
  }
  writeFileSync(path.join(OUT, `${name}.png`), image.toPNG());
  const size = image.getSize();
  console.log(`[chief-zero-agents] ${name}.png ${String(size.width)}x${String(size.height)}`);
}

/** What the cold `/` load shows, with a store this run never seeded. */
async function measureColdState(target: BrowserWindow): Promise<unknown> {
  return within(
    "measure cold state",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         return {
           composer_found: document.querySelector(".chief-composer") !== null,
           textarea_found: document.querySelector("textarea.chief-input") !== null,
           onboarding_found: document.querySelector(".try-sample") !== null,
           agent_cards: document.querySelectorAll(".fleet-card").length,
         };
       })()`,
    ),
  );
}

async function focusComposer(target: BrowserWindow): Promise<boolean> {
  const focused = (await target.webContents.executeJavaScript(
    `(() => {
       const input = document.querySelector("textarea.chief-input");
       if (input === null) return false;
       input.focus();
       return document.activeElement === input;
     })()`,
  )) as boolean;
  await settle(600);
  return focused;
}

/**
 * `capture-mar615.ts`'s `askRecordsQuestion`, asking a real (non-standing)
 * question instead of a `STANDING_WORDS` one — the arm this packet's fix is
 * actually about, `lib/chief/records-answer.ts`'s `undeclaredAnswer`.
 */
async function askQuestion(target: BrowserWindow, question: string): Promise<unknown> {
  return within(
    "ask question",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const textarea = document.querySelector("textarea.chief-input");
         if (textarea === null) return { asked: false, reason: "no textarea" };
         const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
         setter.call(textarea, ${JSON.stringify(question)});
         textarea.dispatchEvent(new Event("input", { bubbles: true }));
         textarea.focus();
         textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
         return { asked: true };
       })()`,
    ),
  );
}

/** The turn that landed, read straight out of the room's own DOM. */
async function readLatestTurn(target: BrowserWindow): Promise<unknown> {
  return within(
    "read latest turn",
    10_000,
    target.webContents.executeJavaScript(
      `(() => {
         const turns = document.querySelectorAll(".chief-turn");
         if (turns.length === 0) return { turn_count: 0 };
         const last = turns[turns.length - 1];
         const asked = last.querySelector(".chief-asked")?.textContent ?? null;
         const reply = last.querySelector(".chief-says")?.textContent ?? null;
         const feedback = document.querySelector(".chief-feedback")?.textContent ?? null;
         const charge = last.querySelector(".chief-charge")?.textContent ?? null;
         return { turn_count: turns.length, asked, reply, feedback, charge };
       })()`,
    ),
  );
}

async function run(): Promise<void> {
  await app.whenReady();
  mkdirSync(OUT, { recursive: true });

  const window = await appWindowLoaded();
  window.setResizable(true);
  await window.webContents.loadURL(new URL("/", window.webContents.getURL()).toString());
  await settle(1200);

  const cold = await measureColdState(window);
  console.log(`[chief-zero-agents] cold state ${JSON.stringify(cold)}`);
  await shoot(window, "01-cold-zero-agents");

  const focused = await focusComposer(window);
  await shoot(window, "02-composer-open-zero-agents");

  const asked = await askQuestion(window, QUESTION);
  await settle(2000);
  const turn = await readLatestTurn(window);
  await shoot(window, "03-answered-zero-agents");

  const transcript = {
    captured_at: new Date().toISOString(),
    question: QUESTION,
    cold_state: cold,
    composer_focused: focused,
    asked,
    turn,
  };
  writeFileSync(path.join(OUT, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`, "utf8");
  console.log(`[chief-zero-agents] transcript: ${JSON.stringify(transcript, null, 2)}`);

  const coldChecked = cold as { composer_found: boolean; agent_cards: number };
  const turnChecked = turn as { turn_count: number; reply: string | null };
  const failures: string[] = [];
  if (!coldChecked.composer_found) {
    failures.push("chief-composer was not in the DOM on a cold load with zero agents");
  }
  if (coldChecked.agent_cards !== 0) {
    failures.push(`expected zero fleet cards, found ${String(coldChecked.agent_cards)}`);
  }
  if (turnChecked.turn_count !== 1) {
    failures.push(`expected exactly one chief turn, found ${String(turnChecked.turn_count)}`);
  }
  if (turnChecked.reply === null || !/empty/i.test(turnChecked.reply)) {
    failures.push(`the chief's reply did not name the fleet as empty: ${String(turnChecked.reply)}`);
  }

  console.log(
    failures.length === 0
      ? "[chief-zero-agents] PASS: the chief answered honestly from records with zero agents"
      : `[chief-zero-agents] FAIL:\n${failures.map((line) => `  - ${line}`).join("\n")}`,
  );

  app.exit(failures.length === 0 ? 0 : 1);
}

run().catch((error: unknown) => {
  console.error("[chief-zero-agents] run failed:", error);
  app.exit(1);
});
