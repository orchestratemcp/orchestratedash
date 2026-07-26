/**
 * The HTTP transport profile v0, as a client. **The first real
 * `AgentDomAdapter`.**
 *
 * Until MAR-415 every command DASH accepted stopped at `noAdapter`, which
 * refused it honestly. This module is what replaces that refusal with a
 * request: `POST {control-location-uri}/commands` carrying the envelope
 * `lib/agent-dom/runner.ts` built, and `GET {control-location-uri}` for the
 * state snapshot the poller feeds to `putAgentDomState`.
 *
 * It is one class of adapter for two kinds of agent, which is acceptance
 * criterion 5 of the issue rather than a coincidence: the bundled runner's
 * control location is loopback and a remote agent-managed one is HTTPS, and
 * nothing below branches on which. They differ in what their manifests declare,
 * not in the code that reaches them.
 *
 * ## What this module refuses to trust
 *
 * The thing on the other end is a *separate trust domain*, and after MAR-415 it
 * may be a process DASH launched or a server on the internet. The contract's
 * threat model has an entry for a compromised runner, and its answer is that
 * DASH "cannot make a hostile runner safe or truthful" — so what is left is to
 * stop it corrupting DASH:
 *
 * - **Bounded reads.** A response body is read with a byte ceiling, because
 *   `await response.json()` on a hostile server is an unbounded allocation.
 * - **Bounded, scrubbed `detail`.** Whatever the runner says lands in
 *   `command_results.outcome_json` and is shown to a user, so it is truncated
 *   and stripped of control characters. It is provider content, i.e. data.
 * - **The token never leaves the header.** Not into a URL, not into a log line,
 *   not into an error message. `describeTransportError` exists to make the
 *   safe formatting the easy formatting.
 */

import type { AgentCommandEnvelope } from "./envelope";
import type { AdapterOutcome, AgentDomAdapter } from "./runner";

/**
 * How to reach one agent's runner.
 *
 * The token is the out-of-band channel authentication the contract requires
 * ("Authentication and channel authorization are established out of band by the
 * installed adapter"). For the bundled runner it is minted by Electron main and
 * held in the OS vault; it is passed here as a value and never read from the
 * store by this module, so nothing about a credential's storage leaks into the
 * transport.
 */
export interface ControlChannel {
  /** Already validated by `checkControlUrl`. No trailing slash. */
  uri: string;
  /** Bearer credential. Never logged and never placed in a URL. */
  token: string;
}

export interface TransportOptions {
  /** Injected so the adapter is testable without a listening socket. */
  fetch?: typeof globalThis.fetch;
  /** Defaults to `DEFAULT_TIMEOUT_MS`. */
  timeout_ms?: number;
}

/**
 * Long enough for a loopback runner that is busy, short enough that a hung
 * endpoint does not wedge the command channel. A command that takes longer than
 * this has already outlived most of its two-minute envelope TTL.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The ceiling on a response body.
 *
 * An Agent DOM state snapshot for a busy agent is tens of kilobytes; a megabyte
 * is generous by an order of magnitude and still small enough that a malicious
 * or broken runner cannot exhaust memory by answering slowly and forever.
 */
export const MAX_RESPONSE_BYTES = 1_048_576;

/** Detail text is for a human reading a receipt, not for carrying a payload. */
const MAX_DETAIL_CHARS = 500;

/* ---------------------------------------------------------------------- *
 * The adapter
 * ---------------------------------------------------------------------- */

/**
 * What a runner answers a command with.
 *
 * Deliberately narrow. DASH already decided whether the command was allowed;
 * this is the runner reporting what it then did, and the only fields DASH acts
 * on are whether it worked and what to show. Anything else in the body is
 * ignored under the contract's additive-versioning rule.
 */
interface CommandResponseBody {
  ok?: unknown;
  detail?: unknown;
}

/**
 * Build an adapter bound to one channel.
 *
 * A function rather than a class so the `AgentDomAdapter` port stays the only
 * shape a caller sees — `electron/main.ts` selects between this and `noAdapter`
 * per agent, and both sides of that choice must be the same type.
 */
export function httpAdapter(
  channel: ControlChannel,
  options: TransportOptions = {},
): AgentDomAdapter {
  return {
    async submit(envelope: AgentCommandEnvelope): Promise<AdapterOutcome> {
      const response = await request(
        `${channel.uri}/commands`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${channel.token}`,
          },
          body: JSON.stringify(envelope),
        },
        channel,
        options,
      );

      if (!response.ok) {
        return response.outcome;
      }

      // A transport-level success still has to be read for what the runner
      // said. An adapter that treated 200 as "the effect happened" would be the
      // stub this whole channel exists to avoid, one HTTP hop further out.
      const body = response.body as CommandResponseBody | null;
      if (body === null || typeof body !== "object") {
        return {
          ok: false,
          reason: "adapter_failed",
          detail: "The runner answered with something that was not a command result.",
        };
      }
      if (body.ok === true) {
        return { ok: true, detail: safeDetail(body.detail) };
      }
      return {
        ok: false,
        reason: "adapter_failed",
        detail: safeDetail(body.detail) ?? "The runner refused the command and gave no reason.",
      };
    },
  };
}

/* ---------------------------------------------------------------------- *
 * State
 * ---------------------------------------------------------------------- */

export type StateFetchResult =
  | { ok: true; state: unknown }
  | { ok: false; reason: "unavailable" | "failed"; detail: string };

/**
 * Fetch one Agent DOM state snapshot.
 *
 * Returns the parsed body as `unknown` on purpose. Validation belongs to
 * `putAgentDomState`, which checks it against `agent-dom-state.schema.json`
 * before it is allowed to decide anything — and a transport that pre-validated
 * would be a second place for that rule to live and drift.
 */
export async function fetchAgentDomState(
  channel: ControlChannel,
  options: TransportOptions = {},
): Promise<StateFetchResult> {
  const response = await request(
    channel.uri,
    { method: "GET", headers: { authorization: `Bearer ${channel.token}` } },
    channel,
    options,
  );

  if (!response.ok) {
    return {
      ok: false,
      reason: response.outcome.reason === "adapter_unavailable" ? "unavailable" : "failed",
      detail: response.outcome.detail ?? "The runner could not be reached.",
    };
  }
  return { ok: true, state: response.body };
}

/* ---------------------------------------------------------------------- *
 * The one request path
 * ---------------------------------------------------------------------- */

type RequestResult =
  | { ok: true; body: unknown }
  | { ok: false; outcome: Extract<AdapterOutcome, { ok: false }> };

/**
 * Both operations go through here, so the timeout, the byte ceiling and the
 * "never quote the token" rule are properties of the transport rather than
 * things each caller remembered.
 *
 * The unavailable/failed split follows the rejection taxonomy:
 * `adapter_unavailable` means DASH could not reach the runner at all, and
 * `adapter_failed` means it was reached and something went wrong there. A user
 * whose runner is not running needs to start it; a user whose runner returned
 * 500 needs to read its log. Collapsing the two would lose that.
 */
async function request(
  url: string,
  init: RequestInit,
  channel: ControlChannel,
  options: TransportOptions,
): Promise<RequestResult> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeout = options.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await doFetch(url, { ...init, signal: controller.signal });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        outcome: {
          ok: false,
          reason: "adapter_failed",
          detail:
            "The runner rejected DASH's credential for this channel. " +
            "The adapter may need to be re-enrolled.",
        },
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        outcome: {
          ok: false,
          reason: "adapter_failed",
          detail: `The runner answered ${String(response.status)}.`,
        },
      };
    }

    const text = await readBounded(response);
    if (text === null) {
      return {
        ok: false,
        outcome: {
          ok: false,
          reason: "adapter_failed",
          detail: `The runner's response exceeded ${String(MAX_RESPONSE_BYTES)} bytes and was not read.`,
        },
      };
    }
    try {
      return { ok: true, body: text === "" ? null : (JSON.parse(text) as unknown) };
    } catch {
      return {
        ok: false,
        outcome: {
          ok: false,
          reason: "adapter_failed",
          detail: "The runner's response was not JSON.",
        },
      };
    }
  } catch (error: unknown) {
    return {
      ok: false,
      outcome: {
        ok: false,
        reason: "adapter_unavailable",
        detail: describeTransportError(error, channel, timeout),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a body with a ceiling, or return null when it exceeds one.
 *
 * `response.text()` would happily buffer whatever arrives. Streaming and
 * counting is the difference between a hostile runner making DASH slow and a
 * hostile runner making DASH exit.
 */
async function readBounded(response: Response): Promise<string | null> {
  const body = response.body;
  if (body === null || body === undefined) {
    return "";
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          return null;
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Describe a transport failure without quoting anything sensitive.
 *
 * A thrown `TypeError` from `fetch` can carry the request URL, and this
 * module's requests carry a bearer token in a header that some runtimes include
 * in a verbose cause chain. So the error's own message is never interpolated:
 * the host is named because it is in the manifest anyway, and the rest is
 * classified rather than quoted.
 */
export function describeTransportError(
  error: unknown,
  channel: ControlChannel,
  timeoutMs: number,
): string {
  const host = hostOf(channel.uri);
  if (error instanceof Error && error.name === "AbortError") {
    return `The runner at ${host} did not answer within ${String(timeoutMs)} ms.`;
  }
  return `The runner at ${host} could not be reached.`;
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "the configured control location";
  }
}

/**
 * Is this code point one a runner may not put in text DASH will print?
 *
 * C0, DEL and C1. Tested numerically rather than with a regex character class:
 * a source file containing raw control bytes — which is what an escaped range
 * turns into the moment any tool in the chain normalises it — is a file every
 * future editor, formatter and diff gets to reinterpret.
 */
function isControlCode(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

/**
 * Bound and scrub text the runner chose.
 *
 * Control characters are replaced because this string reaches a log line and a
 * UI: a runner that embedded a newline could otherwise forge what looks like a
 * second audit record in the console, which is a cheap way to make a trail
 * untrustworthy.
 */
export function safeDetail(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  let scrubbed = "";
  for (const character of value) {
    scrubbed += isControlCode(character.codePointAt(0) ?? 0) ? " " : character;
  }

  const cleaned = scrubbed.trim();
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned.length > MAX_DETAIL_CHARS ? `${cleaned.slice(0, MAX_DETAIL_CHARS)}…` : cleaned;
}
