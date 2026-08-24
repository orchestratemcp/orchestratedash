/**
 * The chief's one outbound reach, and the funnel that makes every use of it a
 * row somebody can read afterwards (MAR-744, item 3).
 *
 * Henrik's second sentence — *"then ask it to find more sources to a topic"* —
 * is the only thing in this packet that leaves the machine. Everything else the
 * chief gained is a read of DASH's own store.
 *
 * ## Why this is not a broker operation
 *
 * It nearly was, and the reason it is not is worth writing down, because "put it
 * through the broker" is the right instinct and it does not fit.
 *
 * `lib/broker/operations.ts` builds a request **for a connection a person made**:
 * an operation names a `connection_provider`, `execute` resolves a grant against
 * the vault, mints or reads a credential, and re-checks the built URL against
 * that provider's `api_origin`. Every one of those steps is about a credential.
 * A public feed has none — no account, no key, no grant, no origin belonging to
 * anybody. Shaping it as an operation would mean a connection with no
 * credential, a grant over nothing, and a provider profile invented so that a
 * URL had something to be checked against: a security boundary defined by which
 * argument somebody remembered to pass null to, which is the exact objection
 * `runner/chief-broker.ts` already makes to reusing `createBroker`.
 *
 * So the two properties that actually matter are taken **structurally** instead,
 * and taken here:
 *
 * 1. **DASH decides the address, always.** `lib/chief/sources.ts` holds three
 *    frozen templates and one narrowed hole. This module never sees a URL it did
 *    not get from `addressFor`, and there is no argument on `fetchChiefSources`
 *    that could carry one.
 * 2. **Every attempt is a row.** `decide()` below is the single exit, exactly as
 *    it is in `runner/chief-broker.ts` — one audit row per source, on every
 *    path, before anything returns. An audit table is a record of decisions
 *    rather than of successes, and that is a property of there being one exit
 *    rather than a rule reviewers have to re-check.
 *
 * The refusal vocabulary is `BrokerRefusal`, imported and not invented, so a
 * source DASH could not reach reads the same word in the audit as a provider
 * DASH could not reach. ADR 0021 rule 2, inherited the same way the chief's own
 * broker inherits it.
 *
 * ## What comes back is data, and stays data
 *
 * Headlines and dates from feeds nobody vetted. ADR 0002 invariant 7's default,
 * and `lib/ai/ask.ts`' structural answer applies unchanged: nothing in DASH
 * reads the chief's answer, and no address in a fetched item is ever sent to a
 * model — it lives on the citation, which is DASH's own record of what it
 * fetched and is rendered by DASH. A model that invents a source cannot make
 * that source appear in the list beside it.
 *
 * A fetch justified by fetched content is impossible here rather than guarded:
 * the topic comes from the person's own question through `lib/chief/tools.ts`,
 * and no path in this repository passes fetched text back into `topic`.
 *
 * ## Hosted twice, decided once
 *
 * `fetchImpl`, `audit` and `now` are the whole of the world this needs, so main
 * hands it `fetch` and `recordBrokerCall`, the runner hands it `fetch` and its
 * audit spool, and the fetching itself is one implementation. Same reasoning as
 * `lib/chief/answer.ts`, one layer down.
 */

import { randomUUID } from "node:crypto";

import type { BrokerRefusal } from "../broker/protocol";
import type { ChiefDecisionRow } from "./audit";
import { CHIEF_SOURCES_CONNECTION_ID, CHIEF_SOURCES_OPERATION } from "./audit";
import {
  addressFor,
  MAX_ITEMS_PER_SOURCE,
  readFeed,
  type ChiefSource,
  type FetchedItem,
} from "./sources";

/**
 * How long DASH waits for one source.
 *
 * Short, because three of these run for one question a person is sitting in
 * front of, and a source having a bad day must not turn into a chat room that
 * looks broken. The scout's own `FETCH_TIMEOUT_MS` is the same order for the
 * same reason, on a path where nobody is waiting.
 */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * How much of a source's answer DASH will read.
 *
 * `max_response_bytes`' job, on the operation rather than on the call — here the
 * operation is "read a public feed" and the number is a property of that rather
 * than something a caller chooses. A quarter of a megabyte is a generous feed
 * and a useless payload, and an unbounded read of a response from a host nobody
 * vetted is a way to exhaust whichever process is doing the reading.
 */
const MAX_RESPONSE_BYTES = 262_144;

/**
 * One source DASH tried, and what came of it.
 *
 * The whole record, including the failures, because *"I could not reach arXiv"*
 * is a sentence the person is owed — ADR 0028 decision 9's honesty rule applied
 * to a source instead of to a model. `lib/copy/chief-sources.ts` has the words.
 */
export interface FetchedSource {
  /** The source's id. A value: it keys the record and never enters prose. */
  id: string;
  /** What a person reads. */
  name: string;
  /**
   * The address DASH actually fetched, or null when it never got that far.
   *
   * DASH's own record of its own request. This is what a citation links to, and
   * it is on the record rather than reconstructed later, because a link under a
   * claim has to be the address the claim came from.
   */
  address: string | null;
  status: "ok" | "empty" | "unreachable" | "not_a_feed" | "refused";
  /** The entries kept, newest as the source ordered them, bounded. */
  items: FetchedItem[];
}

export interface ChiefFetchDeps {
  fetchImpl: typeof fetch;
  /** Record one decision. Called exactly once per source attempted. */
  audit(row: ChiefDecisionRow): void;
  now(): Date;
}

export interface ChiefFetchOutcome {
  topic: string;
  sources: FetchedSource[];
  /** Every kept entry, flattened in source order. What a citation numbers. */
  items: { source_id: string; source_name: string; item: FetchedItem }[];
}

/**
 * Read the allowlisted sources for one topic.
 *
 * Sequential rather than parallel, and that is deliberate on a path where three
 * requests would obviously be faster together. Two reasons, and the second is
 * the one that decides it: the timeout above already bounds the worst case at
 * something a person will sit through, and a serial walk means the audit rows
 * land in the order the requests were made, which is what makes the table read
 * as an account of what DASH did rather than as three interleaved fragments.
 *
 * Never throws. Every failure mode of a host nobody vetted is a `status` on a
 * `FetchedSource` and a row in the audit, so the caller has one shape to render
 * and the person gets a sentence either way.
 */
export async function fetchChiefSources(
  topic: string,
  deps: ChiefFetchDeps,
  sources: readonly ChiefSource[],
): Promise<ChiefFetchOutcome> {
  const fetched: FetchedSource[] = [];

  for (const source of sources) {
    fetched.push(await readOne(source, topic, deps));
  }

  const items: ChiefFetchOutcome["items"] = [];
  for (const source of fetched) {
    for (const item of source.items) {
      items.push({ source_id: source.id, source_name: source.name, item });
    }
  }
  return { topic, sources: fetched, items };
}

async function readOne(
  source: ChiefSource,
  topic: string,
  deps: ChiefFetchDeps,
): Promise<FetchedSource> {
  const began = deps.now();
  const startedAt = began.getTime();

  /**
   * Every exit goes through here.
   *
   * `runner/chief-broker.ts`' `decide`, and its property: one audit row per
   * attempt on every path, written before the value is returned. The row
   * carries the source's **id** and never the address — `input_keys` is a list
   * of field names by contract, and an address is a value.
   */
  const decide = (
    status: FetchedSource["status"],
    refusal: BrokerRefusal | null,
    address: string | null,
    items: FetchedItem[],
  ): FetchedSource => {
    const decided = deps.now();
    deps.audit({
      connection_id: CHIEF_SOURCES_CONNECTION_ID,
      operation: CHIEF_SOURCES_OPERATION,
      // Fresh per source, never derived from the topic: two people asking about
      // the same subject are two requests, and a replay check that said
      // otherwise would refuse the second one forever.
      request_id: `chief-sources-${randomUUID()}`,
      decision: refusal === null ? "allowed" : "refused",
      refusal,
      // Names, never values. `source` and `topic` are what this call took; the
      // subject somebody asked about is their business and is not audit data.
      input_keys: ["source", "topic"],
      result_count: refusal === null ? items.length : null,
      duration_ms: Math.max(0, decided.getTime() - startedAt),
      decided_at: decided.toISOString(),
    });
    return { id: source.id, name: source.name, address, status, items };
  };

  const address = addressFor(source, topic);
  if (address === null) {
    /*
     * DASH would not build this address: a topic the narrowing refused, or a
     * template that did not land on the allowlist. `invalid_input` rather than
     * a fetch failure, because nothing was attempted and a row saying otherwise
     * would be a row asserting a request nobody made.
     */
    return decide("refused", "invalid_input", null, []);
  }

  let body: string | null;
  try {
    const response = await deps.fetchImpl(address, {
      method: "GET",
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/json, text/xml",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return decide("unreachable", "provider_unavailable", address, []);
    }
    body = await readBounded(response, MAX_RESPONSE_BYTES);
  } catch {
    /*
     * Dropped rather than inspected. A fetch rejection carries the request, and
     * while this one has no credential on it, the habit is the one
     * `runner/chief-broker.ts` keeps and the reason a reader should not have to
     * check which of the two paths they are on.
     */
    return decide("unreachable", "provider_unavailable", address, []);
  }

  if (body === null) {
    // Past the byte ceiling, or a body that would not read. Not a feed DASH can
    // use, and told apart from a reachable-but-empty one below.
    return decide("not_a_feed", "provider_refused", address, []);
  }

  const parsed = readFeed(body, source.format);
  if (parsed === null) {
    // An error page, or a host that changed what it serves. Its own status:
    // "this address is not a feed" and "this feed has no news" send a person to
    // two different places, and collapsing them is the wrong answer this whole
    // pattern exists to avoid.
    return decide("not_a_feed", "provider_refused", address, []);
  }

  const kept = parsed.slice(0, MAX_ITEMS_PER_SOURCE);
  // Reached, understood, and empty. Allowed rather than refused: DASH asked a
  // question and got a complete answer, and the answer was nothing.
  return decide(kept.length === 0 ? "empty" : "ok", null, address, kept);
}

/**
 * Read at most `max` bytes of a response, or null.
 *
 * `runner/chief-broker.ts`' local copy, restated for its reason: the bound
 * belongs to the operation, and `readBounded` in `lib/broker/execute.ts` is
 * private to that module.
 */
async function readBounded(response: Response, max: number): Promise<string | null> {
  const body = response.body;
  if (body === null) {
    return null;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      read += chunk.value.byteLength;
      if (read > max) {
        return null;
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text + decoder.decode();
}
