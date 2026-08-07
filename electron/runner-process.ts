/**
 * Starting, adopting and stopping the bundled runner.
 *
 * The runner is a **detached** child. That one flag is what makes the issue's
 * second acceptance criterion true — "closing the DASH window leaves running
 * agents running" — without touching `window-all-closed` at all: agents are
 * children of the runner, and the runner is not a child of anything Electron
 * tears down. DASH can quit and come back, and the fleet does not notice.
 *
 * The honest cost of that is stated in `runner/README.md`: DASH now leaves a
 * process behind, which is exactly the thing `electron/main.ts` argued against
 * doing in MAR-424. The difference is that this one is doing something —
 * holding the agents — and it can be stopped from the UI rather than only from
 * Task Manager.
 *
 * ## Node, from inside Electron
 *
 * `process.execPath` in a packaged app is the Electron binary, not `node`. With
 * `ELECTRON_RUN_AS_NODE=1` that same binary is a Node runtime, which means the
 * runner needs no separate Node installation on the user's machine and cannot
 * end up running against a different version than it was built for. It is the
 * one environment variable this module sets for a reason a reader would not
 * guess.
 *
 * ## The vault is no longer a precondition (MAR-430)
 *
 * MAR-415 held the channel token in the OS vault and refused to start the
 * runner at all without one. That coupled *hosting a local agent* to *having a
 * keyring*, which on a Linux box with no libsecret meant DASH could not host
 * even an agent that had no credentials to protect. `runner/README.md` item 7
 * recorded it as a known defect; this is the fix.
 *
 * The channel credential now lives in `runner.key` under an ACL this project
 * sets and verifies — see `runner/channel-secret.ts` — and the endpoint is a
 * Unix socket or a named pipe rather than a TCP port. What still requires
 * `SecureStore`, and still fails closed without it, is everything a *person*
 * entrusted to DASH: provider credentials, and the bearer token for a remote
 * runner reached over HTTPS. Those are in `electron/agent-adapters.ts`.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, openSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import { ChannelSecretError, ensureChannelSecret } from "../runner/channel-secret";
import { channelSecretFingerprint, readSessionKey } from "../runner/session-key";
import { EndpointError } from "../runner/endpoint";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "../runner/identity";
import type { RunnerEndpointFile } from "../runner/main";

export interface RunnerHandle {
  /**
   * The base every agent's control location is built on.
   *
   * A placeholder authority, not a host: the bytes go down `endpoint`. See
   * `lib/agent-dom/ipc-fetch.ts` for why it is deliberately unresolvable.
   */
  origin: string;
  /** The Unix socket path or Windows pipe name this runner listens on. */
  endpoint: string;
  transport: "unix" | "pipe";
  pid: number;
  token: string;
  /** True when DASH attached to a runner that was already up. */
  adopted: boolean;
  /**
   * When the runner says it started, from its own endpoint file (MAR-467).
   *
   * Null for a runner DASH just spawned — the file is written by the runner
   * after it is listening, so at this point in a spawn there is nothing to read
   * and inventing "now" would be DASH answering a question it asked the runner.
   * Nothing needs it in that case: `closedWindow` only consults this for an
   * adopted runner, because only an adopted one can have spanned a window in
   * which DASH was not running.
   */
  started_at: string | null;
}

export type EnsureRunnerResult =
  | { ok: true; handle: RunnerHandle }
  | {
      ok: false;
      reason: "endpoint_refused" | "spawn_failed" | "never_listened" | "stale_runner";
      detail: string;
    };

interface RunnerCandidate {
  handle: RunnerHandle;
  compatible: boolean;
  observed_build?: string;
  observed_protocol?: number;
}

/**
 * What `adopt` found, and the third answer is the one MAR-520 is about.
 *
 * It used to return `RunnerCandidate | null`, and `null` covered three
 * genuinely different worlds: nothing is listening; something is listening and
 * it is not a runner we may adopt; the file is unreadable. `ensureRunner` reads
 * `null` as permission to spawn, so the middle case — **a live runner holding
 * this data directory that DASH cannot authenticate to** — silently became a
 * second runner writing to the same `runner.sqlite`.
 *
 * That is not a hypothetical. On 2026-08-07 a runner spawned by the attended
 * Google proof was alive, healthy and supervising three agents while answering
 * 401 to the on-disk `runner.key`; the next spawn would have gone straight past
 * it. `retireLegacyRunner`'s own comment already names the rule this breaks —
 * "Two runners supervising one machine is precisely what the endpoint's
 * exactly-one guarantee exists to prevent" — and it only ever enforced it for
 * the pre-MAR-430 case where the recorded file carries a `port`.
 *
 * So the cases are separated, and `foreign` is refused rather than driven over.
 */
type AdoptOutcome =
  | { kind: "none" }
  | { kind: "candidate"; candidate: RunnerCandidate }
  | {
      kind: "foreign";
      pid: number;
      endpoint: string;
      observed_build?: string;
      /** The fingerprint the runner published, when it published one. */
      fingerprint?: string;
    };

export function runnerIdentityMatches(
  recorded: { runner_build?: unknown; runner_protocol?: unknown },
  health: { runner_build?: unknown; runner_protocol?: unknown },
): boolean {
  return (
    recorded.runner_build === RUNNER_BUILD_ID &&
    recorded.runner_protocol === RUNNER_PROTOCOL_VERSION &&
    health.runner_build === RUNNER_BUILD_ID &&
    health.runner_protocol === RUNNER_PROTOCOL_VERSION
  );
}

function endpointFilePath(dataDir: string): string {
  return path.join(dataDir, "runner.json");
}

/** A `fetch` bound to one runner's endpoint. */
export function runnerFetch(handle: RunnerHandle): typeof globalThis.fetch {
  return ipcFetch(handle.endpoint);
}

/**
 * Is a runner already listening, and is it ours?
 *
 * The endpoint file says where to look; the health check says whether anything
 * is there; the authenticated probe says whether it is a runner that accepts
 * our secret. All three still matter. What changed with MAR-430 is what a
 * stale file can point at: a dead runner's *port* could be reused by an
 * unrelated process, whereas a dead runner's socket path or pipe name simply
 * does not answer. The authenticated probe is kept anyway — a path under the
 * user's own control could still be occupied by something the user ran.
 */
async function adopt(dataDir: string, token: string): Promise<AdoptOutcome> {
  const file = endpointFilePath(dataDir);
  if (!existsSync(file)) {
    return { kind: "none" };
  }

  let recorded: RunnerEndpointFile;
  try {
    recorded = JSON.parse(readFileSync(file, "utf8")) as RunnerEndpointFile;
  } catch {
    return { kind: "none" };
  }
  if (typeof recorded.endpoint !== "string" || typeof recorded.pid !== "number") {
    return { kind: "none" };
  }

  const call = ipcFetch(recorded.endpoint);
  let healthBody: {
    runner_build?: unknown;
    runner_protocol?: unknown;
  } = {};
  const fingerprint =
    typeof recorded.channel_secret_fingerprint === "string"
      ? recorded.channel_secret_fingerprint
      : undefined;
  const foreign = (): AdoptOutcome => ({
    kind: "foreign",
    pid: recorded.pid,
    endpoint: recorded.endpoint,
    observed_build:
      typeof healthBody.runner_build === "string" ? healthBody.runner_build : undefined,
    fingerprint,
  });

  try {
    const health = await call(`${IPC_ORIGIN}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!health.ok) {
      return { kind: "none" };
    }
    healthBody = (await health.json()) as typeof healthBody;
    // Authenticated probe. A 401 means something is listening that does not
    // share our secret — which is not a runner we may adopt, **and not one we
    // may ignore either**. It answered `/health`, so it is alive and holding
    // this data directory; see `AdoptOutcome`.
    const probe = await call(`${IPC_ORIGIN}/agents/__probe__`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (probe.status === 401 || probe.status === 403) {
      return foreign();
    }
  } catch {
    // Nothing answered on the recorded endpoint: a dead runner's socket path or
    // pipe name simply does not exist, which is the ordinary stale-file case.
    return { kind: "none" };
  }

  const observedBuild =
    typeof healthBody.runner_build === "string" ? healthBody.runner_build : undefined;
  const observedProtocol =
    typeof healthBody.runner_protocol === "number" ? healthBody.runner_protocol : undefined;
  return {
    kind: "candidate",
    candidate: {
      handle: {
        origin: IPC_ORIGIN,
        endpoint: recorded.endpoint,
        transport: recorded.transport === "pipe" ? "pipe" : "unix",
        pid: recorded.pid,
        token,
        adopted: true,
        started_at: typeof recorded.started_at === "string" ? recorded.started_at : null,
      },
      compatible: runnerIdentityMatches(recorded, healthBody),
      observed_build: observedBuild,
      observed_protocol: observedProtocol,
    },
  };
}

/**
 * Ensure a runner is up, and return how to reach it.
 *
 * Adopt first, spawn second. Spawning unconditionally would orphan the previous
 * runner along with every agent it holds, which is the same failure as killing
 * the fleet on restart wearing a different hat.
 */
export async function ensureRunner(dataDir: string): Promise<EnsureRunnerResult> {
  let token: string;
  try {
    token = ensureChannelSecret(dataDir);
  } catch (error: unknown) {
    // The one remaining reason a machine cannot host agents, and it is a much
    // narrower one than "no keyring": DASH could not put an owner-only ACL on
    // one file, or could not prove that it had. Failing closed here is the
    // issue's own instruction — an unprovable ACL is not a protected secret.
    return {
      ok: false,
      reason: "endpoint_refused",
      detail:
        error instanceof ChannelSecretError || error instanceof EndpointError
          ? error.message
          : "The runner's channel credential could not be prepared.",
    };
  }

  const existing = await adopt(dataDir, token);
  if (existing.kind === "candidate") {
    if (existing.candidate.compatible) {
      return { ok: true, handle: existing.candidate.handle };
    }

    const stopped = await stopRunner(existing.candidate.handle);
    if (!stopped.ok) {
      return {
        ok: false,
        reason: "stale_runner",
        detail:
          `DASH found runner pid ${String(existing.candidate.handle.pid)} from a different build ` +
          `(${existing.candidate.observed_build ?? "identity unavailable"}) and did not adopt it. ` +
          `${stopped.detail} Restart Windows once to retire a runner built before graceful shutdown.`,
      };
    }
  }

  /**
   * A live runner this DASH cannot authenticate to (MAR-520).
   *
   * The old code reached this point with `null` and spawned. Two runners over
   * one `runner.sqlite` is the two-writers-one-store pattern MAR-506's
   * corruption is suspected to have come from, and it is worse than not
   * starting: the second runner works, so nothing looks wrong until the store
   * does.
   *
   * One attempt is made before refusing, and it is the whole point of
   * `runner/session-key.ts`: the credential a runner is actually using is now
   * recorded by the runner, so a DASH that finds a stranger's runner can still
   * ask it to stop through the authenticated route AGENTS.md prescribes.
   * Nothing is force-killed here or anywhere.
   *
   * When that fails the refusal names the one remedy a person has. It is a
   * worse outcome than starting, and it is the honest one — the alternative is
   * DASH quietly arranging the conditions for the corruption it has already
   * spent an issue recovering from.
   */
  if (existing.kind === "foreign") {
    const retired = await retireForeignRunner(dataDir, existing);
    if (!retired.ok) {
      return { ok: false, reason: "stale_runner", detail: retired.detail };
    }
  }

  const retired = await retireLegacyRunner(dataDir);
  if (!retired.ok) {
    return { ok: false, reason: "stale_runner", detail: retired.detail };
  }

  // An endpoint file that survived a crash points nowhere useful and would
  // otherwise be adopted again on the next launch.
  rmSync(endpointFilePath(dataDir), { force: true });

  /**
   * A fresh endpoint name per spawn.
   *
   * The issue asks for unpredictable-per-install; per-spawn is strictly
   * stronger. It is what stops a local process pre-creating the Windows pipe
   * DASH is about to bind — and if one somehow did, libuv's
   * `FILE_FLAG_FIRST_PIPE_INSTANCE` makes the bind fail rather than silently
   * join, so the failure is closed either way.
   */
  const endpointId = randomBytes(12).toString("hex");

  const entry = fileURLToPath(new URL("./runner.mjs", import.meta.url));
  const logFile = openSync(path.join(dataDir, "runner.log"), "a");

  let pid: number | undefined;
  try {
    const child = spawn(process.execPath, [entry], {
      // Detached: the runner gets its own process group and survives DASH.
      detached: true,
      // No pipes. A detached process whose parent exits would otherwise write
      // into a closed stdout and die of EPIPE the first time it logged.
      stdio: ["ignore", logFile, logFile],
      env: {
        ...cleanEnvironment(),
        ELECTRON_RUN_AS_NODE: "1",
        DASH_RUNNER_DATA_DIR: dataDir,
        // Not a secret, unlike the token this replaced. A Windows pipe name is
        // enumerable by any local process, so its value is that it could not be
        // guessed beforehand — not that it stays hidden afterwards.
        DASH_RUNNER_ENDPOINT_ID: endpointId,
      },
    });
    child.unref();
    pid = child.pid;
  } catch (error: unknown) {
    return {
      ok: false,
      reason: "spawn_failed",
      detail: error instanceof Error ? error.message : "The runner could not be started.",
    };
  }

  const listening = await waitForEndpointFile(dataDir);
  if (listening === null) {
    return {
      ok: false,
      reason: "never_listened",
      detail: `The runner started as pid ${String(pid)} but never reported an endpoint. See runner.log in the data directory.`,
    };
  }

  return {
    ok: true,
    handle: {
      origin: IPC_ORIGIN,
      endpoint: listening.endpoint,
      transport: listening.transport === "pipe" ? "pipe" : "unix",
      pid: listening.pid,
      token,
      adopted: false,
      started_at: null,
    },
  };
}

/** What a preflight found holding the data directory (MAR-520). */
export type LeftoverRunner =
  | { state: "none" }
  | { state: "adoptable"; pid: number; build?: string }
  | { state: "retired"; pid: number; build?: string }
  | { state: "held"; pid: number; build?: string; detail: string };

/**
 * Is anything holding this data directory, and can it be asked to stop?
 *
 * The preflight half of MAR-520, exported so an attended harness can ask the
 * question **before** it builds anything and before an operator sits down at a
 * consent screen. The alternative is what happened on 2026-08-07: a leftover
 * runner discovered at the end of a session, by hand, from a process list.
 *
 * It deliberately does **not** retire an adoptable runner. A healthy runner
 * this DASH can authenticate to is one the shell will adopt in a moment, and a
 * preflight that stopped it would be ending the fleet on startup — the failure
 * `ensureRunner`'s own header refuses. Only the unadoptable case is acted on,
 * because that is the one that would otherwise become a second writer.
 */
export async function retireLeftoverRunner(dataDir: string): Promise<LeftoverRunner> {
  let token: string;
  try {
    token = ensureChannelSecret(dataDir);
  } catch {
    // Without a channel credential this process cannot authenticate to
    // anything. `ensureRunner` reports that properly; a preflight saying
    // "nothing is here" would be a lie, so it says it found nothing it can act
    // on and lets the real refusal come from the real place.
    return { state: "none" };
  }

  const found = await adopt(dataDir, token);
  if (found.kind === "none") {
    return { state: "none" };
  }
  if (found.kind === "candidate") {
    return {
      state: "adoptable",
      pid: found.candidate.handle.pid,
      build: found.candidate.observed_build,
    };
  }

  const retired = await retireForeignRunner(dataDir, found);
  return retired.ok
    ? { state: "retired", pid: found.pid, build: found.observed_build }
    : { state: "held", pid: found.pid, build: found.observed_build, detail: retired.detail };
}

/**
 * Ask a runner DASH cannot authenticate to, using the credential it recorded
 * for itself (MAR-520).
 *
 * The sequence is deliberately the polite one all the way down. The session key
 * is presented only after the published fingerprint says it is the right key,
 * so a mismatch is reported as a mismatch rather than spent as a failed
 * authentication attempt against a process somebody else may own. `stopRunner`
 * is the same authenticated `POST /shutdown` DASH's own Stop uses.
 *
 * Every failure path ends in the same sentence, because there is only one thing
 * a person can do about a runner nothing on this machine holds the credential
 * for: restart the computer once. Saying it plainly is better than a technical
 * refusal that reads as a bug, and much better than a `Stop-Process` suggestion
 * — `AGENTS.md` forbids that for the reason a force-killed runner corrupted
 * this project's real store once already.
 */
async function retireForeignRunner(
  dataDir: string,
  found: { pid: number; endpoint: string; observed_build?: string; fingerprint?: string },
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const restart =
    `Restart this computer once to clear it; DASH will not hard-terminate a runner that ` +
    `is holding your agent history.`;
  const found_it =
    `DASH found runner pid ${String(found.pid)} ` +
    `(${found.observed_build ?? "identity unavailable"}) already running against this data ` +
    `directory, and it does not accept DASH's channel credential. DASH will not start a ` +
    `second runner over the same records.`;

  const session = readSessionKey(dataDir);
  if (session === null) {
    return {
      ok: false,
      detail: `${found_it} It recorded no credential of its own, so nothing here can ask it to stop. ${restart}`,
    };
  }
  if (found.fingerprint !== undefined && channelSecretFingerprint(session) !== found.fingerprint) {
    // The runner published which credential it is using and this is not it —
    // a session key left by a *different* runner, most likely one that crashed.
    return {
      ok: false,
      detail: `${found_it} The credential recorded beside it belongs to a different runner. ${restart}`,
    };
  }

  const stopped = await stopRunner({
    origin: IPC_ORIGIN,
    endpoint: found.endpoint,
    transport: found.endpoint.startsWith("\\\\") ? "pipe" : "unix",
    pid: found.pid,
    token: session,
    adopted: true,
    started_at: null,
  });
  if (!stopped.ok) {
    return { ok: false, detail: `${found_it} ${stopped.detail} ${restart}` };
  }
  return { ok: true };
}

/**
 * Stop a runner left behind by a version that listened on a port.
 *
 * The upgrade case, and the only one where "adopt or spawn" is not enough. A
 * pre-MAR-430 `runner.json` carries `port` and no `endpoint`, so `adopt`
 * correctly declines it — and without this, the old process would keep running
 * forever, holding agents DASH can no longer see or stop, while a second runner
 * starts beside it. Two runners supervising one machine is precisely what the
 * endpoint's exactly-one guarantee exists to prevent, and an update is not
 * allowed to be the way around it.
 *
 * Signalled rather than adopted: the old runner speaks a transport this build
 * no longer dials, so there is nothing to say to it but "stop".
 */
async function retireLegacyRunner(
  dataDir: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const file = endpointFilePath(dataDir);
  if (!existsSync(file)) {
    return { ok: true };
  }
  let recorded: { pid?: unknown; port?: unknown; endpoint?: unknown };
  try {
    recorded = JSON.parse(readFileSync(file, "utf8")) as typeof recorded;
  } catch {
    return { ok: true };
  }
  if (typeof recorded.port !== "number" || typeof recorded.endpoint === "string") {
    return { ok: true };
  }
  if (typeof recorded.pid !== "number") {
    return { ok: true };
  }
  if (!processExists(recorded.pid)) {
    return { ok: true };
  }
  if (process.platform === "win32") {
    return {
      ok: false,
      detail:
        `DASH found a pre-upgrade runner (pid ${String(recorded.pid)}) that cannot checkpoint ` +
        "its store through a graceful Windows shutdown. Restart Windows once; DASH will not " +
        "hard-terminate the process holding your agent history.",
    };
  }

  try {
    process.kill(recorded.pid, "SIGTERM");
    console.warn(
      `[dash-shell] stopped a pre-MAR-430 runner (pid ${String(recorded.pid)}) that listened on a port.`,
    );
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && processExists(recorded.pid)) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return processExists(recorded.pid)
      ? {
          ok: false,
          detail: `The pre-upgrade runner (pid ${String(recorded.pid)}) did not stop after SIGTERM.`,
        }
      : { ok: true };
  } catch {
    return processExists(recorded.pid)
      ? { ok: false, detail: `The pre-upgrade runner (pid ${String(recorded.pid)}) could not be stopped.` }
      : { ok: true };
  }
}

/**
 * The environment the runner inherits.
 *
 * Deliberately not `process.env` wholesale. Electron sets a number of variables
 * that mean something to a renderer and nothing to a Node process, and DASH's
 * own `DASH_DATA_DIR` must not silently become the runner's — the runner is
 * told its directory explicitly, and inheriting a second opinion about it is
 * how two processes end up disagreeing about where the truth is.
 */
function cleanEnvironment(): NodeJS.ProcessEnv {
  const { DASH_DATA_DIR: _ignored, ...rest } = process.env;
  return rest;
}

/** Poll for the endpoint file the runner writes once it is listening. */
async function waitForEndpointFile(
  dataDir: string,
  timeoutMs = 10_000,
): Promise<RunnerEndpointFile | null> {
  const file = endpointFilePath(dataDir);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as RunnerEndpointFile;
      } catch {
        // Written but not yet flushed. Try again.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

/**
 * Ask the runner to shut down over its protected local control channel.
 *
 * Node maps SIGTERM to TerminateProcess on Windows, which gives neither agents
 * nor SQLite a shutdown callback. The runner owns the order, so only the runner
 * can stop its children, close its server and checkpoint its store cleanly.
 */
export async function stopRunner(handle: RunnerHandle): Promise<{ ok: boolean; detail: string }> {
  const call = runnerFetch(handle);
  try {
    const response = await call(`${handle.origin}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${handle.token}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status !== 202) {
      const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
      return {
        ok: false,
        detail:
          typeof body.detail === "string"
            ? body.detail
            : `The runner refused graceful shutdown (${String(response.status)}).`,
      };
    }

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!processExists(handle.pid)) {
        return { ok: true, detail: `Runner pid ${String(handle.pid)} stopped gracefully.` };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
      ok: false,
      detail: `Runner pid ${String(handle.pid)} did not exit after its graceful shutdown request.`,
    };
  } catch (error: unknown) {
    if (!processExists(handle.pid)) {
      return { ok: true, detail: "The runner was not running." };
    }
    return {
      ok: false,
      detail:
        error instanceof Error
          ? `The runner could not be stopped gracefully: ${error.message}`
          : "The runner could not be stopped gracefully.",
    };
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as { code?: string } | null)?.code !== "ESRCH";
  }
}
