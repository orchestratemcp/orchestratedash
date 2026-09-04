/**
 * Every attempt to have a brief judged, written down (MAR-863, ADR 0033).
 *
 * The impure half of `lib/genlayer/`, in `lib/ai/ask-store.ts`' shape: it stores
 * what `lib/genlayer/adjudicate.ts` decided and reads it back for whoever is
 * drawing the page. **No policy here.** A function in this file that decided
 * what an empty verdict *meant* would be a second authority beside
 * `readReceipt`, free to drift from it — and the whole cost of this packet's
 * central bug was two places disagreeing about what a receipt says.
 *
 * ## What is in a row and what is deliberately not
 *
 * Names, hashes and conclusions. Never the deliverable, which DASH already holds
 * as an artifact and which `brief_digest` names exactly; never a network's own
 * error text, which is content DASH did not write and must not reach a page
 * through a durable column; never the raw judge output, for the reason
 * `GENLAYER_ADJUDICATE.project` gives.
 *
 * ## Node only
 *
 * `lib/db.ts` is here, so this is Electron main and the tests. What a component
 * needs is the projection in `lib/views/artifacts.ts`, which crosses as data.
 */

import { db } from "../db";
import {
  ADJUDICATION_STAGES,
  type Adjudication,
  type AdjudicationFailure,
  type AdjudicationStage,
} from "./record";
import type { AdjudicationOutcome } from "./receipt";

/*
 * Re-exported so a caller that stores an attempt needs one import rather than
 * two. The shapes live in `./record` because a component draws them and cannot
 * carry `node:sqlite` — see that module's own note.
 */
export type {
  Adjudication,
  AdjudicationFailure,
  AdjudicationStage,
} from "./record";
export { ADJUDICATION_STAGES } from "./record";

/** Everything needed to open a row. The rest arrives as the attempt moves. */
export interface AdjudicationOpening {
  commission_id: string;
  agent: string;
  run_id: string;
  artifact_id: string;
  brief_digest: string;
  rpc_url: string;
  contract_address: string;
  chain_id: number;
  started_at: string;
}

/**
 * How many attempts one brief's card reads back.
 *
 * A read limit rather than a retention rule — nothing is deleted, on
 * `ASK_HISTORY_LIMIT`'s reasoning. Five is enough that a person who was refused
 * four times can still see all four, and small enough that a page polling every
 * few seconds stays cheap.
 */
export const ADJUDICATION_HISTORY_LIMIT = 5;

/* ---------------------------------------------------------------------- *
 * Writes
 * ---------------------------------------------------------------------- */

/**
 * Open a row for one attempt, before anything is published.
 *
 * **Written first, and that ordering is the design.** The row exists before the
 * faucet is called, so a DASH that is killed between the first transaction and
 * the third leaves a record saying which stage it reached rather than nothing at
 * all — and a commission that exists on chain with no row here would be a
 * published document DASH cannot tell anybody about.
 *
 * Returns false when the write failed, and the caller then does not publish.
 * That is the strict direction: a failure to record is a reason not to act,
 * because the act is permanent and the record is the only thing that makes it
 * legible afterwards.
 */
export function openAdjudication(opening: AdjudicationOpening): boolean {
  try {
    db()
      .prepare(
        "INSERT INTO brief_adjudications " +
          "(commission_id, agent, run_id, artifact_id, brief_digest, rpc_url, " +
          "contract_address, chain_id, stage, started_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'funding', ?)",
      )
      .run(
        opening.commission_id,
        opening.agent,
        opening.run_id,
        opening.artifact_id,
        opening.brief_digest,
        opening.rpc_url,
        opening.contract_address,
        opening.chain_id,
        opening.started_at,
      );
    return true;
  } catch (error: unknown) {
    console.warn(`[dash] could not open an adjudication row: ${message(error)}`);
    return false;
  }
}

/**
 * Note that the attempt reached a stage, and which transaction carried it.
 *
 * One function for both because they arrive together: a stage changes *because*
 * a transaction was submitted, and two calls would leave a window in which the
 * page says `judging` with no hash to show for it.
 *
 * `hash` is null for `funding`, which is an RPC call and not a transaction.
 */
export function advanceAdjudication(
  commissionId: string,
  stage: AdjudicationStage,
  hash: string | null,
): void {
  const column =
    stage === "opening"
      ? "open_tx"
      : stage === "submitting"
        ? "submit_tx"
        : stage === "judging"
          ? "evaluate_tx"
          : null;
  try {
    if (column === null || hash === null) {
      db()
        .prepare("UPDATE brief_adjudications SET stage = ? WHERE commission_id = ?")
        .run(stage, commissionId);
      return;
    }
    // The column name is one of three literals chosen above from a closed union,
    // never a caller's string. The values are still bound.
    db()
      .prepare(
        `UPDATE brief_adjudications SET stage = ?, ${column} = ? WHERE commission_id = ?`,
      )
      .run(stage, hash, commissionId);
  } catch (error: unknown) {
    console.warn(`[dash] could not advance an adjudication: ${message(error)}`);
  }
}

/** What the attempt settled as. Written once, and it is the end of the row. */
export interface AdjudicationSettlement {
  settled_at: string;
  outcome: AdjudicationOutcome | null;
  status_name: string | null;
  execution_result: string | null;
  consensus_result: string | null;
  leader_model: string | null;
  verdict: string | null;
  reasons: string[];
  failure: AdjudicationFailure | null;
}

/**
 * Close one attempt.
 *
 * Every field of the reading lands together, so there is no moment at which a
 * page could read a verdict without the three fields that say whether it was
 * applied. `lib/genlayer/receipt.ts` is the only thing that produces them and
 * `GENLAYER_ADJUDICATE.project` the only thing that produces the verdict.
 */
export function settleAdjudication(
  commissionId: string,
  settlement: AdjudicationSettlement,
): void {
  try {
    db()
      .prepare(
        "UPDATE brief_adjudications SET stage = 'settled', settled_at = ?, outcome = ?, " +
          "status_name = ?, execution_result = ?, consensus_result = ?, leader_model = ?, " +
          "verdict = ?, reasons_json = ?, failure = ? WHERE commission_id = ?",
      )
      .run(
        settlement.settled_at,
        settlement.outcome,
        settlement.status_name,
        settlement.execution_result,
        settlement.consensus_result,
        settlement.leader_model,
        settlement.verdict,
        JSON.stringify(settlement.reasons),
        settlement.failure,
        commissionId,
      );
  } catch (error: unknown) {
    console.warn(`[dash] could not settle an adjudication: ${message(error)}`);
  }
}

/* ---------------------------------------------------------------------- *
 * Reads
 * ---------------------------------------------------------------------- */

/**
 * Every attempt against one brief, newest first.
 *
 * Keyed by `(agent, artifact_id)` — the index's own key — and never by run,
 * because the card that draws this is a card about the artifact.
 */
export function readAdjudications(
  agent: string,
  artifactId: string,
  limit = ADJUDICATION_HISTORY_LIMIT,
): Adjudication[] {
  let rows: unknown[];
  try {
    rows = db()
      .prepare(
        "SELECT * FROM brief_adjudications WHERE agent = ? AND artifact_id = ? " +
          "ORDER BY started_at DESC LIMIT ?",
      )
      .all(agent, artifactId, limit);
  } catch (error: unknown) {
    console.warn(`[dash] could not read adjudications: ${message(error)}`);
    return [];
  }
  const read: Adjudication[] = [];
  for (const row of rows) {
    const one = readRow(row);
    if (one !== null) {
      read.push(one);
    }
  }
  return read;
}

/** Every attempt this agent has running, for the caller that resumes them. */
export function readUnsettledAdjudications(): Adjudication[] {
  let rows: unknown[];
  try {
    rows = db()
      .prepare("SELECT * FROM brief_adjudications WHERE stage != 'settled'")
      .all();
  } catch (error: unknown) {
    console.warn(`[dash] could not read running adjudications: ${message(error)}`);
    return [];
  }
  const read: Adjudication[] = [];
  for (const row of rows) {
    const one = readRow(row);
    if (one !== null) {
      read.push(one);
    }
  }
  return read;
}

/**
 * One row, or null when it is not one this version can read.
 *
 * Skipped rather than repaired, `readStore`'s rule after the malformed store of
 * 2026-08-19: a row that cannot be read is one row missing from a list, and a
 * throw here is a page that will not draw.
 */
function readRow(row: unknown): Adjudication | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const source = row as Record<string, unknown>;
  const stage = text(source["stage"]);
  if (
    stage === null ||
    !(ADJUDICATION_STAGES as readonly string[]).includes(stage) ||
    text(source["commission_id"]) === null
  ) {
    return null;
  }
  return {
    commission_id: text(source["commission_id"]) ?? "",
    agent: text(source["agent"]) ?? "",
    run_id: text(source["run_id"]) ?? "",
    artifact_id: text(source["artifact_id"]) ?? "",
    brief_digest: text(source["brief_digest"]) ?? "",
    rpc_url: text(source["rpc_url"]) ?? "",
    contract_address: text(source["contract_address"]) ?? "",
    chain_id: typeof source["chain_id"] === "number" ? source["chain_id"] : 0,
    stage: stage as AdjudicationStage,
    started_at: text(source["started_at"]) ?? "",
    settled_at: text(source["settled_at"]),
    open_tx: text(source["open_tx"]),
    submit_tx: text(source["submit_tx"]),
    evaluate_tx: text(source["evaluate_tx"]),
    outcome: text(source["outcome"]) as AdjudicationOutcome | null,
    status_name: text(source["status_name"]),
    execution_result: text(source["execution_result"]),
    consensus_result: text(source["consensus_result"]),
    leader_model: text(source["leader_model"]),
    verdict: text(source["verdict"]),
    reasons: readReasons(source["reasons_json"]),
    failure: text(source["failure"]) as AdjudicationFailure | null,
  };
}

/** The stored reasons, or none. A column that will not parse is no reasons. */
function readReasons(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((one) => typeof one === "string") : [];
  } catch {
    return [];
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
