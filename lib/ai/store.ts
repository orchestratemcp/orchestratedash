/**
 * Reading and writing what a model provider last said about a key (MAR-582).
 *
 * The only impure module under `lib/ai/`, and deliberately the thinnest, in
 * `lib/broker/store.ts`'s shape: it stores a record `lib/ai/liveness.ts` already
 * decided, and reads it back for whoever is drawing a card. No policy lives
 * here. A function in this file that decided what a status code meant would be a
 * second authority beside `classifyProbe`, free to drift from it.
 *
 * ## The record is a report, never a permission
 *
 * Nothing consults this to decide whether a request may be made. The broker
 * resolves a grant from the manifest and the live credential on every single
 * call, so a row here that has gone stale — or that says `key_refused` about a
 * key the user has since replaced — shows out-of-date wording and grants and
 * denies nobody anything. That is what makes it safe to cache an observation at
 * all, and it is the same argument `broker_grants` makes about a receipt.
 *
 * ## Absence is the never-asked state
 *
 * There is no row until something asks a provider. `readLivenessRecord` returns
 * `notChecked()` for a missing row, which is the honest reading: a key nobody
 * has checked and a key whose check DASH has forgotten are the same state, and
 * inventing a row at connect time would put a non-observation in a table of
 * observations.
 */

import { db } from "../db";
import { notChecked, type AiLivenessRecord, type AiLivenessState, AI_LIVENESS_STATES } from "./liveness";

/**
 * Record one observation, replacing whatever was there.
 *
 * A state and not a history, for the reason `evidence_pulls` is one: the
 * question a card asks is "what did the provider say last time", and a log of
 * every check on a machine that has been open for a week would answer it worse
 * and cost more. The audit of what DASH *did* with the key is `broker_audit`,
 * which is a different table answering a different question.
 *
 * Never throws into the caller. A check that failed because a table is sick must
 * not turn into a connection that reports a failure it did not have —
 * `recordBrokerCall` makes the same trade for the same reason.
 */
export function recordLivenessCheck(
  agent: string,
  connectionId: string,
  record: AiLivenessRecord,
): void {
  if (record.checked_at === null) {
    // `not_checked` has no observation behind it, so there is nothing to write.
    // Refusing here rather than storing a null date means the table's
    // `checked_at` can stay NOT NULL, and a row can never assert a check that
    // did not happen.
    return;
  }
  try {
    db()
      .prepare(
        "INSERT INTO ai_key_checks (agent, connection_id, state, checked_at, model_count) " +
          "VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT (agent, connection_id) DO UPDATE SET " +
          "state = excluded.state, checked_at = excluded.checked_at, " +
          "model_count = excluded.model_count",
      )
      .run(agent, connectionId, record.state, record.checked_at, record.model_count);
  } catch (error: unknown) {
    console.warn(
      `[dash] could not record a provider key check: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/**
 * What the provider last said, or the never-asked state.
 *
 * A stored state this build does not recognise reads as never-asked rather than
 * being passed through. `lib/store.ts` guards each row's JSON the same way: a
 * record that cannot be interpreted should render as the absence of a record,
 * which a person can act on, rather than as a fifth state a renderer then has to
 * have a branch for.
 */
export function readLivenessCheck(agent: string, connectionId: string): AiLivenessRecord {
  let row: unknown;
  try {
    row = db()
      .prepare(
        "SELECT state, checked_at, model_count FROM ai_key_checks " +
          "WHERE agent = ? AND connection_id = ?",
      )
      .get(agent, connectionId);
  } catch (error: unknown) {
    console.warn(
      `[dash] could not read a provider key check: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return notChecked();
  }

  if (row === undefined || row === null) {
    return notChecked();
  }
  const record = row as Record<string, unknown>;
  const state = String(record["state"]);
  if (!(AI_LIVENESS_STATES as readonly string[]).includes(state) || state === "not_checked") {
    return notChecked();
  }
  const count = record["model_count"];
  return {
    state: state as AiLivenessState,
    checked_at: String(record["checked_at"]),
    model_count: count === null || count === undefined ? null : Number(count),
  };
}

/**
 * Forget what a provider said about a key DASH no longer holds.
 *
 * Called by disconnect, after the credential is gone, in the order and for the
 * reason `forgetReceipt` is: an observation about a key DASH has deleted would
 * outlive the thing it is an observation of, and the next person to connect a
 * different key would see the previous one's verdict.
 *
 * Deliberately unlike `broker_audit`, which a disconnect keeps. Those rows
 * record what was *done* while the access existed and are exactly the history a
 * suspicious user disconnected in order to check. A liveness row records nothing
 * that happened; it is a cached answer about a credential that is gone.
 */
export function forgetLivenessCheck(agent: string, connectionId: string): void {
  try {
    db()
      .prepare("DELETE FROM ai_key_checks WHERE agent = ? AND connection_id = ?")
      .run(agent, connectionId);
  } catch (error: unknown) {
    console.warn(
      `[dash] could not forget a provider key check: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
