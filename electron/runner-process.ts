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
import { EndpointError } from "../runner/endpoint";
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
}

export type EnsureRunnerResult =
  | { ok: true; handle: RunnerHandle }
  | {
      ok: false;
      reason: "endpoint_refused" | "spawn_failed" | "never_listened";
      detail: string;
    };

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
async function adopt(dataDir: string, token: string): Promise<RunnerHandle | null> {
  const file = endpointFilePath(dataDir);
  if (!existsSync(file)) {
    return null;
  }

  let recorded: RunnerEndpointFile;
  try {
    recorded = JSON.parse(readFileSync(file, "utf8")) as RunnerEndpointFile;
  } catch {
    return null;
  }
  if (typeof recorded.endpoint !== "string" || typeof recorded.pid !== "number") {
    return null;
  }

  const call = ipcFetch(recorded.endpoint);
  try {
    const health = await call(`${IPC_ORIGIN}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!health.ok) {
      return null;
    }
    // Authenticated probe. A 401 means something is listening that does not
    // share our secret, which is not a runner we may adopt.
    const probe = await call(`${IPC_ORIGIN}/agents/__probe__`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (probe.status === 401 || probe.status === 403) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    origin: IPC_ORIGIN,
    endpoint: recorded.endpoint,
    transport: recorded.transport === "pipe" ? "pipe" : "unix",
    pid: recorded.pid,
    token,
    adopted: true,
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
  if (existing !== null) {
    return { ok: true, handle: existing };
  }

  retireLegacyRunner(dataDir);

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
    },
  };
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
function retireLegacyRunner(dataDir: string): void {
  const file = endpointFilePath(dataDir);
  if (!existsSync(file)) {
    return;
  }
  let recorded: { pid?: unknown; port?: unknown; endpoint?: unknown };
  try {
    recorded = JSON.parse(readFileSync(file, "utf8")) as typeof recorded;
  } catch {
    return;
  }
  if (typeof recorded.port !== "number" || typeof recorded.endpoint === "string") {
    return;
  }
  if (typeof recorded.pid !== "number") {
    return;
  }

  try {
    process.kill(recorded.pid, "SIGTERM");
    console.warn(
      `[dash-shell] stopped a pre-MAR-430 runner (pid ${String(recorded.pid)}) that listened on a port.`,
    );
  } catch {
    // Already gone, or not ours to signal. Either way there is nothing left to
    // retire and the new runner's endpoint cannot collide with a TCP port.
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
 * Ask the runner to shut down.
 *
 * A signal rather than an HTTP route: stopping the runner is not something an
 * authenticated caller does to a resource, it is something the machine's owner
 * does to a process, and giving it an endpoint would make "shut down the thing
 * holding every agent" reachable by anything that ever learns the credential.
 */
export function stopRunner(handle: RunnerHandle): { ok: boolean; detail: string } {
  try {
    process.kill(handle.pid, "SIGTERM");
    return { ok: true, detail: `Asked the runner (pid ${String(handle.pid)}) to stop.` };
  } catch (error: unknown) {
    // ESRCH means it is already gone, which is the state we wanted.
    const code = (error as { code?: string } | null)?.code;
    if (code === "ESRCH") {
      return { ok: true, detail: "The runner was not running." };
    }
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "The runner could not be stopped.",
    };
  }
}
