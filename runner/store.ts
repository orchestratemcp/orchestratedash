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

import { classifyStoreError, type RunnerStoreDamage } from "./store-damage";

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
  // MAR-434. The task workspace's index.
  //
  // It is in the runner's database rather than DASH's for the reason the module
  // header gives for there being two databases at all: the runner owns these
  // files, so the runner owns the record of them. DASH holds a projection it
  // renders, which it drains like telemetry — and a projection that disagrees
  // with this table is a bug in the drain, not a second opinion.
  //
  // The whole point of persisting it is the issue's "restart preserves the
  // artifact index. Missing, moved, quarantined, and deleted bytes remain
  // distinguishable." An index held only in memory would make every restart
  // report every artifact as missing, which is the one wrong answer that reads
  // as a real one.
  `
  CREATE TABLE task_workspaces (
    task_id    TEXT PRIMARY KEY,
    agent      TEXT NOT NULL,
    -- Null until the run starts. A user selects files before triggering, so the
    -- workspace outlives its own runlessness by design; bindTaskRun fills it in
    -- once and refuses to change it.
    run_id     TEXT,
    directory  TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed_at  TEXT
  );

  CREATE TABLE task_inputs (
    input_id     TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES task_workspaces (task_id) ON DELETE CASCADE,
    role         TEXT NOT NULL,
    -- Display metadata. Deliberately NOT the path it came from: the contract
    -- says absolute paths do not enter records, and a column holding one is a
    -- column a later renderer will print.
    display_name TEXT NOT NULL,
    media_type   TEXT NOT NULL,
    byte_size    INTEGER NOT NULL,
    sha256       TEXT NOT NULL,
    admitted_at  TEXT NOT NULL
  );

  CREATE INDEX task_inputs_by_task ON task_inputs (task_id, admitted_at);

  CREATE TABLE workspace_artifacts (
    artifact_id       TEXT PRIMARY KEY,
    task_id           TEXT NOT NULL,
    -- agent and run_id are written from the runner's own knowledge of which
    -- child wrote the line and which task it belongs to. No child-supplied
    -- value reaches either column, which is what "the runner binds source
    -- agent/run identity" means in storage terms.
    agent             TEXT NOT NULL,
    run_id            TEXT NOT NULL,
    role              TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    media_type        TEXT NOT NULL,
    byte_size         INTEGER NOT NULL,
    sha256            TEXT NOT NULL,
    stored_path       TEXT NOT NULL,
    -- Size and mtime together are what availability compares against, so that a
    -- list can answer "is this still the file we registered" without hashing
    -- every artifact on every render. The hash is the download-time check.
    mtime_ms          REAL NOT NULL,
    registered_at     TEXT NOT NULL,
    retention         TEXT NOT NULL,
    quarantine_reason TEXT,
    deleted_at        TEXT
  );

  CREATE INDEX workspace_artifacts_by_run ON workspace_artifacts (agent, run_id);
  CREATE INDEX workspace_artifacts_by_task ON workspace_artifacts (task_id);
  `,

  // MAR-743, ADR 0028 decision 6: what the chief did while DASH was closed,
  // waiting to be drained into DASH's own tables.
  //
  // ## These are queues, not homes
  //
  // The durable home of a chief conversation is `chief_messages` in
  // `dash.sqlite`, and of a broker decision is `broker_audit` beside it. The
  // runner cannot write either — two processes on one WAL store is the
  // mechanism that destroyed that file twice — so it writes here and DASH
  // drains it on its next open, exactly as `/telemetry/drain` and
  // `/artifacts/drain` already work.
  //
  // A drained row is deleted. That is what makes these queues rather than a
  // second copy of somebody's conversation living in a file with different
  // permissions and a different lifetime.
  //
  // ## What is deliberately absent
  //
  // No token, no key, no webhook, no Discord message id and no author. The
  // question and the answer are here because they are the turn; **who** sent it
  // is not, because there is exactly one identity that may send one (ADR 0028
  // decision 4) and recording it per row would turn this table into a log of
  // one person's Discord activity for no gain.
  `
  CREATE TABLE chief_turn_spool (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    asked_at     TEXT NOT NULL,
    question     TEXT NOT NULL,
    answer       TEXT,
    failure      TEXT,
    provider_id  TEXT,
    model_id     TEXT,
    tokens_in    INTEGER,
    tokens_out   INTEGER,
    amount_usd   REAL,
    receipt_json TEXT NOT NULL,
    -- Always 'discord' today. Written rather than assumed at the drain, so a
    -- row cannot lose its provenance by being copied -- ADR 0021's own rule.
    origin       TEXT NOT NULL
  );

  CREATE TABLE chief_audit_spool (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id TEXT NOT NULL,
    operation     TEXT NOT NULL,
    request_id    TEXT NOT NULL,
    decision      TEXT NOT NULL,
    refusal       TEXT,
    -- The *names* of the fields, never their values. broker_audit's own rule.
    input_keys    TEXT NOT NULL,
    result_count  INTEGER,
    duration_ms   INTEGER NOT NULL,
    decided_at    TEXT NOT NULL
  );
  `,

  /*
   * What the chief's tools produced on a turn the runner answered (MAR-744).
   *
   * Its own step rather than a widened `CREATE TABLE` above, because a runner
   * that has already been run once has that table and will never see the
   * original statement again -- this store's migration loop is the same
   * `user_version` walk `lib/db.ts` uses, and a schema edited in place is a
   * schema only a fresh install ever gets.
   *
   * NULL for a turn where no tool ran, which is what `recordChiefTurn` writes
   * on the other side of the drain for the same case. One representation of
   * nothing, on both sides of the queue.
   */
  `
  ALTER TABLE chief_turn_spool ADD COLUMN evidence_json TEXT;
  `,

  /*
   * What the scheduler did while DASH was closed (MAR-742 item 8, ADR 0029).
   *
   * A queue, not a home — `chief_turn_spool`'s whole argument above, and this
   * table inherits every sentence of it. `agent_schedule_runs` in `dash.sqlite`
   * is where a settled window lives; the runner cannot write that file, so it
   * writes here and DASH drains it on its next poll. A drained row is deleted.
   *
   * ## Why this exists at all, when the run itself already travels
   *
   * A scheduled run reaches DASH's store on its own, as ordinary telemetry,
   * through the drain that has always been there. What telemetry cannot carry is
   * **that a schedule caused it**: the agent mints the run id and has never
   * heard of the schedule, and the runner is the only party that knows both
   * halves. It is also the only party that can report the window where *nothing*
   * ran, which has no telemetry to travel on at all and is the row a person most
   * needs when they ask why their agent has been quiet since Tuesday.
   *
   * ## What is deliberately absent
   *
   * No run id, no artifact, no agent output, no payload. The row says which
   * agent, which window, when it was settled, what happened, and one sentence.
   * Everything else about the run is already somewhere DASH can read it.
   */
  `
  CREATE TABLE schedule_spool (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent      TEXT NOT NULL,
    -- The scheduled moment. Not when anything happened.
    due_at     TEXT NOT NULL,
    settled_at TEXT NOT NULL,
    -- 'ran' | 'missed' | 'refused'.
    outcome    TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT ''
  );
  `,

  /*
   * The last set of schedules DASH pushed, so a runner that started without DASH
   * has something to honour (MAR-785, ADR 0030 decision 5).
   *
   * ## Why this is not the second home ADR 0029 refused
   *
   * ADR 0029 decision 1 refused a `schedules/` directory beside the
   * registrations, and the refusal was about **where a schedule lives**: it is
   * edited on a page, shown on a page and deleted with its agent, every one of
   * those is a `dash.sqlite` operation, and a file that also held it would be a
   * second copy free to disagree with the page that owns it.
   *
   * That argument is untouched here. `agent_schedules` is still the only home,
   * still the only thing any surface reads, and nothing writes this row except
   * the arrival of a push. What this table holds is not a schedule; it is **what
   * this runner was last told**, which is the same category as `runner_audit`
   * holding what it was last asked to do. The row is a receipt the runner keeps
   * for itself, and DASH overwrites it within five seconds of its window opening.
   *
   * ADR 0029 decision 2 said the runner keeps *nothing* of its own across a
   * restart, and that sentence was true of a runner DASH always started. ADR
   * 0030 makes the runner start without DASH, which removes the party that used
   * to hand it its world — so it has to remember, and the whole of the staleness
   * this introduces is bounded by "the schedules can only change while DASH is
   * open, and DASH re-asserts them every five seconds while it is".
   *
   * ## Shape
   *
   * One row, enforced by the primary key rather than by whoever writes it, and
   * the payload is the pushed document verbatim. Parsed with the same code the
   * push is parsed with, so a shape this runner cannot read is a shape it also
   * could not have accepted over the channel — see `restore` in
   * `runner/schedule.ts`, which discards an unreadable row rather than throwing.
   *
   * A store that gets retired for damage (`retireDamagedStore`) loses this row,
   * and that is an accepted degradation rather than an oversight: a runner with
   * no memory of its instructions is exactly the runner that existed before this
   * migration, and DASH's next push repairs it.
   */
  `
  CREATE TABLE schedule_standing (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    -- The pushed document, verbatim: { schedules: [...], since: {...} }.
    configuration TEXT NOT NULL,
    received_at   TEXT NOT NULL
  );
  `,
];

export interface RunnerStore {
  readonly database: DatabaseSync;
  close(): void;
}

/**
 * Opening the runner's store either works or names why it did not (MAR-506).
 *
 * A union rather than a throw, because a damaged store is not exceptional — it
 * is a state the product has copy for (`describeRunnerStoreDamage`) and a repair
 * for (`retireDamagedStore`). Throwing would leave every caller deciding what a
 * SQLite message means, which is how the user came to be shown "The runner
 * answered 500."
 *
 * Errors that are *not* about the store's integrity still throw. A caller who
 * cannot create the directory has a different problem, and dressing it as damage
 * would offer to set aside a file that is fine.
 */
export type RunnerStoreResult =
  | { ok: true; store: RunnerStore }
  | { ok: false; damage: RunnerStoreDamage };

/** The name the runner's database has on disk, in one place. */
export const RUNNER_STORE_FILE = "runner.sqlite";

/**
 * Open the runner's database under `directory`, creating it if needed.
 *
 * The pragmas match DASH's store because the reasoning does: WAL so a crash
 * leaves a replayable log rather than a torn file, and `synchronous = FULL` so
 * a committed row is on disk before anything is told it happened. A runner that
 * acknowledged a command it then lost would be worse than one that was slow.
 *
 * ## The probe, and why the pragmas are not one
 *
 * `PRAGMA quick_check` is run before the migration and it is the only step here
 * that reads a page it does not otherwise need. The machine that prompted
 * MAR-506 is the argument for it: every line above it succeeded on a store whose
 * data pages were unreadable, because a header and a `user_version` live on
 * pages that were intact. Without the probe this function would go on returning
 * a handle that answers `PRAGMA` and throws on `SELECT`, which is precisely the
 * runner that 500s per request.
 *
 * A failing probe closes the handle before returning. A caller holding an open
 * connection to a database it has been told is damaged is a caller that will
 * eventually use it.
 */
export function openRunnerStore(directory: string): RunnerStoreResult {
  mkdirSync(directory, { recursive: true });

  let database: DatabaseSync;
  try {
    database = new DatabaseSync(path.join(directory, RUNNER_STORE_FILE));
  } catch (error: unknown) {
    const damage = classifyStoreError(error);
    if (damage === null) {
      throw error;
    }
    return { ok: false, damage };
  }

  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    database.exec("PRAGMA foreign_keys = ON");

    const probe = database.prepare("PRAGMA quick_check(1)").get();
    // `quick_check` answers with the string "ok" on a healthy database and with
    // a description of the first problem otherwise. It is read rather than
    // relied on to throw, because on some damage it reports rather than raises —
    // and a check that only noticed the raising kind would be a check that
    // passed on the store this exists for.
    const verdict = String(probe?.["quick_check"] ?? "ok");
    if (verdict !== "ok") {
      database.close();
      return { ok: false, damage: { kind: "malformed", detail: verdict } };
    }

    migrate(database);
  } catch (error: unknown) {
    const damage = classifyStoreError(error);
    if (damage === null) {
      database.close();
      throw error;
    }
    database.close();
    return { ok: false, damage };
  }

  return {
    ok: true,
    store: {
      database,
      close(): void {
        database.close();
      },
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
