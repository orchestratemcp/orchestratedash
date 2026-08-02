/**
 * Reading and writing the broker's two tables (MAR-458, ADR 0002).
 *
 * The only impure module in `lib/broker/`, and deliberately the thinnest: it
 * writes rows the executor already decided the shape of, and reads them back for
 * the Connection Center. No policy lives here — a function in this file that
 * decided whether something was allowed would be a second authority beside
 * `lib/broker/grant.ts`, free to drift from it.
 *
 * ## The receipt is a projection, not a permission
 *
 * `broker_grants` is what a person reads. It is never consulted to decide
 * anything: `lib/broker/execute.ts` recomputes the grant from the manifest and
 * the live credential on every call, so a row here that has gone stale shows a
 * user out-of-date wording and grants nobody anything. That is what makes it
 * safe to cache a receipt at all.
 */

import { db } from "../db";
import { maskAccount } from "../secret-refs";
import type { BrokerAuditRow } from "./execute";
import type { BrokerGrant } from "./grant";

/* ---------------------------------------------------------------------- *
 * Receipts
 * ---------------------------------------------------------------------- */

export interface BrokerReceipt {
  agent: string;
  connection_id: string;
  field_id: string;
  /** Masked, e.g. `he••@gmail.com`. Never a full address. */
  account_hint: string | null;
  /** The granted operation ids at the time the receipt was written. */
  operations: string[];
  granted_at: string;
  last_used_at: string | null;
}

/**
 * Write or refresh the receipt for one grant.
 *
 * `granted_at` survives an update. The date a user first approved this is the
 * fact the receipt exists to carry, and overwriting it on every reconnect would
 * make every grant look like it was approved this morning — which is the one
 * number a person would use to notice access they no longer remember giving.
 *
 * Everything else is replaced, because everything else is current state: the
 * account can change when a user reconnects with a different one, and the
 * operation set can shrink when they untick a box.
 */
export function recordReceipt(grant: BrokerGrant, at: string): void {
  const operations = JSON.stringify(grant.operations.map((operation) => operation.id));
  // Masked here, at the one point the address is in hand, exactly as
  // `lib/connection-actions.ts` masks before writing `connection_secrets`.
  //
  // This line was wrong when it was first written — it stored `grant.account`
  // whole — and `tests/oauth-connection.test.ts`'s "puts no part of the token or
  // the account in the database file" caught it on the first run. Worth leaving
  // a note on: the grant carries the real address because the broker needs it to
  // mask consistently, so every writer of it has to mask, and only this one and
  // the audit ever write it anywhere.
  const accountHint = grant.account === null ? null : maskAccount(grant.account);
  db()
    .prepare(
      "INSERT INTO broker_grants " +
        "(agent, connection_id, field_id, account_hint, operations, granted_at, last_used_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, NULL) " +
        "ON CONFLICT (agent, connection_id) DO UPDATE SET " +
        "field_id = excluded.field_id, account_hint = excluded.account_hint, " +
        "operations = excluded.operations",
    )
    .run(
      grant.agent_id,
      grant.connection_id,
      grant.field_id,
      accountHint,
      operations,
      at,
    );
}

/**
 * Note that a grant was used.
 *
 * Separate from `recordReceipt` and deliberately not an upsert: a "last used"
 * for a grant with no receipt row would be a use of something the user was never
 * shown they approved, and inventing the row here would hide that rather than
 * surface it. In practice the row is written when the connection is made.
 */
export function touchReceipt(agent: string, connectionId: string, at: string): void {
  db()
    .prepare(
      "UPDATE broker_grants SET last_used_at = ? WHERE agent = ? AND connection_id = ?",
    )
    .run(at, agent, connectionId);
}

/** Forget a receipt. Called by disconnect, after the credential is gone. */
export function forgetReceipt(agent: string, connectionId: string): void {
  db().prepare("DELETE FROM broker_grants WHERE agent = ? AND connection_id = ?").run(agent, connectionId);
}

export function listReceipts(agent: string): BrokerReceipt[] {
  const rows = db()
    .prepare(
      "SELECT agent, connection_id, field_id, account_hint, operations, granted_at, last_used_at " +
        "FROM broker_grants WHERE agent = ? ORDER BY granted_at",
    )
    .all(agent);

  return rows.map((row) => ({
    agent: String(row["agent"]),
    connection_id: String(row["connection_id"]),
    field_id: String(row["field_id"]),
    account_hint: row["account_hint"] === null ? null : String(row["account_hint"]),
    operations: parseOperations(row["operations"]),
    granted_at: String(row["granted_at"]),
    last_used_at: row["last_used_at"] === null ? null : String(row["last_used_at"]),
  }));
}

/**
 * A stored operation list, or an empty one.
 *
 * A damaged value yields no capabilities rather than a throw, for the reason
 * `lib/store.ts` guards each row's JSON: a receipt that cannot be read should
 * render as a receipt with nothing on it, which a user can act on, rather than
 * taking down the page that would have let them disconnect.
 */
function parseOperations(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------- *
 * Audit
 * ---------------------------------------------------------------------- */

/**
 * Record one attempt.
 *
 * Never throws into the caller. An audit write that failed and took the request
 * down with it would mean a broken table turns into a broken connection; an
 * audit write that failed silently would mean a gap nobody sees. So it is caught
 * and reported to the console, and the call proceeds — the same trade
 * `lib/agent-dom/store.ts` makes, and the one worth making when the alternative
 * is denying a user their own mail because a log is sick.
 *
 * The values written are the ones `BrokerAuditRow` already restricted. This
 * function adds nothing and reads nothing it was not given.
 */
export function recordBrokerCall(row: BrokerAuditRow): void {
  try {
    db()
      .prepare(
        "INSERT INTO broker_audit " +
          "(agent, connection_id, operation, request_id, decision, refusal, input_keys, " +
          " result_count, account_hint, duration_ms, decided_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        row.agent,
        row.connection_id,
        row.operation,
        row.request_id,
        row.decision,
        row.refusal,
        JSON.stringify(row.input_keys),
        row.result_count,
        row.account_hint,
        row.duration_ms,
        row.decided_at,
      );
  } catch (error: unknown) {
    console.warn(
      `[dash] could not record a brokered call: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

export interface BrokerAuditEntry extends BrokerAuditRow {
  id: number;
}

/** The most recent calls for one agent, newest first. */
export function readBrokerAudit(agent: string, limit = 50): BrokerAuditEntry[] {
  const rows = db()
    .prepare(
      "SELECT id, agent, connection_id, operation, request_id, decision, refusal, input_keys, " +
        " result_count, account_hint, duration_ms, decided_at " +
        "FROM broker_audit WHERE agent = ? ORDER BY id DESC LIMIT ?",
    )
    .all(agent, limit);

  return rows.map((row) => ({
    id: Number(row["id"]),
    agent: String(row["agent"]),
    connection_id: String(row["connection_id"]),
    operation: String(row["operation"]),
    request_id: String(row["request_id"]),
    decision: row["decision"] === "allowed" ? "allowed" : "refused",
    refusal: row["refusal"] === null ? null : (String(row["refusal"]) as BrokerAuditRow["refusal"]),
    input_keys: parseOperations(row["input_keys"]),
    result_count: row["result_count"] === null ? null : Number(row["result_count"]),
    account_hint: row["account_hint"] === null ? null : String(row["account_hint"]),
    duration_ms: Number(row["duration_ms"]),
    decided_at: String(row["decided_at"]),
  }));
}
