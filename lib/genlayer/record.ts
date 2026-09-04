/**
 * What one attempt at a judgement *is*, with nothing that reads or writes it
 * (MAR-863, ADR 0033).
 *
 * The same split `lib/brief/citations.ts` and `lib/brief/fingerprint.ts` keep,
 * and it is a **bundle boundary rather than a tidiness preference**: storing an
 * attempt needs `node:sqlite`; *drawing* one needs only the shape. A component
 * value-importing anything that reaches a Node builtin drags it into the
 * renderer bundle and the packaged app stops hydrating — every page paints its
 * background and nothing else, with no error on screen. That is MAR-498's
 * defect, and `tests/client-bundle.test.ts` is the gate that catches it.
 *
 * So: this module has **no imports but one type**, and everything here is safe
 * to reach from a component. `lib/genlayer/store.ts` does the reading and
 * writing, re-exports these so a caller needs one import rather than two, and is
 * reached from `lib/views/build.ts` alone — exactly the arrangement
 * `analyzeGrounding` already has.
 */

import type { AdjudicationOutcome } from "./receipt";

/**
 * How far one attempt has got.
 *
 * Ordered as the run goes, and every member is a place a person can be told
 * something true while they wait. That is the point of storing it: the measured
 * span from press to verdict is forty-five seconds to five minutes, and *"a
 * committee is reading it"* at minute four is a different message from *"DASH is
 * opening the case"* at second three.
 *
 * `judging` is the long one and it is where the tail lives — `evaluate` alone
 * took between sixteen and two hundred and forty-nine seconds to be accepted
 * across the spike's ten judgements. Nothing here carries a deadline; see
 * `lib/genlayer/adjudicate.ts` on why a fixed timeout would be a claim about a
 * distribution nobody has the right tail of.
 */
export const ADJUDICATION_STAGES = [
  /** Making a throwaway account and asking the faucet to fund it. */
  "funding",
  /** Writing the terms on chain. The first transaction. */
  "opening",
  /** Putting the briefing on chain. The second transaction. */
  "submitting",
  /** The committee is reading it. The third, and the long one. */
  "judging",
  /** It stopped moving. `outcome` and `failure` say how. */
  "settled",
] as const;

export type AdjudicationStage = (typeof ADJUDICATION_STAGES)[number];

/**
 * Why an attempt could not finish, in the kinds that lead somewhere different.
 *
 * A closed list on `BriefCitationState`'s terms, and never a network's own
 * message. `lib/copy/genlayer.ts` says each one in words with a next action, and
 * the actions really do differ: an unreachable endpoint is *try again in a
 * minute*, a refused payload is *DASH will not publish this brief*, and a
 * `no_consensus` — which is not a failure at all, and lives on `outcome` — is
 * *ask again*.
 */
export type AdjudicationFailure =
  /** The endpoint did not answer, or answered with something unreadable. */
  | "network_unreachable"
  /** The faucet refused. Nothing was published; nothing to undo. */
  | "faucet_refused"
  /** A transaction was rejected by the contract. The commission is unusable. */
  | "transaction_refused"
  /** DASH refused to build the payload. See `PayloadRefusal` for which. */
  | "payload_refused"
  /** The wait was abandoned — the window closed, or DASH was asked to stop. */
  | "abandoned";

/**
 * One attempt, exactly as the row holds it.
 *
 * Plain data, so it crosses to the page unchanged. Note what is not on it: the
 * deliverable, which DASH already holds as an artifact and which `brief_digest`
 * names; and any text the network wrote about itself, which is content DASH did
 * not author and must not reach a surface through a durable column.
 */
export interface Adjudication {
  commission_id: string;
  agent: string;
  run_id: string;
  artifact_id: string;
  brief_digest: string;
  rpc_url: string;
  contract_address: string;
  chain_id: number;
  stage: AdjudicationStage;
  started_at: string;
  /** Null while it is still moving. */
  settled_at: string | null;
  open_tx: string | null;
  submit_tx: string | null;
  evaluate_tx: string | null;
  /** DASH's three-field reading. Null until the evaluate receipt is in. */
  outcome: AdjudicationOutcome | null;
  status_name: string | null;
  execution_result: string | null;
  consensus_result: string | null;
  /** What the network says wrote the verdict. Its claim, never DASH's. */
  leader_model: string | null;
  /** One of `ADJUDICATION_VERDICTS`, or null when no state was applied. */
  verdict: string | null;
  reasons: string[];
  failure: AdjudicationFailure | null;
}

/** Whether this attempt is still moving. The page draws a stage when it is. */
export function isRunning(attempt: Adjudication): boolean {
  return attempt.stage !== "settled";
}
