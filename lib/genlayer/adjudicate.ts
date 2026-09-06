/**
 * One brief, judged on GenLayer, from the press to the receipt (MAR-863,
 * ADR 0033).
 *
 * The state machine. It builds the payload, opens a commission, submits the
 * deliverable, asks for a judgement, reads what came back, and writes every
 * stage to the store as it goes. Everything it *decides* is in this file;
 * everything it *touches* arrives through `GenLayerChain`, which is why
 * `tests/broker-genlayer.test.ts` can drive the whole `MAJORITY_DISAGREE` path
 * against a recorded receipt with no network in the room.
 *
 * ## Four calls, and they are the whole of what DASH can make happen
 *
 * `open_commission`, `submit_deliverable`, `evaluate`, `get_verdict`. Every one
 * is checked against `ADJUDICATE_FUNCTIONS` before it is made, in `call` below,
 * so the answer to *"what can DASH do to this contract?"* is one frozen array in
 * `lib/broker/operations.ts` rather than a grep over this file. `reclaim` — the
 * only function on that contract that moves anything — is absent from the array
 * and unreachable from here.
 *
 * ## The bounty is zero, always
 *
 * `open_commission` is payable and the spike locked a hundred units to
 * demonstrate escrow. DASH opens at **zero**. Nothing of the person's is at
 * stake, `reclaim` has nothing to reclaim, and the account paying gas is a
 * throwaway holding faucet money. This packet judges a document; it does not
 * move value, and there is no input by which a caller could make it.
 *
 * ## No fixed timeout, and what stands in for one
 *
 * Measured across the spike's ten judgements: `evaluate` took **16 to 249
 * seconds** to be accepted and **45 to 281 seconds** to be finalized. A
 * thirty-second deadline would fail most runs; a sixty-second one would fail a
 * third of them. So the wait is bounded by the *transport's* own retry budget —
 * generous, derived from that measured tail, and stated in `WAIT` below — and
 * exhausting it settles the attempt as `abandoned` with a route out rather than
 * leaving a spinner on screen.
 *
 * The three transactions are each waited to **finalized** rather than merely
 * accepted, which is what the spike did and what the one live end-to-end probe
 * of this code did. Reading a verdict earlier would be faster and is not
 * something this packet has evidence for.
 *
 * ## Node only
 *
 * `buildAdjudicationPayload` reaches `node:crypto` and the store reaches
 * `node:sqlite`. This runs in Electron main.
 */

import {
  ADJUDICATE_FUNCTIONS,
  GENLAYER_ADJUDICATE,
  type AdjudicateOperation,
} from "../broker/operations";
import type { BriefArtifact, DigestArtifact } from "../contracts";
import type { GenLayerConnection } from "./connection";
import { buildAdjudicationPayload, type AdjudicationPayload } from "./payload";
import { readReceipt, type ReceiptReading } from "./receipt";
import { GenLayerNetworkLostError } from "./record";
import {
  advanceAdjudication,
  openAdjudication,
  settleAdjudication,
  type AdjudicationFailure,
} from "./store";
import { commissionTerms } from "./terms";

/* ---------------------------------------------------------------------- *
 * What this needs from a chain
 * ---------------------------------------------------------------------- */

/**
 * The four things a GenLayer client has to be able to do, and no more.
 *
 * Injected rather than imported, on `BrokerDeps`' reasoning: the one seam that
 * reaches a network is a seam a test can stand in front of. It is also what
 * keeps `genlayer-js` out of this module's import graph — see
 * `lib/genlayer/client.ts`, which is the only file in DASH that names it.
 *
 * Note what is absent. There is no `deploy`, no `transfer`, no way to name an
 * endpoint or an address per call: the connection is fixed when the chain is
 * opened, and this interface cannot redirect a single call away from it.
 */
export interface GenLayerChain {
  /** The throwaway account signing this attempt. Made when the chain opened. */
  readonly address: string;
  /** Ask the network's faucet for enough to pay for the transactions. */
  fund(amount: number): Promise<void>;
  /**
   * Send one contract write. Returns the transaction hash.
   *
   * Strings only, and that is every argument this contract takes: a commission
   * id, three clauses of terms, a digest and a serialised document. A signature
   * accepting `unknown` would be one a caller could hand a structure nobody
   * bounded, on the way to a public chain.
   */
  write(functionName: string, args: readonly string[]): Promise<string>;
  /** Wait for one transaction to finalize. Returns the raw receipt. */
  waitFinalized(hash: string): Promise<unknown>;
  /** Read one view function. Returns whatever the contract answered. */
  read(functionName: string, args: readonly string[]): Promise<unknown>;
}

/**
 * The wait, and where the numbers come from.
 *
 * The faucet needs a moment to land before the first transaction can pay for
 * itself; three seconds is what the spike used and what the live probe used, and
 * it is the one sleep in this file.
 *
 * `FAUCET_AMOUNT` is small on purpose. The account is a throwaway on a test
 * network, the commissions are opened at zero, and the only thing this pays for
 * is gas.
 */
const FAUCET_SETTLE_MS = 3_000;
const FAUCET_AMOUNT = 100;

/* ---------------------------------------------------------------------- *
 * What the caller gets back
 * ---------------------------------------------------------------------- */

/**
 * How the attempt ended, as one value.
 *
 * `commission_id` is present on every arm including the failures, because a
 * failure that reached the chain still left a commission there and the row that
 * names it is how a person finds out. Absent only when DASH refused before
 * publishing anything.
 */
export type AdjudicationResult =
  | {
      ok: true;
      commission_id: string;
      /** Null exactly when the committee refused the leader — see `reading`. */
      verdict: string | null;
      reasons: string[];
      reading: ReceiptReading;
      evaluate_tx: string;
    }
  | { ok: false; commission_id: string | null; failure: AdjudicationFailure };

/* ---------------------------------------------------------------------- *
 * The run
 * ---------------------------------------------------------------------- */

/**
 * Have one brief judged.
 *
 * Long-running by nature, and the store is what makes that bearable: a row
 * exists before anything is published, and every stage is written as it is
 * reached, so a person who navigates away or closes DASH comes back to a record
 * rather than to nothing.
 *
 * `now` and `sleep` are injected for `lib/workspace.ts`' reason — a projection
 * that reads its own clock cannot be tested at a boundary — and here it is
 * sharper still: a test of the five-minute path must not take five minutes.
 * `log` is injected for the same reason `network_lost` exists at all (MAR-880):
 * the one line it writes names a real network error, and a test asserting
 * that line was written must not depend on `console.warn`.
 */
export async function adjudicateBrief(
  brief: BriefArtifact,
  digest: DigestArtifact,
  connection: GenLayerConnection,
  openChain: (connection: GenLayerConnection) => Promise<GenLayerChain>,
  deps: { now(): Date; sleep(ms: number): Promise<void>; log(line: string): void },
): Promise<AdjudicationResult> {
  const startedAt = deps.now().toISOString();
  const commissionId = commissionIdFor(brief.run_id, deps.now());

  /*
   * The payload first, before anything else happens.
   *
   * A brief that cannot be turned into a payload is one DASH will not publish,
   * and finding that out *after* a commission exists on chain would leave an
   * empty commission somebody has to explain. `buildAdjudicationPayload` refuses
   * on the fingerprint join, which is the same ruling the renderer already makes
   * — see `lib/brief/fingerprint.ts`.
   */
  const built = buildAdjudicationPayload(brief, digest, commissionId);
  if (!built.ok) {
    return { ok: false, commission_id: null, failure: "payload_refused" };
  }

  /*
   * The operation narrows what leaves the machine, and it does it here rather
   * than at the transport for `lib/broker/operations.ts`' stated reason: the
   * validation belongs three lines from the call it is interpolated into. This
   * is also the last door the no-addresses rule is checked at.
   */
  const composed = composeArguments(GENLAYER_ADJUDICATE, built.payload);
  if (composed === null) {
    return { ok: false, commission_id: null, failure: "payload_refused" };
  }

  /*
   * The row exists before the first byte leaves. See `openAdjudication`: a
   * failure to record is a reason not to publish, because the act is permanent
   * and the record is the only thing that makes it legible afterwards.
   */
  const opened = openAdjudication({
    commission_id: commissionId,
    agent: brief.agent,
    run_id: brief.run_id,
    artifact_id: brief.artifact_id,
    brief_digest: built.payload.brief_digest,
    rpc_url: connection.rpc_url,
    contract_address: connection.contract_address,
    chain_id: connection.chain_id,
    started_at: startedAt,
  });
  if (!opened) {
    return { ok: false, commission_id: null, failure: "payload_refused" };
  }

  const settle = (failure: AdjudicationFailure): AdjudicationResult => {
    settleAdjudication(commissionId, {
      settled_at: deps.now().toISOString(),
      outcome: null,
      status_name: null,
      execution_result: null,
      consensus_result: null,
      leader_model: null,
      verdict: null,
      reasons: [],
      failure,
    });
    return { ok: false, commission_id: commissionId, failure };
  };

  let chain: GenLayerChain;
  try {
    chain = await openChain(connection);
    await chain.fund(FAUCET_AMOUNT);
    await deps.sleep(FAUCET_SETTLE_MS);
  } catch {
    /*
     * The caught value is dropped rather than inspected, `lib/broker/execute.ts`'
     * rule: a fetch rejection can carry the request, and nothing a network says
     * about itself is text DASH will put on a page or in a durable column.
     */
    return settle("faucet_refused");
  }

  const stage = async (
    name: "opening" | "submitting" | "judging",
    functionName: string,
    args: readonly string[],
  ): Promise<{ hash: string; receipt: unknown } | AdjudicationFailure> => {
    let hash: string;
    try {
      hash = await writeCall(chain, functionName, args);
    } catch {
      return "network_unreachable";
    }
    advanceAdjudication(commissionId, name, hash);
    try {
      return { hash, receipt: await chain.waitFinalized(hash) };
    } catch (error) {
      if (error instanceof GenLayerNetworkLostError) {
        /*
         * DASH stopped *hearing from the network*, which is a narrower and
         * more useful claim than "DASH stopped waiting" — see `abandoned`
         * below. The error is bound and logged, never stored: a network's
         * own text is content DASH did not write, and `failure` is a closed
         * enum column, not a place for it (MAR-880).
         */
        deps.log(`[dash] judgement ${commissionId} stopped in ${name}: ${error.message}`);
        return "network_lost";
      }
      // The transaction is on the chain and DASH stopped watching it. That is
      // not the same as a refusal and must not read as one — see `abandoned`.
      return "abandoned";
    }
  };

  const open = await stage("opening", "open_commission", [
    composed.commission_id,
    composed.asked,
    composed.acceptance_criteria,
    composed.evidence_requirements,
  ]);
  if (typeof open === "string") {
    return settle(open);
  }
  if (readReceipt(open.receipt).outcome !== "applied") {
    // The commission was not written, so there is nothing to submit against.
    return settle("transaction_refused");
  }

  const submit = await stage("submitting", "submit_deliverable", [
    composed.commission_id,
    composed.brief_digest,
    composed.deliverable_json,
  ]);
  if (typeof submit === "string") {
    return settle(submit);
  }
  if (readReceipt(submit.receipt).outcome !== "applied") {
    /*
     * The contract re-derives the sha256 from the bytes it received and refuses
     * a mismatch. This is where a transport that mangled a byte lands — as a
     * refused transaction rather than as a differently-judged document.
     */
    return settle("transaction_refused");
  }

  const judged = await stage("judging", "evaluate", [composed.commission_id]);
  if (typeof judged === "string") {
    return settle(judged);
  }

  /*
   * The three-field reading, and the only place in DASH it is done.
   *
   * `outcome` is `no_consensus` for a transaction that was FINALIZED, whose
   * leader's execution was SUCCESS, and whose committee refused the leader's
   * verdict — roughly one judgement in ten. Nothing was written, so
   * `get_verdict` would return an empty verdict, and reporting that as a
   * result is the failure this whole module is shaped to avoid.
   */
  const reading = readReceipt(judged.receipt);
  if (reading.outcome !== "applied") {
    settleAdjudication(commissionId, {
      settled_at: deps.now().toISOString(),
      outcome: reading.outcome,
      status_name: reading.status,
      execution_result: reading.execution_result,
      consensus_result: reading.consensus_result,
      leader_model: reading.leader_model,
      verdict: null,
      reasons: [],
      failure: null,
    });
    return {
      ok: true,
      commission_id: commissionId,
      verdict: null,
      reasons: [],
      reading,
      evaluate_tx: judged.hash,
    };
  }

  let verdictBody: unknown;
  try {
    verdictBody = await readCall(chain, "get_verdict", [composed.commission_id]);
  } catch {
    return settle("network_unreachable");
  }

  const projected = GENLAYER_ADJUDICATE.project(verdictBody);
  settleAdjudication(commissionId, {
    settled_at: deps.now().toISOString(),
    outcome: reading.outcome,
    status_name: reading.status,
    execution_result: reading.execution_result,
    consensus_result: reading.consensus_result,
    leader_model: reading.leader_model,
    verdict: projected.verdict,
    reasons: projected.reasons,
    failure: null,
  });

  return {
    ok: true,
    commission_id: commissionId,
    verdict: projected.verdict,
    reasons: projected.reasons,
    reading,
    evaluate_tx: judged.hash,
  };
}

/* ---------------------------------------------------------------------- *
 * The two narrowings
 * ---------------------------------------------------------------------- */

/**
 * Every contract call goes through here, and none may name a function outside
 * the frozen list.
 *
 * `planCall`'s job, one layer down. The list is in `lib/broker/operations.ts`
 * beside the operation, so *"what can DASH make happen on this contract?"* is
 * answered by reading one array — and a call site that named `reclaim` would
 * throw here rather than move money.
 *
 * A throw and not a refusal, `OPERATIONS`' own module-load check's reasoning:
 * reaching it means DASH's own code asked for something it does not declare,
 * which is a programming mistake and not an outcome anybody should see worded
 * politely on a page.
 */
function declared(functionName: string): void {
  if (!ADJUDICATE_FUNCTIONS.includes(functionName)) {
    throw new Error(`GenLayer function ${functionName} is not one DASH declares`);
  }
}

/** One contract write, gated. Returns the transaction hash. */
async function writeCall(
  chain: GenLayerChain,
  functionName: string,
  args: readonly string[],
): Promise<string> {
  declared(functionName);
  return chain.write(functionName, args);
}

/** One contract read, gated. Returns whatever the contract answered. */
async function readCall(
  chain: GenLayerChain,
  functionName: string,
  args: readonly string[],
): Promise<unknown> {
  declared(functionName);
  return chain.read(functionName, args);
}

/** The six validated values that reach the contract, or null on a refusal. */
function composeArguments(
  operation: AdjudicateOperation,
  payload: AdjudicationPayload,
): {
  commission_id: string;
  asked: string;
  acceptance_criteria: string;
  evidence_requirements: string;
  brief_digest: string;
  deliverable_json: string;
} | null {
  const terms = commissionTerms();
  const composed = operation.compose({
    commission_id: payload.commission_id,
    deliverable_json: payload.deliverable_json,
    brief_digest: payload.brief_digest,
    asked: terms.asked,
    acceptance_criteria: terms.acceptance_criteria,
    evidence_requirements: terms.evidence_requirements,
  });
  if (!composed.ok) {
    return null;
  }
  const json = composed.json;
  return {
    commission_id: String(json["commission_id"]),
    asked: String(json["asked"]),
    acceptance_criteria: String(json["acceptance_criteria"]),
    evidence_requirements: String(json["evidence_requirements"]),
    brief_digest: String(json["brief_digest"]),
    deliverable_json: String(json["deliverable_json"]),
  };
}

/**
 * Mint one commission id.
 *
 * It has to be unique on the contract **forever**, because the contract refuses
 * an id it already holds — which is exactly what makes the resubmission path
 * work: asking again after a `no_consensus` is a *new* commission against the
 * same brief, not a retry of the old one.
 *
 * Three parts, and each earns its place:
 *
 * - The **run id**, shortened, is the readable half — a person reading a
 *   commission on a public explorer can tell which run it was about.
 * - The **moment** separates two attempts against the same brief.
 * - Four characters of **randomness**, and this is not belt-and-braces. The
 *   contract is shared by every DASH that points at it, so uniqueness is needed
 *   across *machines*, not just within one — two people judging briefs from
 *   runs whose ids happen to share eight characters, in the same millisecond,
 *   would otherwise collide, and the second would be refused with a message
 *   about a payload rather than about a name.
 *
 * Every part is narrowed to `COMMISSION_ID`'s alphabet here, and
 * `GENLAYER_ADJUDICATE.compose` checks that they were.
 */
export function commissionIdFor(runId: string, at: Date): string {
  const readable = runId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase();
  /*
   * `Math.random` and not `randomUUID`, deliberately: this is a name, not a
   * secret, and nothing about the design depends on it being unguessable. What
   * it has to be is *different*, and the store's primary key is what actually
   * refuses a collision if one ever happened anyway.
   */
  const salt = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `dash-${readable.length === 0 ? "run" : readable}-${at.getTime().toString(36)}-${salt}`;
}
