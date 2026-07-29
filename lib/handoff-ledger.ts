/**
 * What DASH decided about each handoff it has been shown.
 *
 * The registration file is the source of truth for *what is registered*; this
 * ledger is the record of *what was asked and answered*. Keeping them apart
 * matters because they answer different questions and have different lifetimes:
 * removing an agent deletes its registration and leaves the ledger, so "I added
 * this once and then removed it" stays a fact DASH can state rather than a gap.
 *
 * ## Why this is not the duplicate check
 *
 * "Opening the same handoff twice does not create duplicates" is enforced by the
 * registration file being keyed on the agent's id — see
 * `lib/registration.ts::writeRegistration`, which returns `unchanged` without
 * writing. That holds for two *different* handoffs describing the same agent,
 * which a rebuild produces every time, and a ledger keyed on handoff id could
 * never catch.
 *
 * What the ledger adds is precision in the message. Having seen this exact
 * handoff before lets DASH say "you already added this agent" instead of the
 * vaguer "an agent by that name exists", and that difference is the whole
 * "plain-language recovery path" criterion in one sentence.
 *
 * Nothing secret is written here. Not the nonce — see the migration in
 * `lib/db.ts` — and not the command line.
 */

import { db } from "./db";

export type HandoffOutcome =
  /** A new agent was registered. */
  | "registered"
  /** The same agent, the same facts. Nothing was written. */
  | "unchanged"
  /** An agent that already existed now runs something different, with consent. */
  | "updated"
  /** The user said no. */
  | "declined"
  /** DASH would not open it: expired, mismatched, malformed, unsafe. */
  | "refused";

export interface HandoffRecord {
  handoff_id: string;
  agent: string;
  outcome: HandoffOutcome;
  /** The agent's project directory. Chosen by the user, recognisable to them. */
  source: string;
  /** Plain language. Never a credential, never a command line. */
  detail?: string;
  decided_at: string;
}

/**
 * Record a decision, keeping the first one for a given handoff.
 *
 * `DO NOTHING` rather than an upsert: the interesting fact about a replayed
 * handoff is what happened the *first* time, and letting a later replay
 * overwrite it would erase the registration event behind an "unchanged".
 */
export function recordHandoff(record: HandoffRecord): void {
  db()
    .prepare(
      "INSERT INTO agent_handoffs (handoff_id, agent, outcome, source, detail, decided_at) " +
        "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (handoff_id) DO NOTHING",
    )
    .run(
      record.handoff_id,
      record.agent,
      record.outcome,
      record.source,
      record.detail ?? null,
      record.decided_at,
    );
}

export function readHandoffRecord(handoffId: string): HandoffRecord | null {
  const row = db()
    .prepare(
      "SELECT handoff_id, agent, outcome, source, detail, decided_at " +
        "FROM agent_handoffs WHERE handoff_id = ?",
    )
    .get(handoffId);
  if (row === undefined) {
    return null;
  }
  return {
    handoff_id: String(row["handoff_id"]),
    agent: String(row["agent"]),
    outcome: String(row["outcome"]) as HandoffOutcome,
    source: String(row["source"]),
    detail: row["detail"] === null ? undefined : String(row["detail"]),
    decided_at: String(row["decided_at"]),
  };
}

/** Every decision about one agent, oldest first. For the workspace's history. */
export function readHandoffHistory(agent: string): HandoffRecord[] {
  return db()
    .prepare(
      "SELECT handoff_id, agent, outcome, source, detail, decided_at " +
        "FROM agent_handoffs WHERE agent = ? ORDER BY decided_at, handoff_id",
    )
    .all(agent)
    .map((row) => ({
      handoff_id: String(row["handoff_id"]),
      agent: String(row["agent"]),
      outcome: String(row["outcome"]) as HandoffOutcome,
      source: String(row["source"]),
      detail: row["detail"] === null ? undefined : String(row["detail"]),
      decided_at: String(row["decided_at"]),
    }));
}
