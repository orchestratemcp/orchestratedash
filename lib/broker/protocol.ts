/**
 * The shape of what an agent asks the broker for, and what it gets back
 * (MAR-458, ADR 0002).
 *
 * This is an **untrusted boundary in the strong sense**. The other side is a
 * child process DASH started but did not write: it may be any quality at all,
 * it may have been compromised by the very provider content it was reading, and
 * the whole point of the broker is that a hostile one on this side of the pipe
 * still cannot reach a token. So every field is checked rather than cast, and
 * the parser's default answer to anything it does not recognise is no.
 *
 * ## What is deliberately absent from a request
 *
 * No URL. No method. No headers. No scope. No account. No token, obviously —
 * but also nothing an agent could put in a request that would *name* one, so
 * there is no field to be careless about. An agent names an operation and a
 * connection, both of which DASH looks up in its own tables, and supplies typed
 * input the operation itself validates.
 *
 * `runner/protocol.ts` makes the same argument about what a command message
 * omits: "an agent that could read them would be an agent that could be written
 * to depend on them."
 *
 * ## Why the refusal codes are agent-visible and the detail is not
 *
 * An agent needs to tell "you may not do that" from "the provider is down",
 * because one is worth reporting to the user and one is worth retrying. So the
 * code crosses. What does not cross is anything derived from the failure itself:
 * no provider body, no status line, no vault error, no URL. An agent that could
 * read a provider's error text has a channel out of the boundary, and a provider
 * that can write into an agent's reasoning is the injection ADR 0002 invariant 7
 * is about.
 */

/** Bumped when the shapes below change incompatibly. Rides the agent protocol. */
export const BROKER_PROTOCOL_VERSION = 1;

/**
 * Why a brokered call did not happen, in the kinds that lead somewhere
 * different for the agent and for the person watching.
 */
export type BrokerRefusal =
  /** No such operation exists in DASH. Includes every operation never built. */
  | "unknown_operation"
  /** The operation exists and this connection's grant does not cover it. */
  | "not_granted"
  /** The agent named a connection its own manifest does not declare. */
  | "unknown_connection"
  /** DASH holds no credential for it. The user has not connected it. */
  | "not_connected"
  /**
   * The provider no longer honours the credential. Needs a human, not a retry.
   *
   * A withdrawn sign-in, or — since MAR-582 — a model provider key that has been
   * deleted or rotated in the user's own account. One code for both because the
   * agent's move is the same: stop, and report it to the person who can make a
   * new one. Which of the two it was is a question for the Connections page,
   * which has the connection in front of it.
   */
  | "revoked"
  /** Connected, but the user did not grant everything this operation needs. */
  | "permission_missing"
  /**
   * The operation spends the person's money, and no person asked for it
   * (MAR-545).
   *
   * Its own code rather than `not_granted`, because the two lead somewhere
   * completely different. `not_granted` means consent is missing and could be
   * given; this means the request arrived from a process rather than from
   * somebody at the keyboard, and no amount of connecting or ticking boxes
   * changes that. An agent that reports "you have not connected this" when the
   * truth is "I am not allowed to spend on my own" would send its user to a page
   * where there is nothing to do.
   *
   * See `BrokerOrigin` in `lib/broker/execute.ts` for the standing this enforces
   * and for the one thing that has to be built before it can be relaxed.
   */
  | "needs_a_person"
  /** The typed input failed the operation's own narrowing. */
  | "invalid_input"
  /** This request id has been seen before from this agent. */
  | "duplicate_request"
  /** The agent is asking faster than the broker will serve. */
  | "rate_limited"
  /** DASH could not reach the provider. Worth retrying later. */
  | "provider_unavailable"
  /** The provider answered, and said no for a reason DASH does not interpret. */
  | "provider_refused"
  /** The vault would not open, so DASH could not read the sign-in. */
  | "vault_unavailable"
  /** DASH itself refused for a reason that is DASH's bug, not the agent's. */
  | "broker_error";

/** A well-formed request from an agent. Every field has been checked. */
export interface BrokerRequest {
  /**
   * Unique per agent. The agent chooses it; DASH only requires that it not
   * repeat, which is what makes a replayed line a refusal rather than a second
   * execution.
   */
  request_id: string;
  /** A connection id from the agent's own manifest. Looked up, never trusted. */
  connection_id: string;
  /** An operation id. Resolved against the frozen allowlist, never dispatched. */
  operation: string;
  /** The operation's typed input. Narrowed by the operation, not here. */
  input: Record<string, unknown>;
}

export type BrokerResponse =
  | { protocol_version: number; type: "broker_response"; request_id: string; ok: true; result: Record<string, unknown> }
  | { protocol_version: number; type: "broker_response"; request_id: string; ok: false; refusal: BrokerRefusal };

/** The longest a request line may be, and the widest an id may be. */
export const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ID_LENGTH = 128;

/**
 * Ids DASH will echo back into its own audit table and its own routing map.
 *
 * Deliberately narrow: printable, no whitespace, no control characters, no
 * newline. A newline is the one that matters — these values are written into a
 * newline-delimited protocol in the other direction, and an id containing one
 * would let an agent frame a second message inside a field of the first.
 */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Parse one candidate from an agent, or return null.
 *
 * Null rather than a refusal for a *malformed* candidate, because a malformed
 * one has no request id to answer to: there is nowhere to send a refusal, and
 * inventing an id to answer would be answering a message nobody sent. The runner
 * logs it and drops it, which is what `parseAgentMessage` already does for
 * anything it does not recognise.
 *
 * Everything past the shape check is a *well-formed* request and gets a real
 * refusal, because there is now an id to address it to.
 */
export function parseBrokerRequest(candidate: unknown): BrokerRequest | null {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const value = candidate as Record<string, unknown>;

  const requestId = value["request_id"];
  const connectionId = value["connection_id"];
  const operation = value["operation"];
  if (
    typeof requestId !== "string" ||
    !SAFE_ID.test(requestId) ||
    requestId.length > MAX_REQUEST_ID_LENGTH ||
    typeof connectionId !== "string" ||
    !SAFE_ID.test(connectionId) ||
    connectionId.length > MAX_ID_LENGTH ||
    typeof operation !== "string" ||
    !SAFE_ID.test(operation) ||
    operation.length > MAX_ID_LENGTH
  ) {
    return null;
  }

  const input = value["input"];
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
    return null;
  }

  // Copied into a null-prototype object rather than passed through. The
  // operations read `input[field]`, and an input carrying `__proto__` or
  // `constructor` would otherwise resolve those to `Object.prototype` members —
  // which are objects, not strings, so the type checks catch it, but a null
  // prototype means the check is not the only thing standing between an agent
  // and a surprising lookup.
  const copied: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(input ?? {})) {
    copied[key] = entry;
  }

  return {
    request_id: requestId,
    connection_id: connectionId,
    operation,
    input: copied,
  };
}

export function refuse(requestId: string, refusal: BrokerRefusal): BrokerResponse {
  return {
    protocol_version: BROKER_PROTOCOL_VERSION,
    type: "broker_response",
    request_id: requestId,
    ok: false,
    refusal,
  };
}

export function fulfil(requestId: string, result: Record<string, unknown>): BrokerResponse {
  return {
    protocol_version: BROKER_PROTOCOL_VERSION,
    type: "broker_response",
    request_id: requestId,
    ok: true,
    result,
  };
}

/** One line, as written to a child's stdin. */
export function encodeBrokerResponse(response: BrokerResponse): string {
  return `${JSON.stringify(response)}\n`;
}
