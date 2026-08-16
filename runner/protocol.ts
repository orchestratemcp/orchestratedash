/**
 * The runner ↔ agent protocol: newline-delimited JSON over the child's own
 * stdin and stdout.
 *
 * This is the seam that makes an accepted command have an effect. DASH decides
 * whether a command may run, the runner decides it again independently, and
 * then *something has to actually tell the agent*. That something is a line of
 * JSON written to a process the runner started. The same pipe carries state and
 * telemetry in the other direction, so a hosted agent never needs a listening
 * port or an ingest credential in its environment.
 *
 * ## Why stdin/stdout and not another HTTP hop
 *
 * The runner already owns the child's lifetime, so the pipe exists whether or
 * not we use it. Giving each agent a listening socket would mean every agent
 * binding a port, authenticating a caller, and being reachable by anything else
 * on the machine that can open a connection — three new problems to solve per
 * agent, in exchange for nothing the pipe does not already give us. A pipe is
 * authenticated by construction: only the process holding the other end can
 * write to it.
 *
 * ## Acknowledgement is mandatory, and that is the honest part
 *
 * A command is not "delivered" because a line was written. Anything can be
 * written to a pipe nobody reads. The agent must answer with an `ack` naming
 * the `command_id`, and until it does the runner reports the command as
 * unacknowledged rather than done — which is what stops this layer from
 * becoming the success-returning stub that `noAdapter`'s comment warns about,
 * one process boundary further in.
 *
 * ## Non-protocol output is not an error
 *
 * Agents log. A line that is not JSON, or is JSON that is not one of these
 * messages, is the agent's ordinary output and is forwarded to the runner's log
 * untouched. Treating it as a protocol violation would make the first
 * `console.log` in anybody's agent look like a fault.
 */

import type { AgentCommand } from "../lib/workspace";
import type { CommandTarget } from "../lib/agent-dom/envelope";

/** Bumped when the message shapes below change incompatibly. */
export const AGENT_PROTOCOL_VERSION = 1;

/* ---------------------------------------------------------------------- *
 * Runner → agent
 * ---------------------------------------------------------------------- */

/**
 * A command, as the agent sees it.
 *
 * Note what is absent: the actor, the nonce, the expiry, the idempotency key
 * and the audit correlation. All of those are the runner's business — they are
 * how it decided to deliver this at all — and an agent that could read them
 * would be an agent that could be written to depend on them. What the agent
 * needs is what to do and to what.
 *
 * `reason` is present because this is where the user's free text was always
 * going: DASH carries it in the envelope and never stores it, the runner
 * forwards it here, and the agent's own record is the answer to "why was this
 * approved". See `docs/agent-command-channel.md`.
 */
export interface AgentCommandMessage {
  protocol_version: number;
  type: "command";
  command_id: string;
  command: AgentCommand;
  target: CommandTarget;
  payload?: { option_id?: string; reason?: string };
}

export function encodeCommand(message: Omit<AgentCommandMessage, "protocol_version" | "type">): string {
  const line: AgentCommandMessage = {
    protocol_version: AGENT_PROTOCOL_VERSION,
    type: "command",
    ...message,
  };
  return `${JSON.stringify(line)}\n`;
}

/**
 * The task a run is about to do, and the files it may read (MAR-434).
 *
 * **Deliberately not a command.** The contract's seven verbs act on a run in
 * flight — approve, reject, choose, retry, pause, resume, cancel — and
 * `docs/agent-command-channel.md` is explicit that inventing an eighth to cover
 * something they do not describe is dishonest, which is the same argument that
 * kept `start` and `stop` off the command channel and on `/lifecycle`. Handing an
 * agent its inputs is not adjudicating a gate. It gets its own message, its own
 * route and no envelope machinery.
 *
 * What travels is a resolved path per input **and nothing about where the file
 * came from**. The user's own path never leaves DASH's process: what the child
 * sees is a path inside a directory the runner made, under a name the runner
 * minted. So a child cannot learn that the price list came from
 * `C:\Users\henri\Desktop\kunder\`, and a log line that quotes an input path
 * quotes an opaque id.
 */
export interface AgentTaskMessage {
  protocol_version: number;
  type: "task";
  task_id: string;
  /** The task workspace root. `inputs/` is readable; `outbox/` is writable. */
  directory: string;
  inputs: Array<{
    input_id: string;
    role: string;
    /** For the agent's own logging and prompts. Not a path. */
    display_name: string;
    media_type: string;
    byte_size: number;
    sha256: string;
    /** Inside `directory`. The only file paths this agent is given. */
    path: string;
  }>;
}

export function encodeTask(message: Omit<AgentTaskMessage, "protocol_version" | "type">): string {
  const line: AgentTaskMessage = {
    protocol_version: AGENT_PROTOCOL_VERSION,
    type: "task",
    ...message,
  };
  return `${JSON.stringify(line)}\n`;
}

/* ---------------------------------------------------------------------- *
 * Agent → runner
 * ---------------------------------------------------------------------- */

/** The agent confirming it handled a command, successfully or not. */
export interface AgentAckMessage {
  type: "ack";
  command_id: string;
  ok: boolean;
  detail?: string;
}

/**
 * The agent publishing what it is currently doing.
 *
 * The body is the agent's *contribution* to an Agent DOM state document, not a
 * complete one: the agent does not know its own PID from the runner's point of
 * view, is not the authority on whether its process is alive, and must not be
 * able to claim it is `running` after it has crashed. `runner/state.ts` merges
 * this with facts the runner observed and is the only thing that produces a
 * document DASH will see.
 */
export interface AgentStateMessage {
  type: "state";
  state: Record<string, unknown>;
}

/**
 * One telemetry v1 candidate.
 *
 * `event` deliberately stays `unknown` here. This parser owns the NDJSON
 * envelope, not the telemetry contract: Electron main drains the runner and
 * hands every candidate to `ingestEvents`, the same validation boundary used by
 * `POST /api/events`. Keeping a malformed candidate recognizable is what lets
 * that boundary reject and record it without discarding valid neighbours.
 */
export interface AgentTelemetryMessage {
  type: "telemetry";
  event: unknown;
}

/**
 * One run artifact candidate (MAR-457).
 *
 * `artifact` stays `unknown` for exactly the reason `event` does one message up:
 * this parser owns the NDJSON envelope, not the artifact contract. Electron main
 * hands every candidate to `ingestArtifact`, which applies
 * `run-artifact.schema.json` — so a malformed artifact is rejected and recorded
 * at the same boundary a malformed event is, without taking its neighbours with
 * it.
 *
 * It rides this pipe rather than the frozen telemetry channel because an
 * artifact is a different population from an event: `listRuns` derives a run's
 * status from its events, and a document that could arrive as an event would be
 * a document that could change a run's status by existing.
 */
export interface AgentArtifactMessage {
  type: "artifact";
  artifact: unknown;
}

/**
 * One brokered-operation request (MAR-458, ADR 0002).
 *
 * `request` stays `unknown` for the same reason `event` and `artifact` do: this
 * parser owns the newline-delimited envelope and not the broker's contract. The
 * runner buffers the candidate and DASH applies `parseBrokerRequest`, which is
 * the boundary that knows what an operation is — and knows to refuse everything
 * it does not recognise.
 *
 * It rides this pipe because the pipe is already authenticated by construction:
 * only the process holding the other end can write to it, so the runner can bind
 * a request to the child that made it without the agent presenting a credential.
 * That binding is load-bearing — it is what stops one agent asking for another
 * agent's connection — and no credential in an agent environment could provide
 * it, because a credential in an agent environment is the thing this whole issue
 * exists to remove.
 */
export interface AgentBrokerRequestMessage {
  type: "broker_request";
  request: unknown;
}

/**
 * One controlled-browser request (MAR-628, ADR 0019).
 *
 * `request` stays `unknown` for `broker_request`'s reason: this parser owns the
 * newline-delimited envelope and not the browser's contract.
 * `lib/browser/protocol.ts` is the parser, on the DASH side where the operation
 * catalogue and the origin allowlist are.
 *
 * ## Why this is not a broker request with a different operation id
 *
 * Because a brokered request names a **connection**, and this names none. There
 * is no account behind a browser session, no scope, no token and no provider — so
 * riding the broker's envelope would have meant making `connection_id` optional,
 * and that is the one field binding a request to somebody's mailbox. A required
 * field made optional for a caller that does not need it is how the next caller
 * ends up not needing it either.
 *
 * The two also fail differently in a way the transport has to keep apart. A
 * brokered request DASH never answers is an agent that waited. A browser request
 * DASH never answers is that, **plus** a Chromium view attached to DASH's window
 * with a page loaded in it — so `runner/supervisor.ts` gives this its own, much
 * shallower bound rather than a share of the broker's.
 *
 * It rides this pipe on the same authenticated-by-construction argument: only
 * the process holding the other end can write to it, so the runner binds each
 * request to the child that wrote it, and an agent has no field in which to name
 * a browser session belonging to anybody else.
 */
export interface AgentBrowserRequestMessage {
  type: "browser_request";
  request: unknown;
}

/**
 * The agent saying it wrote a file into its outbox (MAR-434).
 *
 * Every field is checked here rather than left `unknown`, which is the opposite
 * of the three messages above and is the right call for the opposite reason.
 * Those three carry *documents* that a schema on the DASH side is authoritative
 * for, so parsing them here would put a second reader of an untrusted body in
 * the process that talks to every agent. This message carries no document at
 * all: three short strings, all of which the runner itself must act on, and the
 * one that becomes a filesystem operation is checked by `inspectComponent`
 * before anything opens it.
 *
 * Note the fields that are **not** here. No agent, no run id, no size, no
 * digest, no path — only a name inside a directory the runner made. Everything
 * else on the resulting receipt is observed by the runner. An agent cannot
 * publish under another agent's name because there is nowhere in this message to
 * write a name, which is a stronger statement than a check that it matches.
 */
export interface AgentArtifactFileMessage {
  type: "artifact_file";
  task_id: string;
  role: string;
  /** One path component in this agent's own outbox. Never a path. */
  name: string;
}

export type AgentMessage =
  | AgentAckMessage
  | AgentStateMessage
  | AgentTelemetryMessage
  | AgentArtifactMessage
  | AgentArtifactFileMessage
  | AgentBrokerRequestMessage
  | AgentBrowserRequestMessage;

/**
 * Parse one line of agent output.
 *
 * Returns null for anything that is not a well-formed protocol message,
 * including valid JSON of the wrong shape. The caller logs those; see the
 * module header for why that is not an error.
 *
 * Every field is checked rather than cast. The agent is a separate program that
 * may be any quality at all, and `as` would make its bugs into ours.
 */
export function parseAgentMessage(line: string): AgentMessage | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || !trimmed.startsWith("{")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (message["type"] === "ack") {
    const commandId = message["command_id"];
    if (typeof commandId !== "string" || commandId.length === 0) {
      return null;
    }
    if (typeof message["ok"] !== "boolean") {
      return null;
    }
    const detail = message["detail"];
    return {
      type: "ack",
      command_id: commandId,
      ok: message["ok"],
      detail: typeof detail === "string" ? detail : undefined,
    };
  }

  if (message["type"] === "state") {
    const state = message["state"];
    if (typeof state !== "object" || state === null || Array.isArray(state)) {
      return null;
    }
    return { type: "state", state: state as Record<string, unknown> };
  }

  if (message["type"] === "telemetry" && Object.hasOwn(message, "event")) {
    return { type: "telemetry", event: message["event"] };
  }

  if (message["type"] === "artifact" && Object.hasOwn(message, "artifact")) {
    return { type: "artifact", artifact: message["artifact"] };
  }

  if (message["type"] === "artifact_file") {
    const taskId = message["task_id"];
    const role = message["role"];
    const name = message["name"];
    if (
      typeof taskId !== "string" ||
      taskId.length === 0 ||
      typeof role !== "string" ||
      role.length === 0 ||
      typeof name !== "string" ||
      name.length === 0
    ) {
      // Null, not a partial message. An `artifact_file` missing its name is not
      // an artifact with a default name; it is a line the runner logs and
      // ignores, exactly as it does any other output it cannot read.
      return null;
    }
    return { type: "artifact_file", task_id: taskId, role, name };
  }

  if (message["type"] === "broker_request" && Object.hasOwn(message, "request")) {
    return { type: "broker_request", request: message["request"] };
  }

  if (message["type"] === "browser_request" && Object.hasOwn(message, "request")) {
    return { type: "browser_request", request: message["request"] };
  }

  return null;
}

/* ---------------------------------------------------------------------- *
 * Framing
 * ---------------------------------------------------------------------- */

/**
 * Split a byte stream into lines across chunk boundaries.
 *
 * A pipe delivers whatever the OS felt like delivering: one line may arrive in
 * three chunks and three lines in one. Naively splitting each chunk on newlines
 * silently corrupts any message unlucky enough to straddle a boundary, and the
 * corruption is load-dependent — which is the worst kind to debug, because it
 * appears only when an agent gets busy.
 *
 * The buffer is capped. An agent that writes a gigabyte with no newline in it
 * must not be able to exhaust the runner's memory, so the partial line is
 * dropped and the reader resynchronises at the next newline.
 */
export const MAX_LINE_BYTES = 262_144;

export interface LineReader {
  /** Feed a chunk; returns the complete lines it finished. */
  push(chunk: string): string[];
  /** True when the last push dropped an over-long partial line. */
  overflowed(): boolean;
}

export function createLineReader(maxBytes: number = MAX_LINE_BYTES): LineReader {
  let buffer = "";
  let overflow = false;

  return {
    push(chunk: string): string[] {
      overflow = false;
      buffer += chunk;

      const lines: string[] = [];
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        lines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }

      if (buffer.length > maxBytes) {
        // Drop the partial line, not the whole stream: the next newline starts
        // a message we can still read.
        buffer = "";
        overflow = true;
      }
      return lines;
    },
    overflowed(): boolean {
      return overflow;
    },
  };
}
