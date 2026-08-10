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
 * draft-only profile the only one that does is `gmail.draft.create`. ADR 0002
 * invariant 6 says this in as many words, and this module is where it is true
 * rather than promised: there is no send operation, and `operationById` is a
 * lookup over a frozen list rather than a dispatch over anything an agent
 * supplies.
 *
 * ## What changed when a write appeared, and what had to replace it (MAR-469)
 *
 * Until stage 2 the sentence above was carried by an absence: nothing was built
 * on `gmail.compose`, so a credential granting it was granted **no operations at
 * all**, and "no send exists" needed no check because no code could reach the
 * scope. That argument is now spent. A write operation exists, it runs on the
 * scope that can send, and every guard between the two is a real check that can
 * have a bug.
 *
 * So the guarantee is rebuilt structurally, in the shape ADR 0005 used for
 * `broker_lapses`: **the field an escape would have to fill is not there.** A
 * write operation does not have a `plan`. It cannot return a URL, a path, a
 * method or a header, because `WriteOperation` declares no member that could
 * carry one — it declares a `path` which is a frozen literal on the operation
 * object, and a `compose` that returns a JSON body and nothing else. A bug
 * inside `compose`, however bad, cannot produce a request to
 * `/gmail/v1/users/me/messages/send`, because `compose` does not get to say
 * where the request goes. Reaching a send endpoint means typing one into
 * `WRITE_PATHS` below, which `tests/broker-threat-model.test.ts` pins by value.
 *
 * The second half is the body. DASH builds the RFC 5322 message itself from
 * typed fields; there is no `raw` input and no header an agent can name. See
 * `composeRfc822`.
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

import { aiModelsUrl, aiProviders, type AiProviderProfile } from "../ai/providers";

/** Read or write *at the provider*. Drives ordering and the words on a card. */
export type BrokerAccess = "read" | "write";

/**
 * A provider request, fully decided by DASH.
 *
 * The agent contributes values that were validated into `input`; it contributes
 * nothing to `method`, nothing to `origin`, and nothing to `path` beyond
 * segments this module encoded itself.
 *
 * A union rather than one shape with an optional body, and `method` stays an
 * enum of two rather than becoming a string. The difference matters at the one
 * call site in `lib/broker/execute.ts`: a `GET` carries no body and a `POST`
 * always carries one, so the two cannot be confused into a mutating request
 * with nothing in it or a read with a payload attached.
 */
export type ProviderCall =
  | {
      method: "GET";
      /** Absolute, and re-checked against the profile's origin before it is used. */
      url: string;
    }
  | {
      method: "POST";
      /**
       * Absolute, and built by `planCall` from the operation's own frozen
       * `path` — never from anything `compose` returned, because `compose`
       * cannot return one.
       */
      url: string;
      /** The JSON body DASH will send. Every field of it was built by DASH. */
      json: Record<string, unknown>;
    };

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

/** What a `compose` may return. Note what it may not: a URL, a path, a method. */
export type ComposeResult =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; refusal: BrokerInputRefusal; field: string };

interface OperationBase {
  /** Stable id an agent names, e.g. `gmail.search`. */
  id: string;
  /** The provider profile this belongs to, e.g. `google-gmail`. */
  connection_provider: string;
  /** One sentence, plain language, no identifiers. Rendered on the card. */
  label: string;
  /**
   * Every scope this operation needs.
   *
   * A grant covers the operation only when it covers *all* of these, which is
   * what makes a partial consent produce a smaller operation set rather than a
   * runtime failure halfway through a run. See `lib/broker/grant.ts`.
   */
  required_scopes: readonly string[];
  /**
   * How many bytes of response body the broker will read before giving up.
   *
   * Per operation because they differ by an order of magnitude, and because an
   * unbounded read of a provider response is a way for a compromised or
   * misbehaving upstream to exhaust the DASH process. On the operation rather
   * than on the planned call, so it is a property of the thing being done and
   * not something a `plan` gets to decide per request.
   */
  max_response_bytes: number;
  /** Turn a parsed provider body into the agent's answer, field by named field. */
  project(body: unknown): Record<string, unknown>;
}

/**
 * An operation that only reads.
 *
 * It builds its own URL, because a read's path carries an id the agent named
 * and there is nothing a bad path could do that reading the wrong message would
 * not already be. `plan` is still the only thing that touches it, and the
 * origin is re-checked afterwards.
 */
export interface ReadOperation extends OperationBase {
  access: "read";
  plan(origin: string, input: Record<string, unknown>): PlanResult;
}

/**
 * An operation that changes something in somebody's account (MAR-469).
 *
 * Three fields exist because a write cannot ship without answering three
 * questions, and a type is a better place to ask them than a review checklist.
 *
 * `path` is the whole of the no-send guarantee. It is a literal on the
 * operation object; `compose` never sees it and cannot return one. So the set
 * of paths DASH will ever POST to is the set written out in `WRITE_PATHS`, and
 * it is knowable by reading one array rather than by auditing every code path
 * that might build a URL.
 *
 * `consequence` and `wider_permission` are the two sentences a person needs
 * before approving a write, and they are required rather than optional because
 * the failure this file is guarding against is a capability list that reads like
 * a read. "Save a reply as a draft" tells a user almost nothing about what will
 * be sitting in their mailbox afterwards.
 */
export interface WriteOperation extends OperationBase {
  access: "write";
  /**
   * The one path this operation will ever POST to. A constant, never computed.
   * Must appear in `WRITE_PATHS`, which the tests pin by value.
   */
  path: string;
  /**
   * What a person will be able to see and do because this ran. Plain language,
   * no identifiers, and honest about who can undo it.
   */
  consequence: string;
  /**
   * How the provider permission behind this is wider than the action, or null
   * when it is not.
   *
   * Required-but-nullable rather than optional, so adding a write operation
   * means answering the question. For Gmail the answer is never null and it is
   * the single most important line on the card: `gmail.compose` is the narrowest
   * scope Google offers that can create a draft, and it can also send. There is
   * no draft-only Gmail scope to ask for instead.
   */
  wider_permission: string | null;
  /**
   * Turn a validated input into the JSON body DASH will send.
   *
   * Takes no origin and returns no URL. That is the point — see the note at the
   * top of this file.
   */
  compose(input: Record<string, unknown>): ComposeResult;
}

export type BrokerOperation = ReadOperation | WriteOperation;

const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * The scope a provider-side draft needs, and the reason this file has a section
 * about honesty in it (MAR-469).
 *
 * Google offers no draft-only Gmail scope. `gmail.compose` is the narrowest one
 * that can create a draft and it can also send; the alternatives are wider
 * still. So DASH cannot ask for a permission that is incapable of sending, and
 * a card claiming the user granted "drafts only" would be false about their
 * Google account.
 *
 * What DASH can do is hold the token and build nothing that sends — which is
 * what `WRITE_PATHS` makes checkable rather than promised.
 */
const GMAIL_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

/**
 * Every path DASH will ever send a mutating request to (MAR-469).
 *
 * Read this array as the answer to "what can this application do to my
 * account?". It is the complete answer: `planCall` builds a POST's URL from the
 * operation's own `path` and from nothing else, and every `path` is checked
 * against this list at module load, so a write operation that named a path
 * absent from here would fail to build rather than fail closed at runtime.
 *
 * Gmail's send endpoints are `/gmail/v1/users/me/messages/send` and
 * `/gmail/v1/users/me/drafts/send`. Neither is here, and adding either is a
 * one-line diff in a file whose test asserts this array by value — which is the
 * conversation ADR 0005 wanted its column-list test to force, pointed at the
 * one irreversible thing this product can do.
 */
const WRITE_PATHS: readonly string[] = Object.freeze(["/gmail/v1/users/me/drafts"]);

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

/* ---------------------------------------------------------------------- *
 * Addresses — one allowlist, read side and write side (MAR-469, MAR-523)
 * ---------------------------------------------------------------------- */

/**
 * A single address, conservatively.
 *
 * Narrower than RFC 5322 permits, deliberately. The grammar allows quoted local
 * parts containing almost anything, and a header builder that accepts the whole
 * grammar is a header builder whose safety depends on getting the quoting right.
 * This accepts the addresses people actually have and rejects the rest, which
 * costs a small number of real users an operation and costs an attacker the
 * entire class.
 *
 * Both halves are allowlists rather than exclusions, which is what makes the
 * safety argument short: CR, LF and NUL are simply not in either character set,
 * so a value passing this cannot end the `To:` line and start a `Bcc:` one. `,`
 * and `;` are absent too, so it cannot become two recipients, and `<`, `>` and
 * `"` are absent, so it cannot carry a display name with structure in it.
 *
 * ## Why it moved up here (MAR-523)
 *
 * It used to live beside `composeRfc822`, which read as though it were a rule
 * about writing headers. It is not: it is **the set of addresses this module is
 * willing to name at all**, and the projection below is now held to it too. That
 * is what makes `from_address` safe to hand straight to `to` — the projection
 * cannot emit a value the composer would refuse, because both ask this one
 * question.
 *
 * The first attended run against real Google (2026-08-07) failed on exactly the
 * gap this closes. Gmail's `From:` is `Display Name <addr@host>`; the reply path
 * handed that whole header value to `to`; this pattern refused it, correctly,
 * and the refusal read as DASH breaking its own draft. The validator was never
 * the bug and is not loosened by a character.
 */
const ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * The bare addr-spec inside an RFC 5322 mailbox header, or undefined (MAR-523).
 *
 * DASH parses this **once, here**, rather than leaving every agent to do it. An
 * agent that had to extract an address from a `From:` header would be an agent
 * writing an RFC 5322 parser in an untrusted process and handing the result to a
 * write operation — and the version of that which is one regex short is the
 * version that puts a display name where a recipient goes.
 *
 * The rules are short on purpose:
 *
 * - **No angle brackets** — the whole trimmed value must be an address itself.
 *   A bare `a@b.example` is the common case and passes through unchanged.
 * - **Exactly one `<`** — the text between it and the next `>` is the address.
 *   Any display name, quoted or encoded-word or otherwise, is discarded rather
 *   than interpreted, because nothing downstream needs it. The raw header is
 *   still projected beside this as `from`, for anything that wants to show a
 *   human what the sender called themselves.
 * - **More than one `<`** — undefined. `From:` may legally carry several
 *   mailboxes, and picking one of them would be DASH quietly choosing who a
 *   reply goes to. Better to have no recipient than the wrong one.
 *
 * Whatever comes out is then tested against `ADDRESS`, so the answer is either a
 * value `gmail.draft.create` will accept or nothing at all. There is no third
 * outcome, and that is the property `tests/broker-write.test.ts` pins.
 */
function addressFromHeader(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const opens = value.split("<").length - 1;
  let candidate: string;
  if (opens === 0) {
    candidate = value.trim();
  } else if (opens === 1) {
    const start = value.indexOf("<") + 1;
    const end = value.indexOf(">", start);
    if (end === -1) {
      return undefined;
    }
    candidate = value.slice(start, end).trim();
  } else {
    return undefined;
  }
  return ADDRESS.test(candidate) ? candidate : undefined;
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
const GMAIL_SEARCH: ReadOperation = {
  id: "gmail.search",
  connection_provider: "google-gmail",
  label: "Find messages in your mailbox",
  access: "read",
  required_scopes: [GMAIL_READONLY],
  max_response_bytes: 262_144,

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

    return { ok: true, call: { method: "GET", url: url.toString() } };
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
 *
 * `from_address` is the sixth field and the only derived one (MAR-523). `from`
 * is what the provider sent, for showing a person; `from_address` is the bare
 * addr-spec parsed out of it, for handing to `to`. They are separate fields
 * rather than one cleaned-up value because the display name is real information
 * a reply flow may want to render, and because a projection that silently
 * rewrote a provider header would be lying about what arrived.
 */
const GMAIL_MESSAGE_READ: ReadOperation = {
  id: "gmail.message.read",
  connection_provider: "google-gmail",
  label: "Read one message you asked it to look at",
  access: "read",
  required_scopes: [GMAIL_READONLY],
  max_response_bytes: 2_097_152,

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

    return { ok: true, call: { method: "GET", url: url.toString() } };
  },

  project(body) {
    const message = (body ?? {}) as Record<string, unknown>;
    const payload = message["payload"];
    const text = plainTextBody(payload);
    const from = header(payload, "From");
    return {
      message_id: readString(message, "id"),
      thread_id: readString(message, "threadId"),
      from,
      from_address: addressFromHeader(from),
      to: header(payload, "To"),
      subject: header(payload, "Subject"),
      date: header(payload, "Date"),
      snippet: readString(message, "snippet"),
      body_text: text === undefined ? undefined : text.slice(0, MAX_BODY_CHARS),
    };
  },
};

/* ---------------------------------------------------------------------- *
 * Writing a message (MAR-469)
 * ---------------------------------------------------------------------- */

/*
 * `ADDRESS` used to be defined here. It is above, beside `addressFromHeader`,
 * because it governs both what this composes and what the projection is willing
 * to name — see the note there (MAR-523).
 */

/**
 * Anything that must never reach a header line.
 *
 * C0 controls and DEL. CR and LF are the ones that matter and the rest are here
 * because a header value has no legitimate use for them either, and a check
 * listing exactly two characters invites the question of why not the others.
 */
// eslint-disable-next-line no-control-regex
const HEADER_CONTROL = /[\u0000-\u001F\u007F]/;

/** The longest subject DASH will build a header from. */
const MAX_SUBJECT_LENGTH = 300;

/** The longest body. Matches `contracts/run-artifact.schema.json`'s draft body. */
const MAX_DRAFT_BODY_CHARS = 20_000;

/**
 * A header value as RFC 2047 encoded words, when it is not plain ASCII.
 *
 * Plain printable ASCII is emitted as-is, because an encoded word where none is
 * needed makes every subject unreadable in the raw message for no gain. Anything
 * else is base64 encoded words folded across continuation lines: each word's
 * payload is at most 45 bytes so the whole `=?UTF-8?B?…?=` stays inside RFC
 * 2047's 75-character limit, and the split is taken on a code point boundary so
 * a multi-byte character is never cut in half.
 *
 * The value has already been refused if it contains a control character, so the
 * ASCII branch cannot emit one and the folding cannot be escaped.
 */
function encodeHeaderValue(value: string): string {
  if (/^[ -~]*$/.test(value)) {
    return value;
  }

  const words: string[] = [];
  let chunk: string[] = [];
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 45 && chunk.length > 0) {
      words.push(Buffer.from(chunk.join(""), "utf8").toString("base64"));
      chunk = [];
      bytes = 0;
    }
    chunk.push(character);
    bytes += size;
  }
  if (chunk.length > 0) {
    words.push(Buffer.from(chunk.join(""), "utf8").toString("base64"));
  }

  // Folded with CRLF + space, which is the only place this builder emits a CRLF
  // that is not a header separator — and it emits it around base64, which
  // cannot contain one.
  return words.map((word) => `=?UTF-8?B?${word}?=`).join("\r\n ");
}

/**
 * The message DASH will ask the provider to store, as RFC 5322 bytes.
 *
 * ## Why DASH builds this and the agent does not
 *
 * Gmail's `drafts.create` takes `message.raw`: an entire opaque message. Passing
 * an agent's bytes through would make every guard in this file decorative — the
 * agent would choose the recipients, the headers, and anything else a message
 * can carry. So there is no `raw` input. The agent supplies four typed values
 * and DASH writes the message, which is the same argument `plan` makes about a
 * URL, applied to the one operation that has a body.
 *
 * ## What is deliberately absent
 *
 * **No `From`.** Gmail fills it from the account whose token DASH presented, so
 * an agent cannot compose a draft that appears to come from somebody else — and
 * DASH does not have to check that it did not, because it never had the chance.
 *
 * **No `Bcc`, no `Cc`, no `Reply-To`.** One recipient, named in one field. A
 * draft with a blind copy on it is the shape of an exfiltration, and a header
 * DASH does not write is a header nobody has to review.
 *
 * The body is base64 with `Content-Transfer-Encoding: base64`, which means the
 * one field with no character restrictions cannot contain a line that looks like
 * a header, a boundary, or anything else structural.
 */
function composeRfc822(fields: {
  to: string;
  subject: string;
  body: string;
}): string {
  const headers = [
    `To: ${fields.to}`,
    `Subject: ${encodeHeaderValue(fields.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  // 76-character lines, as RFC 2045 requires of base64 bodies.
  const body = (Buffer.from(fields.body, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join(
    "\r\n",
  );
  return `${headers.join("\r\n")}\r\n\r\n${body}\r\n`;
}

/**
 * Save a reply in the user's own Drafts folder.
 *
 * The first operation in DASH that changes anything in somebody's account, and
 * the reason ADR 0002 amendment 2 exists. What it creates is visible in Gmail
 * and can be sent by one human click; what it cannot do is take that click.
 *
 * `required_scopes` is `gmail.compose` alone — deliberately not compose *and*
 * readonly. An agent that only drafts should not have to be able to read the
 * mailbox to do it, and the intersection in `lib/broker/grant.ts` means a
 * manifest declaring only compose now gets exactly one operation: this one.
 * That is a genuinely narrower agent than anything stage 1 could describe.
 */
const GMAIL_DRAFT_CREATE: WriteOperation = {
  id: "gmail.draft.create",
  connection_provider: "google-gmail",
  label: "Save a reply in your Gmail drafts",
  access: "write",
  required_scopes: [GMAIL_COMPOSE],
  path: "/gmail/v1/users/me/drafts",
  max_response_bytes: 65_536,

  consequence:
    "The reply appears in your Drafts folder in Gmail, addressed and written, " +
    "and stays there until you send it or delete it yourself. DASH has no action that sends mail.",
  wider_permission:
    "Google has no drafts-only permission to ask for: the one this needs also allows sending. " +
    "DASH builds nothing on that half of it, so no agent can ask DASH to send — but the " +
    "permission itself is wider than the action, and you can withdraw it in your Google account.",

  compose(input) {
    // One bare address, held to the same `ADDRESS` the projection is held to.
    // A reply flow gets its value from `gmail.message.read`'s `from_address`,
    // never from `from` — the raw header carries a display name and is refused
    // here, which is the refusal MAR-523 was filed for and the refusal that
    // stays. Loosening this to accept `Display Name <addr>` would put the whole
    // mailbox grammar back inside a header DASH writes.
    const to = requireString(input, "to", { max: 320, pattern: ADDRESS });
    if (!to.ok) {
      return to;
    }
    const subject = requireString(input, "subject", { max: MAX_SUBJECT_LENGTH });
    if (!subject.ok) {
      return subject;
    }
    if (HEADER_CONTROL.test(subject.value)) {
      // The header-injection refusal. A subject carrying CRLF would otherwise
      // end the Subject line and let the rest of the value become headers of
      // DASH's own message — `Bcc:` being the one worth the trouble.
      return { ok: false, refusal: "input_malformed", field: "subject" };
    }
    const body = requireString(input, "body_text", { max: MAX_DRAFT_BODY_CHARS });
    if (!body.ok) {
      return body;
    }

    const message: Record<string, unknown> = {
      raw: Buffer.from(
        composeRfc822({ to: to.value, subject: subject.value, body: body.value }),
        "utf8",
      ).toString("base64url"),
    };

    // Optional, and the only agent-supplied value that reaches the provider
    // outside the message DASH wrote. Gmail resolves it *within the
    // authenticated account*, so a thread id belonging to somebody else's
    // mailbox does not reach it — it is a 404 for this account, and the draft
    // is refused rather than filed against a stranger's conversation.
    const threadId = input["thread_id"];
    if (threadId !== undefined && threadId !== null) {
      if (typeof threadId !== "string") {
        return { ok: false, refusal: "input_wrong_type", field: "thread_id" };
      }
      if (!GMAIL_ID.test(threadId)) {
        return { ok: false, refusal: "input_malformed", field: "thread_id" };
      }
      message["threadId"] = threadId;
    }

    return { ok: true, json: { message } };
  },

  project(body) {
    const draft = (body ?? {}) as Record<string, unknown>;
    const message = draft["message"];
    return {
      draft_id: readString(draft, "id"),
      message_id: readString(message, "id"),
      thread_id: readString(message, "threadId"),
    };
  },
};

/* ---------------------------------------------------------------------- *
 * Model providers (MAR-582)
 * ---------------------------------------------------------------------- */

/**
 * A model id, conservatively.
 *
 * Provider content, and therefore untrusted under ADR 0002 invariant 7. The
 * shape here is the one the three registries actually use — a bare name like
 * `gpt-4.1-mini`, or one vendor segment and one model segment as in
 * `anthropic/claude-opus-4` and `meta-llama/llama-3.3-70b:free` — expressed as
 * an allowlist rather than an exclusion, so the safety argument is short: no
 * whitespace, no control characters, no quotes, no angle brackets and no
 * backslash can appear in a value that passes.
 *
 * **The structure matters as much as the character set**, which a flat
 * character class got wrong on its first draft: `[A-Za-z0-9._:/-]+` accepts
 * `../../etc/passwd`, and a test written to watch for exactly that caught it. No
 * operation interpolates a model id into a URL today — there is no completion
 * call — so it was not yet an escape; it was a value that would become one the
 * moment somebody built the operation this slice deliberately did not. Requiring
 * each segment to begin with an alphanumeric, allowing at most one separator,
 * and refusing a run of dots outright means a traversal cannot be spelled at
 * all rather than being harmless for now.
 */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(\/[A-Za-z0-9][A-Za-z0-9._:-]{0,63})?$/;

/**
 * A model id DASH is willing to name, structure and characters both.
 *
 * Exported since MAR-583, which gave a *person* a model id to choose and DASH a
 * row to write it into. One predicate for both directions is the point: the ids
 * offered to an agent through the brokered list and the ids stored as somebody's
 * choice come from the same catalogue, and two spellings of "acceptable" would
 * eventually disagree about one of them.
 */
export function isModelId(id: string): boolean {
  return MODEL_ID.test(id) && !id.includes("..");
}

/** The most model ids one answer will carry across the boundary. */
const MAX_MODELS = 200;

/**
 * Read the list of models a key can reach.
 *
 * **The only thing DASH has built on a model key, and stage 1 of exactly the
 * shape ADR 0002's rollout uses.** There is no completion operation, no
 * streaming, no embedding and no image call — so an agent holding this
 * connection can find out what it *could* use and cannot spend a penny of the
 * account behind it. That is a narrower agent than any raw key produces, and it
 * is also, plainly, not yet a useful one: a completion operation is the next
 * slice, and it needs a cost story and a per-run budget this one deliberately
 * does not invent.
 *
 * All three providers answer this question the same way — an object with a
 * `data` array of objects carrying an `id` — which is why one projection serves
 * three profiles rather than three near-identical ones.
 *
 * Ids only. Not descriptions, not context lengths, not prices: a projection that
 * carried a provider's marketing copy into an agent's reasoning is precisely the
 * injection surface invariant 7 is about, and an agent that needs a price is an
 * agent asking a question DASH has not built an operation for.
 */
function modelsListOperation(provider: AiProviderProfile): ReadOperation {
  return {
    id: `${provider.id}.models.list`,
    connection_provider: provider.connection_provider,
    label: `See which models your ${provider.label} key can use`,
    access: "read",
    // Empty, and not a placeholder. A key carries no scopes, so step 3 of the
    // three-party intersection has nothing to say — see `describeKeyNarrowing`,
    // which is where a card admits that rather than implying otherwise.
    required_scopes: [],
    max_response_bytes: 1_048_576,

    plan(origin) {
      // Built from the profile's own frozen path and re-rooted on the origin the
      // broker resolved, so a request cannot reach a second provider's registry
      // even if the two profiles were ever confused. `aiModelsUrl` is the same
      // construction DASH's own liveness probe uses; one URL, built once.
      const url = new URL(new URL(aiModelsUrl(provider)).pathname, origin);
      return { ok: true, call: { method: "GET", url: url.toString() } };
    },

    project(body) {
      const data = (body as { data?: unknown } | null)?.data;
      const list = Array.isArray(data) ? data : [];
      return {
        models: list
          .map((entry) => readString(entry, "id"))
          .filter((id): id is string => id !== undefined && isModelId(id))
          .slice(0, MAX_MODELS),
      };
    },
  };
}

const MODEL_OPERATIONS: readonly ReadOperation[] = Object.freeze(
  aiProviders().map(modelsListOperation),
);

/**
 * Every operation the broker will ever perform, frozen.
 *
 * Adding one is a deliberate act with a card sentence, a scope list, a request
 * shape and a projection — which is the point. There is no path from a manifest,
 * a scope, a connection or an agent request to an entry that is not written here
 * by hand.
 *
 * The model-provider entries are generated from `lib/ai/providers.ts` rather
 * than written out three times, and that is not a loophole: the generator takes
 * a profile from a closed, by-value list and produces one read whose path,
 * origin and projection are all fixed here. Widening the set still means editing
 * a reviewed array — it is just a different array (MAR-582).
 */
const OPERATIONS: readonly BrokerOperation[] = Object.freeze([
  GMAIL_SEARCH,
  GMAIL_MESSAGE_READ,
  GMAIL_DRAFT_CREATE,
  ...MODEL_OPERATIONS,
]);

/**
 * Every write operation's path really is one this file declared (MAR-469).
 *
 * At module load, not at request time. A write operation whose path is not in
 * `WRITE_PATHS`, or is not rooted at `/`, is a programming mistake that must not
 * survive to become a runtime refusal somebody reads as an agent misbehaving —
 * so it takes the module down on import, where the stack names the operation.
 *
 * The relative-path check is the one that would matter: `new URL("//evil.example/x", origin)`
 * resolves to a different host entirely, and this is the line that means
 * `planCall` cannot be handed one.
 */
for (const operation of OPERATIONS) {
  if (operation.access !== "write") {
    continue;
  }
  if (!operation.path.startsWith("/") || operation.path.startsWith("//")) {
    throw new Error(`Broker write operation ${operation.id} has a path that is not rooted at this origin`);
  }
  if (!WRITE_PATHS.includes(operation.path)) {
    throw new Error(`Broker write operation ${operation.id} names a path outside WRITE_PATHS`);
  }
}

/** Every path a mutating brokered request can reach. For the card and the tests. */
export function writePaths(): readonly string[] {
  return WRITE_PATHS;
}

/**
 * The one request DASH will make for this operation, or a refusal (MAR-469).
 *
 * The single place a `BrokerOperation` becomes a `ProviderCall`, so the
 * asymmetry between the two kinds is written once. A read plans its own URL; a
 * write composes only a body and **this function** builds the URL, from the
 * operation's frozen `path` and the profile's origin. There is no argument
 * `compose` could return, and no input an agent could supply, that reaches the
 * path of a POST.
 *
 * Exported so `tests/broker-threat-model.test.ts` can drive every operation with
 * hostile inputs through exactly the code the broker uses, rather than through a
 * reconstruction of it that could drift.
 */
export function planCall(
  operation: BrokerOperation,
  origin: string,
  input: Record<string, unknown>,
): PlanResult {
  if (operation.access === "read") {
    return operation.plan(origin, input);
  }
  const composed = operation.compose(input);
  if (!composed.ok) {
    return composed;
  }
  return {
    ok: true,
    call: {
      method: "POST",
      url: new URL(operation.path, origin).toString(),
      json: composed.json,
    },
  };
}

/**
 * The operation with this id, or null.
 *
 * Null for anything unknown, which includes every operation a future slice might
 * add and every operation an agent invents. `gmail.send`, `gmail.drafts.send`
 * and `gmail.message.delete` all resolve to null here, whatever the connected
 * account's scopes happen to be — `gmail.compose` grants the ability to send at
 * Google and there is still nothing here to ask for it with.
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
