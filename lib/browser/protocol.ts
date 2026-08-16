/**
 * The shape of what an agent asks the controlled browser for, and what it gets
 * back (MAR-628, ADR 0019).
 *
 * A sibling of `lib/broker/protocol.ts` and deliberately not a reuse of it. The
 * two look similar and describe different things: a broker request names a
 * **connection** DASH holds a credential for, and a browser request names
 * nothing of the sort — there is no account, no scope, no token and no provider
 * behind it. Widening `BrokerRequest` with an optional connection would have
 * made the one field that binds a request to somebody's mailbox optional, which
 * is the kind of convenience `lib/broker/operations.ts` spends a section
 * refusing.
 *
 * Everything that file says about the boundary applies here unchanged: the
 * other side is a child process DASH started but did not write, it may have
 * been compromised by the very page it was reading, and every field is checked
 * rather than cast.
 *
 * ## What is deliberately absent from a request
 *
 * No selector. No script. No key. No coordinate. No frame. No CDP method and no
 * CDP parameters. No session id either — an agent does not get to name which
 * browser session it is talking to, because the answer is "the one DASH opened
 * for the run this process is in", and a field carrying it would be a field an
 * agent could point at somebody else's.
 *
 * ## Why the refusal codes are agent-visible and the detail is not
 *
 * The broker's argument, applied to a browser. An agent needs to tell "you may
 * not go there" from "that page would not load", because one is worth reporting
 * to the person and one is worth trying a different source. So the code
 * crosses. What does not cross is anything derived from the failure itself: no
 * HTTP status, no Chromium error string, no redirect chain and no page body. A
 * page that can write into an agent's reasoning through an error message is the
 * injection ADR 0002 invariant 7 is about, arriving by the back door.
 */

/** Bumped when the shapes below change incompatibly. Rides the agent protocol. */
export const BROWSER_PROTOCOL_VERSION = 1;

/**
 * Why a browser request did not happen, in the kinds that lead somewhere
 * different for the agent and for the person watching.
 */
export type BrowserRefusal =
  /** No such operation exists in DASH. Includes every operation never built. */
  | "unknown_operation"
  /**
   * This agent's manifest declares no `browser` block, so there is no origin
   * list and nothing to open. Its own code because the recovery is an edit to
   * the agent, not an action in DASH.
   */
  | "browser_not_declared"
  /**
   * The address is outside the origins declared for this run.
   *
   * The one refusal a well-behaved agent is most likely to meet, and the one
   * whose sentence matters most: the agent asked for somewhere real and DASH
   * declined to take its browser there. It is not a fault and an agent should
   * report it as a limit rather than as an error.
   */
  | "origin_not_allowed"
  /**
   * A person pressed Stop, or the run ended. The session is gone and later
   * commands are refused for as long as this run lasts.
   *
   * ADR 0019 requires the word to mean exactly this much: it stops **future
   * controller commands** and destroys the session. It does not recall a request
   * the browser already sent.
   */
  | "revoked"
  /** No browser session is open, and this operation does not open one. */
  | "no_session"
  /** The typed input failed the operation's own narrowing. */
  | "invalid_input"
  /** This request id has been seen before from this agent. */
  | "duplicate_request"
  /** The agent is asking faster than the controller will serve. */
  | "rate_limited"
  /** The page did not load, or did not finish. Worth trying something else. */
  | "page_unavailable"
  /** DASH itself refused for a reason that is DASH's bug, not the agent's. */
  | "browser_error";

/** A well-formed request from an agent. Every field has been checked. */
export interface BrowserRequest {
  /**
   * Unique per agent. The agent chooses it; DASH only requires that it not
   * repeat, which is what makes a replayed line a refusal rather than a second
   * navigation.
   */
  request_id: string;
  /** An operation id. Resolved against the frozen catalogue, never dispatched. */
  operation: string;
  /** The operation's typed input. Narrowed by the operation, not here. */
  input: Record<string, unknown>;
}

export type BrowserResponse =
  | {
      protocol_version: number;
      type: "browser_response";
      request_id: string;
      ok: true;
      result: Record<string, unknown>;
    }
  | {
      protocol_version: number;
      type: "browser_response";
      request_id: string;
      ok: false;
      refusal: BrowserRefusal;
    };

export const MAX_BROWSER_REQUEST_ID_LENGTH = 128;

/**
 * Ids DASH will echo back into its own trail table.
 *
 * `lib/broker/protocol.ts`'s alphabet, for its reason: these values are written
 * into a newline-delimited protocol in the other direction, and an id containing
 * a newline would let an agent frame a second message inside a field of the
 * first.
 */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Parse one candidate from an agent, or return null.
 *
 * Null rather than a refusal for a *malformed* candidate, because a malformed
 * one has no request id to answer to. Everything past the shape check is a
 * well-formed request and gets a real refusal, because there is now an id to
 * address it to.
 */
export function parseBrowserRequest(candidate: unknown): BrowserRequest | null {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return null;
  }
  const value = candidate as Record<string, unknown>;

  const requestId = value["request_id"];
  const operation = value["operation"];
  if (
    typeof requestId !== "string" ||
    !SAFE_ID.test(requestId) ||
    requestId.length > MAX_BROWSER_REQUEST_ID_LENGTH ||
    typeof operation !== "string" ||
    !SAFE_ID.test(operation)
  ) {
    return null;
  }

  const input = value["input"];
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
    return null;
  }

  // Copied into a null-prototype object rather than passed through, for
  // `parseBrokerRequest`'s reason: the operations read `input[field]`, and an
  // input carrying `__proto__` would otherwise resolve to an `Object.prototype`
  // member rather than to nothing.
  const copied: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, entry] of Object.entries(input ?? {})) {
    copied[key] = entry;
  }

  return { request_id: requestId, operation, input: copied };
}

export function refuseBrowser(requestId: string, refusal: BrowserRefusal): BrowserResponse {
  return {
    protocol_version: BROWSER_PROTOCOL_VERSION,
    type: "browser_response",
    request_id: requestId,
    ok: false,
    refusal,
  };
}

export function fulfilBrowser(
  requestId: string,
  result: Record<string, unknown>,
): BrowserResponse {
  return {
    protocol_version: BROWSER_PROTOCOL_VERSION,
    type: "browser_response",
    request_id: requestId,
    ok: true,
    result,
  };
}

/** One line, as written to a child's stdin. */
export function encodeBrowserResponse(response: BrowserResponse): string {
  return `${JSON.stringify(response)}\n`;
}
