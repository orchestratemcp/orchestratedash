/**
 * What an agent may ask the broker to do, and exactly what each request becomes
 * (MAR-458, ADR 0002).
 *
 * ADR 0002's third invariant is the whole of this file: *an agent invokes
 * allowlisted operations with typed inputs; it never chooses a provider URL, an
 * HTTP method, or a raw scope.* So an operation is not a passthrough with a
 * whitelist in front of it. It is a **named thing DASH knows how to do**, whose
 * request is constructed here from a small typed input, and whose response is
 * projected down to named fields before anything the agent can read is built.
 *
 * ## Why the operation set is smaller than the scope set
 *
 * `gmail.compose` can send mail. That is Google's design and DASH cannot narrow
 * it — a user who grants it has granted the ability to send, at Google. What
 * DASH controls is whether any *operation exists* that would use it, and in the
 * draft-only profile none does. ADR 0002 invariant 6 says this in as many words,
 * and this module is where it is true rather than promised: there is no send
 * operation, no draft-create operation, and `operationById` is a lookup over a
 * frozen list rather than a dispatch over anything an agent supplies.
 *
 * The consequence worth stating plainly: a connection whose credential grants
 * `gmail.compose` and nothing else is granted **no operations at all**. The
 * scope buys nothing, because nothing is built on it.
 *
 * ## Why inputs are validated here and not at the transport
 *
 * The transport's job is to establish that a line of JSON came from a particular
 * child process. It has no idea what a Gmail message id may look like. Putting
 * the narrowing here — beside the request the input is interpolated into — means
 * the pattern that stops `../../users/me/settings/forwardingAddresses` sits three
 * lines from the URL it would otherwise have escaped into, rather than in a
 * different file that someone later relaxes for an unrelated caller.
 *
 * ## Nothing here performs I/O
 *
 * `plan` returns a description of a request. `project` turns a parsed body into
 * the agent's answer. Neither touches the network, a token, or a vault. That is
 * what lets `tests/broker-threat-model.test.ts` attack this boundary with no
 * Electron, no runner and no Google account — the attacks worth writing are all
 * about what a URL becomes and what comes back, and both are pure functions of
 * an untrusted input.
 */

/** Read or write *at the provider*. Drives ordering and the words on a card. */
export type BrokerAccess = "read" | "write";

/**
 * A provider request, fully decided by DASH.
 *
 * The agent contributes values that were validated into `input`; it contributes
 * nothing to `method`, nothing to `origin`, and nothing to `path` beyond
 * segments this module encoded itself.
 */
export interface ProviderCall {
  method: "GET";
  /** Absolute, and re-checked against the profile's origin before it is used. */
  url: string;
  /**
   * How many bytes of response body the broker will read before giving up.
   *
   * Per operation because the two differ by an order of magnitude, and because
   * an unbounded read of a provider response is a way for a compromised or
   * misbehaving upstream to exhaust the DASH process.
   */
  max_response_bytes: number;
}

/** Why an input was refused. Returned rather than thrown so it can be audited. */
export type BrokerInputRefusal =
  | "input_not_an_object"
  | "missing_required_input"
  | "input_wrong_type"
  | "input_out_of_range"
  | "input_malformed";

export type PlanResult =
  | { ok: true; call: ProviderCall }
  | { ok: false; refusal: BrokerInputRefusal; field: string };

export interface BrokerOperation {
  /** Stable id an agent names, e.g. `gmail.search`. */
  id: string;
  /** The provider profile this belongs to, e.g. `google-gmail`. */
  connection_provider: string;
  /** One sentence, plain language, no identifiers. Rendered on the card. */
  label: string;
  access: BrokerAccess;
  /**
   * Every scope this operation needs.
   *
   * A grant covers the operation only when it covers *all* of these, which is
   * what makes a partial consent produce a smaller operation set rather than a
   * runtime failure halfway through a run. See `lib/broker/grant.ts`.
   */
  required_scopes: readonly string[];
  /** Turn a validated input into the one request DASH will make. */
  plan(origin: string, input: Record<string, unknown>): PlanResult;
  /** Turn a parsed provider body into the agent's answer, field by named field. */
  project(body: unknown): Record<string, unknown>;
}

const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * A Gmail id, as Gmail actually writes them.
 *
 * Hexadecimal in practice, but the pattern is deliberately the wider
 * URL-safe-base64 alphabet with a hard length cap rather than `[0-9a-f]+`: a
 * provider that widens its own id format must not turn into a DASH outage, and
 * nothing in the wider set can end a path segment or start a query. What it
 * excludes is the whole attack: `/`, `.`, `%`, `?`, `#`, `:` and whitespace are
 * all absent, so no value matching this can add a segment, escape upward, open a
 * query string, or turn a relative id into an absolute URL.
 */
const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Longest search an agent may hand Gmail. Generous for a query, useless as a payload. */
const MAX_QUERY_LENGTH = 512;

/** The most messages one search may name. */
const MAX_SEARCH_RESULTS = 25;

function requireString(
  input: Record<string, unknown>,
  field: string,
  options: { max: number; pattern?: RegExp },
): { ok: true; value: string } | { ok: false; refusal: BrokerInputRefusal; field: string } {
  const raw = input[field];
  if (raw === undefined || raw === null) {
    return { ok: false, refusal: "missing_required_input", field };
  }
  if (typeof raw !== "string") {
    // Not coerced. `String(value)` on an object produces "[object Object]",
    // which is a request DASH would then really make on an agent's behalf
    // because a type check was written as a convenience rather than a rule.
    return { ok: false, refusal: "input_wrong_type", field };
  }
  if (raw.length === 0 || raw.length > options.max) {
    return { ok: false, refusal: "input_out_of_range", field };
  }
  if (options.pattern !== undefined && !options.pattern.test(raw)) {
    return { ok: false, refusal: "input_malformed", field };
  }
  return { ok: true, value: raw };
}

function optionalCount(
  input: Record<string, unknown>,
  field: string,
  fallback: number,
  max: number,
): { ok: true; value: number } | { ok: false; refusal: BrokerInputRefusal; field: string } {
  const raw = input[field];
  if (raw === undefined || raw === null) {
    return { ok: true, value: fallback };
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, refusal: "input_wrong_type", field };
  }
  if (raw < 1 || raw > max) {
    // Clamping silently would be friendlier and wrong: an agent that asked for
    // a thousand messages and received twenty-five, with no refusal, has been
    // given a wrong answer to the question it asked.
    return { ok: false, refusal: "input_out_of_range", field };
  }
  return { ok: true, value: raw };
}

/** Read a string member of an untrusted parsed body, or undefined. */
function readString(source: unknown, key: string): string | undefined {
  if (typeof source !== "object" || source === null) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Gmail returns headers as a list of `{name, value}`. Names are case-insensitive
 * per RFC 5322, and Gmail is not consistent about which case it sends.
 */
function header(payload: unknown, name: string): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const headers = (payload as Record<string, unknown>)["headers"];
  if (!Array.isArray(headers)) {
    return undefined;
  }
  const wanted = name.toLowerCase();
  for (const entry of headers) {
    if (readString(entry, "name")?.toLowerCase() === wanted) {
      return readString(entry, "value");
    }
  }
  return undefined;
}

/**
 * The plain-text body of a message, walked from Gmail's MIME tree.
 *
 * Only `text/plain` is taken. Not because HTML is unreadable, but because the
 * body of a stranger's email is the most hostile string in this whole system
 * (ADR 0002 invariant 7: provider content is untrusted data), and the version of
 * it that cannot carry markup, script or a remote image is the version worth
 * putting in front of a person and an agent. Bounded, because a MIME tree is
 * attacker-shaped and a recursive walk over one should say how deep it will go.
 */
function plainTextBody(payload: unknown, depth = 0): string | undefined {
  if (depth > 8 || typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const node = payload as Record<string, unknown>;

  if (readString(node, "mimeType") === "text/plain") {
    const data = readString(node["body"], "data");
    if (data !== undefined) {
      try {
        return Buffer.from(data, "base64url").toString("utf8");
      } catch {
        return undefined;
      }
    }
  }

  const parts = node["parts"];
  if (Array.isArray(parts)) {
    for (const part of parts) {
      const found = plainTextBody(part, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/** Longest message body the broker will hand back. */
const MAX_BODY_CHARS = 20_000;

/**
 * Search the connected mailbox.
 *
 * Returns ids and thread ids and nothing else. A search that returned snippets
 * would be a way to read every message in a mailbox with one call while the
 * audit recorded one operation — so reading a message is a separate operation,
 * separately audited, one message at a time.
 */
const GMAIL_SEARCH: BrokerOperation = {
  id: "gmail.search",
  connection_provider: "google-gmail",
  label: "Find messages in your mailbox",
  access: "read",
  required_scopes: [GMAIL_READONLY],

  plan(origin, input) {
    const query = requireString(input, "query", { max: MAX_QUERY_LENGTH });
    if (!query.ok) {
      return query;
    }
    const limit = optionalCount(input, "max_results", 10, MAX_SEARCH_RESULTS);
    if (!limit.ok) {
      return limit;
    }

    // Built with `URL`/`URLSearchParams` rather than by concatenation. A
    // hand-built query string is where an unescaped `&` in a search term turns
    // one parameter into two, and the two this call has are the ones that decide
    // whose mailbox is read and how much of it.
    const url = new URL("/gmail/v1/users/me/messages", origin);
    url.searchParams.set("q", query.value);
    url.searchParams.set("maxResults", String(limit.value));

    return { ok: true, call: { method: "GET", url: url.toString(), max_response_bytes: 262_144 } };
  },

  project(body) {
    const messages = (body as { messages?: unknown } | null)?.messages;
    const list = Array.isArray(messages) ? messages : [];
    return {
      messages: list
        .map((entry) => ({
          message_id: readString(entry, "id"),
          thread_id: readString(entry, "threadId"),
        }))
        .filter((entry): entry is { message_id: string; thread_id: string | undefined } =>
          entry.message_id !== undefined,
        )
        .slice(0, MAX_SEARCH_RESULTS),
    };
  },
};

/**
 * Read one message the agent already found.
 *
 * `format=full` because a draft reply needs the body it is replying to. The
 * projection below is what keeps that from being a raw provider response with a
 * DASH label on it: five named headers, a snippet and the plain-text body, and
 * nothing else — no label ids, no raw MIME, no `historyId`, no attachment
 * handles that would name a second thing to fetch.
 */
const GMAIL_MESSAGE_READ: BrokerOperation = {
  id: "gmail.message.read",
  connection_provider: "google-gmail",
  label: "Read one message you asked it to look at",
  access: "read",
  required_scopes: [GMAIL_READONLY],

  plan(origin, input) {
    const id = requireString(input, "message_id", { max: 128, pattern: GMAIL_ID });
    if (!id.ok) {
      return id;
    }

    // `encodeURIComponent` as well as the pattern. The pattern already excludes
    // everything that could escape a segment, and the encoder is the guard that
    // survives someone widening the pattern later for a provider that allows a
    // dot — belt and braces on the one interpolation in this file.
    const url = new URL(
      `/gmail/v1/users/me/messages/${encodeURIComponent(id.value)}`,
      origin,
    );
    url.searchParams.set("format", "full");

    return { ok: true, call: { method: "GET", url: url.toString(), max_response_bytes: 2_097_152 } };
  },

  project(body) {
    const message = (body ?? {}) as Record<string, unknown>;
    const payload = message["payload"];
    const text = plainTextBody(payload);
    return {
      message_id: readString(message, "id"),
      thread_id: readString(message, "threadId"),
      from: header(payload, "From"),
      to: header(payload, "To"),
      subject: header(payload, "Subject"),
      date: header(payload, "Date"),
      snippet: readString(message, "snippet"),
      body_text: text === undefined ? undefined : text.slice(0, MAX_BODY_CHARS),
    };
  },
};

/**
 * Every operation the broker will ever perform, frozen.
 *
 * Adding one is a deliberate act with a card sentence, a scope list, a request
 * shape and a projection — which is the point. There is no path from a manifest,
 * a scope, a connection or an agent request to an entry that is not written here
 * by hand.
 */
const OPERATIONS: readonly BrokerOperation[] = Object.freeze([
  GMAIL_SEARCH,
  GMAIL_MESSAGE_READ,
]);

/**
 * The operation with this id, or null.
 *
 * Null for anything unknown, which includes every operation a future slice might
 * add and every operation an agent invents. `gmail.send`, `gmail.draft.create`
 * and `gmail.message.delete` all resolve to null here, today, whatever the
 * connected account's scopes happen to be.
 *
 * A `find` over a frozen array rather than an object lookup: a plain object is
 * reachable at `__proto__`, `constructor` and `toString` by an agent that names
 * them, and a lookup that returned `Object.prototype.toString` for the operation
 * id `toString` is the kind of thing that is funny until it is a bug report.
 */
export function operationById(id: unknown): BrokerOperation | null {
  if (typeof id !== "string" || id.length === 0) {
    return null;
  }
  return OPERATIONS.find((operation) => operation.id === id) ?? null;
}

/** Every operation DASH offers for one connection provider. */
export function operationsForProvider(connectionProvider: string): BrokerOperation[] {
  return OPERATIONS.filter((operation) => operation.connection_provider === connectionProvider);
}

/** Every operation, for the tests and the capability card. */
export function allOperations(): readonly BrokerOperation[] {
  return OPERATIONS;
}
