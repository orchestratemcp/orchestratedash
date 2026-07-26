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
import "./main.js";

import { app, BrowserWindow } from "electron";

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import { putAgentDomState, readCommandAudit } from "../lib/agent-dom/store";
import { dataDir } from "../lib/db";
import { importManifest } from "../lib/store";

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

/** Resolve once the window has painted, or reject rather than hang forever. */
function firstWindow(): Promise<BrowserWindow> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no window after 30s")), 30_000);
    const attach = (): void => {
      const [window] = BrowserWindow.getAllWindows();
      if (window === undefined) {
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

/* -- Proof 3: an Agent DOM command reaches noAdapter -------------------- */

const imported = importManifest(
  example("gmail-meeting-assistant.manifest.v2.example.json"),
);
check("3a. seeded the v2 manifest", imported.ok, imported);

const observedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const seeded = putAgentDomState(liveSnapshot(observedAt, expiresAt));
check("3b. seeded a live state snapshot", seeded.ok, seeded);

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
}

console.log(`\n[smoke] ${failures.length === 0 ? "all proofs passed" : `FAILED: ${failures.join(", ")}`}\n`);
console.log(
  `[smoke] the runner is left running on purpose (pid ${String(recorded?.pid ?? "-")}). ` +
    `That is what "closing DASH leaves agents running" means; see runner/README.md.\n`,
);
}

void run().then(
  () => app.exit(failures.length === 0 ? 0 : 1),
  (error: unknown) => {
    console.error(`[smoke] ${error instanceof Error ? error.stack : String(error)}`);
    app.exit(1);
  },
);
