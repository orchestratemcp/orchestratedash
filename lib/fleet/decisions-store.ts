/**
 * Filing and reading the decisions log (MAR-673, ADR 0024).
 *
 * The impure half of `lib/fleet/decisions.ts`, in `lib/chief/store.ts`'s
 * shape: it stores what the write-sites decided and reads it back for
 * whoever is drawing the surface or the briefing. No policy here — a
 * function in this file that decided what a superseded row *meant* would be
 * a second authority beside `markDecisions`, free to drift from it.
 *
 * ## Filing never fails the change it records
 *
 * `fileDecision` warns and returns rather than throwing, on every store
 * module's rule — with one deliberate nuance. Called with the writer's own
 * `database` it joins that transaction, so the change and its record land
 * together or not at all (ADR 0024 decision 1); called without one it is a
 * best-effort append, and a failed append must not undo a change the person
 * already made. The write-sites that hold a transaction pass it; the
 * single-statement ones do not, and for them the change is already
 * committed by the time this runs.
 */

import type { DatabaseSync } from "node:sqlite";

import { db } from "../db";
import {
  isDecisionKind,
  type DecisionAuthor,
  type DecisionDraft,
  type DecisionRecord,
  type DecisionSubjectKind,
} from "./decisions";

/**
 * Write one decision, and say whether it landed.
 *
 * When `database` is supplied the insert runs on the caller's connection —
 * inside whatever transaction the caller holds — and a throw propagates so
 * `transact` rolls the change and the record back together. Standalone, it
 * catches and warns: see the module header.
 */
export function fileDecision(draft: DecisionDraft, database?: DatabaseSync): boolean {
  const run = (handle: DatabaseSync): void => {
    handle
      .prepare(
        "INSERT INTO fleet_decisions " +
          "(decided_at, subject_kind, subject_id, kind, topic, summary, outcome_json, " +
          "decided_by, rule, reason, reason_added_at, receipts_json) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
      )
      .run(
        draft.decided_at,
        draft.subject_kind,
        draft.subject_id,
        draft.kind,
        draft.topic,
        draft.summary,
        JSON.stringify(draft.outcome),
        draft.decided_by,
        draft.rule,
        draft.reason,
        JSON.stringify(draft.receipts),
      );
  };

  if (database !== undefined) {
    run(database);
    return true;
  }
  try {
    run(db());
    return true;
  } catch (error: unknown) {
    console.warn(`[dash] could not file a decision: ${message(error)}`);
    return false;
  }
}

/**
 * Every decision, oldest first — the order `markDecisions` requires, and the
 * store's arrival order is exactly the supersession order, so nothing here
 * re-decides what "newer" means.
 *
 * The whole log rather than a page. ADR 0024 decision 1's filter is what
 * makes that affordable — the log grows at the speed a person changes their
 * fleet — and reading it whole is what lets supersession be computed from
 * ordering alone. The day this table needs a limit is the day the kinds
 * list widened too far, and this comment is the tripwire.
 */
export function readDecisions(): DecisionRecord[] {
  let rows: unknown[];
  try {
    rows = db()
      .prepare(
        "SELECT id, decided_at, subject_kind, subject_id, kind, topic, summary, " +
          "outcome_json, decided_by, rule, reason, reason_added_at, receipts_json " +
          "FROM fleet_decisions ORDER BY id",
      )
      .all() as unknown[];
  } catch (error: unknown) {
    console.warn(`[dash] could not read the decisions log: ${message(error)}`);
    return [];
  }

  const decisions: DecisionRecord[] = [];
  for (const row of rows) {
    const decision = projectDecision(row);
    if (decision !== null) {
      decisions.push(decision);
    }
  }
  return decisions;
}

/**
 * One stored row as a decision, or null.
 *
 * `projectExchange`'s rule: a row this build cannot interpret — a kind it
 * does not know, a subject kind it does not know — reads as the absence of
 * a record rather than as a value every renderer downstream needs a branch
 * for. An unreadable `outcome_json` degrades to an empty object instead of
 * dropping the row: the summary sentence is still true and still worth
 * showing, and an empty outcome only disables the drift comparison, which
 * `markDecisions` already treats as "did not look".
 */
function projectDecision(row: unknown): DecisionRecord | null {
  const record = row as Record<string, unknown>;
  const kind = record["kind"];
  if (!isDecisionKind(kind)) {
    return null;
  }
  const subjectKind = record["subject_kind"];
  if (subjectKind !== "agent" && subjectKind !== "connection" && subjectKind !== "fleet") {
    return null;
  }
  const decidedBy = record["decided_by"];
  if (decidedBy !== "person" && decidedBy !== "dash-rule") {
    return null;
  }
  return {
    id: Number(record["id"]),
    decided_at: String(record["decided_at"]),
    subject_kind: subjectKind as DecisionSubjectKind,
    subject_id: typeof record["subject_id"] === "string" ? record["subject_id"] : null,
    kind,
    topic: String(record["topic"] ?? ""),
    summary: String(record["summary"] ?? ""),
    outcome: parseObject(record["outcome_json"]),
    decided_by: decidedBy as DecisionAuthor,
    rule: typeof record["rule"] === "string" ? record["rule"] : null,
    reason: typeof record["reason"] === "string" ? record["reason"] : null,
    reason_added_at:
      typeof record["reason_added_at"] === "string" ? record["reason_added_at"] : null,
    receipts: parseReceipts(record["receipts_json"]),
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseReceipts(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown";
}
