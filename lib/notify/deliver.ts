/**
 * One HTTP request to a Discord webhook, and the five things it can mean
 * (MAR-588, outbound half).
 *
 * Split from `lib/notify/discord.ts` on purpose. That module composes and is
 * pure; this one reaches the network and is the only thing in DASH that ever
 * sends the webhook credential anywhere. Keeping the seam sharp is what lets the
 * composition rules be tested without a socket, and lets this be tested against
 * a listener on loopback without composing anything.
 *
 * ## The endpoint is an argument and never a field
 *
 * `deliverDiscordMessage(endpoint, message)` — the credential is a parameter,
 * the body is a separate value, and nothing here merges them. That is the
 * type-level version of `lib/notify/discord.ts`'s rule 1, placed at the one
 * function that holds both halves at once.
 *
 * ## Nothing this returns carries the endpoint
 *
 * Not the outcome, not the detail sentence, not a log line. Every failure below
 * is described by a fixed string chosen from the status code — the underlying
 * error's own message is deliberately discarded, because Node's fetch failures
 * carry a `cause` that names what it was connecting to, and a support log that
 * quotes it is a support log with a webhook host in it. The status code is kept,
 * because a number is not a credential and is the thing a person debugging this
 * actually needs.
 *
 * ## Why `fetch` is injected
 *
 * So the proof harness in `scripts/notify-proof.mjs` and the unit tests can
 * drive the real function against a real local listener, and so nothing in this
 * module has to know whether it is talking to Discord. A default of the global
 * `fetch` keeps every production call site free of the ceremony.
 */

import type { DiscordMessage } from "./discord";

/**
 * How long DASH waits for Discord before giving up on one message.
 *
 * Ten seconds rather than a minute: this runs unattended in the runner, a
 * message that is late is worth less than a message that is on time, and a
 * request left open is a request holding a slot in the queue behind it.
 */
export const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * What happened, in the five shapes the caller acts on differently.
 *
 * - `delivered` — Discord took it.
 * - `rate_limited` — Discord is asking for a pause. The caller waits and retries.
 * - `rejected` — Discord understood and said no. This is the webhook being
 *   deleted, revoked or mistyped, and it is the one outcome that will not fix
 *   itself: retrying is pointless and the person has to be told.
 * - `unavailable` — Discord had a problem, or the network did. Worth retrying.
 * - `unreachable` — the request never completed. Also worth retrying.
 *
 * `rejected` and `unavailable` are separated for exactly that reason. Folded
 * together, a deleted webhook would be retried forever and never reported, which
 * is the failure mode where a person believes they are being notified and is not.
 */
export type DeliveryOutcome =
  | { kind: "delivered"; status: number }
  | { kind: "rate_limited"; status: number; retry_after_ms: number }
  | { kind: "rejected"; status: number; detail: string }
  | { kind: "unavailable"; status: number; detail: string }
  | { kind: "unreachable"; detail: string };

/** The slice of `fetch` this needs, so a test can supply one without a network. */
export type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/**
 * The longest pause DASH will honour from a `Retry-After`.
 *
 * Discord's own webhook rate limits are measured in seconds. A header asking for
 * an hour would either be a mistake or something other than Discord answering,
 * and either way parking the queue for that long is worse than dropping the
 * message and saying so.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * POST one message.
 *
 * A single attempt. Retrying is the caller's decision because the caller is the
 * one holding a queue and a clock — see `runner/notify.ts`, which is where the
 * "how often may DASH talk to Discord" policy lives. A retry loop in here would
 * be a second, invisible policy underneath it.
 */
export async function deliverDiscordMessage(
  endpoint: string,
  message: DiscordMessage,
  fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  timeoutMs: number = DELIVERY_TIMEOUT_MS,
): Promise<DeliveryOutcome> {
  const body = JSON.stringify(message);

  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // Discord asks bots and integrations to identify themselves, and this is
        // the honest answer: DASH, the version, and a link to nothing. It carries
        // no machine name, no user name and no agent name.
        "user-agent": "OrchestrateDASH (local notifier)",
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // The error is discarded rather than reported. See the module header: Node
    // attaches a `cause` naming the host it failed to reach, and this sentence
    // is read by a person looking at a log they may paste somewhere.
    return {
      kind: "unreachable",
      detail: "DASH could not reach Discord. It will try again with the next message.",
    };
  }

  const status = response.status;

  // 204 is the ordinary success for a webhook execution; 200 comes back when
  // `?wait=true` was asked for, which DASH never asks for. Both are accepted so
  // the check is about the class rather than about one number.
  if (status >= 200 && status < 300) {
    return { kind: "delivered", status };
  }

  if (status === 429) {
    return {
      kind: "rate_limited",
      status,
      retry_after_ms: retryAfterMs(response.headers.get("retry-after")),
    };
  }

  if (status === 401 || status === 403 || status === 404) {
    return {
      kind: "rejected",
      status,
      detail:
        "Discord would not accept the message. The webhook may have been deleted, or the address may be wrong. Set it up again in DASH's notification settings.",
    };
  }

  if (status >= 400 && status < 500) {
    return {
      kind: "rejected",
      status,
      detail: "Discord refused the message and DASH will not keep retrying it.",
    };
  }

  return {
    kind: "unavailable",
    status,
    detail: "Discord had a problem answering. DASH will try again with the next message.",
  };
}

/**
 * `Retry-After` in milliseconds, defaulting to one second.
 *
 * Discord sends this as seconds, sometimes fractional. A missing, unparseable or
 * negative value becomes one second rather than zero — a caller that retried
 * immediately after a 429 would earn the next one — and anything beyond the cap
 * is clamped rather than obeyed, per `MAX_RETRY_AFTER_MS`.
 */
function retryAfterMs(header: string | null): number {
  const seconds = header === null ? Number.NaN : Number.parseFloat(header);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 1_000;
  }
  return Math.min(Math.round(seconds * 1_000), MAX_RETRY_AFTER_MS);
}
