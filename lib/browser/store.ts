/**
 * Reading and writing the browser's three tables (MAR-628, ADR 0019).
 *
 * The only impure module in `lib/browser/`, and deliberately the thinnest: it
 * writes rows `lib/browser/session.ts` already decided the shape of, and reads
 * them back for the supervision surface. No policy lives here. A function in
 * this file that decided whether something was allowed would be a second
 * authority beside the controller, free to drift from it — which is the note
 * `lib/broker/store.ts` opens with, and it is the same note.
 *
 * ## The trail is a projection, never a permission
 *
 * Nothing here is consulted to decide anything. The controller holds the live
 * session in memory and re-decides every request against the manifest's
 * declared origins, so a row here that has gone stale shows a person
 * out-of-date wording and permits nobody anything. That is what makes it safe
 * to write a receipt at all.
 *
 * ## Why the session row is written twice and its origins once
 *
 * `declared_origins` is written when the session opens and never updated. It is
 * the answer to *what was this run set up for*, which a manifest edited an hour
 * later must not be able to change — a finished receipt describing a permission
 * nobody granted at the time is the failure `recordReceipt` avoids by keeping
 * `granted_at`. `visited_origins`, `first_read_at`, `ended_at` and `end_reason`
 * are current state and are replaced.
 */

import { db } from "../db";
import type {
  BlockedRequestRow,
  BrowserEndReason,
  BrowserSession,
  BrowserTrailRow,
} from "./session";

/* ---------------------------------------------------------------------- *
 * Writing
 * ---------------------------------------------------------------------- */

/** Record that DASH opened a browser for one run. */
export function recordSessionOpened(session: BrowserSession): void {
  db()
    .prepare(
      "INSERT INTO browser_sessions " +
        "(session_id, agent, run_id, declared_origins, visited_origins, opened_at, " +
        "first_read_at, ended_at, end_reason) " +
        "VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL) " +
        "ON CONFLICT (session_id) DO NOTHING",
    )
    .run(
      session.session_id,
      session.agent,
      session.run_id,
      JSON.stringify(session.declared_origins),
      JSON.stringify(session.visited_origins),
      session.opened_at,
    );
}

/**
 * Bring a session's current state up to date.
 *
 * Called after every decided action and once more when the session ends, so
 * that a person who opens DASH while a run is going sees where the browser has
 * actually been rather than where it started.
 */
export function recordSessionProgress(session: BrowserSession): void {
  db()
    .prepare(
      "UPDATE browser_sessions SET visited_origins = ?, first_read_at = ?, " +
        "ended_at = ?, end_reason = ? WHERE session_id = ?",
    )
    .run(
      JSON.stringify(session.visited_origins),
      session.first_read_at,
      session.ended_at,
      session.end_reason,
      session.session_id,
    );
}

/** Record one decided action. One row per request, on every path. */
export function recordBrowserAction(row: BrowserTrailRow): void {
  db()
    .prepare(
      "INSERT INTO browser_actions " +
        "(agent, run_id, session_id, request_id, operation, decision, refusal, origin, " +
        "url_before, url_after, frame_after, decided_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      row.agent,
      row.run_id,
      row.session_id,
      row.request_id,
      row.operation,
      row.decision,
      row.refusal,
      row.origin,
      row.url_before,
      row.url_after,
      row.frame_after,
      row.decided_at,
    );
}

/** Record one request a page made and DASH refused. Nobody asked for these. */
export function recordBlockedRequest(row: BlockedRequestRow): void {
  db()
    .prepare(
      "INSERT INTO browser_blocked (agent, session_id, kind, origin, reason, blocked_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(row.agent, row.session_id, row.kind, row.origin, row.reason, row.blocked_at);
}

/* ---------------------------------------------------------------------- *
 * Reading
 * ---------------------------------------------------------------------- */

/** One session as the surface reads it back. Origins are parsed, not raw JSON. */
export interface StoredBrowserSession {
  session_id: string;
  agent: string;
  run_id: string | null;
  declared_origins: string[];
  visited_origins: string[];
  opened_at: string;
  first_read_at: string | null;
  ended_at: string | null;
  end_reason: BrowserEndReason | null;
}

export interface StoredBrowserAction {
  request_id: string;
  operation: string;
  decision: "allowed" | "refused";
  refusal: string | null;
  origin: string | null;
  url_before: string | null;
  url_after: string | null;
  frame_after: string | null;
  decided_at: string;
}

/**
 * The most rows one surface will read.
 *
 * A bound rather than a page control, because the surface it feeds is a record
 * of one session and a session that produced more than this many actions is one
 * whose rate limit was saturated for minutes. `describeTruncation` is not
 * needed: the count of everything is read separately and rendered, so a person
 * is told how many rows exist rather than shown a list that quietly stops.
 */
export const MAX_TRAIL_ROWS = 200;

/**
 * Parse a stored origin list.
 *
 * Nothing here trusts the column. It is DASH's own JSON and this is not a
 * security boundary, but it is a *version* boundary — an installed DASH can
 * meet a database an older or newer build wrote — and a row that will not parse
 * yields an empty list rather than a throw that takes a page down.
 */
function readOrigins(value: unknown): string[] {
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

/** Every browser session for one agent, newest first. */
export function listBrowserSessions(agent: string, limit = 20): StoredBrowserSession[] {
  const rows = db()
    .prepare(
      "SELECT session_id, agent, run_id, declared_origins, visited_origins, opened_at, " +
        "first_read_at, ended_at, end_reason FROM browser_sessions " +
        "WHERE agent = ? ORDER BY opened_at DESC LIMIT ?",
    )
    .all(agent, limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    session_id: String(row["session_id"]),
    agent: String(row["agent"]),
    run_id: row["run_id"] === null ? null : String(row["run_id"]),
    declared_origins: readOrigins(row["declared_origins"]),
    visited_origins: readOrigins(row["visited_origins"]),
    opened_at: String(row["opened_at"]),
    first_read_at: row["first_read_at"] === null ? null : String(row["first_read_at"]),
    ended_at: row["ended_at"] === null ? null : String(row["ended_at"]),
    end_reason: row["end_reason"] === null ? null : (String(row["end_reason"]) as BrowserEndReason),
  }));
}

/** Every decided action in one session, oldest first — the order it happened. */
export function listBrowserActions(sessionId: string): StoredBrowserAction[] {
  const rows = db()
    .prepare(
      "SELECT request_id, operation, decision, refusal, origin, url_before, url_after, " +
        "frame_after, decided_at FROM browser_actions " +
        "WHERE session_id = ? ORDER BY id ASC LIMIT ?",
    )
    .all(sessionId, MAX_TRAIL_ROWS) as Array<Record<string, unknown>>;

  return rows.map(readAction);
}

/** One stored action row, field by field. Shared by the two readers above. */
function readAction(row: Record<string, unknown>): StoredBrowserAction {
  return {
    request_id: String(row["request_id"]),
    operation: String(row["operation"]),
    decision: String(row["decision"]) === "allowed" ? "allowed" : "refused",
    refusal: row["refusal"] === null ? null : String(row["refusal"]),
    origin: row["origin"] === null ? null : String(row["origin"]),
    url_before: row["url_before"] === null ? null : String(row["url_before"]),
    url_after: row["url_after"] === null ? null : String(row["url_after"]),
    frame_after: row["frame_after"] === null ? null : String(row["frame_after"]),
    decided_at: String(row["decided_at"]),
  };
}

/**
 * Actions decided before any browser existed (MAR-628).
 *
 * **The hole MAR-628's first real proof run found.** The most interesting
 * refusal this system produces — an agent asking for an origin the run was not
 * set up for — is refused at step 7 of `handle`, which is *before* step 8 opens
 * a session. So it is written with an empty `session_id`, and a surface that
 * lists sessions and then their actions renders it nowhere at all. The row was
 * there and no person could see it, which is the exact failure the trail exists
 * to prevent, arrived at from the other direction.
 *
 * They are read per agent rather than per run because a refusal before a
 * session may also precede the run's first event, so there is nothing to group
 * it under yet.
 */
export function listSessionlessBrowserActions(agent: string): StoredBrowserAction[] {
  const rows = db()
    .prepare(
      "SELECT request_id, operation, decision, refusal, origin, url_before, url_after, " +
        "frame_after, decided_at FROM browser_actions " +
        "WHERE agent = ? AND session_id = '' ORDER BY id DESC LIMIT ?",
    )
    .all(agent, MAX_TRAIL_ROWS) as Array<Record<string, unknown>>;
  return rows.map(readAction).reverse();
}

/**
 * How many requests a page made that DASH refused, in one session.
 *
 * A count and not a list, on purpose. The rows are there and a developer can
 * read them, but the surface shows a number: an advert network's twenty hosts
 * are twenty rows of noise on a record whose whole value is that a person can
 * read it, and `describeBlocked` says the useful thing about them in one
 * sentence.
 */
export function countBlockedRequests(sessionId: string): number {
  const row = db()
    .prepare("SELECT COUNT(*) AS n FROM browser_blocked WHERE session_id = ?")
    .get(sessionId) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}
