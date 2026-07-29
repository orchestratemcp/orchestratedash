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

export type AgentMessage = AgentAckMessage | AgentStateMessage | AgentTelemetryMessage;

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
