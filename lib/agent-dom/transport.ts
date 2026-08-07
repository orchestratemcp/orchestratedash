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

import {
  STORE_DAMAGED_REASON,
  describeRunnerStoreDamage,
  type Recovery,
  type RunnerStoreDamageKind,
} from "../copy/recovery";
import type { AgentCommandEnvelope } from "./envelope";
import { ipcFetch } from "./ipc-fetch";
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
  /**
   * A Unix socket or Windows named pipe to dial instead of resolving `uri`.
   *
   * Set for the bundled runner since MAR-430 and never for a remote one: a
   * local endpoint is access-controlled by the OS, and a remote one is reached
   * over HTTPS. When present, `uri`'s authority is a placeholder that is never
   * looked up — see `lib/agent-dom/ipc-fetch.ts`.
   */
  ipc_path?: string;
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
  // An injected fetch wins, so tests keep working without a listening endpoint.
  // Otherwise the channel decides: a local runner is dialled down its socket or
  // pipe, and everything else goes over the network exactly as before.
  const doFetch =
    options.fetch ?? (channel.ipc_path === undefined ? globalThis.fetch : ipcFetch(channel.ipc_path));
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
      /*
       * MAR-506. Read the body before deciding what to say.
       *
       * This branch used to answer `The runner answered ${status}.` without
       * looking, and that sentence is what a user saw for four hours on a
       * machine whose `runner.sqlite` was malformed. It names the transport. It
       * does not say that DASH reached the runner, that the runner is running,
       * that nothing of theirs is lost, or what to do — which is everything
       * they needed.
       *
       * The runner now answers a damaged store with a typed 503, so the body is
       * where the answer is. It is read with the same ceiling as a success
       * body: a failing runner is not a reason to relax the one bound that
       * keeps a hostile one from making DASH exit.
       */
      const damage = await readStoreDamage(response);
      if (damage !== null) {
        return {
          ok: false,
          outcome: {
            ok: false,
            reason: "adapter_failed",
            /*
           * `can_retire: true` (MAR-518). `POST /store/retire` now has a
           * caller: `runner.retireStore`, reachable from `app/page.tsx`, the
           * one place the runner's health is checked independently of any
           * one agent. This path — a command against one agent, while its
           * store happens to be damaged — has nowhere to put a button of its
           * own, so the sentence stays text here; it is true regardless of
           * which screen reads it, and the home page is where it is acted
           * on. That is a weaker rendering than a button and a stronger one
           * than "Report this. Nothing here can be repaired by reopening
           * DASH," which is what this line said until the repair existed
           * anywhere to point to.
           */
          detail: recoverySentences(describeRunnerStoreDamage(damage, { can_retire: true })),
          },
        };
      }
      return {
        ok: false,
        outcome: {
          ok: false,
          reason: "adapter_failed",
          /*
           * The generic case, and it is worded for a person rather than for a
           * log because this string is rendered. The status code moves into the
           * second sentence, where it is a detail somebody reporting the fault
           * can quote, rather than being the whole of what they are told.
           */
          detail:
            "DASH reached the part of itself that runs agents, and it could not carry out the request. " +
            `Nothing was changed. If this keeps happening it needs reporting (status ${String(response.status)}).`,
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
 * The runner's "my own records are damaged" answer, or null (MAR-506).
 *
 * Matches on `reason` first and only then trusts `kind`, so a runner answering
 * some other 5xx with a body that happens to have a `kind` field cannot steer
 * DASH's copy. An unrecognised `kind` falls back to `malformed` rather than
 * being rejected: the runner has said its store is damaged, which is the fact
 * the user needs, and refusing to say anything because the classification is
 * from a newer build would be losing the message over its label.
 *
 * A body that is missing, oversized or not JSON returns null and the generic
 * sentence is used. Silence is not evidence of a damaged store.
 *
 * Exported for `electron/main.ts`'s `runner.status` handling (MAR-518), so the
 * home page can learn the same fact this module already reads off a failed
 * command — one classifier, not two that could drift on what counts as
 * "damaged".
 */
export async function readStoreDamage(response: Response): Promise<RunnerStoreDamageKind | null> {
  const text = await readBounded(response);
  if (text === null || text === "") {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as { reason?: unknown; kind?: unknown };
  if (record.reason !== STORE_DAMAGED_REASON) {
    return null;
  }
  return record.kind === "not_a_database" || record.kind === "unreadable"
    ? record.kind
    : "malformed";
}

/**
 * A `Recovery` flattened into the one field this channel has.
 *
 * `AdapterOutcome` carries a single `detail` string, and it is what
 * `app/agents/detail/page.tsx` already renders — so the three sentences arrive
 * on screen today, with no change to a surface another open PR owns.
 *
 * **This is a transitional shape and should not spread.** MAR-423's whole
 * argument for `Recovery` being three fields is that a surface cannot then
 * render two and drop the third, and a joined string gives that back. What
 * saves it here is that all three are present and in order; what a later
 * surface should take is the object.
 */
function recoverySentences(recovery: Recovery): string {
  return `${recovery.headline} ${recovery.meaning} ${recovery.next_action}`;
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
  // A local endpoint's `uri` authority is a placeholder nobody resolves, so
  // naming it would show a person a hostname that does not exist and cannot be
  // pinged. "The local runner" is both true and actionable.
  const where = channel.ipc_path === undefined ? `the runner at ${hostOf(channel.uri)}` : "the local runner";
  if (error instanceof Error && error.name === "AbortError") {
    return `${capitalise(where)} did not answer within ${String(timeoutMs)} ms.`;
  }
  return `${capitalise(where)} could not be reached.`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
