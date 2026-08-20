/**
 * One HTTP request to a LAB's ingest route, and the five things it can mean
 * (MAR-479, ADR 0026).
 *
 * Split from `lib/lab/observation.ts` on purpose, exactly as `lib/notify/
 * deliver.ts` is split from `lib/notify/discord.ts`: that module composes and
 * is pure, this one reaches the network and is the only thing in DASH that ever
 * sends a LAB token anywhere. The seam is what lets the composition rules be
 * tested without a socket and this be tested against a listener on loopback
 * without composing anything.
 *
 * ## The token is an argument and never a field
 *
 * `postObservations(endpoint, token, body)` — three parameters, and nothing
 * here merges them into a stored object. Nothing this returns carries the token
 * either: every failure below is described by a fixed string chosen from the
 * status code, and the underlying error's own message is deliberately
 * discarded, because Node's fetch failures carry a `cause` naming what they
 * were connecting to and a receipt that quotes one is a receipt with somebody's
 * LAB host in it. The status code is kept — a number is not a credential and is
 * the thing a person debugging this actually needs.
 *
 * ## Nothing here retries, and nothing here blocks
 *
 * ADR 0026 decision 6: a LAB that is down, that 404s because
 * `LAB_DASH_INGEST_ENABLED` is off, or that rejects the token is a receipt row
 * with a status code. ADR 0004's rule — LAB is not this repository and not this
 * machine, so nothing about this half may gate anything — is enforced by this
 * function having no way to signal a caller to wait, and by
 * `electron/lab-telemetry.ts` recording every outcome and acting on none of
 * them.
 */

import { LAB_INGEST_PATH } from "./settings";

/**
 * How long DASH waits for a LAB before giving up on one batch.
 *
 * Ten seconds, `DELIVERY_TIMEOUT_MS`' number and its reasoning: this can run at
 * startup with nobody watching, a batch that is late is worth less than one on
 * time, and a request left open is a request holding a socket for a machine
 * that is very often simply not running.
 */
export const SEND_TIMEOUT_MS = 10_000;

/**
 * What happened, in the five shapes a receipt words differently.
 *
 * `refused` and `unavailable` are separated for `DeliveryOutcome`'s reason, and
 * here the distinction has a second use: `refused` is overwhelmingly the two
 * ordinary mistakes — the token is wrong (401), or `LAB_DASH_INGEST_ENABLED` is
 * not set so the route 404s and the endpoint's existence is not even observable.
 * Both need a person; neither will fix itself.
 */
export type SendOutcome =
  | { kind: "accepted"; status: number; accepted: number }
  /** LAB took some and rejected some — its 207. Both counts are real. */
  | { kind: "partial"; status: number; accepted: number; rejected: number; detail: string }
  | { kind: "refused"; status: number; detail: string }
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
  text(): Promise<string>;
}>;

/** LAB's answer shape. Parsed defensively — it is another program's output. */
interface IngestAnswer {
  accepted: number;
  rejected: number;
  errors: string[];
}

function readAnswer(raw: string): IngestAnswer | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const body = parsed as Record<string, unknown>;
    return {
      accepted: typeof body["accepted"] === "number" ? body["accepted"] : 0,
      rejected: typeof body["rejected"] === "number" ? body["rejected"] : 0,
      errors: Array.isArray(body["errors"])
        ? body["errors"].filter((e): e is string => typeof e === "string")
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * The endpoint as DASH will actually call it.
 *
 * Exported so the settings page can render the full URL a person is agreeing
 * to, rather than the base they typed — ADR 0026 decision 5's *before* half
 * covers where the bytes go as well as what is in them.
 */
export function ingestUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}${LAB_INGEST_PATH}`;
}

/**
 * POST one batch.
 *
 * A single attempt, no retry, for `deliverDiscordMessage`'s reason: retrying is
 * a policy that needs a queue and a clock, and here there is neither — the next
 * scheduled batch re-sends anything that did not land, because de-duplication
 * is keyed on what was *accepted* rather than on what was attempted.
 */
export async function postObservations(
  endpoint: string,
  token: string,
  body: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, SEND_TIMEOUT_MS);

  try {
    const response = await fetchImpl(ingestUrl(endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
    });

    const answer = readAnswer(await response.text());

    if (response.status === 200) {
      return { kind: "accepted", status: 200, accepted: answer?.accepted ?? 0 };
    }
    if (response.status === 207) {
      return {
        kind: "partial",
        status: 207,
        accepted: answer?.accepted ?? 0,
        rejected: answer?.rejected ?? 0,
        // LAB's own validation messages, which name fields rather than values —
        // see `validateDashObservation`. Safe to keep and the only useful thing
        // in a partial answer.
        detail: answer?.errors.join("; ") ?? "LAB rejected part of the batch and did not say why.",
      };
    }
    if (response.status === 401) {
      return { kind: "refused", status: 401, detail: "LAB did not accept the token." };
    }
    if (response.status === 403 || response.status === 404) {
      return {
        kind: "refused",
        status: response.status,
        detail: "That LAB is not accepting DASH telemetry. LAB_DASH_INGEST_ENABLED is not set there.",
      };
    }
    if (response.status === 400) {
      return {
        kind: "refused",
        status: 400,
        detail: answer?.errors.join("; ") ?? "LAB could not read the message.",
      };
    }
    return {
      kind: "unavailable",
      status: response.status,
      detail: "That LAB answered with an error.",
    };
  } catch {
    // Deliberately not the caught error's message. See the module docblock.
    return {
      kind: "unreachable",
      detail: "DASH could not reach that address. Nothing was sent.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** One sentence for the receipt row. Never carries the endpoint or the token. */
export function describeSendOutcome(outcome: SendOutcome): string {
  switch (outcome.kind) {
    case "accepted":
      return outcome.accepted === 1
        ? "LAB took 1 entry."
        : `LAB took ${outcome.accepted} entries.`;
    case "partial":
      return `LAB took ${outcome.accepted} and refused ${outcome.rejected}: ${outcome.detail}`;
    case "refused":
    case "unavailable":
      return outcome.detail;
    case "unreachable":
      return outcome.detail;
  }
}

/** How many entries actually landed, for de-duplication. Zero on every failure. */
export function acceptedCount(outcome: SendOutcome): number {
  return outcome.kind === "accepted" || outcome.kind === "partial" ? outcome.accepted : 0;
}
