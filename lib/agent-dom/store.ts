/**
 * The durable half of the command channel: state snapshots, nonces,
 * idempotency results and the command audit trail.
 *
 * This is the module MAR-416's "schema headroom" was for. It inherits that
 * store's properties rather than re-arguing them: WAL journalling, a durable
 * commit before acknowledgement, and `transact` for anything that must be
 * all-or-nothing (see `docs/local-store-and-vault.md`).
 *
 * Nothing here stores a payload *value*. `lib/shell/ipc.ts` has audited keys
 * and never values since the boundary was built, and moving the audit from a
 * log line into a table is not a reason to relax that — the free-text `reason`
 * a user types travels to the runner in the envelope and stops there.
 */

import type { DatabaseSync } from "node:sqlite";

import { validateState } from "../contracts";
import { db, readRowsTolerantly, transact } from "../db";
import type { AgentDomState } from "../workspace";
import { decisionIdentity, type CommandRejection } from "./enforce";
import type { AgentCommandEnvelope } from "./envelope";

/* ---------------------------------------------------------------------- *
 * State snapshots
 * ---------------------------------------------------------------------- */

export interface StoredSnapshot {
  agent: string;
  /**
   * The freshness value the command layer binds to. Advances only when the
   * decision context does — see `putAgentDomState`.
   */
  observed_at: string;
  /** What the runner last said, untouched. Orders snapshots; binds nothing. */
  runner_observed_at: string;
  /** `decisionIdentity` of the stored document; null on a pre-MAR-464 row. */
  decision_identity: string | null;
  state: AgentDomState;
  received_at: string;
}

export type SnapshotResult =
  | { ok: true; agent: string; observed_at: string; superseded: boolean }
  | { ok: false; errors: string[] };

/**
 * Accept one Agent DOM state snapshot.
 *
 * Validated against the contract on the way in, exactly as manifests and events
 * are. A snapshot is a document DASH *receives*, and this one decides whether a
 * command may run — so trusting its shape because an adapter sent it would put
 * target resolution at the mercy of whatever the adapter felt like emitting.
 *
 * An older snapshot for an agent DASH already has newer state for is refused
 * rather than applied. Out-of-order arrival would otherwise roll the world
 * backwards: an approval the runner has already resolved would look pending
 * again, and the command layer would happily act on it.
 *
 * ## Why `observed_at` is allowed to stand still (MAR-464)
 *
 * The runner mints `observed_at` on every build and `electron/agent-adapters.ts`
 * rebuilds every five seconds, so the value moved whether or not anything had
 * happened. Every control bound to a rendered snapshot was therefore refused as
 * `stale_snapshot` about five seconds after it was drawn — including Approve and
 * Reject on a runner-enforced approval.
 *
 * So the value carried forward here whenever `decisionIdentity` is unchanged.
 * The stored document is rewritten to agree with it, because the command layer
 * compares against the parsed document and two spellings of the same fact are
 * how the two halves of a check drift apart.
 *
 * **This is not DASH editing a document it received.** The content is stored
 * exactly as it arrived; what is declined is the *advance of an identity* for
 * content that did not change. The value written is always one the runner
 * itself minted for this same decision context, and it can only ever be older
 * than the arriving one — DASH can make a snapshot look its age, never fresher.
 * That direction matters: the invariant `runner/state.ts` protects is that an
 * agent must not be able to make old state look current, and freezing moves the
 * value the other way.
 *
 * Three properties come back at once, and the third is the one that would have
 * been quietly lost by the tempting fix of re-reading the snapshot before every
 * command:
 *
 * 1. **Approvals survive being read.** A person may look at the screen for as
 *    long as they like, because looking is not an event.
 * 2. **"The world changed, look again" starts meaning it.** The refusal now
 *    fires when the decision context moved, which is the only time it was ever
 *    worth firing.
 * 3. **Idempotency works for the first time.** `idempotencyKey` hashes
 *    `observed_at`, so under a churning value two clicks six seconds apart
 *    derived *different* keys — the anti-duplication defence held for a fast
 *    double click and quietly lapsed for a slow one. Re-reading before each
 *    command would have made every click derive a fresh key and removed the
 *    defence entirely.
 */
export function putAgentDomState(input: unknown, receivedAt: string = new Date().toISOString()): SnapshotResult {
  const validation = validateState(input);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const state = validation.value;
  const database = db();

  return transact(database, () => {
    const existing = readSnapshotRow(database, state.agent_id);
    // Ordered on the runner's own timestamps. Comparing frozen values would
    // accept a snapshot older than the newest one seen, so long as it was newer
    // than whenever the current context began — which is precisely the rollback
    // this guard exists to refuse.
    if (existing !== null && existing.runner_observed_at > state.observed_at) {
      return {
        ok: true as const,
        agent: state.agent_id,
        observed_at: existing.observed_at,
        superseded: true,
      };
    }

    const identity = decisionIdentity(state);
    const unchanged = existing !== null && existing.decision_identity === identity;
    const observedAt = unchanged ? existing.observed_at : state.observed_at;
    const stored: AgentDomState = { ...state, observed_at: observedAt };

    database
      .prepare(
        "INSERT INTO agent_dom_state " +
          "(agent, observed_at, runner_observed_at, decision_identity, state_json, received_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (agent) DO UPDATE SET " +
          "observed_at = excluded.observed_at, runner_observed_at = excluded.runner_observed_at, " +
          "decision_identity = excluded.decision_identity, state_json = excluded.state_json, " +
          "received_at = excluded.received_at",
      )
      .run(
        state.agent_id,
        observedAt,
        state.observed_at,
        identity,
        JSON.stringify(stored),
        receivedAt,
      );

    return {
      ok: true as const,
      agent: state.agent_id,
      observed_at: observedAt,
      superseded: false,
    };
  });
}

/**
 * Read the row, tolerating one written before MAR-464's migration.
 *
 * Both new columns are nullable because `ALTER TABLE ... ADD COLUMN` fills
 * existing rows with NULL, and every installed DASH has one. A null
 * `runner_observed_at` falls back to `observed_at`, which is exactly what it
 * held before the freeze existed. A null `decision_identity` is reported as
 * such rather than being recomputed from the stored document: the next snapshot
 * then counts as a change and advances `observed_at` once. Recomputing would
 * look tidier and would be a guess that the stored bytes still hash to what
 * they hashed to under whatever projection was current when they were written.
 */
function readSnapshotRow(database: DatabaseSync, agent: string): StoredSnapshot | null {
  const row = database
    .prepare(
      "SELECT agent, observed_at, runner_observed_at, decision_identity, state_json, received_at " +
        "FROM agent_dom_state WHERE agent = ?",
    )
    .get(agent);
  if (row === undefined) {
    return null;
  }
  const observedAt = String(row["observed_at"]);
  const runnerObservedAt = row["runner_observed_at"];
  const identity = row["decision_identity"];
  return {
    agent: String(row["agent"]),
    observed_at: observedAt,
    runner_observed_at:
      runnerObservedAt === null || runnerObservedAt === undefined
        ? observedAt
        : String(runnerObservedAt),
    decision_identity:
      identity === null || identity === undefined ? null : String(identity),
    state: JSON.parse(String(row["state_json"])) as AgentDomState,
    received_at: String(row["received_at"]),
  };
}

/** The snapshot DASH currently holds for an agent, or null when it holds none. */
export function readAgentDomState(agent: string): StoredSnapshot | null {
  return readSnapshotRow(db(), agent);
}

/* ---------------------------------------------------------------------- *
 * Nonces
 * ---------------------------------------------------------------------- */

/**
 * Record a nonce, and report whether it had already been used.
 *
 * The INSERT is the check. Reading first and inserting second would leave a
 * window in which two submissions of the same envelope both find nothing and
 * both proceed — which is the exact scenario replay protection exists for, so
 * implementing it with a race would be worse than not claiming it.
 *
 * A rejected command still burns its nonce. Single-use means single-use, and a
 * legitimate re-issue carries a fresh one anyway.
 */
export function recordNonce(
  database: DatabaseSync,
  envelope: AgentCommandEnvelope,
  seenAt: string,
): boolean {
  const inserted = database
    .prepare(
      "INSERT INTO command_nonces (nonce, agent, command_id, seen_at) " +
        "VALUES (?, ?, ?, ?) ON CONFLICT (nonce) DO NOTHING",
    )
    .run(envelope.nonce, envelope.target.agent_id, envelope.command_id, seenAt);
  return Number(inserted.changes) === 1;
}

/* ---------------------------------------------------------------------- *
 * Idempotency
 * ---------------------------------------------------------------------- */

/** What a command did, as returned to the caller and stored for duplicates. */
export interface CommandOutcome {
  ok: boolean;
  reason?: CommandRejection;
  /** Non-secret, command-specific detail from the adapter. */
  detail?: string;
}

export interface StoredCommandResult {
  status: "in_flight" | "settled";
  command_id: string;
  outcome: CommandOutcome;
}

/**
 * Claim an idempotency key, or report that it is already claimed.
 *
 * Returns null when this command is the first to claim the key and may proceed;
 * returns the stored result when it is a duplicate, in which case the caller
 * must return that result and perform no effect.
 *
 * The row is written *before* the adapter is called, which is the contract's
 * "store the idempotency result before or with an irreversible effect". The
 * cost is that a crash mid-dispatch leaves an `in_flight` row and a duplicate
 * is told the outcome is unknown. That is the right way round: an unknown
 * outcome is resolved by looking, a duplicated irreversible action is not.
 */
export function claimIdempotencyKey(
  database: DatabaseSync,
  envelope: AgentCommandEnvelope,
  startedAt: string,
): StoredCommandResult | null {
  const existing = readCommandResult(database, envelope.idempotency_key);
  if (existing !== null) {
    return existing;
  }

  const pending: CommandOutcome = {
    ok: false,
    detail: "This command was submitted and DASH has not recorded how it ended.",
  };
  const inserted = database
    .prepare(
      "INSERT INTO command_results " +
        "(idempotency_key, agent, command, command_id, status, outcome_json, started_at) " +
        "VALUES (?, ?, ?, ?, 'in_flight', ?, ?) ON CONFLICT (idempotency_key) DO NOTHING",
    )
    .run(
      envelope.idempotency_key,
      envelope.target.agent_id,
      envelope.command,
      envelope.command_id,
      JSON.stringify(pending),
      startedAt,
    );

  // Lost the race to another writer between the read and the insert. The other
  // one owns the effect; this one is a duplicate.
  return Number(inserted.changes) === 1 ? null : readCommandResult(database, envelope.idempotency_key);
}

export function settleCommandResult(
  database: DatabaseSync,
  idempotencyKey: string,
  outcome: CommandOutcome,
  settledAt: string,
): void {
  database
    .prepare(
      "UPDATE command_results SET status = 'settled', outcome_json = ?, settled_at = ? " +
        "WHERE idempotency_key = ?",
    )
    .run(JSON.stringify(outcome), settledAt, idempotencyKey);
}

export function readCommandResult(
  database: DatabaseSync,
  idempotencyKey: string,
): StoredCommandResult | null {
  const row = database
    .prepare("SELECT status, command_id, outcome_json FROM command_results WHERE idempotency_key = ?")
    .get(idempotencyKey);
  if (row === undefined) {
    return null;
  }
  return {
    status: String(row["status"]) as StoredCommandResult["status"],
    command_id: String(row["command_id"]),
    outcome: JSON.parse(String(row["outcome_json"])) as CommandOutcome,
  };
}

/* ---------------------------------------------------------------------- *
 * Audit
 * ---------------------------------------------------------------------- */

/**
 * One attempt at the command channel.
 *
 * Named `AgentCommandAuditRecord` rather than sharing `lib/shell/ipc.ts`'s
 * `CommandAuditRecord` because they record different events: that one records
 * a *request crossing the IPC boundary*, this one records a *command being
 * decided against an agent*. A malformed request never becomes one of these,
 * and collapsing the two would mean the shell boundary could only log things
 * that had already been resolved to an agent.
 */
export interface AgentCommandAuditRecord {
  command_id: string;
  request_id: string;
  correlation_id: string;
  causation_id?: string;
  agent: string | null;
  run_id: string | null;
  command: string;
  actor_id: string;
  actor_type: string;
  authenticated_by: string;
  /** `duplicate` is an outcome, not a refusal: the stored result was returned. */
  decision: "allowed" | "denied" | "duplicate";
  reason?: CommandRejection;
  /** Key names only, never values. */
  payload_keys: string[];
  mutates: boolean;
  irreversible: boolean;
  issued_at: string | null;
  expires_at: string | null;
  decided_at: string;
}

export function writeCommandAudit(
  database: DatabaseSync,
  record: AgentCommandAuditRecord,
): void {
  database
    .prepare(
      "INSERT INTO command_audit (command_id, request_id, correlation_id, causation_id, " +
        "agent, run_id, command, actor_id, actor_type, authenticated_by, decision, reason, " +
        "payload_keys, mutates, irreversible, issued_at, expires_at, decided_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      record.command_id,
      record.request_id,
      record.correlation_id,
      record.causation_id ?? null,
      record.agent,
      record.run_id,
      record.command,
      record.actor_id,
      record.actor_type,
      record.authenticated_by,
      record.decision,
      record.reason ?? null,
      JSON.stringify(record.payload_keys),
      record.mutates ? 1 : 0,
      record.irreversible ? 1 : 0,
      record.issued_at,
      record.expires_at,
      record.decided_at,
    );
}

export interface AuditQuery {
  agent?: string;
  correlation_id?: string;
}

/**
 * Read the audit trail back.
 *
 * Correlation is a first-class filter because "show me every attempt against
 * this approval, accepted and rejected together" is the question the trail
 * exists to answer.
 */
export function readCommandAudit(query: AuditQuery = {}): AgentCommandAuditRecord[] {
  const clauses: string[] = [];
  const parameters: string[] = [];
  if (query.agent !== undefined) {
    clauses.push("agent = ?");
    parameters.push(query.agent);
  }
  if (query.correlation_id !== undefined) {
    clauses.push("correlation_id = ?");
    parameters.push(query.correlation_id);
  }
  const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
  const narrowed = clauses.length === 0 ? "" : ` AND ${clauses.join(" AND ")}`;

  /**
   * Read tolerantly, because this is the table that actually failed.
   *
   * On the store that prompted this change, `SELECT * FROM command_audit` threw
   * `SQLITE_CORRUPT` while `count(*)` still answered 12 from an index. An audit
   * trail is the last thing that should become unreadable in bulk because one
   * page went bad — `lib/store.ts` argues that DASH must not erase its own
   * record of what happened, and losing it to a failed read would be the same
   * outcome by accident.
   *
   * Rows on the damaged page are absent rather than substituted. A gap in an
   * audit trail is a fact; a placeholder row in one would be a fabrication.
   */
  const read = readRowsTolerantly(db(), {
    table: "command_audit",
    bulk: `SELECT * FROM command_audit${where} ORDER BY id`,
    byRowid: `SELECT * FROM command_audit WHERE rowid = ?${narrowed}`,
    parameters,
  });

  if (read.lost > 0) {
    /**
     * Said out loud, because this is an audit trail.
     *
     * Everywhere else a tolerant read can quietly return what survived; here,
     * silently handing back a shorter trail than exists would be the log
     * misrepresenting itself — the one failure mode a record of what happened
     * must not have. The count is the whole message: no row content, because
     * these rows are unreadable by definition, and `formatCommandAuditLine`
     * exists precisely so audit output is never improvised.
     */
    console.warn(
      `[dash-command] ${String(read.lost)} audit row(s) are unreadable; this trail is incomplete`,
    );
  }

  return read.rows.map((row) => ({
      command_id: String(row["command_id"]),
      request_id: String(row["request_id"]),
      correlation_id: String(row["correlation_id"]),
      causation_id: row["causation_id"] === null ? undefined : String(row["causation_id"]),
      agent: row["agent"] === null ? null : String(row["agent"]),
      run_id: row["run_id"] === null ? null : String(row["run_id"]),
      command: String(row["command"]),
      actor_id: String(row["actor_id"]),
      actor_type: String(row["actor_type"]),
      authenticated_by: String(row["authenticated_by"]),
      decision: String(row["decision"]) as AgentCommandAuditRecord["decision"],
      reason: row["reason"] === null ? undefined : (String(row["reason"]) as CommandRejection),
      payload_keys: JSON.parse(String(row["payload_keys"])) as string[],
      mutates: Number(row["mutates"]) === 1,
      irreversible: Number(row["irreversible"]) === 1,
      issued_at: row["issued_at"] === null ? null : String(row["issued_at"]),
      expires_at: row["expires_at"] === null ? null : String(row["expires_at"]),
      decided_at: String(row["decided_at"]),
    }));
}

/**
 * One log line per attempt, for the same reason `formatAuditLine` exists in
 * `lib/shell/ipc.ts`: keeping the formatter beside the record is what stops a
 * well-meaning `JSON.stringify(payload)` appearing in a console call later.
 */
export function formatCommandAuditLine(record: AgentCommandAuditRecord): string {
  const keys = record.payload_keys.length > 0 ? ` keys=[${record.payload_keys.join(",")}]` : "";
  const reason = record.reason ? ` reason=${record.reason}` : "";
  return (
    `[dash-command] ${record.decision} command=${record.command} agent=${record.agent ?? "-"}` +
    ` run=${record.run_id ?? "-"} actor=${record.actor_id} via=${record.authenticated_by}` +
    `${keys}${reason} corr=${record.correlation_id} id=${record.command_id}`
  );
}
