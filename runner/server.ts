/**
 * The runner's HTTP surface: the contract's transport profile v0, served.
 *
 * ```
 * GET  /agents/{id}            one Agent DOM state snapshot
 * POST /agents/{id}/commands   one command envelope
 * POST /agents/{id}/lifecycle  start or stop the agent's process
 * GET  /health                 what this runner is supervising
 * ```
 *
 * The first two are the profile verbatim, which is what makes a runner-hosted
 * agent and a remote one reachable by the same adapter: an agent's manifest
 * names `http://127.0.0.1:{port}/agents/{id}` as its control location, and
 * `lib/agent-dom/transport.ts` neither knows nor cares that this one is local.
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
 * - **Loopback only**, twice: the listener binds `127.0.0.1`, and every request
 *   is checked for a loopback peer anyway. Binding is configuration and can be
 *   got wrong; the check is code.
 * - **Bearer token, compared in constant time.** A naive `===` on a secret
 *   leaks its prefix to anyone who can time requests, and this endpoint is
 *   reachable by every process on the machine.
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
import { buildAgentDomState, type ProcessReport } from "./state";
import type { Supervisor } from "./supervisor";

/** Generous for an envelope, far too small to be a useful memory attack. */
export const MAX_REQUEST_BYTES = 262_144;

export interface RunnerServerOptions {
  supervisor: Supervisor;
  database: DatabaseSync;
  /** The channel credential. Compared, never logged, never echoed. */
  token: string;
  principal: ChannelPrincipal;
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
  if (!isLoopbackPeer(request)) {
    // Belt and braces with the bind address. A runner that ever grows a
    // non-loopback listener must not silently become reachable.
    send(response, 403, { ok: false, detail: "The runner accepts loopback connections only." });
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);

  // `/health` is the only unauthenticated route, and it says nothing an
  // unauthenticated caller could not learn by looking at the process list.
  if (request.method === "GET" && segments.length === 1 && segments[0] === "health") {
    send(response, 200, { ok: true, supervising: options.supervisor.list().length });
    return;
  }

  if (!isAuthorized(request, options.token)) {
    // No detail about why. A caller learning "the token was the right length"
    // is a caller learning something.
    send(response, 401, { ok: false, detail: "Unauthorized." });
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
    try {
      action = (JSON.parse(body) as { action?: unknown }).action;
    } catch {
      send(response, 400, { ok: false, detail: "The request body was not JSON." });
      return;
    }

    if (action === "start") {
      const started = options.supervisor.start(agentId);
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

export function isLoopbackPeer(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  if (address === undefined) {
    return false;
  }
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    address.startsWith("127.")
  );
}

/** Read a bounded body, or null when the caller sent too much. */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_REQUEST_BYTES) {
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
