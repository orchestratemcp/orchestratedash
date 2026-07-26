/**
 * The runner's own durable state.
 *
 * **A separate database file, on purpose.** The Agent DOM v2 contract makes the
 * runner a distinct trust domain from DASH — it "validates commands, checks
 * authorization, persists approvals and replay records, enforces gates
 * immediately before side effects" — and a separate trust domain that writes
 * into the other one's database is not a separate trust domain. It is a second
 * process with a shared mutable dependency and a diagram claiming otherwise.
 *
 * So this module does not import `lib/db.ts`, and the duplication that follows
 * (a second `transact`, a second migration runner) is the price of that
 * boundary rather than an oversight. The two schemas are also genuinely
 * different: DASH records what it *decided*, the runner records what it
 * *did*.
 *
 * ## The one place the free-text reason is stored
 *
 * `docs/agent-command-channel.md` settled that DASH never stores an approval's
 * rationale — "keys, never values", with no exceptions — and pointed at the
 * runner as where the answer to "why was this approved" actually lives: "the
 * reason travels to the runner inside the envelope, and the runner is
 * authoritative for execution and keeps its own record." This is that record.
 * It is here rather than in DASH because the runner is the system of record for
 * execution, and because a user auditing their own agent should be able to find
 * the answer somewhere.
 *
 * The location is passed in, never resolved at module-evaluation time.
 * `electron/data-dir.ts` documents what that mistake costs when a module
 * decides its own storage location on import.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Ordered, append-only, and independent of DASH's sequence. Migration 0 here
 * has nothing to do with migration 0 there; they are different databases with
 * different `user_version` counters.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE runner_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Replay protection, at the runner. The contract requires the runner to
  -- "atomically record used nonces" itself; DASH doing the same check first
  -- does not discharge that, because the runner also answers to adapters DASH
  -- did not build. The INSERT is the check, as it is in DASH's store.
  CREATE TABLE command_nonces (
    nonce      TEXT PRIMARY KEY,
    agent      TEXT NOT NULL,
    command_id TEXT NOT NULL,
    seen_at    TEXT NOT NULL
  );

  -- Idempotency, at the runner. Written in_flight before the effect is
  -- attempted and settled after, so a runner that dies mid-delivery leaves a
  -- record saying the outcome is unknown rather than one implying it never
  -- happened.
  CREATE TABLE command_results (
    idempotency_key TEXT PRIMARY KEY,
    agent           TEXT NOT NULL,
    command         TEXT NOT NULL,
    command_id      TEXT NOT NULL,
    status          TEXT NOT NULL,
    outcome_json    TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    settled_at      TEXT
  );

  -- Approvals the runner has resolved. Its own record, not a copy of DASH's:
  -- the runner is what actually let the side effect happen, so this is the row
  -- that answers "who approved this, when, and why".
  --
  -- reason is stored here and nowhere in DASH. See the module header.
  CREATE TABLE approval_decisions (
    request_id  TEXT PRIMARY KEY,
    agent       TEXT NOT NULL,
    decision    TEXT NOT NULL,
    actor_id    TEXT NOT NULL,
    command_id  TEXT NOT NULL,
    reason      TEXT,
    decided_at  TEXT NOT NULL
  );

  -- Every attempt the runner adjudicated, accepted or refused, for the same
  -- reason DASH keeps one: a channel whose refusals are invisible cannot be
  -- audited. Correlation is carried through from the envelope so an
  -- investigation spans both trails.
  CREATE TABLE runner_audit (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id     TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    agent          TEXT NOT NULL,
    command        TEXT NOT NULL,
    actor_id       TEXT NOT NULL,
    decision       TEXT NOT NULL,
    reason_code    TEXT,
    detail         TEXT,
    decided_at     TEXT NOT NULL
  );

  CREATE INDEX runner_audit_by_correlation ON runner_audit (correlation_id);
  CREATE INDEX runner_audit_by_agent ON runner_audit (agent, decided_at);
  `,
];

export interface RunnerStore {
  readonly database: DatabaseSync;
  close(): void;
}

/**
 * Open the runner's database under `directory`, creating it if needed.
 *
 * The pragmas match DASH's store because the reasoning does: WAL so a crash
 * leaves a replayable log rather than a torn file, and `synchronous = FULL` so
 * a committed row is on disk before anything is told it happened. A runner that
 * acknowledged a command it then lost would be worse than one that was slow.
 */
export function openRunnerStore(directory: string): RunnerStore {
  mkdirSync(directory, { recursive: true });
  const database = new DatabaseSync(path.join(directory, "runner.sqlite"));

  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  migrate(database);

  return {
    database,
    close(): void {
      database.close();
    },
  };
}

export function transact<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error: unknown) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrate(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  const applied = Number(row?.user_version ?? 0);

  for (let version = applied; version < MIGRATIONS.length; version += 1) {
    const statements = MIGRATIONS[version];
    if (statements === undefined) {
      continue;
    }
    transact(database, () => {
      database.exec(statements);
      // A loop index over a module constant, never caller input. SQLite does
      // not accept a parameter in a PRAGMA.
      database.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/* ---------------------------------------------------------------------- *
 * Nonces
 * ---------------------------------------------------------------------- */

/** True when this nonce is new. The INSERT is the check; see DASH's twin. */
export function recordNonce(
  database: DatabaseSync,
  nonce: string,
  agent: string,
  commandId: string,
  seenAt: string,
): boolean {
  const inserted = database
    .prepare(
      "INSERT INTO command_nonces (nonce, agent, command_id, seen_at) " +
        "VALUES (?, ?, ?, ?) ON CONFLICT (nonce) DO NOTHING",
    )
    .run(nonce, agent, commandId, seenAt);
  return Number(inserted.changes) === 1;
}

/* ---------------------------------------------------------------------- *
 * Idempotency
 * ---------------------------------------------------------------------- */

export interface RunnerOutcome {
  ok: boolean;
  detail?: string;
}

export interface StoredRunnerResult {
  status: "in_flight" | "settled";
  command_id: string;
  outcome: RunnerOutcome;
}

export function readResult(
  database: DatabaseSync,
  idempotencyKey: string,
): StoredRunnerResult | null {
  const row = database
    .prepare("SELECT status, command_id, outcome_json FROM command_results WHERE idempotency_key = ?")
    .get(idempotencyKey);
  if (row === undefined) {
    return null;
  }
  return {
    status: String(row["status"]) as StoredRunnerResult["status"],
    command_id: String(row["command_id"]),
    outcome: JSON.parse(String(row["outcome_json"])) as RunnerOutcome,
  };
}

/**
 * Claim the key, or return the result that already owns it.
 *
 * Null means this caller won and must perform the effect. Anything else means
 * it lost and must return what it was given without acting — the contract's
 * "returns the same result for duplicates", enforced at the layer that actually
 * performs the side effect rather than only at the one that requested it.
 */
export function claimResult(
  database: DatabaseSync,
  idempotencyKey: string,
  agent: string,
  command: string,
  commandId: string,
  startedAt: string,
): StoredRunnerResult | null {
  const existing = readResult(database, idempotencyKey);
  if (existing !== null) {
    return existing;
  }

  const pending: RunnerOutcome = {
    ok: false,
    detail: "The runner accepted this command and has not recorded how it ended.",
  };
  const inserted = database
    .prepare(
      "INSERT INTO command_results " +
        "(idempotency_key, agent, command, command_id, status, outcome_json, started_at) " +
        "VALUES (?, ?, ?, ?, 'in_flight', ?, ?) ON CONFLICT (idempotency_key) DO NOTHING",
    )
    .run(idempotencyKey, agent, command, commandId, JSON.stringify(pending), startedAt);

  return Number(inserted.changes) === 1 ? null : readResult(database, idempotencyKey);
}

export function settleResult(
  database: DatabaseSync,
  idempotencyKey: string,
  outcome: RunnerOutcome,
  settledAt: string,
): void {
  database
    .prepare(
      "UPDATE command_results SET status = 'settled', outcome_json = ?, settled_at = ? " +
        "WHERE idempotency_key = ?",
    )
    .run(JSON.stringify(outcome), settledAt, idempotencyKey);
}

/* ---------------------------------------------------------------------- *
 * Approvals
 * ---------------------------------------------------------------------- */

export interface ApprovalDecisionRecord {
  request_id: string;
  agent: string;
  decision: "approved" | "rejected";
  actor_id: string;
  command_id: string;
  /** The user's own words. The only place they come to rest. */
  reason?: string;
  decided_at: string;
}

/**
 * Record an approval decision, refusing to overwrite one.
 *
 * Returns the existing decision when the request was already resolved. That is
 * the runner's independent "recheck the approval status immediately before the
 * side effect": DASH checks the snapshot it holds, which may be stale by the
 * time the envelope arrives, and this is the check against the runner's own
 * durable record, which is not.
 */
export function recordApprovalDecision(
  database: DatabaseSync,
  record: ApprovalDecisionRecord,
): ApprovalDecisionRecord | null {
  const inserted = database
    .prepare(
      "INSERT INTO approval_decisions " +
        "(request_id, agent, decision, actor_id, command_id, reason, decided_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (request_id) DO NOTHING",
    )
    .run(
      record.request_id,
      record.agent,
      record.decision,
      record.actor_id,
      record.command_id,
      record.reason ?? null,
      record.decided_at,
    );

  if (Number(inserted.changes) === 1) {
    return null;
  }
  return readApprovalDecision(database, record.request_id);
}

export function readApprovalDecision(
  database: DatabaseSync,
  requestId: string,
): ApprovalDecisionRecord | null {
  const row = database
    .prepare(
      "SELECT request_id, agent, decision, actor_id, command_id, reason, decided_at " +
        "FROM approval_decisions WHERE request_id = ?",
    )
    .get(requestId);
  if (row === undefined) {
    return null;
  }
  return {
    request_id: String(row["request_id"]),
    agent: String(row["agent"]),
    decision: String(row["decision"]) as ApprovalDecisionRecord["decision"],
    actor_id: String(row["actor_id"]),
    command_id: String(row["command_id"]),
    reason: row["reason"] === null ? undefined : String(row["reason"]),
    decided_at: String(row["decided_at"]),
  };
}

/* ---------------------------------------------------------------------- *
 * Audit
 * ---------------------------------------------------------------------- */

export interface RunnerAuditRecord {
  command_id: string;
  correlation_id: string;
  agent: string;
  command: string;
  actor_id: string;
  decision: "accepted" | "refused" | "duplicate";
  reason_code?: string;
  /** Never the free-text reason. Non-secret runner detail only. */
  detail?: string;
  decided_at: string;
}

export function writeRunnerAudit(database: DatabaseSync, record: RunnerAuditRecord): void {
  database
    .prepare(
      "INSERT INTO runner_audit " +
        "(command_id, correlation_id, agent, command, actor_id, decision, reason_code, detail, decided_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      record.command_id,
      record.correlation_id,
      record.agent,
      record.command,
      record.actor_id,
      record.decision,
      record.reason_code ?? null,
      record.detail ?? null,
      record.decided_at,
    );
}

export function readRunnerAudit(database: DatabaseSync, agent?: string): RunnerAuditRecord[] {
  const where = agent === undefined ? "" : " WHERE agent = ?";
  const parameters = agent === undefined ? [] : [agent];
  return database
    .prepare(`SELECT * FROM runner_audit${where} ORDER BY id`)
    .all(...parameters)
    .map((row) => ({
      command_id: String(row["command_id"]),
      correlation_id: String(row["correlation_id"]),
      agent: String(row["agent"]),
      command: String(row["command"]),
      actor_id: String(row["actor_id"]),
      decision: String(row["decision"]) as RunnerAuditRecord["decision"],
      reason_code: row["reason_code"] === null ? undefined : String(row["reason_code"]),
      detail: row["detail"] === null ? undefined : String(row["detail"]),
      decided_at: String(row["decided_at"]),
    }));
}
