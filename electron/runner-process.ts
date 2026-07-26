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
 * ## The channel credential
 *
 * The token lives in the OS vault (MAR-416), because it must survive a DASH
 * restart: a runner adopted after a restart is one DASH has to be able to
 * authenticate to, and a token held only in memory would mean the choice
 * between killing a running fleet and talking to it. **When the vault is not
 * OS-backed the runner is not started at all** — `lib/secure-store.ts` already
 * decided that a credential never falls back to plaintext, and a control
 * channel for a process that executes agent code is not the place to make the
 * first exception.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, openSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isSecureStoreError, type SecureStore } from "../lib/secure-store";
import type { RunnerPortFile } from "../runner/main";

/** The vault key. Must satisfy `isValidSecretName`. */
export const RUNNER_TOKEN_NAME = "dash.runner.channel-token";

export interface RunnerHandle {
  /** The base for every agent's control location on this machine. */
  origin: string;
  port: number;
  pid: number;
  token: string;
  /** True when DASH attached to a runner that was already up. */
  adopted: boolean;
}

export type EnsureRunnerResult =
  | { ok: true; handle: RunnerHandle }
  | {
      ok: false;
      reason: "vault_unavailable" | "spawn_failed" | "never_listened";
      detail: string;
    };

function portFilePath(dataDir: string): string {
  return path.join(dataDir, "runner.json");
}

/**
 * Get the channel token, minting one the first time.
 *
 * 32 bytes of CSPRNG output, base64url — the same shape and the same reasoning
 * as the command nonce in `lib/agent-dom/envelope.ts`.
 */
async function ensureToken(store: SecureStore): Promise<string> {
  try {
    return await store.get(RUNNER_TOKEN_NAME);
  } catch (error: unknown) {
    if (!isSecureStoreError(error) || error.code !== "not_found") {
      throw error;
    }
  }
  const token = randomBytes(32).toString("base64url");
  await store.set(RUNNER_TOKEN_NAME, token);
  return token;
}

/**
 * Is a runner already listening, and is it ours?
 *
 * The port file says where to look; the health check says whether anything is
 * there; the authenticated probe says whether it is a runner that accepts our
 * token. All three matter — a stale port file after a crash can point at a port
 * some unrelated process has since taken, and DASH must not start posting
 * command envelopes at it.
 */
async function adopt(dataDir: string, token: string): Promise<RunnerHandle | null> {
  const file = portFilePath(dataDir);
  if (!existsSync(file)) {
    return null;
  }

  let recorded: RunnerPortFile;
  try {
    recorded = JSON.parse(readFileSync(file, "utf8")) as RunnerPortFile;
  } catch {
    return null;
  }
  if (typeof recorded.port !== "number" || typeof recorded.pid !== "number") {
    return null;
  }

  const origin = `http://127.0.0.1:${String(recorded.port)}`;
  try {
    const health = await fetch(`${origin}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!health.ok) {
      return null;
    }
    // Authenticated probe. A 401 means something is listening that does not
    // share our token, which is not a runner we may adopt.
    const probe = await fetch(`${origin}/agents/__probe__`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (probe.status === 401 || probe.status === 403) {
      return null;
    }
  } catch {
    return null;
  }

  return { origin, port: recorded.port, pid: recorded.pid, token, adopted: true };
}

/**
 * Ensure a runner is up, and return how to reach it.
 *
 * Adopt first, spawn second. Spawning unconditionally would orphan the previous
 * runner along with every agent it holds, which is the same failure as killing
 * the fleet on restart wearing a different hat.
 */
export async function ensureRunner(
  dataDir: string,
  store: SecureStore,
): Promise<EnsureRunnerResult> {
  const backing = store.describeBacking();
  if (!backing.os_backed) {
    return {
      ok: false,
      reason: "vault_unavailable",
      detail:
        `The bundled runner needs an OS-backed vault to hold its control-channel token, and this ` +
        `machine reports "${backing.label}". DASH will run without hosting agents; remote ` +
        `agent-managed agents are unaffected.`,
    };
  }

  let token: string;
  try {
    token = await ensureToken(store);
  } catch (error: unknown) {
    return {
      ok: false,
      reason: "vault_unavailable",
      detail: isSecureStoreError(error)
        ? `The vault refused to hold the runner's token (${error.code}).`
        : "The vault refused to hold the runner's token.",
    };
  }

  const existing = await adopt(dataDir, token);
  if (existing !== null) {
    return { ok: true, handle: existing };
  }

  // A port file that survived a crash points nowhere useful and would otherwise
  // be adopted again on the next launch.
  rmSync(portFilePath(dataDir), { force: true });

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
        DASH_RUNNER_TOKEN: token,
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

  const listening = await waitForPortFile(dataDir);
  if (listening === null) {
    return {
      ok: false,
      reason: "never_listened",
      detail: `The runner started as pid ${String(pid)} but never reported a port. See runner.log in the data directory.`,
    };
  }

  return {
    ok: true,
    handle: {
      origin: `http://127.0.0.1:${String(listening.port)}`,
      port: listening.port,
      pid: listening.pid,
      token,
      adopted: false,
    },
  };
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

/** Poll for the port file the runner writes once it is listening. */
async function waitForPortFile(
  dataDir: string,
  timeoutMs = 10_000,
): Promise<RunnerPortFile | null> {
  const file = portFilePath(dataDir);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, "utf8")) as RunnerPortFile;
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
 * holding every agent" reachable by anything that ever learns the token.
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
