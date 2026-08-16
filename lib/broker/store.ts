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

import { db, getMeta, setMeta } from "../db";
import { maskAccount } from "../secret-refs";
import type { BrokerAuditRow } from "./execute";
import type { BrokerGrant } from "./grant";
import { closedWindow, type UptimeObservation } from "./uptime";

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

/**
 * Whether a receipt exists for this agent and connection.
 *
 * For the decision-filing call sites in `lib/connection-actions.ts`, which
 * need "was this already connected?" *before* they write or delete — the
 * decisions log records transitions, and a reconnect or a re-paste is not
 * one (ADR 0024 decision 1). False on a read error, which errs toward not
 * filing: a missing decision row is a smaller lie than an invented one.
 */
export function hasReceipt(agent: string, connectionId: string): boolean {
  try {
    return (
      db()
        .prepare("SELECT 1 FROM broker_grants WHERE agent = ? AND connection_id = ?")
        .get(agent, connectionId) !== undefined
    );
  } catch {
    return false;
  }
}

/**
 * Forget a receipt. Called by disconnect, after the credential is gone.
 *
 * No decision is filed here, deliberately (ADR 0024 decision 1). This is
 * shared plumbing: the fleet's `withdrawEverywhere` calls it once per agent
 * while executing one person decision, and filing here would turn that one
 * decision into a row per agent nobody individually revoked. The
 * `connection_grant` decision is filed where the per-agent decision is
 * actually made — `lib/connection-actions.ts`.
 */
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
export function recordBrokerCall(row: BrokerAuditRow): number | null {
  try {
    const result = db()
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
    // The row id, so the caller can come back and say whether the answer to this
    // decision ever reached the agent (MAR-467). Returned rather than looked up
    // afterwards by (agent, request_id): that pair is not unique — a replayed
    // request produces a second row carrying the same id with a
    // `duplicate_request` refusal — and an update matching both rows would mark a
    // decision undelivered that was delivered perfectly well.
    return Number(result.lastInsertRowid);
  } catch (error: unknown) {
    console.warn(
      `[dash] could not record a brokered call: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return null;
  }
}

/**
 * Has this agent already had a request with this id adjudicated (MAR-469)?
 *
 * The durable half of replay protection, and it exists because a write appeared.
 * `lib/broker/execute.ts` keeps a bounded per-agent set in memory, which was the
 * whole answer while every operation was a read: the worst a replay could do was
 * read the same message twice. A replayed draft-create puts a second copy in
 * somebody's Drafts folder, and it survives a DASH restart, so the memory has to
 * as well.
 *
 * This is a query rather than a new table. `broker_audit` already records every
 * request id DASH ever decided about, on every path including refusals, and a
 * separate store of "ids seen" would be a second answer to a question the audit
 * already answers — free to disagree with it, and no more durable.
 *
 * **A failure reads as "not seen".** A query that throws must not be able to
 * block a legitimate write, because the alternative is a broken table turning
 * into an agent that can never draft again. The in-memory guard is still there,
 * and the cost of the weaker direction is a duplicate draft rather than a
 * duplicate send — there being no send.
 */
export function hasBrokerRequest(agent: string, requestId: string): boolean {
  try {
    const row = db()
      .prepare("SELECT 1 FROM broker_audit WHERE agent = ? AND request_id = ? LIMIT 1")
      .get(agent, requestId);
    return row !== undefined;
  } catch (error: unknown) {
    console.warn(
      `[dash] could not check a brokered request id: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return false;
  }
}

/**
 * Note that DASH could not confirm this decision's answer reached the agent
 * (MAR-467).
 *
 * Named for what DASH knows rather than for what happened. Three situations
 * reach this function — the child had exited, the POST failed, its reply did not
 * parse — and only the first is certainly a non-delivery. Rather than sort the
 * certain case from the two ambiguous ones and render three shades of the same
 * caution, all three record the claim DASH can actually support.
 *
 * Only ever writes 0. There is no "mark delivered" counterpart and the column
 * stays NULL on the happy path, which is the deliberate asymmetry: a successful
 * delivery is the ordinary case and the reader's default reading of an audit row,
 * so spending a write on every one of them would buy nothing. What is worth a
 * write is the exception, and NULL keeps meaning "nothing to report" rather than
 * being quietly recruited to mean "confirmed fine".
 */
export function markBrokerAnswerUndelivered(auditId: number): void {
  try {
    db().prepare("UPDATE broker_audit SET delivered = 0 WHERE id = ?").run(auditId);
  } catch (error: unknown) {
    console.warn(
      `[dash] could not record an undelivered brokered answer: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/* ---------------------------------------------------------------------- *
 * Lapses — what the audit cannot cover (MAR-467)
 * ---------------------------------------------------------------------- */

/**
 * A brokered attempt or window that DASH did not adjudicate.
 *
 * Read the type as much for what it lacks as for what it has: no operation, no
 * connection, no decision, no refusal. `lib/db.ts` argues the point at the table
 * — the audit trail is worth believing because every row is a decision DASH
 * really made, and the way to keep that true is to give everything else a shape
 * that cannot pass for one.
 */
export interface BrokerLapse {
  id: number;
  kind: BrokerLapseKind;
  /** Null only for `dash_closed`, which is a fact about DASH and not an agent. */
  agent: string | null;
  /** How many requests were destroyed. Null when nobody counted, and nobody can. */
  attempts: number | null;
  from_at: string;
  until_at: string | null;
  observed_by: "runner" | "dash";
}

export type BrokerLapseKind = "dropped_by_runner" | "dash_closed";

export function recordBrokerLapse(lapse: Omit<BrokerLapse, "id">): void {
  try {
    db()
      .prepare(
        "INSERT INTO broker_lapses (kind, agent, attempts, from_at, until_at, observed_by) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(lapse.kind, lapse.agent, lapse.attempts, lapse.from_at, lapse.until_at, lapse.observed_by);
  } catch (error: unknown) {
    // Swallowed for `recordBrokerCall`'s reason: a sick table must not take down
    // the request it is describing. The cost here is smaller and the argument is
    // the same one.
    console.warn(
      `[dash] could not record a broker lapse: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/**
 * Lapses relevant to one agent, newest first.
 *
 * Returns both the drops attributed to this agent and every `dash_closed`
 * window, which carries no agent at all. The join is deliberately this loose:
 * whether a closed window mattered to a particular agent depends on whether its
 * runtime keeps running while DASH is shut, and that is a question about the
 * agent's current manifest rather than about the window. Answering it here would
 * freeze an answer that changes when the manifest does, so the caller answers it.
 */
/**
 * The last time DASH was known to be running (MAR-467).
 *
 * A single `store_meta` row rather than a table of sessions. The only question
 * anyone asks of it is "when did DASH stop", and the answer is a high-water mark
 * — a history of every launch would be a second, longer answer to a question
 * nobody is asking, kept forever.
 */
const LAST_ALIVE_KEY = "broker.dash_last_alive_at";

export function readDashLastAlive(): string | null {
  return getMeta(db(), LAST_ALIVE_KEY);
}

export function writeDashLastAlive(at: string): void {
  try {
    setMeta(db(), LAST_ALIVE_KEY, at);
  } catch (error: unknown) {
    console.warn(
      `[dash] could not record the heartbeat: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}

/**
 * Record the window DASH was closed for, if there is an honest one to record.
 *
 * Called once at startup, before the heartbeat is moved forward. Returns the
 * window it wrote, or null when there was nothing to write — see `closedWindow`,
 * which owns every reason that can be.
 *
 * `attempts` is NULL and that is the whole point of the row. A count of zero
 * would be a claim that nothing was asked, and DASH has no basis for it: nothing
 * was watching. NULL says so.
 */
export function recordClosedWindow(observation: UptimeObservation): { from_at: string; until_at: string } | null {
  const window = closedWindow(observation);
  if (window === null) {
    return null;
  }
  recordBrokerLapse({
    kind: "dash_closed",
    agent: null,
    attempts: null,
    from_at: window.from_at,
    until_at: window.until_at,
    observed_by: "dash",
  });
  return window;
}

/**
 * Forget one agent's lapses. Called when the agent is removed, and by the
 * installed smoke to clear up after its own burst.
 *
 * Deliberately narrower than it looks: `agent IS NULL` rows — the closed windows
 * — are never touched, because they are not this agent's to delete. A window in
 * which DASH was shut is a fact about DASH, and removing an agent does not make
 * DASH have been running.
 */
export function forgetBrokerLapses(agent: string): void {
  db().prepare("DELETE FROM broker_lapses WHERE agent = ?").run(agent);
}

export function readBrokerLapses(agent: string, limit = 20): BrokerLapse[] {
  const rows = db()
    .prepare(
      "SELECT id, kind, agent, attempts, from_at, until_at, observed_by FROM broker_lapses " +
        "WHERE agent = ? OR agent IS NULL ORDER BY id DESC LIMIT ?",
    )
    .all(agent, limit);

  return rows.map((row) => ({
    id: Number(row["id"]),
    kind: String(row["kind"]) as BrokerLapseKind,
    agent: row["agent"] === null ? null : String(row["agent"]),
    attempts: row["attempts"] === null ? null : Number(row["attempts"]),
    from_at: String(row["from_at"]),
    until_at: row["until_at"] === null ? null : String(row["until_at"]),
    observed_by: row["observed_by"] === "runner" ? "runner" : "dash",
  }));
}

export interface BrokerAuditEntry extends BrokerAuditRow {
  id: number;
  /**
   * Whether the answer reached the agent (MAR-467).
   *
   * Three-valued on purpose. `true` is never written — see
   * `markBrokerAnswerUndelivered` — so in practice this is `false` for an answer
   * DASH knows was lost and `null` for every other row, meaning "not known to
   * have failed". `delivered` is not on `BrokerAuditRow` because that type is
   * what the broker hands to the audit at decision time, and at that moment
   * nothing has been delivered yet.
   */
  delivered: boolean | null;
}

/** The most recent calls for one agent, newest first. */
export function readBrokerAudit(agent: string, limit = 50): BrokerAuditEntry[] {
  const rows = db()
    .prepare(
      "SELECT id, agent, connection_id, operation, request_id, decision, refusal, input_keys, " +
        " result_count, account_hint, duration_ms, decided_at, delivered " +
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
    delivered: row["delivered"] === null || row["delivered"] === undefined ? null : row["delivered"] !== 0,
  }));
}
