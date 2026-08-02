/**
 * The runner's HTTP surface: the contract's transport profile v0, served.
 *
 * ```
 * GET  /agents/{id}            one Agent DOM state snapshot
 * POST /agents/{id}/commands   one command envelope
 * POST /agents/{id}/lifecycle  start or stop the agent's process
 * POST /telemetry/drain        hosted-agent event candidates since the last poll
 * POST /artifacts/drain        hosted-agent artifact candidates since the last poll
 * GET  /health                 what this runner is supervising
 * ```
 *
 * The first two are the profile verbatim, which is what makes a runner-hosted
 * agent and a remote one reachable by the same adapter: DASH hands the adapter
 * a control location either way, and `lib/agent-dom/transport.ts` neither knows
 * nor cares that this one arrives down a socket rather than over a network.
 *
 * **`/lifecycle` is deliberately not a command.** `start` and `stop` are not in
 * the contract's seven verbs, and `docs/agent-command-channel.md` explains at
 * length why inventing them would be dishonest: they act on a process, not on a
 * run, and no manifest can declare them. So they get a different route, a
 * different request shape and a different audit path, and nothing about them
 * touches the envelope machinery.
 *
 * ## The posture
 *
 * - **No port at all.** Since MAR-430 the listener is a Unix socket or a
 *   Windows named pipe, so the endpoint is not reachable by every process on
 *   the machine the way a loopback port is. `runner/endpoint.ts` owns that and
 *   documents what each platform does and does not enforce.
 * - **Bearer token, compared in constant time.** The credential survives the
 *   move: OS access control is the first gate and this is the second, and on
 *   Windows the second is the one this project can both set and verify. A naive
 *   `===` on a secret leaks its prefix to anyone who can time requests.
 * - **Bounded bodies.** An unbounded read on a local port is a denial of
 *   service any local process can perform.
 * - **The token is never logged**, and neither is a request body: an envelope
 *   carries the user's free-text approval reason.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

import { validateState } from "../lib/contracts";
import { executeCommand, type ChannelPrincipal } from "./execute";
import { RUNNER_BUILD_ID, RUNNER_PROTOCOL_VERSION } from "./identity";
import { buildAgentDomState, type ProcessReport } from "./state";
import type { AdoptionResult, Supervisor } from "./supervisor";

/** Generous for an envelope, far too small to be a useful memory attack. */
export const MAX_REQUEST_BYTES = 262_144;

export interface ReloadSummary extends AdoptionResult {
  /** Registration files that could not be used, by file name and why. */
  skipped: Array<{ file: string; problem: string }>;
}

export interface RunnerServerOptions {
  supervisor: Supervisor;
  database: DatabaseSync;
  /** The channel credential. Compared, never logged, never echoed. */
  token: string;
  principal: ChannelPrincipal;
  /**
   * Re-read the registration directory (MAR-428).
   *
   * Injected rather than done here because this module has no idea where the
   * data directory is, and should not: it serves a supervisor it was handed.
   * Absent means the route answers 501 rather than pretending to have reloaded,
   * which keeps a runner built without it honest instead of silently useless.
   */
  reload?: () => ReloadSummary;
  /** Graceful process shutdown, supplied only by the standalone runner. */
  shutdown?: () => void;
  now?: () => Date;
  log?: (line: string) => void;
}

export function createRunnerServer(options: RunnerServerOptions): Server {
  const log = options.log ?? ((line: string) => { console.warn(line); });

  return createServer((request, response) => {
    void handle(request, response, options, log).catch((error: unknown) => {
      // A thrown handler must not take the runner down or hang the caller.
      log(`[runner] request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) {
        send(response, 500, { ok: false, detail: "The runner failed to handle the request." });
      }
    });
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: RunnerServerOptions,
  log: (line: string) => void,
): Promise<void> {
  if (!isLocalPeer(request)) {
    // Belt and braces with the endpoint. A runner that ever grows a
    // non-loopback listener must not silently become reachable.
    send(response, 403, { ok: false, detail: "The runner accepts local connections only." });
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

  // `/health` is the only unauthenticated route, and it says nothing an
  // unauthenticated caller could not learn by looking at the process list.
  if (request.method === "GET" && segments.length === 1 && segments[0] === "health") {
    send(response, 200, {
      ok: true,
      supervising: options.supervisor.list().length,
      runner_protocol: RUNNER_PROTOCOL_VERSION,
      runner_build: RUNNER_BUILD_ID,
    });
    return;
  }

  if (!isAuthorized(request, options.token)) {
    // No detail about why. A caller learning "the token was the right length"
    // is a caller learning something.
    send(response, 401, { ok: false, detail: "Unauthorized." });
    return;
  }

  // POST /shutdown — graceful owner-requested shutdown over the same protected
  // local channel. On Windows `process.kill(pid, "SIGTERM")` is implemented as
  // TerminateProcess and skips SQLite close/checkpoint entirely; this route is
  // the portable way to let the runner stop agents, close its server and close
  // its store in the order `runner/main.ts` owns.
  if (request.method === "POST" && segments.length === 1 && segments[0] === "shutdown") {
    if (options.shutdown === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner cannot shut down through its control channel.",
      });
      return;
    }
    send(response, 202, { ok: true, detail: "The runner is shutting down gracefully." });
    setImmediate(options.shutdown);
    return;
  }

  // GET /agents — which agents this runner hosts.
  //
  // DASH needs this to know whose control location is the runner's own route
  // rather than whatever their manifest declared: a runner listens on an
  // ephemeral port, so no manifest written in advance can name it. The runner
  // is the authority on what it supervises, so it is asked.
  //
  // Authenticated, unlike /health, because the list of an operator's agents is
  // more than a liveness fact.
  if (request.method === "GET" && segments.length === 1 && segments[0] === "agents") {
    send(response, 200, { ok: true, agents: processReports(options.supervisor) });
    return;
  }

  // POST /registrations/reload — take up a fresh reading of the directory.
  //
  // A POST rather than a GET because it changes what the runner supervises, and
  // a route of its own rather than a lifecycle action because it is not about
  // one agent. Note what it still cannot do: the body is ignored entirely, so
  // the caller chooses *when* the runner re-reads its directory and never *what*
  // it finds there. "The API chooses which registration to start, never what to
  // run" survives intact — this route does not even choose which.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "registrations" &&
    segments[1] === "reload"
  ) {
    if (options.reload === undefined) {
      send(response, 501, {
        ok: false,
        detail: "This runner was started without the ability to re-read its registrations.",
      });
      return;
    }
    const summary = options.reload();
    send(response, 200, { ok: true, ...summary });
    log(
      `[runner] reload: +${String(summary.added.length)} ~${String(summary.updated.length)} ` +
        `-${String(summary.removed.length)} deferred=${String(summary.deferred.length)} ` +
        `skipped=${String(summary.skipped.length)}`,
    );
    return;
  }

  // POST /telemetry/drain — one bounded fire-and-forget batch from hosted
  // children. This is on the authenticated runner channel and therefore adds no
  // listener, credential or environment variable. The event bodies are not
  // interpreted here: main hands each one to the canonical ingest boundary.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "telemetry" &&
    segments[1] === "drain"
  ) {
    send(response, 200, { ok: true, ...options.supervisor.drainTelemetry() });
    return;
  }

  // POST /artifacts/drain — the same bounded fire-and-forget shape for what a
  // run produced (MAR-457). A separate route rather than more fields on the
  // telemetry drain: the two are validated against different schemas at
  // different ingest boundaries, and one response carrying both would make main
  // sort them apart again by inspecting untrusted bodies.
  if (
    request.method === "POST" &&
    segments.length === 2 &&
    segments[0] === "artifacts" &&
    segments[1] === "drain"
  ) {
    send(response, 200, { ok: true, ...options.supervisor.drainArtifacts() });
    return;
  }

  if (segments[0] !== "agents" || segments[1] === undefined) {
    send(response, 404, { ok: false, detail: "No such route." });
    return;
  }
  const agentId = decodeURIComponent(segments[1]);

  // GET /agents/{id}
  if (request.method === "GET" && segments.length === 2) {
    serveState(response, agentId, options);
    return;
  }

  // POST /agents/{id}/commands
  if (request.method === "POST" && segments.length === 3 && segments[2] === "commands") {
    const body = await readBody(request);
    if (body === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(body);
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not JSON." });
      return;
    }

    const result = await executeCommand(envelope, {
      database: options.database,
      supervisor: options.supervisor,
      principal: options.principal,
      now: options.now,
    });
    // Deliberately 200 with `ok: false` for an adjudicated refusal rather than
    // a 4xx. A refusal is a *result the runner produced*, and the adapter needs
    // to tell it apart from "the request never got that far" — which is exactly
    // what `lib/agent-dom/transport.ts` maps a non-2xx onto.
    send(response, 200, {
      ok: result.ok,
      detail: result.detail,
      reason: result.reason,
      duplicate: result.duplicate,
    });
    log(
      `[runner] ${result.ok ? "accepted" : "refused"} command=${result.command_id}` +
        ` agent=${agentId}${result.reason ? ` reason=${result.reason}` : ""}`,
    );
    return;
  }

  // POST /agents/{id}/lifecycle
  if (request.method === "POST" && segments.length === 3 && segments[2] === "lifecycle") {
    const body = await readBody(request);
    if (body === null) {
      send(response, 413, { ok: false, detail: "The request body was too large." });
      return;
    }
    let action: unknown;
    let credentials: unknown;
    try {
      const parsed = JSON.parse(body) as { action?: unknown; credentials?: unknown };
      action = parsed.action;
      credentials = parsed.credentials;
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not JSON." });
      return;
    }

    if (action === "start") {
      // MAR-383. DASH reads the OS vault and sends the values for this spawn
      // only; the runner holds them no longer than the `start` call. Nothing
      // about them is logged — the line below reports the outcome and the
      // agent id, and `readBody` never logs a body.
      const parsedCredentials = parseSpawnCredentials(credentials);
      if (parsedCredentials === null) {
        send(response, 400, {
          ok: false,
          detail: "credentials must be an object of environment names to string values.",
        });
        return;
      }
      const started = options.supervisor.start(agentId, parsedCredentials);
      send(response, 200, {
        ok: started.ok,
        detail: started.ok ? `Started as pid ${String(started.pid)}.` : started.detail,
        reason: started.ok ? undefined : started.problem,
      });
      log(`[runner] start ${agentId}: ${started.ok ? "ok" : started.problem}`);
      return;
    }
    if (action === "stop") {
      const stopped = options.supervisor.stop(agentId);
      send(response, 200, { ok: stopped.ok, detail: stopped.detail });
      log(`[runner] stop ${agentId}: ${stopped.ok ? "ok" : "failed"}`);
      return;
    }

    send(response, 400, { ok: false, detail: 'action must be "start" or "stop".' });
    return;
  }


  send(response, 404, { ok: false, detail: "No such route." });
}

/**
 * Narrow the `credentials` block of a start request (MAR-383).
 *
 * Absent is the ordinary case and means an empty map, not a refusal: most
 * agents declare no DASH-managed connection, and requiring the key would make
 * every existing caller malformed.
 *
 * Values must be strings. An object or array here would be a caller trying to
 * put structure into an environment variable, and `null` would become the
 * literal `"null"` in the child — both are more likely a bug than an intent,
 * and neither is something to guess at. What this does *not* do is check the
 * names: that is `checkEnvironmentName`, applied in `childEnvironment`, so
 * there is one place the rule lives rather than two that can disagree.
 */
export function parseSpawnCredentials(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const credentials: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") {
      return null;
    }
    credentials[key] = entry;
  }
  return credentials;
}

/**
 * Serve one snapshot, validated on the way out.
 *
 * The runner checks its own document against `agent-dom-state.schema.json`
 * before serving it, which sounds redundant — DASH validates it again on
 * arrival — and is not. A runner that emits a document failing its own contract
 * should discover that at the boundary it controls, not as a mysterious
 * rejection in someone else's store. It is the same argument
 * `lib/agent-dom/runner.ts` makes for validating an envelope it built itself.
 */
function serveState(
  response: ServerResponse,
  agentId: string,
  options: RunnerServerOptions,
): void {
  const facts = options.supervisor.facts(agentId);
  if (facts === null) {
    send(response, 404, { ok: false, detail: `No agent is registered as "${agentId}".` });
    return;
  }

  const state = buildAgentDomState(
    facts,
    options.supervisor.report(agentId),
    options.now?.() ?? new Date(),
  );
  const validation = validateState(state);
  if (!validation.ok) {
    send(response, 500, {
      ok: false,
      detail: `The runner built a state snapshot that fails the contract: ${validation.errors
        .slice(0, 5)
        .join("; ")}`,
    });
    return;
  }

  sendRaw(response, 200, JSON.stringify(state));
}

/** What `/health` and the shell's status command report. */
export function processReports(supervisor: Supervisor): ProcessReport[] {
  return supervisor.list().map((agentId) => {
    const facts = supervisor.facts(agentId);
    return {
      agent_id: agentId,
      pid: facts?.pid ?? null,
      lifecycle: facts?.lifecycle ?? "stopped",
      started_at: facts?.started_at ?? null,
      exit_code: facts?.exit_code ?? null,
      exit_signal: facts?.exit_signal ?? null,
      commands: supervisor.commands(agentId),
    };
  });
}

/* ---------------------------------------------------------------------- *
 * Request plumbing
 * ---------------------------------------------------------------------- */

/**
 * Compare the presented token with the real one in constant time.
 *
 * `a === b` on secrets returns as soon as two bytes differ, so the time it
 * takes reveals how long a shared prefix was. That is a practical attack
 * against a local port that anything on the machine may probe in a loop.
 * Lengths are compared first because `timingSafeEqual` throws on a mismatch —
 * and a length is not the secret.
 */
export function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  const presented = Buffer.from(header.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  if (presented.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(presented, expected);
}

/**
 * Is this connection one the runner may answer?
 *
 * Since MAR-430 the runner listens on a Unix socket or a named pipe and never
 * on a port, and an IPC connection has **no remote address** — there is no peer
 * IP because there is no IP. So an absent address is the expected case and is
 * allowed: the operating system already decided who may connect, by socket mode
 * and directory ownership on POSIX and by the pipe's descriptor on Windows.
 *
 * The loopback branch is kept for the case that no longer occurs. A future
 * change that reintroduces a TCP listener — for a remote runner, say — must not
 * get a non-loopback peer accepted by default just because this check was
 * written when there was nothing to check.
 */
export function isLocalPeer(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  if (address === undefined) {
    return true;
  }
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

/**
 * Read a bounded body, or null when the caller sent too much.
 *
 * The early return **pauses** the request rather than walking away from it.
 * Abandoning a half-read stream leaves the peer writing into a reader that
 * will never drain, and the answer this runner has already decided on — a 413 —
 * then races the peer's remaining bytes. Over loopback TCP the kernel buffer
 * usually hid that; over a Unix socket the buffer is smaller and it surfaces as
 * an `EPIPE` on whichever side loses. Pausing stops the read without
 * discarding the connection, so the refusal reaches the caller first.
 */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      request.pause();
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function send(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  sendRaw(response, status, JSON.stringify(body));
}

function sendRaw(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "application/json",
    // Nothing here is cacheable and some of it is a decision about a
    // credential-adjacent action.
    "cache-control": "no-store",
  });
  response.end(body);
}
