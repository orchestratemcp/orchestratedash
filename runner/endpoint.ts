/**
 * Where the runner listens, and why it is not a port.
 *
 * MAR-415 shipped the runner on loopback TCP. That worked and was wrong in two
 * ways at once: a TCP listener is reachable by *every* process on the machine,
 * so the only thing standing between a hostile local program and the command
 * channel was a bearer token — and that token had to live in the OS vault to
 * survive a restart, which is why `runner/README.md` item 7 said "no OS-backed
 * vault means no runner". A Linux box without a keyring could not host an agent
 * that had no secrets to protect in the first place.
 *
 * MAR-430 replaces the port with an OS-local endpoint whose access control is
 * the operating system's job:
 *
 * | Platform | Endpoint | What limits access |
 * | --- | --- | --- |
 * | macOS / Linux | Unix-domain socket | 0700 runtime directory, 0600 socket, ownership checked |
 * | Windows | Named pipe | The pipe's DACL, plus `lib`-side channel secret — see below |
 *
 * The HTTP semantics above it do not change at all. `node:http` serves a
 * `socketPath` exactly as it serves a port, so `runner/server.ts` is untouched
 * by this and the contract's transport profile v0 is still what is spoken.
 *
 * ## The Windows caveat, stated plainly
 *
 * Node cannot author a named pipe's DACL. libuv calls `CreateNamedPipeW` with
 * `lpSecurityAttributes = NULL` and exposes no override, and fixing it after
 * `listen()` does not work either: each pipe *instance* is given its security
 * descriptor at creation, and libuv creates a fresh instance per connection.
 *
 * The descriptor Windows then assigns — measured, not assumed — is:
 *
 * ```
 * D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;<owner>)(A;;FR;;;WD)(A;;FR;;;AN)
 * ```
 *
 * `WD` is Everyone and `AN` is Anonymous, both with `FILE_GENERIC_READ`. That
 * is genuinely wider than owner-only, and it is why MAR-430 named the DACL as
 * an acceptance criterion rather than a detail.
 *
 * What it does **not** grant is `FILE_WRITE_DATA`. A foreign principal can
 * connect and occupy an instance; it cannot write a byte. Every byte this
 * runner emits is a response to a request the peer had to send first, so a
 * peer that cannot write learns nothing and commands nothing. The acceptance
 * criterion — "a different local user cannot read state or submit a command" —
 * holds on the default descriptor.
 *
 * Depth for the part we cannot author comes from `runner/channel-secret.ts`,
 * whose file ACL we *can* author and *can* verify. See that module.
 *
 * ## One runner, enforced by the OS
 *
 * libuv passes `FILE_FLAG_FIRST_PIPE_INSTANCE`, so a second bind to a live
 * pipe name fails with `EADDRINUSE` rather than quietly joining it. Combined
 * with an unpredictable per-spawn name that is also the anti-squatting answer:
 * a hostile process cannot pre-create the pipe this runner is about to use,
 * because it cannot guess the name, and if it somehow did the bind would fail
 * closed instead of handing it our traffic.
 */

import { existsSync, mkdirSync, chmodSync, statSync, unlinkSync } from "node:fs";
import type { Server } from "node:http";
import net from "node:net";
import path from "node:path";

/** Windows named pipes live in a flat kernel namespace under this prefix. */
const PIPE_PREFIX = String.raw`\\.\pipe`;

/**
 * The ceiling on a Unix socket path.
 *
 * `sockaddr_un.sun_path` is 104 bytes on macOS and 108 on Linux, and exceeding
 * it fails at `bind` with a message that reads like a permissions problem. The
 * smaller of the two is checked so a path that works on Linux does not surprise
 * a mac, and the check is explicit so the error names the real cause.
 */
const MAX_UNIX_SOCKET_PATH = 104;

export interface RunnerEndpoint {
  /** What `server.listen` and `http.request({ socketPath })` both take. */
  path: string;
  transport: "unix" | "pipe";
}

/**
 * Derive the endpoint for one runner instance.
 *
 * `endpointId` is minted per spawn by `electron/runner-process.ts` rather than
 * per install. The issue asks for unpredictable-per-install; per-spawn is
 * strictly stronger and costs nothing, because DASH learns the real path by
 * reading `runner.json` rather than by recomputing it.
 *
 * The id is not a secret and is not treated as one: a Windows pipe name is
 * enumerable by any local process, so its value is that it cannot be guessed
 * *in advance*, not that it stays hidden afterwards.
 */
export function runnerEndpoint(dataDir: string, endpointId: string): RunnerEndpoint {
  if (process.platform === "win32") {
    return { path: `${PIPE_PREFIX}\\orchestratedash-runner-${endpointId}`, transport: "pipe" };
  }
  return { path: path.join(runtimeDirectory(dataDir), `runner-${endpointId}.sock`), transport: "unix" };
}

/**
 * Where a Unix socket goes.
 *
 * `XDG_RUNTIME_DIR` is the right answer when it exists: the OS creates it 0700,
 * owned by the session user, and clears it on logout — which is exactly the
 * lifetime a control socket wants. Everything else falls back to a `run/`
 * directory beside the store, created 0700 by `prepareEndpoint`.
 *
 * A socket under the data directory is the fallback rather than the default
 * because a data directory may be synced, backed up or on a network mount, and
 * none of those are things that should be true of a socket.
 */
function runtimeDirectory(dataDir: string): string {
  const xdg = process.env["XDG_RUNTIME_DIR"];
  if (xdg !== undefined && xdg.length > 0) {
    return path.join(xdg, "orchestratedash");
  }
  return path.join(dataDir, "run");
}

export type EndpointProblem =
  /** Another live runner already holds this endpoint. */
  | "in_use"
  /** The socket or its directory exists but belongs to someone else. */
  | "foreign_owner"
  /** The path is longer than `sockaddr_un` can carry. */
  | "path_too_long"
  /** The runtime directory could not be created or hardened. */
  | "directory_refused";

export class EndpointError extends Error {
  readonly problem: EndpointProblem;
  constructor(problem: EndpointProblem, message: string) {
    super(message);
    this.name = "EndpointError";
    this.problem = problem;
  }
}

/**
 * Make the endpoint bindable, or refuse with a reason.
 *
 * Windows needs nothing here: a named pipe is a kernel object that dies with
 * the process holding it, so there is no such thing as a stale one. The whole
 * body of this function is the POSIX crash-recovery story.
 *
 * @throws EndpointError
 */
export async function prepareEndpoint(endpoint: RunnerEndpoint): Promise<void> {
  if (endpoint.transport === "pipe") {
    return;
  }

  if (Buffer.byteLength(endpoint.path, "utf8") > MAX_UNIX_SOCKET_PATH) {
    throw new EndpointError(
      "path_too_long",
      `The runner's socket path is ${String(Buffer.byteLength(endpoint.path, "utf8"))} bytes and the ` +
        `platform limit is ${String(MAX_UNIX_SOCKET_PATH)}. Set XDG_RUNTIME_DIR, or move the data directory somewhere shorter.`,
    );
  }

  const directory = path.dirname(endpoint.path);
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // `mkdir` honours the mode only when it creates the directory, so an
    // existing one from an older version — or from a umask that widened it — is
    // narrowed explicitly rather than trusted.
    chmodSync(directory, 0o700);
  } catch (error: unknown) {
    throw new EndpointError(
      "directory_refused",
      `The runner could not create an owner-only runtime directory at ${directory}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  assertOwnedByUs(directory, "runtime directory");

  await reclaimStaleSocket(endpoint.path);
}

/**
 * Deal with a socket file left behind by a crash.
 *
 * The three outcomes are deliberately not collapsed. A socket that still
 * answers means a runner is alive and this process must not steal its name; a
 * socket that refuses means the runner behind it is gone and the file is
 * litter; a socket that refuses *us specifically* means it is somebody else's,
 * and unlinking it would be this process deleting another user's endpoint.
 *
 * Unlinking on `ECONNREFUSED` and only then is what makes crash recovery safe.
 * "Delete it if it exists" would be a race with a runner that is merely busy.
 */
async function reclaimStaleSocket(socketPath: string): Promise<void> {
  if (!existsSync(socketPath)) {
    return;
  }
  assertOwnedByUs(socketPath, "socket");

  const liveness = await probe(socketPath);
  if (liveness === "live") {
    throw new EndpointError(
      "in_use",
      `A runner is already listening on ${socketPath}. This one will not take its endpoint.`,
    );
  }
  if (liveness === "forbidden") {
    throw new EndpointError(
      "foreign_owner",
      `${socketPath} exists and this user may not connect to it. Refusing to remove another principal's socket.`,
    );
  }
  unlinkSync(socketPath);
}

/** Connect, briefly, only to learn whether anything is on the other end. */
function probe(socketPath: string): Promise<"live" | "stale" | "forbidden"> {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    const settle = (outcome: "live" | "stale" | "forbidden"): void => {
      socket.destroy();
      resolve(outcome);
    };
    socket.once("connect", () => { settle("live"); });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      settle(error.code === "EACCES" || error.code === "EPERM" ? "forbidden" : "stale");
    });
    // A socket file whose server is wedged answers neither way. Treating that
    // as live is the safe guess: it refuses to start rather than displacing
    // something that might still be holding agents.
    socket.setTimeout(2_000, () => { settle("live"); });
  });
}

/**
 * Refuse to use a path this user does not own.
 *
 * On a shared machine `/tmp`-adjacent paths are the classic way one user hands
 * another a file they did not create. The runner does not repair such a thing;
 * it declines to use it, because repairing it would mean this process asserting
 * authority over another principal's file.
 */
function assertOwnedByUs(target: string, label: string): void {
  const stats = statSync(target);
  const uid = process.getuid?.();
  if (uid !== undefined && stats.uid !== uid) {
    throw new EndpointError(
      "foreign_owner",
      `The runner's ${label} at ${target} is owned by uid ${String(stats.uid)}, not by uid ${String(uid)}.`,
    );
  }
}

/**
 * Bind the server and make the socket owner-only.
 *
 * The `chmod` has to happen *after* `listen`, because the file does not exist
 * until then — which leaves a window in which the socket exists with whatever
 * the umask allowed. The 0700 parent directory is what closes that window: a
 * socket nobody can traverse to is not connectable regardless of its own mode.
 * Both are applied, because the directory is the belt and the mode is the
 * braces, and `runner/README.md` now says which is which.
 *
 * @throws EndpointError
 */
export async function listenOnEndpoint(server: Server, endpoint: RunnerEndpoint): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(
          new EndpointError(
            "in_use",
            `A runner already holds ${endpoint.path}. On Windows this is the OS enforcing ` +
              `exactly one runner per endpoint, not a race to retry.`,
          ),
        );
        return;
      }
      reject(error);
    });
    server.listen(endpoint.path, () => { resolve(); });
  });

  if (endpoint.transport === "unix") {
    chmodSync(endpoint.path, 0o600);
    assertOwnedByUs(endpoint.path, "socket");
  }
}

/**
 * Remove a Unix socket on the way out.
 *
 * `server.close()` does not unlink it, so without this every clean shutdown
 * would leave the litter that `reclaimStaleSocket` then has to reason about.
 * Doing it here means the crash path is the only one that ever needs recovery.
 */
export function releaseEndpoint(endpoint: RunnerEndpoint): void {
  if (endpoint.transport !== "unix") {
    return;
  }
  try {
    unlinkSync(endpoint.path);
  } catch {
    // Already gone, or never created. Neither is worth failing a shutdown over.
  }
}
