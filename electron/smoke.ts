/**
 * The proof harness for MAR-424. **Not part of the shipped shell.**
 *
 * MAR-424 exists because `electron/` had never executed. Three things had to be
 * shown, and none of them can be shown by a unit test — they are precisely the
 * claims that unit tests are structurally unable to make:
 *
 * 1. the UI renders in a real window;
 * 2. `shell.ping` completes a round trip from a real renderer, through the
 *    preload, the review and the audit, and back;
 * 3. one Agent DOM command reaches `noAdapter`, and its refusal lands in
 *    `command_audit` in the real user-data directory.
 *
 * MAR-432 adds one more proof to the same harness: with
 * `DASH_SHELL_URL=dash-app://ui/`, the real static export loads through the
 * packaged origin and its separate `dashData` preload bridge completes a read.
 * That is the closest exercise of the installed renderer available without
 * signing and sideloading an MSIX.
 *
 * Driving it from here rather than from devtools by hand is a deliberate choice:
 * a proof you can re-run is worth more than a screenshot, and the next person to
 * touch the shell can check it still works in one command.
 *
 * `electron .` runs `main.mjs` and never this file. `pnpm shell:smoke` runs this
 * one, which imports `main.ts` and lets it start the app normally — so what is
 * proven is the real startup path, not a reconstruction of it.
 *
 * ## On proof 3, and what "reaches noAdapter" actually requires
 *
 * A command against an agent DASH knows nothing about is refused at
 * `unknown_target`. That still writes an audit row, and it would look like this
 * proof passing while proving nothing at all about the adapter seam. Reaching
 * `noAdapter` means passing every enforcement check first — so the harness seeds
 * a manifest and a *live* state snapshot, and the evidence to read is that the
 * audit shows an `allowed` row followed by an `adapter_unavailable` one. Two
 * rows, in that order, is the shape that cannot be faked by an early refusal.
 *
 * The seeding calls `putAgentDomState`, which until now had no caller outside
 * the tests. That does not make this the snapshot ingest MAR-415 owes: it is a
 * harness writing a fixture, not an adapter polling a control endpoint.
 */

// MUST BE FIRST, and in this order. `smoke-identity` gives the harness the
// app name that `electron .` would have had, and `main.js` carries the
// side-effect import that points the store at the user-data directory derived
// from it. Every import below reads decisions those two have already made.
import "./smoke-identity.js";
import { collectSpawnCredentials } from "./main.js";
// MAR-436. Which window is the app's, now that it is not the first one made.
import { appWindow } from "./app-window.js";

import { app, BrowserWindow, shell } from "electron";

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import {
  forgetAgentDomState,
  putAgentDomState,
  readAgentDomState,
  readCommandAudit,
} from "../lib/agent-dom/store";
import { brokerProfileFor } from "../lib/broker/providers";
import {
  forgetBrokerLapses,
  readBrokerAudit,
  readBrokerLapses,
} from "../lib/broker/store";
import { connectableFields, connectionSecretName } from "../lib/connection-credentials";
import { oauthProviderById } from "../lib/oauth/providers";
import {
  OAUTH_CREDENTIAL_VERSION,
  serializeOAuthCredential,
} from "../lib/oauth/credential";
import { closeDb, dataDir } from "../lib/db";
import {
  FIRST_PAINT_BUDGET_MS,
  FIRST_PAINT_PROBE,
  readFirstPaint,
  type FirstPaintObservation,
} from "../lib/shell/first-paint";
import { RENDERER_ORIGIN } from "../lib/shell/renderer-scheme";
import { connectionsView } from "../lib/views/build";
import {
  artifactsForRun,
  forgetAgent,
  readAgentManifest,
  importManifest,
  resolveArtifactAvailability,
} from "../lib/store";
import {
  BUNDLED_NODE_COMMAND,
  removeRegistration,
  writeRegistration,
} from "../lib/registration";
import { runnerFetch } from "./runner-process";
import { secureStore } from "./secure-store";
import { DEFAULT_SOURCES, SOURCES_FILE_NAME } from "../lib/agent-sources";
import { createSampleAgent, SAMPLE_AGENT_ID } from "../lib/sample-agent";
import { openHandoff, removeAgent } from "../lib/handoff-flow";
import { readHandoffRecord } from "../lib/handoff-ledger";
import { readRegistration } from "../lib/registration";
import { ensureChannelSecret } from "../runner/channel-secret";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "../runner/identity";
import { promptForAuthorization } from "./credential-prompt";
import { handoffPorts } from "./handoff-host";
import type { RunnerHandle } from "./runner-process";
import { readTemplateSources } from "./sample-agent";

/** Read from the repo, like `lib/contracts.ts` does. Run from the repo root. */
function example<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(process.cwd(), "examples", name), "utf8")) as T;
}

const AGENT = "synthetic-gmail-meeting-assistant";
const TASK = "task-meeting-01";
const APPROVAL = "approval-meeting-01";
const ACTION = "action-create-invite-draft";

const failures: string[] = [];

function check(label: string, passed: boolean, detail: unknown): void {
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}: ${JSON.stringify(detail)}`);
  if (!passed) {
    failures.push(label);
  }
}

/**
 * A proof that was not attempted, and says so.
 *
 * MAR-473: when 6g produced no run, 6i/6j/6k each queried run id `""` and
 * reported `undefined` — three red lines, each blaming the thing it is named
 * after, for one upstream cause. A downstream proof whose input never arrived
 * has not failed; it has not run. Recording that distinction is what lets a
 * reader of the log find the one line that matters.
 *
 * A skip never fails the job on its own: the root failure above it already
 * does, and duplicating it would restore the noise this replaces.
 */
function skip(label: string, because: string): void {
  console.log(`SKIP  ${label}: not attempted — ${because}`);
}

/**
 * An observation that is not a verdict.
 *
 * MAR-473 needs to know whether a live source still answers without that
 * question being able to fail a release. This prints, is dated, and is never
 * added to `failures`. See ADR 0004.
 */
function note(label: string, detail: unknown): void {
  console.log(`NOTE  ${label}: ${JSON.stringify(detail)}`);
}

/** What a wait did, not merely whether it succeeded. */
interface Waited<T> {
  value: T | null;
  elapsed_ms: number;
  polls: number;
  /** What the final poll saw instead of what it wanted. */
  last_seen: unknown;
}

/**
 * Wait, and be able to say what you waited for and what you saw.
 *
 * MAR-473: `waitForValue` returns `null` on timeout, and `6g` passed that
 * straight into `check` as its whole diagnostic. `FAIL 6g ...: null` cannot
 * distinguish "no run existed" from "a run existed and was still running" from
 * "a run completed but its id was already known" — three different defects with
 * one indistinguishable symptom, and the reason this issue needed CI archaeology
 * rather than a log read. The `seen` half of each poll is the answer.
 */
async function waitForObserved<T>(
  read: () => Promise<{ value: T | null; seen: unknown }>,
  label: string,
  timeoutMs: number,
): Promise<Waited<T>> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let polls = 0;
  let seen: unknown = null;
  while (Date.now() < deadline) {
    const observation = await read();
    polls += 1;
    seen = observation.seen;
    if (observation.value !== null) {
      return {
        value: observation.value,
        elapsed_ms: Date.now() - started,
        polls,
        last_seen: seen,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const elapsed = Date.now() - started;
  console.warn(
    `[smoke] timed out waiting for ${label} after ${String(elapsed)}ms ` +
      `over ${String(polls)} polls; last saw ${JSON.stringify(seen)}`,
  );
  return { value: null, elapsed_ms: elapsed, polls, last_seen: seen };
}

async function waitForValue<T>(
  read: () => Promise<T | null>,
  label: string,
  timeoutMs = 20_000,
): Promise<T | null> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  let polls = 0;
  while (Date.now() < deadline) {
    const value = await read();
    polls += 1;
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // How long, and how many times it looked. A wait that gave up after 20s and a
  // wait that gave up after one poll because the deadline had already passed are
  // different bugs, and until MAR-473 they printed the same line.
  console.warn(
    `[smoke] timed out waiting for ${label} after ${String(Date.now() - started)}ms ` +
      `over ${String(polls)} polls`,
  );
  return null;
}

/**
 * The example snapshot's deadlines are fixed dates in July 2026 and every one of
 * them is now in the past, so an `approve` against it is refused at
 * `approval_expired` — a real rejection, and the wrong one to be proving. The
 * tests move the clock instead; a real launch cannot, so the snapshot moves.
 *
 * Only the times change. The approval, the action and the enforcement flag are
 * the example's own, and the result still has to satisfy
 * `agent-dom-state.schema.json` on the way into the store.
 */
function liveSnapshot(observedAt: string, expiresAt: string): Record<string, unknown> {
  const state = example<Record<string, unknown>>("gmail-meeting-assistant.state.example.json");
  const approvals = state["approval_requests"] as Array<Record<string, unknown>>;
  const choices = state["choices"] as Array<Record<string, unknown>>;
  return {
    ...state,
    observed_at: observedAt,
    approval_requests: approvals.map((request) => ({
      ...request,
      requested_at: observedAt,
      expires_at: expiresAt,
    })),
    choices: choices.map((choice) => ({ ...choice, expires_at: expiresAt })),
  };
}

/**
 * Resolve once the app window has painted, or reject rather than hang forever.
 *
 * **Not `getAllWindows()[0]` any more (MAR-436).** The splash is created first,
 * on purpose, so the first window is now reliably the wrong one — and even
 * before the splash existed this was luck rather than a guarantee, which the
 * credential-prompt helper further down this file already says in its own
 * comment: *"`getAllWindows` order is not contractual"*.
 *
 * The splash is deliberately **not** suppressed under the smoke. A product that
 * takes a different startup path when it is being proven is a product whose
 * proof is about a different program; keeping it means the mandatory gate now
 * covers the splash's whole lifecycle, including that it closes and does not
 * leave DASH with a second window.
 */
function firstWindow(): Promise<BrowserWindow> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no app window after 30s")), 30_000);
    const attach = (): void => {
      const window = appWindow();
      if (window === null) {
        setTimeout(attach, 100);
        return;
      }
      window.webContents.once("did-finish-load", () => {
        clearTimeout(timer);
        resolve(window);
      });
      window.webContents.once("did-fail-load", (_event, code: number, description: string) => {
        clearTimeout(timer);
        reject(new Error(`renderer failed to load: ${description} (${code})`));
      });
    };
    attach();
  });
}

/**
 * Everything runs inside this function, and it is called *without* a top-level
 * `await`. That is not a style choice.
 *
 * Electron dispatches `ready` only after the entry module has finished
 * evaluating, so `await app.whenReady()` at the top level of an ESM main
 * deadlocks: the module is waiting for an event that cannot fire until the
 * module stops waiting. It hangs silently, with no output and no error, which is
 * how it cost an afternoon here. `main.ts` gets this right already — its
 * `void app.whenReady().then(...)` is load-bearing for the same reason.
 */
async function run(): Promise<void> {
await app.whenReady();

/*
 * MAR-436. Observed here, before anything awaits, or not at all: the splash's
 * whole lifetime is shorter than the startup it narrates.
 *
 * The ordering is deterministic rather than lucky. `main.ts` registers its
 * `whenReady` handler as an import side effect — which is to say before this
 * module's body runs — Electron dispatches handlers in registration order, and
 * `openSplash` is the first statement in that handler with nothing awaited in
 * front of it. So when this line runs the splash exists and the app window does
 * not.
 */
const windowsDuringStartup = BrowserWindow.getAllWindows();

const window = await firstWindow();

console.log(`\n[smoke] store: ${dataDir}`);
console.log(`[smoke] userData: ${app.getPath("userData")}\n`);

/* -- Proof 0: this is the directory the installed app uses -------------- */

/**
 * Checked first, because every proof below is only worth as much as this one.
 * A harness that writes to `.../Roaming/Electron` passes all of them while
 * saying nothing about the app. See `electron/smoke-identity.ts`.
 */
check(
  "0. the store is the one `electron .` uses",
  dataDir === app.getPath("userData") && path.basename(dataDir) === "orchestratedash",
  dataDir,
);

/* -- Proof 1: the UI renders ------------------------------------------- */

const rendered = (await window.webContents.executeJavaScript(
  `({ title: document.title, url: location.href, headings: document.querySelectorAll("h1,h2").length })`,
)) as { title: string; url: string; headings: number };
check("1. the UI renders", rendered.headings > 0, rendered);

if (process.env.DASH_SHELL_URL?.startsWith("dash-app://") === true) {
  check(
    "1b. the UI renders from the packaged origin",
    rendered.url.startsWith("dash-app://ui/"),
    rendered.url,
  );
}

/* -- Proofs 1c/1d: the splash's lifecycle (MAR-436) -------------------- */

/**
 * The splash is deliberately not suppressed under this harness, and until now
 * that was a claim this file made in a comment and never checked — the same
 * shape of defect as `6j` asserting only that *a* verdict existed.
 *
 * Two things have to be true and they fail in opposite directions. A splash
 * that never appears leaves the cold-start gap MAR-436 exists to close; a
 * splash that never closes leaves DASH showing two windows, one of them
 * frameless and permanent.
 *
 * `1d` is also what makes proof 7's credential-prompt finder safe. That finder
 * takes "the window that is not the app window" to be the prompt, which is only
 * true once the splash is gone — so the harness establishes it here rather than
 * assuming it several hundred lines further down.
 */
check(
  "1c. a splash window was up while DASH started",
  windowsDuringStartup.length === 1 && !windowsDuringStartup.includes(window),
  {
    windows_at_ready: windowsDuringStartup.length,
    was_the_app_window: windowsDuringStartup.includes(window),
  },
);

const soleWindow = await waitForObserved(
  async () => {
    const open = BrowserWindow.getAllWindows();
    const besides = open.filter((candidate) => candidate !== window);
    return {
      value: besides.length === 0 ? open.length : null,
      seen: { open: open.length, besides_the_app_window: besides.length },
    };
  },
  "1d. the splash to close",
  15_000,
);
check(
  "1d. the splash closed itself, leaving DASH one window",
  soleWindow.value === 1,
  soleWindow,
);

/**
 * MAR-440, and a defect this harness is the only thing that could have caught.
 *
 * The chrome moved the skip link down by a title bar and left its hidden
 * transform — two times the element's own height — where it was, so about 11px
 * of accent-coloured link sat across the top of every page. Nothing overflowed,
 * no element was misplaced in the DOM, and the rule reads as correct in
 * isolation, which is why a stylesheet test and a DOM measurement both missed
 * it. It takes a real layout, and this is the file with one.
 *
 * Both directions, because they fail differently: a link that never hides is the
 * regression, and a link that never *shows* is the over-correction that would
 * take a keyboard user's only shortcut past six navigation links away.
 */
const skipLink = (await window.webContents.executeJavaScript(
  `(() => {
     const link = document.querySelector("a.skip-link");
     if (link === null) return null;
     const hidden = link.getBoundingClientRect();
     link.focus({ preventScroll: true });
     const shown = link.getBoundingClientRect();
     link.blur();
     return {
       hidden_bottom: Math.round(hidden.bottom),
       shown_top: Math.round(shown.top),
       height: Math.round(hidden.height),
     };
   })()`,
)) as { hidden_bottom: number; shown_top: number; height: number } | null;
check(
  "1e. the skip link is off-screen until it is focused",
  skipLink !== null && skipLink.hidden_bottom <= 0 && skipLink.shown_top > 0,
  skipLink,
);

/**
 * `1f`. The first page stopped saying it was loading.
 *
 * **Proof `1` above passes on a window whose renderer never ran**, and that is
 * not a hypothetical: a `pnpm shell` launch spent an afternoon showing "Reading
 * your agents…" and nothing else, while `1` counted the two headings the server
 * had delivered and reported that the UI renders. `2d` was equally green,
 * because it asks `window.dashData` directly and the harness is not the page.
 * Both are the shape MAR-473 named — a check satisfied by the failure it exists
 * to exclude.
 *
 * The distinguishing fact is an absence, so the assertion is one: since MAR-432
 * every page opens in a loading state and leaves it in an effect, so a
 * placeholder that is still there after the budget means no effect ever ran. See
 * `lib/shell/first-paint.ts`, which owns the rule; this proof and
 * `electron/first-paint.ts` evaluate the same probe so the two cannot drift into
 * asking different questions under the same name.
 *
 * What this proof does **not** cover is the developer path, which is where the
 * failure happened. `scripts/verify-shell.mjs` forces the packaged origin so the
 * gate depends only on this repository and this machine (ADR 0004), and that
 * stays true. `pnpm shell:check` is the same assertion pointed at the other
 * host, and it is deliberately not a gate.
 */
const firstPaint = await waitForObserved(
  async () => {
    const seen = (await window.webContents.executeJavaScript(
      FIRST_PAINT_PROBE,
    )) as FirstPaintObservation;
    return { value: readFirstPaint(seen) === "stuck" ? null : seen, seen };
  },
  "1f. the first page to leave its loading state",
  FIRST_PAINT_BUDGET_MS,
);
check(
  "1f. the first page left its loading state",
  firstPaint.value !== null && readFirstPaint(firstPaint.value) === "ready",
  firstPaint,
);

/* -- Proof 2: shell.ping round trip ------------------------------------ */

const bridge = (await window.webContents.executeJavaScript(
  `({ present: typeof window.dashShell === "object", methods: Object.keys(window.dashShell ?? {}), leaks: [ "ipcRenderer", "invoke", "require" ].filter((k) => k in (window.dashShell ?? {})) })`,
)) as { present: boolean; methods: string[]; leaks: string[] };
check("2a. the preload exposes the narrow bridge", bridge.present && bridge.leaks.length === 0, bridge);

const pong = (await window.webContents.executeJavaScript(`window.dashShell.ping()`)) as {
  ok?: boolean;
  data?: { pong?: boolean };
};
check("2b. shell.ping completes a round trip", pong.ok === true && pong.data?.pong === true, pong);

/* -- Proof 2 continued: the read-only document bridge ------------------ */

const dataBridge = (await window.webContents.executeJavaScript(
  `({
    present: typeof window.dashData === "object",
    methods: Object.keys(window.dashData ?? {}).sort(),
    leaks: [ "ipcRenderer", "invoke", "read" ].filter((k) => k in (window.dashData ?? {}))
  })`,
)) as { present: boolean; methods: string[]; leaks: string[] };
check(
  "2c. the preload exposes only the named read methods",
  dataBridge.present &&
    JSON.stringify(dataBridge.methods) ===
      JSON.stringify(["agents", "connections", "inbox", "run", "runs", "workspace"]) &&
    dataBridge.leaks.length === 0,
  dataBridge,
);

const agentsRead = (await window.webContents.executeJavaScript(
  `window.dashData.agents()`,
)) as { ok?: boolean; data?: { agents?: unknown[] } };
check(
  "2d. dashData.agents completes a document round trip",
  agentsRead.ok === true && Array.isArray(agentsRead.data?.agents),
  { ok: agentsRead.ok, agents: agentsRead.data?.agents?.length },
);

/* -- Proof 3: an Agent DOM command reaches noAdapter -------------------- */

/**
 * This proof runs against the installed store, which outlives it (MAR-466).
 *
 * Proof 3h below ends by writing a snapshot dated `observed_at + 120s` —
 * deliberately, because it needs a decision context that has demonstrably moved
 * on — and nothing removed it. `putAgentDomState` refuses any snapshot older
 * than the newest the runner has said, so for the next two minutes this agent's
 * seed was refused as out of order and every proof from 3c down ran against the
 * *previous* run's world. Two of four runs passed and which two was a
 * stopwatch, which is how a proof recorded as proven at `b9f5f07` could fail
 * later on the same commit.
 *
 * Forgetting the agent first is what makes proof 3 independent of what earlier
 * runs left behind — the lesson proof 7 learned when a constant run id let a
 * previous run's artifact satisfy it. The rollback guard is untouched and still
 * right; `tests/snapshot-carryover.test.ts` holds it to that for an agent DASH
 * genuinely knows about.
 */
forgetAgent(AGENT);

const imported = importManifest(
  example("gmail-meeting-assistant.manifest.v2.example.json"),
);
check("3a. seeded the v2 manifest", imported.ok, imported);

const observedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const seeded = putAgentDomState(liveSnapshot(observedAt, expiresAt));
/*
 * `superseded` as well as `ok`. An out-of-order snapshot is declined as
 * `{ ok: true, superseded: true }`, so reading only `ok` let this check report
 * "seeded a live state snapshot" having stored nothing at all — and pushed the
 * failure downstream into 3c, where it read as a defect in the thing 3c is
 * about. A seeding step that cannot notice it failed to seed is not a step.
 */
check(
  "3b. seeded a live state snapshot",
  seeded.ok && !seeded.superseded,
  seeded,
);

const workspaceRead = (await window.webContents.executeJavaScript(
  `window.dashData.workspace(${JSON.stringify(AGENT)})`,
)) as {
  ok?: boolean;
  data?: { found?: boolean; snapshot?: { observed_at?: string; inbox?: unknown[] } | null };
};
check(
  "3c. the live workspace completes a narrowed read round trip",
  workspaceRead.ok === true &&
    workspaceRead.data?.found === true &&
    workspaceRead.data.snapshot?.observed_at === observedAt &&
    Array.isArray(workspaceRead.data.snapshot?.inbox),
  workspaceRead,
);

/**
 * A distinctive free-text reason. `command_audit` records that a reason was
 * supplied and never what it said (see the command-channel doc), so this string
 * must appear in `payload_keys` as a *name* and nowhere in the row as a value.
 */
const REASON_MARKER = `smoke-marker-${Math.random().toString(36).slice(2, 10)}`;

const before = readCommandAudit().length;
const approved = (await window.webContents.executeJavaScript(
  `window.dashShell.approve(${JSON.stringify({
    agent_id: AGENT,
    task_id: TASK,
    approval_id: APPROVAL,
    action_id: ACTION,
    observed_at: observedAt,
    reason: REASON_MARKER,
  })})`,
)) as { ok?: boolean; reason?: string; command_id?: string };

check(
  "3c. the command reached noAdapter rather than an earlier refusal",
  approved.reason === "adapter_unavailable",
  approved,
);

const written = readCommandAudit().slice(before);
const decisions = written.map((record) => `${record.decision}/${record.reason ?? "-"}`);
check(
  "3d. the refusal is durable in command_audit, after an allowed row",
  decisions.length === 2 &&
    decisions[0] === "allowed/-" &&
    decisions[1] === "denied/adapter_unavailable",
  decisions,
);

/**
 * The rule that has held since the boundary was built, checked here on the real
 * store rather than a temp directory. `tests/redaction.test.ts` makes the same
 * argument about the database's bytes; this is the cheap end-to-end echo of it.
 */
check(
  "3e. the audit records the reason's key and never its value",
  written.every(
    (record) =>
      record.payload_keys.includes("reason") &&
      !JSON.stringify(record).includes(REASON_MARKER),
  ),
  { payload_keys: written.at(-1)?.payload_keys, marker_absent: true },
);

/* -- Proofs 3g/3h: what `observed_at` binds to (MAR-464) ---------------- */

/**
 * The defect this pair exists for, and the reason it is proved *here*.
 *
 * `runner/state.ts` mints `observed_at` on every build and
 * `electron/agent-adapters.ts` rebuilds every five seconds, so the value moved
 * whether or not anything had happened — and `enforce.ts` required an exact
 * match. Every control bound to a rendered snapshot therefore had roughly five
 * seconds before it was refused as `stale_snapshot`, including Approve and
 * Reject on a runner-enforced approval reached from the Work inbox.
 *
 * 878 unit tests were green through it. What found it was this harness, on its
 * first honest run, which is the whole of MAR-454's argument — so the guard
 * against its return belongs where the discovery happened rather than only in
 * a test that would have been just as green the first time.
 *
 * `reject` rather than `approve` throughout: the approve above already claimed
 * the idempotency key for this target at this snapshot, and a second one would
 * come back as a stored duplicate — which looks like a pass and would prove
 * nothing about enforcement. Each check below is issued against a distinct
 * rendered snapshot for the same reason.
 */

/** One poll tick: identical content, a later runner clock, progress moved on. */
function repolled(observedAtValue: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  const base = liveSnapshot(observedAt, expiresAt);
  const runs = base["runs"] as Array<Record<string, unknown>>;
  return {
    ...base,
    observed_at: observedAtValue,
    // The fields that genuinely churn while an agent works. If either of these
    // counted as a changed decision, this fix would close the idle case and
    // leave the busy one open — which is the version a user would still hit.
    runs: runs.map((entry) => ({ ...entry, progress: 0.83, current_step: "a_later_step" })),
    ...patch,
  };
}

const afterOnePoll = new Date(Date.parse(observedAt) + 5_000).toISOString();
const afterTwoPolls = new Date(Date.parse(observedAt) + 10_000).toISOString();
check(
  "3g. two poll intervals do not move the snapshot a control is bound to",
  putAgentDomState(repolled(afterOnePoll)).ok &&
    putAgentDomState(repolled(afterTwoPolls)).ok &&
    readAgentDomState(AGENT)?.observed_at === observedAt &&
    readAgentDomState(AGENT)?.runner_observed_at === afterTwoPolls,
  {
    rendered: observedAt,
    held: readAgentDomState(AGENT)?.observed_at,
    runner_said: readAgentDomState(AGENT)?.runner_observed_at,
  },
);

const rejectedLate = (await window.webContents.executeJavaScript(
  `window.dashShell.reject(${JSON.stringify({
    agent_id: AGENT,
    task_id: TASK,
    approval_id: APPROVAL,
    action_id: ACTION,
    observed_at: observedAt,
  })})`,
)) as { ok?: boolean; reason?: string };

check(
  "3g. an approval survives being read for longer than a poll interval",
  rejectedLate.reason === "adapter_unavailable",
  rejectedLate,
);

/**
 * The half worth keeping, and the reason the fix was not "re-read the snapshot
 * before every command". *"The world changed since you looked, look again"* is
 * a property worth having in front of an irreversible action; only its trigger
 * was ever wrong.
 *
 * The task's `detail` is what moves — decision-relevant, and deliberately not
 * something that changes whether `reject` is offered. Cancelling the approval
 * instead would also be refused, but at `approval_not_open` if the freshness
 * gate ever stopped firing, so it would keep passing after the regression it
 * exists to catch.
 */
const reRendered = new Date(Date.parse(observedAt) + 60_000).toISOString();
const movedOn = new Date(Date.parse(observedAt) + 120_000).toISOString();
const detailed = (detail: string): Record<string, unknown> => ({
  tasks: (liveSnapshot(observedAt, expiresAt)["tasks"] as Array<Record<string, unknown>>).map(
    (task) => ({ ...task, detail }),
  ),
});

const staleRefused =
  putAgentDomState(repolled(reRendered, detailed("A proposed time is ready"))).ok &&
  readAgentDomState(AGENT)?.observed_at === reRendered &&
  putAgentDomState(repolled(movedOn, detailed("A different time is ready"))).ok &&
  readAgentDomState(AGENT)?.observed_at === movedOn;

const rejectedStale = (await window.webContents.executeJavaScript(
  `window.dashShell.reject(${JSON.stringify({
    agent_id: AGENT,
    task_id: TASK,
    approval_id: APPROVAL,
    action_id: ACTION,
    observed_at: reRendered,
  })})`,
)) as { ok?: boolean; reason?: string };

check(
  "3h. a decision taken against a context that has since moved is still refused",
  staleRefused && rejectedStale.reason === "stale_snapshot",
  { advanced: staleRefused, ...rejectedStale },
);

/**
 * Take the fabricated future back out of the installed store.
 *
 * `movedOn` is two minutes ahead of now, which is what made this proof refuse
 * the *next* run's seed (MAR-466). Forgetting the agent at the top of proof 3
 * already fixes that; this is the same fact stated from the other end, so the
 * harness cannot poison a store it has finished with even if that call is
 * someday moved or removed.
 *
 * The snapshot only — proof 5 below reads this agent's manifest, and a harness
 * that tidied that away would fail somewhere with nothing to do with tidying.
 */
check(
  "3i. the harness leaves no fabricated future snapshot behind",
  forgetAgentDomState(AGENT).existed && readAgentDomState(AGENT) === null,
  { held_after_cleanup: readAgentDomState(AGENT) },
);

/* -- Proof 3f: the credential bridge is not on the app window ----------- */

/**
 * Amendment 7's central claim, checked from the side that can disprove it.
 *
 * *"`dashCredential` is not exposed in the app window. The two capabilities
 * never coexist in one renderer."* Every other proof about the credential seam
 * is written from inside the prompt, where the bridge is supposed to be. This is
 * the one that fails if a future preload edit exposes it somewhere it is not —
 * which is exactly the regression a reviewer reading `credential-preload.ts`
 * alone would not see, because that file would still be correct.
 */
const appWindowBridges = (await window.webContents.executeJavaScript(
  `({ credential: typeof window.dashCredential, shell: typeof window.dashShell })`,
)) as { credential: string; shell: string };
check(
  "3f. the app window has no credential bridge",
  appWindowBridges.credential === "undefined" && appWindowBridges.shell === "object",
  appWindowBridges,
);

/* -- Proof 5: the OAuth prompt, end to end in main (MAR-446) ------------ */

/**
 * MAR-446 shipped with its Electron half unexecuted.
 *
 * `tests/oauth-*.test.ts` cover the four pure modules thoroughly, and MAR-432's
 * bundle inspection proves `credential-preload.js` is *in* the build. Neither
 * says the pieces are wired: that pressing the prompt's button reaches
 * `CREDENTIAL_AUTHORIZE_CHANNEL`, that main resolves the provider, that
 * `startAuthorization` binds a loopback port, and that the URL handed to the
 * browser is the one the manifest's scopes describe. That is main-process
 * sequencing across a real preload and a real window, which is the category this
 * harness exists for.
 *
 * ## Why the browser is intercepted rather than opened
 *
 * `shell.openExternal` is swapped for a capture function before the flow starts.
 * The alternative is a real Google consent screen in the user's own browser,
 * which would make this run interactive, dependent on whoever is signed in, and
 * impossible to repeat unattended — and it would send a live authorization
 * request from a proof run.
 *
 * Capturing the URL asserts strictly more than watching a tab appear: the
 * redirect really is the loopback address the listener really bound, the
 * challenge method really is S256, and the scopes really are the manifest's.
 * What stays unproven is the handoff itself — that the OS opens that URL — and
 * that is the one link in this chain a machine cannot check for a human.
 */
const oauthTarget = (() => {
  const seededManifest = readAgentManifest(AGENT);
  if (seededManifest === null) {
    return null;
  }
  return (
    connectableFields(AGENT, seededManifest).find((field) => field.kind === "oauth") ?? null
  );
})();

check("5a. the Gmail example declares a sign-in DASH can run", oauthTarget !== null, {
  connection: oauthTarget?.connection_id,
  field: oauthTarget?.field_id,
  provider: oauthTarget?.oauth?.provider_id,
});

if (oauthTarget !== null) {
  const opened: string[] = [];
  const realOpenExternal = shell.openExternal.bind(shell);
  shell.openExternal = async (url: string): Promise<void> => {
    opened.push(url);
  };

  // The prompt is a *modal child* of the app window, so it is the window that
  // is not the one we already have. Resolved by waiting for it to appear rather
  // than by index, because `getAllWindows` order is not contractual.
  const promptWindow = new Promise<BrowserWindow>((resolve, reject) => {
    // The timeout says what it saw. "No prompt window" was the only thing this
    // ever reported, and it was wrong in both directions: a window that opened
    // and failed to load looked identical to one that was never constructed.
    const deadline = setTimeout(() => {
      const seen = BrowserWindow.getAllWindows().map((candidate) => ({
        app: candidate === window,
        url: candidate.webContents.getURL(),
        loading: candidate.webContents.isLoading(),
      }));
      reject(new Error(`no usable prompt window after 30s; windows: ${JSON.stringify(seen)}`));
    }, 30_000);
    const look = (): void => {
      const found = BrowserWindow.getAllWindows().find((candidate) => candidate !== window);
      if (found === undefined) {
        setTimeout(look, 50);
        return;
      }
      // The page is a local route in the exported renderer, so it can finish
      // loading inside the 50ms this poll waits — and `did-finish-load` would
      // then already have fired, leaving the listener below waiting for an event
      // that is never coming.
      //
      // `getURL()` is the half that cannot be dropped: an empty URL means the
      // window exists but its navigation has not started, and `isLoading()` is
      // false then too. Treating that as loaded resolves this promise onto a
      // blank window, and the `executeJavaScript` that follows hangs with no
      // deadline left to catch it.
      if (!found.webContents.isLoading() && found.webContents.getURL() !== "") {
        clearTimeout(deadline);
        resolve(found);
        return;
      }
      found.webContents.once("did-fail-load", (_event, code, description, url) => {
        clearTimeout(deadline);
        reject(new Error(`the prompt window failed to load ${url}: ${description} (${code})`));
      });
      found.webContents.once("did-finish-load", () => {
        clearTimeout(deadline);
        resolve(found);
      });
    };
    look();
  });

  // Not awaited yet. It settles when the prompt is cancelled below, and awaiting
  // it here would deadlock on a window that has not opened.
  const authorization = promptForAuthorization(
    oauthTarget,
    "Windows Credential Manager",
    false,
    null,
    null,
    window,
    RENDERER_ORIGIN,
  );

  // `promptForAuthorization` has an early return — an unknown provider resolves
  // to `provider_error` without ever constructing a window. Waiting only on the
  // window turns that into a 30-second hang reported as "no prompt window",
  // which names the symptom and hides the cause. Racing the two means the flow
  // reports whichever happened, and an outcome arriving *before* a window is
  // itself the finding.
  const prompt = await Promise.race([
    promptWindow,
    authorization.then((outcome): never => {
      throw new Error(
        `the authorization resolved before any window opened: ${JSON.stringify(outcome)}`,
      );
    }),
  ]);

  const promptBridge = (await prompt.webContents.executeJavaScript(
    `({
      methods: Object.keys(window.dashCredential ?? {}).sort(),
      leaks: [ "dashShell", "dashData", "ipcRenderer", "require" ].filter((k) => k in window)
    })`,
  )) as { methods: string[]; leaks: string[] };
  check(
    "5b. the prompt exposes only the credential bridge",
    JSON.stringify(promptBridge.methods) ===
      JSON.stringify(["authorize", "cancel", "describe", "submit"]) &&
      promptBridge.leaks.length === 0,
    promptBridge,
  );

  const described = (await prompt.webContents.executeJavaScript(
    `window.dashCredential.describe()`,
  )) as {
    mode?: string;
    provider_label?: string;
    permissions?: string[];
    waiting?: boolean;
  } | null;
  check(
    "5c. describe answers in oauth mode, in permissions and not scopes",
    described?.mode === "oauth" &&
      described.provider_label === "Google" &&
      Array.isArray(described.permissions) &&
      described.permissions.length > 0 &&
      // `lib/copy/identifiers.ts` forbids a scope here. A permission list that
      // leaked one would render a googleapis URL at a user as an explanation.
      !JSON.stringify(described.permissions).includes("googleapis.com"),
    described,
  );

  /**
   * The press. Deliberately not awaited: `authorize` resolves only when the
   * whole sign-in settles, and this one settles when we cancel it below.
   */
  void prompt.webContents.executeJavaScript(`window.dashCredential.authorize()`);

  // Poll for the capture rather than sleeping a fixed time: binding a port and
  // building a URL is fast, but a fixed wait is either flaky or slow.
  const captured = await (async (): Promise<string | null> => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (opened.length > 0) {
        return opened[0] ?? null;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  })();

  check("5d. authorize reached shell.openExternal", captured !== null, {
    captured: captured === null ? null : new URL(captured).origin,
  });

  if (captured !== null) {
    const url = new URL(captured);
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const scopes = (url.searchParams.get("scope") ?? "").split(" ").filter(Boolean);
    const declared = [...(oauthTarget.oauth?.scopes ?? [])].sort();

    check(
      "5e. the browser URL is Google's consent endpoint",
      url.origin === "https://accounts.google.com",
      url.origin + url.pathname,
    );

    check(
      "5f. the redirect is a bound loopback port, per RFC 8252",
      // Amendment 8's amendment of Amendment 7: this listener is the new TCP
      // socket, and it is on 127.0.0.1 with an OS-assigned port.
      /^http:\/\/127\.0\.0\.1:\d+\//.test(redirect),
      redirect,
    );

    check(
      "5g. the request is PKCE S256 with a challenge and a state",
      url.searchParams.get("code_challenge_method") === "S256" &&
        (url.searchParams.get("code_challenge") ?? "").length > 0 &&
        (url.searchParams.get("state") ?? "").length > 0,
      {
        method: url.searchParams.get("code_challenge_method"),
        challenge_length: (url.searchParams.get("code_challenge") ?? "").length,
      },
    );

    // The manifest's scopes plus the provider's identity scopes, and nothing
    // else. `openid` and `email` are added by `authorizationScopes` on purpose —
    // without an address DASH cannot tell the user *which* account they
    // connected, and neither scope reaches any user data. See
    // `lib/oauth/providers.ts`.
    //
    // This proof previously demanded the declared set exactly, which the design
    // never produced. It had not been executed on a machine, so the wrong
    // expectation sat here unchallenged: the first real run failed on the
    // identity scopes rather than on anything wrong. What is worth asserting is
    // that nothing *else* is asked for, which is the scope-creep this guards.
    // Read from the provider rather than restated here: a copy would let the
    // two drift, and this proof is the thing that would then be believed.
    const identity = oauthProviderById(oauthTarget.oauth?.provider_id ?? "")?.identity_scopes ?? [];
    const permitted = [...new Set([...identity, ...declared])].sort();
    check(
      "5h. it asks for the declared scopes plus identity, and nothing more",
      JSON.stringify([...scopes].sort()) === JSON.stringify(permitted),
      { asked: [...scopes].sort(), permitted },
    );

    // The verifier is what makes the exchange safe and must never be in
    // anything openable. `lib/oauth/flow.ts` says so; this checks the built URL.
    check(
      "5i. the URL carries no verifier and no secret",
      !captured.includes("code_verifier") && !captured.includes("client_secret"),
      { params: [...url.searchParams.keys()] },
    );
  }

  // Cancel through the bridge, which is also the proof that `cancel` releases
  // the loopback port rather than leaving it bound until the five-minute
  // timeout — the behaviour `electron/oauth-session.ts` claims for it.
  void prompt.webContents.executeJavaScript(`window.dashCredential.cancel()`).catch(() => undefined);

  const outcome = await authorization;
  check(
    "5j. cancelling settles the prompt as cancelled, storing nothing",
    outcome.ok === false && outcome.code === "cancelled",
    outcome,
  );

  shell.openExternal = realOpenExternal;
}

/* -- Proof 4: the bundled runner started, from a real shell ------------- */

/**
 * MAR-415. The one part of the runner that no test can reach.
 *
 * `tests/runner-*.test.ts` cover the runner itself thoroughly, in CI, against
 * real processes — but they construct it in-process. What they cannot show is
 * *Electron spawning it*: a detached child, launched with
 * `ELECTRON_RUN_AS_NODE=1`, finding its own contracts directory from inside
 * `dist/electron/`, and listening. That is exactly the class of thing MAR-424's
 * "three traps that only a real launch finds" was written about, so it is
 * proven here rather than assumed.
 *
 * The endpoint file is the runner's own claim; the HTTP round trip is the
 * check. Since MAR-430 that round trip goes down a named pipe or a Unix socket
 * rather than to a port, which is the other thing only a real launch shows:
 * `runner/endpoint.ts` binding successfully inside a packaged layout.
 */
const endpointFile = path.join(dataDir, "runner.json");
  const recorded = existsSync(endpointFile)
  ? (JSON.parse(readFileSync(endpointFile, "utf8")) as {
      pid: number;
      endpoint: string;
      transport: string;
      runner_protocol?: number;
      runner_build?: string;
    })
  : null;
check("4a. the runner wrote an endpoint file", recorded !== null, recorded);

if (recorded !== null) {
  const call = ipcFetch(recorded.endpoint);

  let health: unknown = null;
  try {
    const response = await call(`${IPC_ORIGIN}/health`, { signal: AbortSignal.timeout(5_000) });
    health = await response.json();
  } catch (error: unknown) {
    health = { error: error instanceof Error ? error.message : String(error) };
  }
  check(
    `4b. the runner is listening on its ${recorded.transport} endpoint`,
    (health as { ok?: boolean } | null)?.ok === true,
    health,
  );

  // The credential is not optional. OS access control is the first gate and
  // this is the second, and on Windows the second is the one this project can
  // both set and verify — see `runner/channel-secret.ts`.
  let unauthorized = 0;
  try {
    unauthorized = (await call(`${IPC_ORIGIN}/agents`, { signal: AbortSignal.timeout(5_000) }))
      .status;
  } catch {
    unauthorized = 0;
  }
  check("4c. the runner refuses an unauthenticated caller", unauthorized === 401, {
    status: unauthorized,
  });

  // MAR-430's headline: there is no port. A runner that still opened one would
  // pass every check above and defeat the point of the issue.
  check(
    "4d. the endpoint is a socket or a pipe, not a port",
    recorded.transport === "pipe" || recorded.transport === "unix",
    { transport: recorded.transport, endpoint: recorded.endpoint },
  );

  check(
    "4e. the installed runner matches this shell build and protocol",
    recorded.runner_protocol === RUNNER_PROTOCOL_VERSION &&
      recorded.runner_build === RUNNER_BUILD_ID &&
      (health as { runner_protocol?: number } | null)?.runner_protocol === RUNNER_PROTOCOL_VERSION &&
      (health as { runner_build?: string } | null)?.runner_build === RUNNER_BUILD_ID,
    {
      expected: { protocol: RUNNER_PROTOCOL_VERSION, build: RUNNER_BUILD_ID },
      recorded: { protocol: recorded.runner_protocol, build: recorded.runner_build },
      health,
    },
  );

  /* -- Proof 6: existing sample -> handoff -> runner -> Runs ------------ */

  const templates = readTemplateSources();
  check("6a. the shipped sample templates can be read", templates.ok, templates.ok ? "present" : templates);

  if (templates.ok && (recorded.transport === "pipe" || recorded.transport === "unix")) {
    const parentDir = mkdtempSync(path.join(tmpdir(), "dash-installed-sample-"));
    let agentId = "";
    try {
      // Avoid touching an existing user's sample registration. The sample
      // names itself from the first free folder, so reserve every identity
      // already owned by this installation inside the temporary parent.
      for (let suffix = 1; suffix < 1_000; suffix += 1) {
        const candidate = suffix === 1 ? SAMPLE_AGENT_ID : `${SAMPLE_AGENT_ID}-${String(suffix)}`;
        if (readRegistration(dataDir, candidate) === null) break;
        mkdirSync(path.join(parentDir, candidate), { recursive: true });
      }

      const created = createSampleAgent({
        parentDir,
        sources: templates.value,
        kitVersion: app.getVersion(),
        now: new Date(),
        ids: {
          handoff_id: randomBytes(16).toString("hex"),
          nonce: randomBytes(32).toString("hex"),
        },
      });
      check("6b. Try a sample agent creates a real handoff", created.ok, created);

      if (created.ok) {
        agentId = created.value.handoff.agent_id;
        // An agent id is a durable identity, so removing and re-adding the
        // sample deliberately preserves its earlier run history. Record that
        // history before this proof starts; otherwise a completed run from an
        // earlier smoke can satisfy the wait before this process has produced
        // its own artifact.
        const previousRuns = (await window.webContents.executeJavaScript(
          `window.dashData.runs()`,
        )) as {
          data?: { runs?: Array<{ agent?: string; run_id?: string }> };
        };
        const previousRunIds = new Set(
          (previousRuns.data?.runs ?? [])
            .filter((run) => run.agent === agentId)
            .map((run) => run.run_id)
            .filter((runId): runId is string => typeof runId === "string"),
        );
        const handle: RunnerHandle = {
          origin: IPC_ORIGIN,
          endpoint: recorded.endpoint,
          transport: recorded.transport,
          pid: recorded.pid,
          token: ensureChannelSecret(dataDir),
          adopted: true,
          started_at: null,
        };
        let observedPending = false;
        const ports = handoffPorts(dataDir, handle);
        const report = await openHandoff(created.value.url, {
          ...ports,
          confirm: async () => {
            observedPending =
              readHandoffRecord(created.value.handoff.handoff_id)?.outcome === "pending";
            return true;
          },
        });
        check(
          "6c. consent sees pending first, then registers and starts the sample",
          observedPending && report.ok && report.running === true,
          { observedPending, report },
        );

        /*
         * 6d is a *negative* proof, and it is the one that matters most here.
         *
         * The agent used to start running the instant the runner spawned it,
         * and every proof below happened to pass because of that. MAR-457
         * inverted it: the sample now waits to be asked. A regression back to a
         * timer would restore the old behaviour and leave every other check in
         * this block still green, so nothing except an assertion that *nothing
         * happened* can catch it.
         *
         * It waits for the agent to publish its waiting task first, so this is
         * "the agent is up and chose not to run", not "the agent has not
         * started yet" — which would pass for the wrong reason.
         */
        const waitingTask = await waitForValue(async () => {
          const view = (await window.webContents.executeJavaScript(
            `window.dashData.workspace(${JSON.stringify(agentId)})`,
          )) as {
            data?: {
              snapshot?: {
                observed_at?: string;
                tasks?: Array<{ id?: string; status?: string }>;
              } | null;
            };
          };
          const task = view.data?.snapshot?.tasks?.find(
            (candidate) => candidate.id === "waiting-to-be-run" && candidate.status === "pending",
          );
          return task === undefined
            ? null
            : { task, observed_at: view.data?.snapshot?.observed_at ?? "" };
        }, "the sample to publish the task it is waiting on");
        check("6d. the sample waits to be asked", waitingTask !== null, waitingTask?.task);

        const ranUnbidden = (await window.webContents.executeJavaScript(
          `window.dashData.runs()`,
        )) as { data?: { runs?: Array<{ agent?: string; run_id?: string }> } };
        check(
          "6e. nothing ran on its own",
          !(ranUnbidden.data?.runs ?? []).some(
            (run) =>
              run.agent === agentId &&
              typeof run.run_id === "string" &&
              !previousRunIds.has(run.run_id),
          ),
          ranUnbidden.data?.runs,
        );

        /*
         * MAR-473: the feed this gate reads is served from this process.
         *
         * Until now the mandatory gate read Google News, Hacker News and arXiv
         * over the public internet, and `6g`'s single 20-second budget had to
         * cover all three fetches *and* the telemetry propagation behind them.
         * `agent-kit/template/agent.mjs` reads sources sequentially with a
         * 15-second timeout each, so one unresponsive source consumed 15s of the
         * 20 and left ~5s for a step that measurably needs ~4s. On `0ac58ac` the
         * fetch took 15.6s and the telemetry needed 4.6s: the gate lost by 0.2
         * seconds, and reported it as a defect in the Runs bridge.
         *
         * Three loopback sources, one per parser, make the mandatory gate a
         * statement about DASH: the run completes, telemetry reaches Runs, the
         * artifact crosses into the app, and the page draws it. It also proves
         * all three parsers on every run, which reading three live feeds never
         * did — a source that went quiet simply produced fewer items and stayed
         * green. Whether the live sources still answer is a real question, and
         * it is asked below by `6l`, which cannot fail a release. See ADR 0004.
         */
        const LOCAL_ITEMS = { rss: 3, hn_algolia: 2, atom: 4 } as const;
        const LOCAL_TOTAL = LOCAL_ITEMS.rss + LOCAL_ITEMS.hn_algolia + LOCAL_ITEMS.atom;
        // Distinct per run, so a digest left by an earlier smoke cannot satisfy
        // this one — the same rule `previousRunIds` enforces one proof above.
        const feedTag = randomBytes(4).toString("hex");
        const headlineFor = (format: string, index: number): string =>
          `DASH local ${format} item ${String(index)} ${feedTag}`;

        let feeds: Server | null = null;
        try {
          feeds = createServer((request, response) => {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const send = (type: string, body: string): void => {
              response.writeHead(200, { "content-type": type });
              response.end(body);
            };

            if (url.pathname === "/rss") {
              const items = Array.from({ length: LOCAL_ITEMS.rss }, (_unused, index) =>
                `<item><title>${headlineFor("rss", index + 1)}</title>` +
                `<link>https://example.invalid/rss/${String(index + 1)}</link>` +
                `<pubDate>Sat, 02 Aug 2026 12:0${String(index)}:00 GMT</pubDate></item>`,
              ).join("");
              send("application/rss+xml", `<rss><channel>${items}</channel></rss>`);
              return;
            }
            if (url.pathname === "/hn") {
              send(
                "application/json",
                JSON.stringify({
                  hits: Array.from({ length: LOCAL_ITEMS.hn_algolia }, (_unused, index) => ({
                    title: headlineFor("hn_algolia", index + 1),
                    url: `https://example.invalid/hn/${String(index + 1)}`,
                    created_at: `2026-08-02T11:0${String(index)}:00.000Z`,
                  })),
                }),
              );
              return;
            }
            if (url.pathname === "/atom") {
              const entries = Array.from({ length: LOCAL_ITEMS.atom }, (_unused, index) =>
                `<entry><title>${headlineFor("atom", index + 1)}</title>` +
                `<link href="https://example.invalid/atom/${String(index + 1)}"/>` +
                `<published>2026-08-02T10:0${String(index)}:00Z</published></entry>`,
              ).join("");
              send("application/atom+xml", `<feed>${entries}</feed>`);
              return;
            }
            response.writeHead(404, { "content-type": "text/plain" });
            response.end("not_found");
          });

          await new Promise<void>((resolve, reject) => {
            feeds?.once("error", reject);
            feeds?.listen(0, "127.0.0.1", resolve);
          });
          const feedOrigin = `http://127.0.0.1:${String((feeds.address() as AddressInfo).port)}`;

          /*
           * The agent reads this file at run time, so writing it after creation
           * and before "Run now" is the same edit a user makes by hand. It is
           * deliberately the user's own affordance rather than a harness-only
           * switch: a test hook the product does not have would prove a path the
           * product does not have.
           */
          writeFileSync(
            path.join(created.value.directory, SOURCES_FILE_NAME),
            JSON.stringify(
              [
                { name: "Local RSS", url: `${feedOrigin}/rss`, format: "rss" },
                { name: "Local HN", url: `${feedOrigin}/hn`, format: "hn_algolia" },
                { name: "Local Atom", url: `${feedOrigin}/atom`, format: "atom" },
              ],
              null,
              2,
            ),
            "utf8",
          );

          /*
           * Run now, through the audited command boundary the renderer uses —
           * not by poking the runner. If this path works only in a test harness
           * it does not work.
           *
           * `observed_at` is re-read here rather than fabricated, and that detail
           * is the whole reason this proof earned its keep. The first version of
           * this check invented a timestamp, and enforcement refused it as
           * `stale_snapshot` — which then exposed the real defect behind it:
           * `runner/state.ts` mints `observed_at` on every build and the adapter
           * rebuilds every five seconds, so the value churns whether or not
           * anything changed. Any control bound to a rendered snapshot has about
           * a five-second window. The page now re-reads for the same reason this
           * does.
           */
          const fresh = (await window.webContents.executeJavaScript(
            `window.dashData.workspace(${JSON.stringify(agentId)})`,
          )) as { data?: { snapshot?: { observed_at?: string } | null } };
          const runRequest = {
            agent_id: agentId,
            observed_at: fresh.data?.snapshot?.observed_at ?? "",
            task_id: "waiting-to-be-run",
          };
          const asked = (await window.webContents.executeJavaScript(
            `window.dashShell.retry(${JSON.stringify(runRequest)})`,
          )) as { ok?: boolean; reason?: string };
          check("6f. Run now is accepted through the audited bridge", asked.ok === true, asked);

          /*
           * Two budgets, because there are two different things being waited on.
           *
           * MAR-473: this used to be one 20-second window covering the agent's own
           * work *and* the telemetry propagation behind it, so a slow source spent
           * the bridge's budget and the bridge got the blame. The agent's work is
           * now loopback and bounded; the bridge's share is stated separately and
           * measured against the ~3.3-5.5s this step has actually taken across
           * every recorded CI run.
           */
          const AGENT_RUN_BUDGET_MS = 30_000;
          const BRIDGE_BUDGET_MS = 20_000;

          // The agent's half first: its own artifact on its own disk. Reaching
          // this line means the run really ran, so a later failure is about DASH
          // rather than about the agent — the distinction 6g could not draw.
          const reportsDir = path.join(created.value.directory, "reports");
          const digestFiles = await waitForObserved(
            async () => {
              const files = existsSync(reportsDir)
                ? readdirSync(reportsDir).filter((name) => name.endsWith(".json"))
                : [];
              return { value: files.length > 0 ? files : null, seen: { reportsDir, files } };
            },
            "the runner-hosted sample digest artifact",
            AGENT_RUN_BUDGET_MS,
          );
          const onDisk = digestFiles.value ?? [];
          check("6h. the sample leaves a digest in its own folder", onDisk.length > 0, {
            files: onDisk,
            waited_ms: digestFiles.elapsed_ms,
          });

          /*
           * Now the bridge, with its own budget and its own diagnosis.
           *
           * The failure detail names what it saw: every run this agent has,
           * with its status and whether its id was already known. "No run at
           * all", "a run still running" and "a completed run whose id predates
           * this proof" are three different defects that all used to print
           * `null`.
           */
          const runWait = await waitForObserved(
            async () => {
              const view = (await window.webContents.executeJavaScript(
                `window.dashData.runs()`,
              )) as {
                ok?: boolean;
                data?: { runs?: Array<{ agent?: string; run_id?: string; status?: string }> };
              };
              const mine = (view.data?.runs ?? []).filter((run) => run.agent === agentId);
              const match =
                mine.find(
                  (run) =>
                    run.status === "completed" &&
                    typeof run.run_id === "string" &&
                    !previousRunIds.has(run.run_id),
                ) ?? null;
              return {
                value: match,
                seen: mine.map((run) => ({
                  run_id: run.run_id,
                  status: run.status,
                  predates_this_proof: previousRunIds.has(run.run_id ?? ""),
                })),
              };
            },
            "runner-hosted sample telemetry to reach Runs",
            BRIDGE_BUDGET_MS,
          );
          const completed = runWait.value;
          check(
            "6g. runner-hosted telemetry renders through the Runs bridge",
            completed !== null,
            completed ?? {
              waited_ms: runWait.elapsed_ms,
              polls: runWait.polls,
              runs_for_this_agent: runWait.last_seen,
              // The agent's own half, so the reader can tell a bridge that never
              // delivered from a run that never happened without leaving the line.
              digest_on_disk: onDisk,
              digest_waited_ms: digestFiles.elapsed_ms,
            },
          );

          /*
           * The half Wave 0 could not prove.
           *
           * 6h is the check this block used to end on: a file exists in the
           * agent's folder. That is evidence the *agent* wrote something and no
           * evidence whatsoever that DASH can show it — which was true, because
           * until MAR-457 there was no artifact contract, table, view or surface
           * for it to arrive in. This reads the digest back through the same
           * bridge the renderer reads, with its citations and its verdict.
           */
          /*
           * MAR-473: no run id, no query. This used to fall through to
           * `run(agentId, "")`, which cannot match anything, so 6i/6j/6k reported
           * `undefined` and read as three independent defects. A proof whose input
           * never arrived says so instead.
           */
          const digest =
            completed === null
              ? null
              : (
                  await waitForObserved(
                    async () => {
                      const view = (await window.webContents.executeJavaScript(
                        `window.dashData.run(${JSON.stringify(agentId)}, ${JSON.stringify(
                          completed.run_id ?? "",
                        )})`,
                      )) as {
                        data?: {
                          artifacts?: Array<{
                            artifact_id?: string;
                            title?: string;
                            items?: unknown[];
                            sources_fetched?: Array<{
                              source_name?: string;
                              source_url?: string;
                              status?: string;
                            }>;
                          }>;
                          grounding?: {
                            verdict?: string;
                            items_total?: number;
                            items_cited?: number;
                          } | null;
                        };
                      };
                      const first = view.data?.artifacts?.[0];
                      return {
                        value:
                          first === undefined
                            ? null
                            : { artifact: first, grounding: view.data?.grounding },
                        seen: { artifacts: view.data?.artifacts?.length ?? 0 },
                      };
                    },
                    "the digest to reach DASH through the read bridge",
                    BRIDGE_BUDGET_MS,
                  )
                ).value;

          if (completed === null) {
            skip(
              "6i. the digest reaches DASH, not just the agent's folder",
              "6g produced no run to read a digest from",
            );
          } else {
            check(
              "6i. the digest reaches DASH, not just the agent's folder",
              digest !== null && typeof digest.artifact.artifact_id === "string",
              digest?.artifact,
            );
          }

          /*
           * What 6j asserts, and why it changed.
           *
           * It used to assert `verdict !== undefined` — that *a* verdict existed.
           * Per `lib/analyze.ts`, a digest of zero items from three unreachable
           * sources has nothing uncited and nothing unsupported, so it is reported
           * `grounded` and that check passed. It would have passed on `ungrounded`
           * too. So the proof that supposedly made the live fetch the point could
           * not tell a working fetch from a dead one, and twice it silently did
           * not: CI runs 30736386756 and 30753436632 carried 20 items instead of
           * 30, one source gone, everything green.
           *
           * Against a local feed the expected count is known exactly, so this now
           * asserts the number and the verdict. Cited must equal total: an item
           * DASH cannot trace to a source it saw fetched is the failure this
           * surface exists for.
           */
          if (completed === null) {
            skip(
              "6j. the digest carries a grounding verdict over every local item",
              "6g produced no run to read a digest from",
            );
          } else {
            check(
              "6j. the digest carries a grounding verdict over every local item",
              digest?.grounding?.verdict === "grounded" &&
                digest.grounding.items_total === LOCAL_TOTAL &&
                digest.grounding.items_cited === LOCAL_TOTAL,
              { expected_items: LOCAL_TOTAL, grounding: digest?.grounding },
            );
          }

          /*
           * ADR 0004's rule, enforced rather than trusted.
           *
           * Everything above is only network-independent while the sources this
           * run actually read are local, and "actually read" is the operative
           * word: `sources.json` is written a hundred lines up and could be
           * changed, defaulted around, or quietly ignored. This reads the
           * addresses back out of the digest DASH received, which is the only
           * place that records where the bytes really came from.
           *
           * Without it the fix is a convention, and a convention is what decays.
           * MAR-473 cost a day of CI archaeology; the next person to point this
           * gate at a live feed should be told so by a proof, not by an
           * intermittent red X three weeks later.
           */
          const fetchedUrls = (digest?.artifact.sources_fetched ?? []).map(
            (source) => source.source_url ?? "",
          );
          const offMachine = fetchedUrls.filter((url) => {
            try {
              const host = new URL(url).hostname;
              return host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
            } catch {
              return true;
            }
          });
          if (completed === null) {
            skip(
              "6m. the mandatory gate reached no host outside this machine",
              "6g produced no run whose sources could be read back",
            );
          } else {
            check(
              "6m. the mandatory gate reached no host outside this machine",
              fetchedUrls.length === 3 && offMachine.length === 0,
              { fetched: fetchedUrls, off_machine: offMachine },
            );
          }

          // And the renderer actually draws it. MAR-454's whole lesson is that a
          // proof reading data through a bridge can pass while the page above it
          // is broken — proofs 5a-5j were green in a suite of 1635 tests while
          // three shipped defects sat in the one path no unit test could reach.
          /*
           * Built from protocol and host rather than from `origin`.
           *
           * `dash-app:` is not one of the URL standard's "special" schemes, so
           * `new URL("dash-app://ui/").origin` is the string "null" — an opaque
           * origin, correctly per spec and useless here. The first version of this
           * proof used it and produced `null/runs/detail?...`, which Electron
           * refused with ERR_INVALID_URL. Found by running it.
           */
          const parsedRenderer = new URL(rendered.url);
          const detailUrl =
            `${parsedRenderer.protocol}//${parsedRenderer.host}` +
            `/runs/detail?agent=${encodeURIComponent(agentId)}` +
            `&run_id=${encodeURIComponent(completed?.run_id ?? "")}`;

          let drawn: { text: string; sources: number } | null = null;
          try {
            await window.loadURL(detailUrl);
            drawn = completed === null ? null : await waitForValue(async () => {
              const seen = (await window.webContents.executeJavaScript(
                `({ text: document.body.innerText,
                    sources: document.querySelectorAll(".digest-sources").length })`,
              )) as { text: string; sources: number };
              // The page reads its view in an effect, so an empty body is "not
              // yet" rather than "not there". Waiting for the digest's own title
              // is what makes this an assertion about content and not about
              // whether a document object exists.
              //
              // The fallback is a sentinel that cannot appear in rendered text,
              // so a missing digest times out rather than matching every page.
              // Written as an escape since MAR-464: it was a raw NUL byte, which
              // made ripgrep classify this whole file as binary and skip it, and
              // a proof file nobody can search is one nobody will read.
              return seen.text.includes(digest?.artifact.title ?? "\u0000") ? seen : null;
            }, "the run detail page to draw the digest");
          } catch (error: unknown) {
            drawn = null;
            console.warn(`[smoke] the run detail page did not load: ${String(error)}`);
          }
          if (completed === null) {
            skip(
              "6k. the run detail page draws the digest",
              "6g produced no run whose detail page could be opened",
            );
          } else {
            check(
              "6k. the run detail page draws the digest",
              drawn !== null,
              drawn?.text.slice(0, 400),
            );
          }

          const finalLedger = readHandoffRecord(created.value.handoff.handoff_id);
          check(
            "6f. the handoff ledger keeps the first final outcome",
            finalLedger?.outcome === "registered",
            finalLedger,
          );

          await removeAgent(agentId, ports);
          agentId = "";
        } finally {
          feeds?.close();
        }
      }
    } finally {
      if (agentId !== "") {
        const handle: RunnerHandle = {
          origin: IPC_ORIGIN,
          endpoint: recorded.endpoint,
          transport: recorded.transport,
          pid: recorded.pid,
          token: ensureChannelSecret(dataDir),
          adopted: true,
          started_at: null,
        };
        await removeAgent(agentId, handoffPorts(dataDir, handle)).catch(() => undefined);
      }
      // Windows can keep a just-exited child's directory handle briefly after
      // lifecycle has reached `exited`. Node's bounded retry is specifically
      // for this EPERM/EBUSY cleanup window; the functional proof above has
      // already required the runner to confirm the process stopped.
      rmSync(parentDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }

  /* -- 6l: are the shipped sources still there? (MAR-473, non-blocking) -- */

  /*
   * The question the mandatory gate stopped asking, asked properly.
   *
   * ADR 0004 splits liveness out of the release gate rather than deleting it.
   * The gate above proves DASH's loop against a local feed; this proves nothing
   * about DASH and everything about the three addresses the scout ships with —
   * whether they still answer, how slowly, and whether what comes back still
   * parses as the format the source declares.
   *
   * It is deliberately better than what it replaces. The old 6j could not tell
   * 30 items from 20 from 0, and twice passed with a source dead. This names the
   * source that failed. It is also deliberately *not* a failure: `note` never
   * touches `failures`, because Hacker News being slow is not a reason to
   * refuse a release, and a red X people learn to re-run is worse than no X at
   * all. Read it, and file an issue when a source has gone.
   */
  const liveResults: unknown[] = [];
  for (const source of DEFAULT_SOURCES) {
    const started = Date.now();
    try {
      const response = await fetch(source.url, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          accept: "application/rss+xml, application/atom+xml, application/json, text/xml",
        },
        redirect: "follow",
      });
      const body = await response.text();
      // The same shape test the agent's own parser applies, without importing
      // an .mjs template into the harness: a JSON source must carry `hits`, an
      // XML one must carry at least one block of the tag its format names.
      const looksParseable =
        source.format === "hn_algolia"
          ? ((): boolean => {
              try {
                return Array.isArray((JSON.parse(body) as { hits?: unknown }).hits);
              } catch {
                return false;
              }
            })()
          : body.includes(source.format === "atom" ? "<entry" : "<item");
      liveResults.push({
        source: source.name,
        status: response.ok ? (looksParseable ? "ok" : "not_a_feed") : "http_error",
        http_status: response.status,
        ms: Date.now() - started,
        bytes: body.length,
      });
    } catch (error: unknown) {
      liveResults.push({
        source: source.name,
        status: "unreachable",
        ms: Date.now() - started,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  note("6l. the shipped live sources still answer (advisory, never blocking)", {
    checked_at: new Date().toISOString(),
    sources: liveResults,
  });

  /* -- Proof 7: the permission broker, end to end (MAR-458) -------------- */

  if (recorded.transport === "pipe" || recorded.transport === "unix") {
    await proveTheBroker(recorded);
    await proveUntracedAttempts(recorded);
    await proveProtectedWorkspaceDownload(recorded);
  }
}

console.log(`\n[smoke] ${failures.length === 0 ? "all proofs passed" : `FAILED: ${failures.join(", ")}`}\n`);
console.log(
  `[smoke] the runner is left running on purpose (pid ${String(recorded?.pid ?? "-")}). ` +
    `That is what "closing DASH leaves agents running" means; see runner/README.md.\n`,
);
}

/* ---------------------------------------------------------------------- *
 * Proof 8: an attempt DASH never received (MAR-467, ADR 0005)
 * ---------------------------------------------------------------------- */

/**
 * A real agent asks for more than the runner's buffer will hold, and the
 * requests that were destroyed become something a user can find.
 *
 * ## Why this one, of the three
 *
 * MAR-467 names three ways a brokered request goes untraced. Only this one can
 * be driven end to end on an installed shell without a human: a closed-DASH
 * window needs DASH to be closed, which is not a thing a proof running *inside*
 * DASH can arrange, and an undelivered answer depends on a child exiting inside
 * the window between DASH deciding and the runner writing — reproducible, but a
 * race to schedule rather than a fact to assert. Both are covered by unit tests
 * and said so plainly in the ADR. This one is a bound being hit, which is
 * deterministic: 200 requests against a buffer of 64.
 *
 * ## The check that matters
 *
 * Not 8b, which merely shows the surface exists. **8d** is the point: the number
 * of audit rows this run produced is compared against the number of requests the
 * agent actually made, and the requests that were dropped must be *missing* from
 * the audit. A build that quietly synthesised a plausible row for a request DASH
 * never saw would pass every other check in this file and fail that one.
 *
 * That is the same failure mode as MAR-473's proof 6j, which asserted a verdict
 * existed and would have accepted `ungrounded` — a check that cannot tell the
 * good case from the bad one reports the good case forever.
 */
async function proveUntracedAttempts(recorded: {
  endpoint: string;
  transport: "pipe" | "unix" | string;
  pid: number;
}): Promise<void> {
  const AGENT_ID = "dash-lapse-proof";
  const CONNECTION_ID = "loopback-mail";
  /** How many the agent fires. Comfortably past MAX_BROKER_BUFFER_COUNT (64). */
  const BURST = 200;

  const workDir = mkdtempSync(path.join(tmpdir(), "dash-lapse-proof-"));
  const reportPath = path.join(workDir, "burst-report.json");

  try {
    const scriptPath = path.join(workDir, "agent.mjs");
    /*
     * Writes its whole burst in one synchronous loop, then reports how many it
     * sent. No waiting for answers: this agent's purpose is to overrun the
     * buffer, and an agent that paused for each answer would never fill it.
     */
    writeFileSync(
      scriptPath,
      `
      import { writeFileSync } from "node:fs";
      const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
      send({ type: "state", state: { status: "running", runs: [], tasks: [] } });
      let sent = 0;
      for (let i = 0; i < ${String(BURST)}; i += 1) {
        send({
          type: "broker_request",
          request: {
            request_id: "burst-" + i,
            connection_id: ${JSON.stringify(CONNECTION_ID)},
            operation: "gmail.search",
            input: { query: "q", max_results: 1 },
          },
        });
        sent += 1;
      }
      writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({ sent, complete: true }), "utf8");
      // Stays alive so the runner keeps a live child while DASH drains. Exiting
      // here would fold case 3 into this proof and make a failure ambiguous.
      setInterval(() => {}, 60000);
      `,
      "utf8",
    );

    // The shipped example with its name changed, for the reason
    // `tests/broker-transport.test.ts` gives: a hand-written v2 manifest drifts
    // from the schema and starts proving things about the proof's own copy.
    const manifest = example("gmail-meeting-assistant.manifest.v2.example.json") as Record<
      string,
      unknown
    >;
    (manifest["agent"] as { name: string }).name = AGENT_ID;

    const imported = importManifest(manifest);
    check("8a. the burst agent's manifest imports", imported.ok, imported.ok ? "imported" : imported);

    const handle: RunnerHandle = {
      origin: IPC_ORIGIN,
      endpoint: recorded.endpoint,
      transport: recorded.transport as RunnerHandle["transport"],
      pid: recorded.pid,
      token: ensureChannelSecret(dataDir),
      adopted: true,
      started_at: null,
    };
    const call = runnerFetch(handle);

    // This run's rows only. A previous run's leftovers satisfying a check is the
    // trap proof 7 documents and proof 6 guards with `previousRunIds`.
    const auditBefore = new Set(readBrokerAudit(AGENT_ID, 1_000).map((row) => row.id));
    const lapsesBefore = new Set(readBrokerLapses(AGENT_ID, 1_000).map((row) => row.id));

    writeRegistration(dataDir, {
      registration: {
        agent_id: AGENT_ID,
        manifest_path: "",
        command: BUNDLED_NODE_COMMAND,
        args: [scriptPath],
        cwd: workDir,
      },
      manifestJson: JSON.stringify(manifest),
      ownership: {
        owner: "dash_handoff",
        handoff_id: "smoke-lapse-proof",
        source_project: workDir,
        display_name: "Lapse proof agent",
        summary: "Asks for more than the runner will buffer.",
        registered_at: new Date().toISOString(),
      },
    });

    await call(`${handle.origin}/registrations/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const started = await call(`${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ action: "start", credentials: await collectSpawnCredentials(AGENT_ID) }),
      signal: AbortSignal.timeout(10_000),
    });
    const startBody = (await started.json()) as { ok?: boolean; detail?: string };
    check("8b. the runner started the burst agent", startBody.ok === true, startBody);

    /* -- The lapse reaches DASH ------------------------------------------ */

    /**
     * Waits for the *shell's own* broker loop to drain and record.
     *
     * Nothing here drives the broker: `electron/main.ts` started it, and this is
     * the installed loop rather than a re-implementation of it. That is exactly
     * what MAR-454 warned about — a proof that exercises the code in-process
     * proves the code, not the product.
     */
    const lapses = await waitForValue(async () => {
      const fresh = readBrokerLapses(AGENT_ID, 1_000).filter(
        (row) => !lapsesBefore.has(row.id) && row.kind === "dropped_by_runner",
      );
      return fresh.length > 0 ? fresh : null;
    }, "a dropped brokered request to reach DASH as a lapse", 45_000);

    const dropped = (lapses ?? []).reduce((sum, row) => sum + (row.attempts ?? 0), 0);
    check(
      "8c. requests the runner destroyed reached DASH as lapses, attributed and dated",
      (lapses ?? []).length > 0 &&
        dropped > 0 &&
        (lapses ?? []).every(
          (row) =>
            row.agent === AGENT_ID &&
            row.observed_by === "runner" &&
            row.attempts !== null &&
            !Number.isNaN(Date.parse(row.from_at)),
        ),
      { lapse_rows: (lapses ?? []).length, dropped_total: dropped },
    );

    /* -- The check this proof exists for --------------------------------- */

    const reportedSent = ((): number => {
      try {
        return existsSync(reportPath)
          ? Number((JSON.parse(readFileSync(reportPath, "utf8")) as { sent?: unknown }).sent ?? 0)
          : 0;
      } catch {
        return 0;
      }
    })();

    const audited = readBrokerAudit(AGENT_ID, 1_000).filter((row) => !auditBefore.has(row.id));
    check(
      "8d. DASH invented no decision for a request it never received",
      reportedSent === BURST &&
        dropped > 0 &&
        // The whole claim in one line: every request is either adjudicated or
        // dropped, never both and never neither. If a dropped request had also
        // produced an audit row, this sum would exceed what the agent sent.
        audited.length + dropped <= BURST &&
        audited.length < BURST,
      {
        sent_by_agent: reportedSent,
        audited_decisions: audited.length,
        dropped_without_decision: dropped,
      },
    );

    check(
      "8e. a lapse carries no operation, decision or refusal, because none was made",
      (lapses ?? []).every((row) => {
        const serialised = JSON.stringify(row);
        return (
          !serialised.includes("gmail.search") &&
          !serialised.includes("allowed") &&
          !serialised.includes("refused") &&
          !Object.hasOwn(row, "operation") &&
          !Object.hasOwn(row, "decision")
        );
      }),
      { columns: Object.keys((lapses ?? [])[0] ?? {}) },
    );

    /* -- And a person can read it ---------------------------------------- */

    const view = connectionsView().agents.find((entry) => entry.name === AGENT_ID);
    const rendered = (view?.lapses ?? []).filter((entry) => entry.kind === "dropped_by_runner");
    check(
      "8f. the Connection Center says so in a sentence, without naming an operation",
      rendered.length > 0 &&
        rendered.every(
          (entry) =>
            entry.sentence.includes("before DASH saw") &&
            (entry.qualifier ?? "").includes("does not know what they asked for") &&
            !`${entry.sentence}${entry.qualifier ?? ""}`.includes("gmail.search"),
        ),
      { sentences: rendered.map((entry) => entry.sentence) },
    );

    /* -- Stop ------------------------------------------------------------ */

    await call(`${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);

    // Windows holds the child's cwd until it has fully exited; see proof 7.
    await waitForValue(async () => {
      try {
        const response = await call(`${handle.origin}/agents`, {
          headers: { authorization: `Bearer ${handle.token}` },
          signal: AbortSignal.timeout(3_000),
        });
        const body = (await response.json()) as {
          agents?: Array<{ agent_id?: string; lifecycle?: string }>;
        };
        const entry = (body.agents ?? []).find((agent) => agent.agent_id === AGENT_ID);
        return entry === undefined || entry.lifecycle === "exited" || entry.lifecycle === "stopped"
          ? "gone"
          : null;
      } catch {
        return null;
      }
    }, "the burst agent's process to exit", 15_000);

    removeRegistration(dataDir, AGENT_ID);
    forgetAgent(AGENT_ID);
    // The lapse rows go too. They are this proof's own droppings, and leaving
    // them would show a real user a warning about an agent that never existed.
    forgetBrokerLapses(AGENT_ID);
    await call(`${handle.origin}/registrations/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  } finally {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/* ---------------------------------------------------------------------- *
 * Proof 7: the permission broker (MAR-458, ADR 0002)
 * ---------------------------------------------------------------------- */

/**
 * A real agent reads a real mailbox through the broker, saves a reply as a draft
 * at the provider, and cannot send anything — and no provider token is
 * observable from the agent process.
 *
 * ## What stage 2 added to this proof (MAR-469)
 *
 * Checks 7k–7n. The first three drive the write: the operation really runs, the
 * message on the wire is the one DASH composed, and a recipient carrying a
 * header injection is refused before a request is made.
 *
 * 7n is the one worth reading twice. The fake provider **serves** Gmail's two
 * send endpoints and answers them with success, so the check that DASH never
 * called one is a statement about DASH rather than about the provider's
 * willingness. A negative proof whose subject is free to refuse is a proof of
 * the wrong party, and this is the check that would notice if a future write
 * operation reached the wrong path with a live token attached.
 *
 * ## What is real here and what is not
 *
 * Real: the vault read, the OAuth envelope, the token exchange over HTTP, the
 * grant resolution, the operation allowlist, the URL DASH constructed, the
 * bearer header, the response projection, the audit rows, the runner's pipe in
 * both directions, a child process the runner actually spawned, and the artifact
 * arriving in DASH's store through the same ingest a digest uses.
 *
 * Not real: the provider. It is an HTTP server this function binds on
 * `127.0.0.1`, because Google cannot be in an unattended proof — it needs an
 * account, a human at a consent screen, and a restricted-scope verification DASH
 * does not have (ADR 0002, "Google release path"). `lib/oauth/providers.ts`
 * documents the guard that makes the substitution possible and impossible to
 * reach by accident.
 *
 * So the claim this proof supports is: **the boundary holds on a real installed
 * shell, with a real child process.** It is not a claim about Gmail's API.
 *
 * ## The negative half is the point
 *
 * 7e asks the agent to report its own environment and its own view of what came
 * back, and searches both for the access token the fake provider minted. That is
 * the one check no unit test can make — `tests/broker-threat-model.test.ts`
 * establishes that the *broker* does not hand a token over, and only a spawned
 * child can establish that nothing else did either.
 */
async function proveTheBroker(recorded: {
  endpoint: string;
  transport: "pipe" | "unix" | string;
  pid: number;
}): Promise<void> {
  const AGENT_ID = "dash-broker-proof";
  const CONNECTION_ID = "loopback-mail";
  const FIELD_ID = "mailbox-account";

  /**
   * The token the fake provider mints, and the string every negative check
   * hunts for. Unmistakable on purpose: a short value could collide with a
   * substring of an id and fail for the wrong reason.
   */
  const PROOF_ACCESS_TOKEN = "PROOF-ACCESS-TOKEN-MUST-NOT-REACH-THE-AGENT";
  const PROOF_REFRESH_TOKEN = "PROOF-REFRESH-TOKEN-MUST-NEVER-LEAVE-THE-VAULT";
  const MESSAGE_ID = "18e0a1b2c3";
  /** The draft id the fake provider returns from `POST /drafts` (MAR-469). */
  const DRAFT_ID = "r-8812340099";

  const workDir = mkdtempSync(path.join(tmpdir(), "dash-broker-proof-"));
  /** Where the agent testifies about its own process. See the write in the script. */
  const reportPath = path.join(workDir, "proof-report.json");
  /**
   * A fresh run id per smoke run, and the reason is a defect this proof had.
   *
   * It was a constant. A run whose agent finished late left a draft in the store
   * under that constant, and the *next* run matched it instantly — so every
   * check after it ran before the agent had done anything, and the proof
   * reported a boundary it had not exercised. This is the same trap proof 6
   * guards with `previousRunIds`, and it is worth stating twice: a proof that
   * can be satisfied by a previous proof's leftovers is not a proof.
   */
  const RUN_ID = `proof-run-${String(Date.now())}`;
  /**
   * A fresh request-id prefix per smoke run, and the same lesson pointed the
   * other way (MAR-467).
   *
   * The ids were `proof-1..3` against a constant agent id, and the broker's
   * replay guard is per agent. An earlier smoke run that was interrupted leaves
   * its requests in the runner's *bounded buffer*, which survives DASH; the next
   * run's shell drains them at startup, adjudicates them, and seeds the replay
   * set with those very ids — so this run's real calls come back
   * `duplicate_request` and 7d/7e/7f/7h/7i fail together, naming a boundary that
   * is working correctly. Observed once here, on this branch's first pass, with
   * 64 undelivered answers reported at startup.
   *
   * `RUN_ID` above documents a proof that a leftover could satisfy. This is a
   * proof a leftover could *fail*, which is the worse of the two: a blocking
   * gate that goes red for a reason unrelated to the change in hand teaches
   * people to re-run it until it is green. ADR 0004 is the standing rule.
   */
  const REQUEST_PREFIX = `proof-${String(Date.now())}`;
  /** Every Authorization header the fake provider was presented with. */
  const presented: string[] = [];
  /**
   * Every path this provider was asked for, in order (MAR-469).
   *
   * The whole of check 7n. A frozen `WRITE_PATHS` array and a unit test over it
   * say what DASH is *built* to reach; this says what DASH actually reached over
   * a full installed run in which a real agent explicitly asked it to send. The
   * two are different claims and only this one is about the running product.
   */
  const requestedPaths: string[] = [];
  /** The bodies of every POST, so 7l can read the message DASH composed. */
  const posted: Array<{ path: string; body: string }> = [];
  let server: Server | null = null;

  try {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const authorization = request.headers.authorization;
      if (typeof authorization === "string") {
        presented.push(authorization);
      }
      requestedPaths.push(url.pathname);

      const json = (status: number, body: unknown): void => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };

      /*
       * The draft endpoint, and the two send endpoints beside it.
       *
       * The sends are served rather than left to 404, and that is the point: if
       * DASH ever reached one, this harness would answer it happily and 7n would
       * be the check that noticed. A proof whose negative case depends on the
       * provider refusing is a proof of the provider.
       */
      if (request.method === "POST") {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          posted.push({ path: url.pathname, body });
          if (url.pathname === "/token") {
            // The refresh-for-access exchange, which is a POST and is DASH's
            // real code path (`lib/oauth/flow.ts`) talking to this.
            json(200, { access_token: PROOF_ACCESS_TOKEN, expires_in: 3599 });
            return;
          }
          if (url.pathname === "/gmail/v1/users/me/drafts") {
            json(200, {
              id: DRAFT_ID,
              message: { id: "18e0a1b2ff", threadId: "18e0a1b2c0", labelIds: ["DRAFT"] },
            });
            return;
          }
          if (
            url.pathname === "/gmail/v1/users/me/messages/send" ||
            url.pathname === "/gmail/v1/users/me/drafts/send"
          ) {
            json(200, { id: "SENT-AND-THAT-IS-A-FAILURE", labelIds: ["SENT"] });
            return;
          }
          json(404, { error: "not_found" });
        });
        return;
      }

      if (url.pathname === "/gmail/v1/users/me/messages") {
        json(200, { messages: [{ id: MESSAGE_ID, threadId: "18e0a1b2c0" }] });
        return;
      }
      if (url.pathname === `/gmail/v1/users/me/messages/${MESSAGE_ID}`) {
        json(200, {
          id: MESSAGE_ID,
          threadId: "18e0a1b2c0",
          snippet: "Can we move Thursday?",
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "colleague@example.com" },
              { name: "Subject", value: "Thursday" },
            ],
            body: {
              data: Buffer.from("Can we move Thursday to the afternoon?").toString("base64url"),
            },
          },
        });
        return;
      }
      json(404, { error: "not_found" });
    });

    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${String(address.port)}`;

    // Set here rather than by the caller, so the window in which this process
    // will talk to anything but Google is the body of this function.
    process.env.DASH_BROKER_PROOF_ORIGIN = origin;

    check(
      "7a. the loopback provider profile exists only under its own guard",
      brokerProfileFor("dash-loopback-mail")?.api_origin === origin &&
        brokerProfileFor("google-gmail")?.api_origin === "https://gmail.googleapis.com",
      { origin },
    );

    /* -- The agent ----------------------------------------------------- */

    /**
     * Asks for two operations, then writes a draft from what came back — and
     * reports its own environment, which is the evidence 7e reads.
     *
     * Written here rather than shipped, because an agent whose purpose is to
     * dump its own environment is a proof fixture and not a sample.
     */
    const agentScript = `
      import { writeFileSync } from "node:fs";
      const reportPath = ${JSON.stringify(reportPath)};
      const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
      const pending = new Map();
      let seq = 0;
      function ask(connection, operation, input) {
        const id = ${JSON.stringify(REQUEST_PREFIX)} + "-" + (seq += 1);
        return new Promise((resolve) => {
          const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, refusal: "broker_unavailable" }); }, 30000);
          pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
          send({ type: "broker_request", request: { request_id: id, connection_id: ${JSON.stringify(CONNECTION_ID)}, operation, input } });
        });
      }

      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let nl = buffer.indexOf("\\n");
        while (nl !== -1) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\\n");
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m && m.type === "broker_response") {
            const settle = pending.get(m.request_id);
            if (settle) { pending.delete(m.request_id); settle(m); }
          }
        }
      });

      send({ type: "state", state: { status: "running", runs: [], tasks: [] } });

      // Written after every step, not only at the end.
      //
      // The first version wrote once, at the end, and a step that hung left the
      // harness with nothing to read and no way to tell which step it was. A
      // three-minute proof cycle is too long to spend on that, so the report is
      // a running account rather than a summary.
      const trace = [];
      let report = {};
      function record(patch) {
        report = { ...report, ...patch, trace };
        writeFileSync(reportPath, JSON.stringify(report), "utf8");
      }
      const note = (line) => { trace.push(line); process.stdout.write("[agent] " + line + "\\n"); };

      (async () => {
        const runId = ${JSON.stringify(RUN_ID)};
        note("asking for search");
        const found = await ask(${JSON.stringify(CONNECTION_ID)}, "gmail.search", { query: "is:unread", max_results: 5 });
        note("search answered ok=" + String(found.ok) + " refusal=" + String(found.refusal));
        record({ search: found });

        const first = found.ok ? (found.result.messages || [])[0] : null;
        note("first message = " + JSON.stringify(first));
        const read = first
          ? await ask(${JSON.stringify(CONNECTION_ID)}, "gmail.message.read", { message_id: first.message_id })
          : { ok: false, refusal: "no_message" };
        note("read answered ok=" + String(read.ok) + " refusal=" + String(read.refusal));
        record({ read });
        // Deliberately asked for and deliberately expected to fail: the proof
        // that a send operation does not exist has to be made from the agent's
        // side, on the installed path, not only in a unit test.
        const send_attempt = await ask(${JSON.stringify(CONNECTION_ID)}, "gmail.send", { to: "x@example.com", subject: "s", body: "b" });
        note("send answered ok=" + String(send_attempt.ok) + " refusal=" + String(send_attempt.refusal));
        record({ send_attempt });

        // MAR-469. The write that is supposed to work, and it is asked for
        // AFTER the send attempt on purpose: a run where the send was refused
        // because the whole connection was broken would then also fail here,
        // and 7h would be passing for the wrong reason.
        const drafted = await ask(${JSON.stringify(CONNECTION_ID)}, "gmail.draft.create", {
          to: read.ok && read.result.from ? read.result.from : "colleague@example.com",
          subject: read.ok ? "Re: " + read.result.subject : "Re:",
          body_text: "Thanks — the afternoon works.",
          thread_id: read.ok ? read.result.thread_id : undefined
        });
        note("draft answered ok=" + String(drafted.ok) + " refusal=" + String(drafted.refusal));
        record({ drafted });

        // The send that goes through the drafts endpoint rather than the
        // messages one. A guard written against the word "send" and not against
        // the operation set would let this through.
        const draft_send_attempt = await ask(${JSON.stringify(CONNECTION_ID)}, "gmail.drafts.send", { draft_id: drafted.ok ? drafted.result.draft_id : "x" });
        note("drafts.send answered ok=" + String(draft_send_attempt.ok) + " refusal=" + String(draft_send_attempt.refusal));
        record({ draft_send_attempt });

        // A recipient carrying CRLF, which is the write-side attack: the header
        // injection that would put a Bcc on a message DASH composed.
        const injected = await ask(${JSON.stringify(CONNECTION_ID)}, "gmail.draft.create", {
          to: "colleague@example.com\\r\\nBcc: attacker@evil.example",
          subject: "Re: Thursday",
          body_text: "hello"
        });
        note("injection answered ok=" + String(injected.ok) + " refusal=" + String(injected.refusal));
        record({ injected });

        // Everything this process can see about itself. The names AND the
        // values, because a token could be under any name at all.
        const environment = Object.entries(process.env).map(([k, v]) => k + "=" + String(v)).join("\\n");

        send({
          type: "artifact",
          artifact: {
            artifact_version: 1,
            agent: ${JSON.stringify(AGENT_ID)},
            run_id: runId,
            artifact_id: "draft-" + runId,
            kind: "draft",
            title: "Reply to " + (read.ok ? read.result.subject : "nothing"),
            generated_at: new Date().toISOString(),
            draft: {
              to: read.ok && read.result.from ? [read.result.from] : [],
              subject: read.ok ? "Re: " + read.result.subject : "Re:",
              body: read.ok ? "Thanks — the afternoon works. (Re: " + read.result.body_text + ")" : "no message",
              // MAR-469. The agent reports where the reply ended up, and this
              // run is the provider-side branch: it really did create a draft
              // through the broker moments ago. A run where that was refused
              // says dash_only instead, which is the honest answer and the one
              // 7k would then fail on.
              placement: drafted.ok
                ? { where: "provider_draft", service: "Loopback mail", draft_id: drafted.result.draft_id }
                : { where: "dash_only" },
              in_reply_to: read.ok ? { message_id: read.result.message_id, thread_id: read.result.thread_id } : undefined,
              sources: read.ok ? [{ message_id: read.result.message_id, subject: read.result.subject, from: read.result.from }] : []
            }
          }
        });

        // Written to a file rather than emitted as telemetry.
        //
        // (No backticks in this comment: it lives inside the template literal
        // that builds this script, and one would end the string.)
        //
        // The first version of this proof put the report in a run_completed
        // event detail, and run-event.schema.json caps that at 300 characters,
        // so DASH correctly rejected it and the proof read nothing. The cap is
        // right and the channel was wrong: this is not telemetry, it is the
        // agent testifying about its own process, and it should not have to fit
        // in a field sized for a sentence.
        //
        // The file is also the stronger evidence. It is produced inside the
        // agent process, from that process own environment, and read by the
        // harness afterwards, so nothing DASH does in between can shape it.
        record({
          send_refusal: send_attempt.ok === false ? send_attempt.refusal : "ALLOWED",
          // "ALLOWED" rather than a boolean, in every one of these, so a check
          // reading the field cannot pass on a falsy value it did not expect.
          draft_send_refusal: draft_send_attempt.ok === false ? draft_send_attempt.refusal : "ALLOWED",
          injection_refusal: injected.ok === false ? injected.refusal : "ALLOWED",
          draft_id: drafted.ok ? drafted.result.draft_id : null,
          environment,
          complete: true
        });
      })().catch((e) => process.stdout.write("[agent] " + String(e) + "\\n"));

      setInterval(() => {}, 1000);
    `;
    const scriptPath = path.join(workDir, "agent.mjs");
    writeFileSync(scriptPath, agentScript, "utf8");

    /*
     * Check that the program this harness just wrote actually parses.
     *
     * Added because it did not, once, and the failure was expensive out of all
     * proportion to the mistake: a single-escaped `\n` inside the template
     * literal that builds the script became a real newline, which ended a string
     * literal in the generated file. Every downstream proof then failed with
     * "no report", which reads exactly like a broker that does not answer.
     *
     * Three minutes per cycle is too long to spend distinguishing "the boundary
     * is broken" from "the harness wrote invalid JavaScript", so the harness now
     * answers that question itself, first, in about fifty milliseconds.
     */
    const parsed = spawnSync(process.execPath, ["--check", scriptPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
    });
    check(
      "7b0. the proof agent this harness wrote is valid JavaScript",
      parsed.status === 0,
      parsed.status === 0 ? "parses" : (parsed.stderr ?? "").split("\n").slice(0, 4).join(" "),
    );

    /* -- The manifest, the credential and the registration -------------- */

    const manifest = example<Record<string, unknown>>(
      "gmail-meeting-assistant.manifest.v2.example.json",
    );
    (manifest["agent"] as Record<string, unknown>)["name"] = AGENT_ID;
    (manifest["agent_dom"] as Record<string, unknown>)["connections"] = [
      {
        id: CONNECTION_ID,
        provider: "dash-loopback-mail",
        label: "Loopback mail",
        purpose: "Read messages and save a reply as a draft",
        ownership: "dash_managed",
        capabilities: [
          { id: "mail.read", label: "Read your messages", access: "read" },
          { id: "mail.draft", label: "Save a reply as a draft", access: "write" },
        ],
        fields: [
          {
            id: FIELD_ID,
            label: "Mailbox account",
            purpose: "Authorize reading messages and saving drafts",
            kind: "oauth_reauthorization",
            required: true,
            technical: {
              provider_scopes: [
                "https://www.googleapis.com/auth/gmail.readonly",
                // MAR-469. Declared by the agent's author, which is step 2 of
                // the three-party intersection; the credential below is step 3.
                // Without both, `gmail.draft.create` is refused and 7k fails.
                "https://www.googleapis.com/auth/gmail.compose",
              ],
              // Declared on purpose. This is the line that used to make DASH
              // put a live provider token into the child's environment, and 7e
              // is the check that it no longer does.
              environment_name: "MAILBOX_OAUTH_TOKEN",
            },
          },
        ],
        // Required by `agent.manifest.v2.schema.json`. Present here because the
        // schema is the schema — a proof that seeded a manifest DASH would
        // refuse would be proving something about a document no user could
        // actually import.
        validation_action: {
          id: "connect-loopback-mail",
          label: "Reconnect and test",
          behavior: "reconnect_test_switch",
        },
      },
    ];

    const imported = importManifest(manifest);
    check("7b. the proof agent's manifest imports", imported.ok, imported.ok ? "imported" : imported);

    // Straight into the vault, as a completed sign-in. The consent flow itself
    // is proof 5's subject and needs a human; what this proof needs is a stored
    // grant, which is what a consent flow leaves behind.
    await secureStore().set(
      connectionSecretName(AGENT_ID, CONNECTION_ID, FIELD_ID),
      serializeOAuthCredential({
        version: OAUTH_CREDENTIAL_VERSION,
        provider: "dash-loopback",
        refresh_token: PROOF_REFRESH_TOKEN,
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
        ],
        account: "proof@example.com",
        obtained_at: new Date().toISOString(),
      }),
    );

    const handle: RunnerHandle = {
      origin: IPC_ORIGIN,
      endpoint: recorded.endpoint,
      transport: recorded.transport as RunnerHandle["transport"],
      pid: recorded.pid,
      token: ensureChannelSecret(dataDir),
      adopted: true,
      started_at: null,
    };
    const call = runnerFetch(handle);

    // Every audit row that already exists, so the assertions below can speak
    // about *this* run. `forgetAgent` clears them at the end, but a run that
    // failed before its cleanup would otherwise leave rows the next run counts.
    const auditBefore = new Set(readBrokerAudit(AGENT_ID, 500).map((row) => row.id));

    writeRegistration(dataDir, {
      registration: {
        agent_id: AGENT_ID,
        manifest_path: "",
        /*
         * `BUNDLED_NODE_COMMAND`, not `process.execPath`, and the difference is
         * not cosmetic — it cost several proof cycles.
         *
         * `resolveSpawnCommand` turns the sentinel into DASH's own binary
         * *plus* `ELECTRON_RUN_AS_NODE=1`. Naming `process.execPath` directly
         * skips the environment, so the child starts as a full Electron **app**
         * rather than as node. Its stdout still reaches the runner — which is
         * why brokered requests kept arriving and being audited — while its
         * stdin is not a node stream, so no answer ever got back and every
         * request timed out as `broker_unavailable`. The tell was in the
         * runner's log: "App threw an error during load" is Electron's wording,
         * not node's.
         *
         * `lib/sample-agent.ts` uses the sentinel for the shipped sample, so a
         * proof that did not was also proving a spawn path no agent uses.
         */
        command: BUNDLED_NODE_COMMAND,
        args: [scriptPath],
        cwd: workDir,
      },
      manifestJson: JSON.stringify(manifest),
      ownership: {
        owner: "dash_handoff",
        handoff_id: "smoke-broker-proof",
        source_project: workDir,
        display_name: "Broker proof agent",
        summary: "Reads through the broker and writes a local draft.",
        registered_at: new Date().toISOString(),
      },
    });

    await call(`${handle.origin}/registrations/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const started = await call(
      `${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/lifecycle`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
        body: JSON.stringify({ action: "start", credentials: await collectSpawnCredentials(AGENT_ID) }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const startBody = (await started.json()) as { ok?: boolean; detail?: string };
    check("7c. the runner started the proof agent", startBody.ok === true, startBody);

    /* -- The round trip -------------------------------------------------- */

    // The agent's own report first: it is written last by the agent, so its
    // presence means the whole sequence finished. Asserting the draft before
    // this would be asserting against a store that may not have received it yet.
    const reported = await waitForValue(async () => {
      if (!existsSync(reportPath)) {
        return null;
      }
      try {
        const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as {
          search?: { ok?: boolean; refusal?: string; result?: Record<string, unknown> };
          read?: { ok?: boolean; refusal?: string; result?: Record<string, unknown> };
          send_attempt?: { ok?: boolean; refusal?: string };
          drafted?: { ok?: boolean; refusal?: string; result?: Record<string, unknown> };
          send_refusal?: string;
          draft_send_refusal?: string;
          injection_refusal?: string;
          draft_id?: string | null;
          environment?: string;
          trace?: string[];
          complete?: boolean;
        };
        // Only a finished report counts. A partial one is the agent still
        // working, and treating it as an answer is how the previous version of
        // this proof read a previous run's leftovers.
        return parsed.complete === true ? parsed : null;
      } catch {
        // A partially written file on the first look. Try again.
        return null;
      }
    }, "the agent's own report of what the broker answered", 45_000);

    /** Whatever the agent had written when the wait ended, complete or not. */
    const partial = ((): Record<string, unknown> | null => {
      try {
        return existsSync(reportPath)
          ? (JSON.parse(readFileSync(reportPath, "utf8")) as Record<string, unknown>)
          : null;
      } catch {
        return null;
      }
    })();

    check(
      "7d. the agent's two read operations were both answered",
      reported?.search?.ok === true && reported.read?.ok === true,
      {
        search: reported?.search?.ok === true ? "ok" : (reported?.search?.refusal ?? "no report"),
        read: reported?.read?.ok === true ? "ok" : (reported?.read?.refusal ?? "no report"),
        // The running account, so a hung step names itself instead of costing
        // another three-minute cycle to locate.
        trace: partial?.["trace"] ?? "none",
      },
    );

    const draft = await waitForValue(async () => {
      const artifacts = artifactsForRun(AGENT_ID, RUN_ID);
      const found = artifacts.find((artifact) => artifact.kind === "draft");
      return found === undefined ? null : found;
    }, "a local draft to reach DASH through the broker", 30_000);

    check(
      "7e. a real read reached DASH as a draft artifact that says where the reply is",
      draft !== null &&
        draft.kind === "draft" &&
        draft.draft.subject === "Re: Thursday" &&
        draft.draft.body.includes("afternoon") &&
        (draft.draft.sources ?? [])[0]?.message_id === MESSAGE_ID &&
        // MAR-469. The artifact contract stopped being able to mean "local" by
        // itself, so the artifact has to say — and a run whose draft creation
        // was refused would carry `dash_only` here and fail, rather than
        // rendering a claim about a mailbox nothing reached.
        draft.draft.placement.where === "provider_draft",
      draft === null
        ? null
        : { title: draft.title, kind: draft.kind, placement: draft.draft.placement },
    );

    // The token really was minted and really was presented. Without this, every
    // negative check below could pass because nothing happened at all.
    check(
      "7f. DASH presented a bearer token to the provider, and the agent never held one",
      presented.some((header) => header === `Bearer ${PROOF_ACCESS_TOKEN}`),
      { calls_with_authorization: presented.length },
    );

    /*
     * The proof MAR-458 exists for.
     *
     * The agent dumped every environment variable it has, names and values, and
     * everything the broker sent it. Neither contains the token DASH used
     * moments earlier on its behalf — and `MAILBOX_OAUTH_TOKEN`, the variable
     * this manifest explicitly asked for, is absent entirely rather than empty.
     */
    const environment = reported?.environment ?? "";
    const responses = JSON.stringify([reported?.search, reported?.read, reported?.send_attempt]);
    check(
      "7g. no provider token is observable from the agent process or its environment",
      reported !== null &&
        !environment.includes(PROOF_ACCESS_TOKEN) &&
        !environment.includes(PROOF_REFRESH_TOKEN) &&
        !environment.includes("MAILBOX_OAUTH_TOKEN") &&
        !responses.includes(PROOF_ACCESS_TOKEN) &&
        !responses.includes(PROOF_REFRESH_TOKEN),
      {
        reported: reported !== null,
        environment_variables: environment.split("\n").filter((line) => line.length > 0).length,
        names: environment
          .split("\n")
          .map((line) => line.split("=")[0])
          .filter((name) => name !== undefined && name.length > 0),
      },
    );

    check(
      "7h. both of the agent's send attempts were refused as operations that do not exist",
      reported?.send_refusal === "unknown_operation" &&
        reported.draft_send_refusal === "unknown_operation",
      {
        send_refusal: reported?.send_refusal,
        draft_send_refusal: reported?.draft_send_refusal,
      },
    );

    /* -- The write (MAR-469) --------------------------------------------- */

    /*
     * The first brokered operation that changes something in an account, driven
     * end to end on the installed shell: the manifest declared compose, the
     * stored credential carried it, the grant intersected to include the draft
     * operation, DASH composed the message itself, and a real POST carrying a
     * real bearer token reached the provider.
     */
    check(
      "7k. the agent created a draft at the provider through the broker",
      reported?.drafted?.ok === true && reported.draft_id === DRAFT_ID,
      {
        refusal: reported?.drafted?.refusal ?? "none",
        draft_id: reported?.draft_id ?? null,
      },
    );

    const draftPost = posted.find((entry) => entry.path === "/gmail/v1/users/me/drafts");
    const rawMessage =
      draftPost === undefined
        ? ""
        : ((): string => {
            try {
              const parsed = JSON.parse(draftPost.body) as { message?: { raw?: unknown } };
              return typeof parsed.message?.raw === "string"
                ? Buffer.from(parsed.message.raw, "base64url").toString("utf8")
                : "";
            } catch {
              return "";
            }
          })();

    /*
     * What DASH actually put on the wire, read back out of the provider's own
     * received body rather than out of DASH's intentions.
     *
     * The `From` check is the one worth having: DASH writes no `From` header at
     * all, so the account a draft appears to come from is the account whose
     * token DASH presented, decided by Google. An agent cannot compose a reply
     * that looks like it came from somebody else, and DASH does not have to
     * check that it did not.
     */
    check(
      "7l. DASH composed the message itself, with no From and no header the agent named",
      rawMessage.includes("To: colleague@example.com") &&
        rawMessage.includes("Content-Transfer-Encoding: base64") &&
        !/^From:/im.test(rawMessage) &&
        !/^Bcc:/im.test(rawMessage) &&
        !rawMessage.includes("attacker@evil.example"),
      {
        headers: rawMessage.split("\r\n\r\n")[0]?.split("\r\n") ?? [],
      },
    );

    check(
      "7m. a recipient carrying a header injection was refused before any request",
      reported?.injection_refusal === "invalid_input" &&
        posted.filter((entry) => entry.path === "/gmail/v1/users/me/drafts").length === 1,
      {
        injection_refusal: reported?.injection_refusal,
        draft_posts: posted.filter((entry) => entry.path === "/gmail/v1/users/me/drafts").length,
      },
    );

    /*
     * The load-bearing negative, and the reason the harness serves the send
     * endpoints instead of leaving them to 404 (MAR-469).
     *
     * A frozen `WRITE_PATHS` and a unit test over it say what DASH is *built* to
     * reach. This says what DASH actually reached across a whole installed run
     * in which a real spawned agent asked twice, by two different names, to send
     * — and it would fail even if the provider had been willing, because this
     * provider is willing. Nothing here depends on Google refusing.
     */
    check(
      "7n. across the whole run DASH never called a send endpoint, though the provider would have served one",
      !requestedPaths.some((path) => path.endsWith("/send")) &&
        requestedPaths.includes("/gmail/v1/users/me/drafts"),
      { paths: [...new Set(requestedPaths)] },
    );

    /* -- The record ------------------------------------------------------ */

    const audited = readBrokerAudit(AGENT_ID, 500).filter((row) => !auditBefore.has(row.id));
    const allowed = audited.filter((row) => row.decision === "allowed");
    check(
      "7i. every brokered call this run is audited, allowed and refused alike",
      allowed.length === 3 &&
        allowed.map((row) => row.operation).sort().join(",") ===
          "gmail.draft.create,gmail.message.read,gmail.search" &&
        allowed.every((row) => row.connection_id === CONNECTION_ID) &&
        audited.filter((row) => row.refusal === "unknown_operation").length === 2 &&
        audited.some((row) => row.refusal === "invalid_input"),
      audited.map((row) => `${row.decision}:${row.operation}:${row.refusal ?? "-"}`),
    );

    check(
      "7j. the audit holds no token, no query text and no message content",
      !JSON.stringify(audited).includes(PROOF_ACCESS_TOKEN) &&
        !JSON.stringify(audited).includes(PROOF_REFRESH_TOKEN) &&
        !JSON.stringify(audited).includes("is:unread") &&
        !JSON.stringify(audited).includes("Thursday") &&
        // MAR-469. A write's audit row names the fields the agent supplied and
        // none of their values, exactly as a read's does — so the reply DASH
        // composed on the user's behalf is not sitting in a durable table.
        !JSON.stringify(audited).includes("the afternoon works") &&
        !JSON.stringify(audited).includes("colleague@example.com") &&
        audited.every((row) => row.account_hint === null || !row.account_hint.includes("proof@")),
      audited.map((row) => ({ operation: row.operation, input_keys: row.input_keys })),
    );

    /* -- Stop ------------------------------------------------------------ */

    await call(`${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);

    // Wait for the runner to confirm the process is gone before the `finally`
    // deletes the directory it was running in. Windows keeps a handle on a
    // child's cwd until it has fully exited, and the first version of this
    // proof hit EPERM there — which turned a passing run into a failing one
    // over a temporary file lock rather than over anything about the broker.
    await waitForValue(async () => {
      try {
        const response = await call(`${handle.origin}/agents`, {
          headers: { authorization: `Bearer ${handle.token}` },
          signal: AbortSignal.timeout(3_000),
        });
        const body = (await response.json()) as {
          agents?: Array<{ agent_id?: string; lifecycle?: string }>;
        };
        const entry = (body.agents ?? []).find((agent) => agent.agent_id === AGENT_ID);
        return entry === undefined || entry.lifecycle === "exited" || entry.lifecycle === "stopped"
          ? "gone"
          : null;
      } catch {
        return null;
      }
    }, "the proof agent's process to exit", 15_000);

    removeRegistration(dataDir, AGENT_ID);
    forgetAgent(AGENT_ID);
    await secureStore()
      .delete(connectionSecretName(AGENT_ID, CONNECTION_ID, FIELD_ID))
      .catch(() => undefined);
    await call(`${handle.origin}/registrations/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  } finally {
    // The window in which this process would talk to a loopback provider ends
    // here, whatever happened above.
    delete process.env.DASH_BROKER_PROOF_ORIGIN;
    server?.close();
    rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/* ---------------------------------------------------------------------- *
 * Proof 9: the protected workspace, select to download (MAR-434)
 * ---------------------------------------------------------------------- */

/**
 * The issue's own acceptance criterion, driven on the real installed shell: a
 * person's own file is selected, a real agent the runner spawned turns it into
 * an output, and the bytes that come back out through the download route hash
 * to what the runner registered.
 *
 * ## Why this is checked at the runner's HTTP surface and not through a button
 *
 * Nothing in `app/` renders a file picker or a download action for this
 * feature yet — `PROJECT_STATE.md` says so plainly. Proof 8 already established
 * the pattern for a runner feature ahead of its UI: drive the real routes on
 * the real, installed, adopted runner, and read DASH's own store functions
 * directly to confirm the *installed shell's own poll loop* — not a
 * reimplementation of it — picked the result up. That is what
 * `electron/agent-adapters.ts`'s `syncWorkspace` is doing every five seconds
 * while this proof runs; **9g** is the check that it did.
 *
 * ## The check that matters
 *
 * Not 9e, which only shows the runner accepted a file from the agent's outbox.
 * **9f** is the point: the exact bytes a person would receive from a download
 * action are read back over the same authenticated channel a download button
 * would use, and hashed independently of the registration record. A build that
 * registered a plausible-looking receipt without actually being able to
 * reproduce the bytes later would pass every earlier check here and fail that
 * one.
 */
async function proveProtectedWorkspaceDownload(recorded: {
  endpoint: string;
  transport: "pipe" | "unix" | string;
  pid: number;
}): Promise<void> {
  const AGENT_ID = "dash-workspace-proof";
  // Unique per smoke process, per MAR-473's lesson: proof 7's fixed ids once
  // let a previous run's leftovers answer for this one.
  const RUN_ID = `run-workspace-proof-${randomBytes(4).toString("hex")}`;

  const workDir = mkdtempSync(path.join(tmpdir(), "dash-workspace-proof-"));
  const selectedFilesDir = mkdtempSync(path.join(tmpdir(), "dash-workspace-proof-selected-"));

  try {
    const scriptPath = path.join(workDir, "agent.mjs");
    /*
     * Reads the one file it is given, writes an unmistakably transformed copy
     * to its outbox and announces it. The transform (uppercasing) is what
     * makes 9f a check that the agent's real output travelled all the way to
     * the download route, rather than a check that some file with the right
     * name exists somewhere.
     */
    writeFileSync(
      scriptPath,
      `
      import { readFileSync, writeFileSync } from "node:fs";
      import path from "node:path";
      import readline from "node:readline";
      const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
      send({ type: "state", state: { status: "running", runs: [], tasks: [] } });
      const rl = readline.createInterface({ input: process.stdin });
      rl.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (message.type !== "task") return;
        const input = message.inputs[0];
        const bytes = readFileSync(input.path, "utf8");
        const outPath = path.join(message.directory, "outbox", "result.txt");
        writeFileSync(outPath, bytes.toUpperCase());
        send({ type: "artifact_file", task_id: message.task_id, role: "result", name: "result.txt" });
      });
      setInterval(() => {}, 60000);
      `,
      "utf8",
    );

    // The shipped example with its name changed, for the reason proof 8's
    // comment already gives: a hand-written v2 manifest drifts from the schema
    // and starts proving things about the proof's own copy. Nothing about this
    // proof exercises broker connections; the example is reused only because it
    // is a manifest known to validate.
    const manifest = example("gmail-meeting-assistant.manifest.v2.example.json") as Record<
      string,
      unknown
    >;
    (manifest["agent"] as { name: string }).name = AGENT_ID;

    const handle: RunnerHandle = {
      origin: IPC_ORIGIN,
      endpoint: recorded.endpoint,
      transport: recorded.transport as RunnerHandle["transport"],
      pid: recorded.pid,
      token: ensureChannelSecret(dataDir),
      adopted: true,
      started_at: null,
    };
    const call = runnerFetch(handle);

    writeRegistration(dataDir, {
      registration: {
        agent_id: AGENT_ID,
        manifest_path: "",
        command: BUNDLED_NODE_COMMAND,
        args: [scriptPath],
        cwd: workDir,
      },
      manifestJson: JSON.stringify(manifest),
      ownership: {
        owner: "dash_handoff",
        handoff_id: "smoke-workspace-proof",
        source_project: workDir,
        display_name: "Workspace proof agent",
        summary: "Turns one selected file into one output.",
        registered_at: new Date().toISOString(),
      },
    });

    await call(`${handle.origin}/registrations/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const started = await call(`${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ action: "start", credentials: await collectSpawnCredentials(AGENT_ID) }),
      signal: AbortSignal.timeout(10_000),
    });
    const startBody = (await started.json()) as { ok?: boolean; detail?: string };
    check("9a. the workspace proof agent's manifest imports and the runner started it", startBody.ok === true, startBody);

    /* -- Select a file that is genuinely the user's own -------------------- */

    const selectedPath = path.join(selectedFilesDir, "price-list.txt");
    const selectedContents = "acme widget — 19.00 kr\n";
    writeFileSync(selectedPath, selectedContents, "utf8");

    const created = await call(`${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    const createdBody = (await created.json()) as { ok?: boolean; task?: { task_id?: string } };
    const taskId = createdBody.task?.task_id ?? "";
    check("9b. a task was opened for the workspace proof agent", createdBody.ok === true && taskId.length > 0, createdBody);

    const admitted = await call(
      `${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/tasks/${encodeURIComponent(taskId)}/inputs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
        body: JSON.stringify({ role: "price_list", source_path: selectedPath }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    const admittedBody = (await admitted.json()) as { ok?: boolean };
    check("9c. the selected file was admitted as the task's input", admittedBody.ok === true, admittedBody);

    /* -- Trigger: bind a run and hand the task to the running agent -------- */

    const dispatched = await call(
      `${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/tasks/${encodeURIComponent(taskId)}/dispatch`,
      {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
        body: JSON.stringify({ run_id: RUN_ID }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    const dispatchedBody = (await dispatched.json()) as { ok?: boolean };
    check("9d. dispatch handed the task to the running agent", dispatchedBody.ok === true, dispatchedBody);

    /* -- Output: the runner registers what the agent wrote ------------------ */

    const registered = await waitForValue(async () => {
      const response = await call(
        `${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/artifacts?run_id=${encodeURIComponent(RUN_ID)}`,
        { headers: { authorization: `Bearer ${handle.token}` }, signal: AbortSignal.timeout(3_000) },
      );
      const body = (await response.json()) as {
        artifacts?: Array<{ artifact_id: string; sha256: string; byte_size: number; display_name: string }>;
      };
      const artifact = (body.artifacts ?? [])[0];
      return artifact ?? null;
    }, "the runner to register the agent's output", 20_000);

    const expectedBytes = selectedContents.toUpperCase();
    const expectedSha256 = createHash("sha256").update(expectedBytes, "utf8").digest("hex");
    check(
      "9e. the runner registered exactly one output, hashed to the bytes the agent actually wrote",
      registered !== null &&
        registered.display_name === "result.txt" &&
        registered.byte_size === Buffer.byteLength(expectedBytes) &&
        registered.sha256 === expectedSha256,
      registered,
    );

    /* -- Download: the same authenticated channel a download action uses --- */

    let downloadedBytes: Buffer | null = null;
    let downloadedSha256: string | null = null;
    if (registered !== null) {
      const download = await call(
        `${handle.origin}/artifacts/${encodeURIComponent(registered.artifact_id)}/download`,
        { headers: { authorization: `Bearer ${handle.token}` }, signal: AbortSignal.timeout(10_000) },
      );
      downloadedBytes = Buffer.from(await download.arrayBuffer());
      downloadedSha256 = createHash("sha256").update(downloadedBytes).digest("hex");
      check(
        "9f. downloaded bytes hash to the registered artifact's own SHA-256, and are the agent's real output",
        download.ok &&
          download.headers.get("x-artifact-sha256") === registered.sha256 &&
          downloadedSha256 === registered.sha256 &&
          downloadedBytes.length === registered.byte_size &&
          downloadedBytes.toString("utf8") === expectedBytes,
        {
          http_status: download.status,
          downloaded_bytes: downloadedBytes.length,
          downloaded_sha256: downloadedSha256,
          registered_sha256: registered.sha256,
        },
      );
    } else {
      skip("9f. downloaded bytes hash to the registered artifact's own SHA-256", "no artifact was registered (9e)");
    }

    /* -- And the installed shell's own poll loop picked it up (not this proof) */

    const availability = await waitForValue(async () => {
      if (registered === null) return null;
      const state = resolveArtifactAvailability(AGENT_ID, RUN_ID)(registered.artifact_id);
      return state === "available" ? state : null;
    }, "electron/agent-adapters.ts's own poll to sync the artifact into DASH's store", 15_000);
    check(
      "9g. the installed shell's own 5-second poll — not this harness — brought the output into DASH's store as available",
      availability === "available",
      { availability },
    );

    /* -- On failure, the runner's own log is the only witness --------------- */

    // The runner is detached with its stdio on {dataDir}/runner.log, so a
    // refusal's underlying error code never reaches this harness's output. On
    // CI that file is discarded with the machine, which makes a proof-9
    // failure undiagnosable from the one place it currently reproduces.
    if (registered === null || availability !== "available") {
      try {
        const tail = readFileSync(path.join(dataDir, "runner.log"), "utf8")
          .split(/\r?\n/)
          .slice(-40)
          .join("\n");
        console.log(`[smoke] tail of runner.log, because proof 9 failed:\n${tail}`);
      } catch {
        console.log("[smoke] proof 9 failed and runner.log could not be read");
      }
    }

    /* -- Stop -------------------------------------------------------------- */

    await call(`${handle.origin}/agents/${encodeURIComponent(AGENT_ID)}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${handle.token}` },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);

    await waitForValue(async () => {
      try {
        const response = await call(`${handle.origin}/agents`, {
          headers: { authorization: `Bearer ${handle.token}` },
          signal: AbortSignal.timeout(3_000),
        });
        const body = (await response.json()) as {
          agents?: Array<{ agent_id?: string; lifecycle?: string }>;
        };
        const entry = (body.agents ?? []).find((agent) => agent.agent_id === AGENT_ID);
        return entry === undefined || entry.lifecycle === "exited" || entry.lifecycle === "stopped"
          ? "gone"
          : null;
      } catch {
        return null;
      }
    }, "the workspace proof agent's process to exit", 15_000);

    removeRegistration(dataDir, AGENT_ID);
    forgetAgent(AGENT_ID);
    await call(`${handle.origin}/registrations/reload`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  } finally {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(selectedFilesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

/**
 * Close the store before `app.exit`.
 *
 * `app.exit` terminates without running `will-quit`, so the checkpoint
 * `electron/main.ts` now performs there does not happen for a smoke run — and
 * this harness is the single most frequent way this store is opened and killed.
 * Leaving it mid-WAL after every proof run is how a store ends up being copied,
 * backed up or terminated in the state that has to be recovered rather than
 * simply read.
 *
 * Both paths, including the failure path: a run that ended badly is exactly the
 * one whose store should be left tidy.
 */
function exitAfterClosing(code: number): void {
  try {
    closeDb();
  } catch (error: unknown) {
    // Never let cleanup change the verdict. A store that would not close is
    // worth printing and is not worth turning a passing run into a failure.
    console.error(`[smoke] closing the store failed: ${String(error)}`);
  }
  app.exit(code);
}

void run().then(
  () => exitAfterClosing(failures.length === 0 ? 0 : 1),
  (error: unknown) => {
    console.error(`[smoke] ${error instanceof Error ? error.stack : String(error)}`);
    exitAfterClosing(1);
  },
);
