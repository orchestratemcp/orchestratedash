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
import "./main.js";

import { app, BrowserWindow, shell } from "electron";

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import { putAgentDomState, readCommandAudit } from "../lib/agent-dom/store";
import { connectableFields } from "../lib/connection-credentials";
import { oauthProviderById } from "../lib/oauth/providers";
import { closeDb, dataDir } from "../lib/db";
import { RENDERER_ORIGIN } from "../lib/shell/renderer-scheme";
import { readAgentManifest, importManifest } from "../lib/store";
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

async function waitForValue<T>(
  read: () => Promise<T | null>,
  label: string,
  timeoutMs = 20_000,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.warn(`[smoke] timed out waiting for ${label}`);
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

if (process.env.DASH_SHELL_URL?.startsWith("dash-app://") === true) {
  check(
    "1b. the UI renders from the packaged origin",
    rendered.url.startsWith("dash-app://ui/"),
    rendered.url,
  );
}

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

const imported = importManifest(
  example("gmail-meeting-assistant.manifest.v2.example.json"),
);
check("3a. seeded the v2 manifest", imported.ok, imported);

const observedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const seeded = putAgentDomState(liveSnapshot(observedAt, expiresAt));
check("3b. seeded a live state snapshot", seeded.ok, seeded);

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
            data?: { snapshot?: { tasks?: Array<{ id?: string; status?: string }> } | null };
          };
          return (
            view.data?.snapshot?.tasks?.find(
              (task) => task.id === "waiting-to-be-run" && task.status === "pending",
            ) ?? null
          );
        }, "the sample to publish the task it is waiting on");
        check("6d. the sample waits to be asked", waitingTask !== null, waitingTask);

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

        // Run now, through the audited command boundary the renderer uses —
        // not by poking the runner. If this path works only in a test harness
        // it does not work.
        const asked = (await window.webContents.executeJavaScript(
          `window.dashShell.retry(${JSON.stringify({
            agent_id: agentId,
            observed_at: new Date().toISOString(),
            task_id: "waiting-to-be-run",
          })})`,
        )) as { ok?: boolean; reason?: string };
        check("6f. Run now is accepted through the audited bridge", asked.ok === true, asked);

        const completed = await waitForValue(async () => {
          const view = (await window.webContents.executeJavaScript(
            `window.dashData.runs()`,
          )) as {
            ok?: boolean;
            data?: { runs?: Array<{ agent?: string; run_id?: string; status?: string }> };
          };
          return (
            view.data?.runs?.find(
              (run) =>
                run.agent === agentId &&
                run.status === "completed" &&
                typeof run.run_id === "string" &&
                !previousRunIds.has(run.run_id),
            ) ?? null
          );
        }, "runner-hosted sample telemetry to reach Runs");
        check("6g. runner-hosted telemetry renders through the Runs bridge", completed !== null, completed);

        const reportsDir = path.join(created.value.directory, "reports");
        const onDisk =
          (await waitForValue(async () => {
            const files = existsSync(reportsDir)
              ? readdirSync(reportsDir).filter((name) => name.endsWith(".json"))
              : [];
            return files.length > 0 ? files : null;
          }, "the runner-hosted sample digest artifact")) ?? [];
        check("6h. the sample leaves a digest in its own folder", onDisk.length > 0, onDisk);

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
        const digest = await waitForValue(async () => {
          const view = (await window.webContents.executeJavaScript(
            `window.dashData.run(${JSON.stringify(agentId)}, ${JSON.stringify(
              completed?.run_id ?? "",
            )})`,
          )) as {
            data?: {
              artifacts?: Array<{ artifact_id?: string; title?: string; items?: unknown[] }>;
              grounding?: { verdict?: string; items_total?: number } | null;
            };
          };
          const first = view.data?.artifacts?.[0];
          return first === undefined ? null : { artifact: first, grounding: view.data?.grounding };
        }, "the digest to reach DASH through the read bridge");
        check(
          "6i. the digest reaches DASH, not just the agent's folder",
          digest !== null && typeof digest.artifact.artifact_id === "string",
          digest?.artifact,
        );

        // An empty source list is the honest offline case for a smoke run, and
        // an empty digest is still grounded: there is no unsupported claim in
        // it. What is being proved is that a verdict was computed and crossed
        // the boundary at all.
        check(
          "6j. the digest carries a grounding verdict",
          digest?.grounding?.verdict !== undefined,
          digest?.grounding,
        );

        // And the renderer actually draws it. MAR-454's whole lesson is that a
        // proof reading data through a bridge can pass while the page above it
        // is broken — proofs 5a-5j were green in a suite of 1635 tests while
        // three shipped defects sat in the one path no unit test could reach.
        const origin = new URL(rendered.url).origin;
        const detailUrl =
          `${origin}/runs/detail?agent=${encodeURIComponent(agentId)}` +
          `&run_id=${encodeURIComponent(completed?.run_id ?? "")}`;

        let drawn: { text: string; sources: number } | null = null;
        try {
          await window.loadURL(detailUrl);
          drawn = await waitForValue(async () => {
            const seen = (await window.webContents.executeJavaScript(
              `({ text: document.body.innerText,
                  sources: document.querySelectorAll(".digest-sources").length })`,
            )) as { text: string; sources: number };
            // The page reads its view in an effect, so an empty body is "not
            // yet" rather than "not there". Waiting for the digest's own title
            // is what makes this an assertion about content and not about
            // whether a document object exists.
            return seen.text.includes(digest?.artifact.title ?? " ") ? seen : null;
          }, "the run detail page to draw the digest");
        } catch (error: unknown) {
          drawn = null;
          console.warn(`[smoke] the run detail page did not load: ${String(error)}`);
        }
        check("6k. the run detail page draws the digest", drawn !== null, drawn?.text.slice(0, 400));

        const finalLedger = readHandoffRecord(created.value.handoff.handoff_id);
        check(
          "6f. the handoff ledger keeps the first final outcome",
          finalLedger?.outcome === "registered",
          finalLedger,
        );

        await removeAgent(agentId, ports);
        agentId = "";
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
}

console.log(`\n[smoke] ${failures.length === 0 ? "all proofs passed" : `FAILED: ${failures.join(", ")}`}\n`);
console.log(
  `[smoke] the runner is left running on purpose (pid ${String(recorded?.pid ?? "-")}). ` +
    `That is what "closing DASH leaves agents running" means; see runner/README.md.\n`,
);
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
