/**
 * The durable local store: schema, connection, and the one-way trip from the
 * old JSON file.
 *
 * DASH's state used to be a single JSON document rewritten whole on every write
 * (`lib/store.ts`, before MAR-416). That was the right size for a manifest list
 * and the wrong size for anything with a history — a transcript, retained
 * events, a command audit trail. This module replaces the document with SQLite
 * and keeps `lib/store.ts` as the query layer above it.
 *
 * **`node:sqlite`, not a native driver.** It is in the standard library, so
 * there is no compiled addon to rebuild against every Electron ABI, and the
 * store stays a zero-dependency module in a repo whose only runtime deps are
 * Ajv and Next. It requires Node >= 22.5.
 *
 * **Crash safety is preserved, and strengthened.** The JSON store wrote to a
 * temp file and renamed, so a crash mid-write could not truncate it. The
 * equivalent here is a transaction: WAL journalling means a crash leaves a
 * recoverable log rather than a torn file, and `synchronous = FULL` means a
 * committed write is on disk. That is strictly stronger than what it replaces —
 * a fifty-event batch is now one atomic commit where it used to be a rewrite of
 * the entire document.
 *
 * Nothing in this file ever holds a secret value. Credentials live in the OS
 * vault (`lib/vault.ts`); the store holds names and masked hints only, and
 * `lib/secret-refs.ts` is the only writer of even those.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { oFor } from "./brand/o-cast";
import { validateEvent, validateManifest } from "./contracts";
import {
  inspectAgentFolderName,
  listAgentFolderNames,
  materializeManifestOnlyFolder,
  readAgentFolderManifest,
  recoverAgentFolderSwaps,
} from "./agent-folders";
import { listRegistrations, manifestDigest } from "./registration";
import {
  applyMigrationStep,
  CHIEFLESS_SLICE,
  reconcileChieflessStore,
  reconcileRenumberedStore,
  RENUMBERED_SLICE,
  type StoreMigrationStep,
  type StoreReconciliation,
} from "./store-reconcile";

/* ---------------------------------------------------------------------- *
 * Location
 * ---------------------------------------------------------------------- */

/**
 * Resolved once at import time, exactly as the JSON store did. Tests set
 * `DASH_DATA_DIR` before importing; the Electron main process sets it to
 * `app.getPath("userData")` before loading anything that touches the store, so
 * the installed app never writes beside the source tree.
 */
export const dataDir = process.env.DASH_DATA_DIR ?? path.join(process.cwd(), ".data");

export const databasePath = path.join(dataDir, "dash.sqlite");

/** The store this one replaces. Read once, on first run, and never written. */
export const legacyJsonPath = path.join(dataDir, "dash.json");

const AGENT_FOLDER_MIGRATION_KEY = "agent_folder_migration";
const AGENT_FOLDER_RECONCILIATION_KEY = "agent_folder_reconciliation";
/** What MAR-676's one-time repair did, on the one store that needed it. */
const STORE_RECONCILIATION_KEY = "store_reconciliation";

export interface AgentFolderMigrationResult {
  materialized_agents: string[];
  already_materialized: string[];
  skipped_agents: Array<{ name: string; errors: string[] }>;
  unreadable_rows: number;
  migrated_at: string;
}

export type AgentFolderIssueKind =
  | "folder_unreadable"
  | "folder_missing"
  | "index_drift"
  | "missing_index";

export interface AgentFolderIssue {
  agent: string;
  kind: AgentFolderIssueKind;
}

export interface AgentFolderReconciliationResult {
  checked_at: string;
  projected_agents: string[];
  issues: AgentFolderIssue[];
}

/* ---------------------------------------------------------------------- *
 * Schema
 * ---------------------------------------------------------------------- */

/**
 * Ordered, append-only. `PRAGMA user_version` records how many have run, so a
 * later feature adds a migration to the end of this array rather than reshaping
 * the file — which is what "schema headroom" for the command audit (DASH-13)
 * and transcripts (DASH-15) actually means. Never edit an entry that has
 * shipped; add a new one.
 */
/**
 * One migration: SQL to execute, or a function to run against the database.
 *
 * The function form arrived with MAR-500 and exists for exactly one reason: that
 * migration's data step is not expressible in SQL. It backfills each existing
 * agent's avatar from `oFor`, a string hash SITE and DASH must compute
 * identically, and reimplementing it in SQLite expressions would be a second
 * copy of the one function whose whole job is to agree with another repository.
 *
 * Same rules either way — ordered, append-only, one transaction each, never
 * edited after shipping.
 */
/**
 * Declared in `lib/store-reconcile.ts` and aliased here.
 *
 * That module is the one place either form is executed (`applyMigrationStep`),
 * because MAR-676's repair runs three of these steps too and two copies of the
 * `typeof step === "function"` branch would be two places a step form could be
 * treated differently.
 */
type Migration = StoreMigrationStep;

const MIGRATIONS: readonly Migration[] = [
  `
  -- Store-level facts: schema provenance, migration record. Not app data.
  CREATE TABLE store_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE agents (
    name             TEXT PRIMARY KEY,
    -- Projected from the manifest so the agents list does not have to parse
    -- every document to answer "which of these can declare connections?".
    manifest_version INTEGER NOT NULL,
    -- The manifest verbatim, as imported. It is the agent author's document,
    -- and the Connection Center's honesty rules depend on being able to say
    -- "the manifest declared this" with no normalisation step in between.
    manifest_json    TEXT NOT NULL,
    imported_at      TEXT NOT NULL
  );

  -- A run's identity, not its status.
  --
  -- Status, event counts and sequence gaps stay derived from the events at read
  -- time (see listRuns), because a cached projection is a second source of
  -- truth that drifts. What this table exists for is to be the thing DASH-13's
  -- command audit and DASH-15's transcripts can foreign-key to: you cannot
  -- reference a GROUP BY.
  CREATE TABLE runs (
    agent         TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (agent, run_id)
  );

  CREATE TABLE events (
    -- Arrival order, which is what the JSON store's array index used to mean.
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent       TEXT NOT NULL,
    run_id      TEXT NOT NULL,
    seq         INTEGER NOT NULL,
    ts          TEXT NOT NULL,
    type        TEXT NOT NULL,
    -- The validated event verbatim. Only the fields above get their own
    -- column, and only because they are grouped or ordered on: exploding the
    -- rest would make this schema a second copy of run-event.schema.json, free
    -- to drift from it. ADR 0001 keeps the contract layer single-sourced for
    -- precisely that reason.
    event_json  TEXT NOT NULL,
    received_at TEXT NOT NULL,
    FOREIGN KEY (agent, run_id) REFERENCES runs (agent, run_id)
  );

  -- Deliberately NOT unique on (agent, run_id, seq). The JSON store accepted
  -- duplicate events and listRuns counts them; adding uniqueness here would
  -- change ingest semantics as a side effect of a storage swap. Idempotency is
  -- a DASH-13 concern and gets its own migration and its own decision.
  CREATE INDEX events_by_run ON events (agent, run_id, seq);
  CREATE INDEX events_by_agent ON events (agent);

  -- Where a credential *is*, never what it is.
  --
  -- secret_name is a key into the OS vault and is validated against the
  -- SecureStore name rules, which a pasted credential cannot satisfy.
  -- masked_hint is accepted only in masked form. See lib/secret-refs.ts, which
  -- is the only module that writes this table.
  CREATE TABLE connection_secrets (
    -- NULL when the connection belongs to DASH itself rather than to an agent.
    agent         TEXT,
    connection_id TEXT NOT NULL,
    field_id      TEXT NOT NULL,
    secret_name   TEXT NOT NULL,
    masked_hint   TEXT,
    -- Which backing held it when it was stored, for honest UI copy after a
    -- machine or profile change.
    backend       TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (agent, connection_id, field_id)
  );
  `,

  // ---------------------------------------------------------------------
  // MAR-417 (DASH-13): the Agent DOM command channel.
  //
  // Migration 0 said the command audit "gets designed by the issue that owns
  // it, not guessed here". This is that issue, and this is that design.
  // ---------------------------------------------------------------------
  `
  -- The latest Agent DOM state snapshot per agent, verbatim and validated
  -- against agent-dom-state.schema.json before it lands here.
  --
  -- One row per agent, not a history: this table exists so DASH can answer
  -- "does that target exist, and is the approval still open?" at the moment a
  -- command arrives. Snapshot history is a transcript concern (DASH-15).
  --
  -- observed_at gets its own column because the command layer binds to it: an
  -- envelope names the snapshot its control was rendered from, and a value
  -- that is not this one is a stale display (see lib/agent-dom/enforce.ts).
  CREATE TABLE agent_dom_state (
    agent       TEXT PRIMARY KEY,
    observed_at TEXT NOT NULL,
    state_json  TEXT NOT NULL,
    received_at TEXT NOT NULL
  );

  -- Replay protection. The primary key *is* the check: recording a nonce and
  -- detecting its reuse are one atomic INSERT, so there is no read-then-write
  -- window for two concurrent submissions of the same envelope to slip through.
  CREATE TABLE command_nonces (
    nonce      TEXT PRIMARY KEY,
    agent      TEXT NOT NULL,
    command_id TEXT NOT NULL,
    seen_at    TEXT NOT NULL
  );

  -- Idempotency. The contract requires the runner to "store the idempotency
  -- result before or with an irreversible effect and return the same result for
  -- duplicates", so a row is written in the "in_flight" state *before* the
  -- adapter is called and settled afterwards.
  --
  -- The consequence is deliberate: if DASH dies mid-dispatch, the row survives
  -- as "in_flight" and a duplicate is told the outcome is unknown rather than
  -- being allowed to act again. An unknown outcome is recoverable by looking;
  -- a duplicated calendar invite or payment is not.
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

  -- Every attempt, accepted or refused.
  --
  -- **No foreign key to the runs table**, despite that table existing to be
  -- foreign-keyed to. Two reasons, and the first is fatal on its own:
  --
  -- 1. Auditing a command that targets an unknown agent or run is an acceptance
  --    criterion of this issue. A foreign key would make exactly those rows
  --    un-insertable — the audit log would fall silent precisely about the
  --    attempts most worth recording.
  -- 2. the runs table is populated from telemetry ingest; Agent DOM runs arrive from an
  --    adapter's state snapshots. Until something reconciles those two
  --    populations they are not the same set, and constraining one to the other
  --    would reject honest commands for runs DASH has state for but no events.
  --
  -- payload_keys is a JSON array of key *names*. No payload value is stored,
  -- including "reason": lib/shell/ipc.ts has audited keys and never values
  -- since the boundary was built, and a table is not a reason to relax it.
  CREATE TABLE command_audit (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    command_id       TEXT NOT NULL,
    request_id       TEXT NOT NULL,
    correlation_id   TEXT NOT NULL,
    causation_id     TEXT,
    agent            TEXT,
    run_id           TEXT,
    command          TEXT NOT NULL,
    actor_id         TEXT NOT NULL,
    actor_type       TEXT NOT NULL,
    authenticated_by TEXT NOT NULL,
    decision         TEXT NOT NULL,
    reason           TEXT,
    payload_keys     TEXT NOT NULL,
    mutates          INTEGER NOT NULL,
    irreversible     INTEGER NOT NULL,
    issued_at        TEXT,
    expires_at       TEXT,
    decided_at       TEXT NOT NULL
  );

  -- Correlation first: "show me every attempt against this approval" is the
  -- question an audit trail exists to answer, and the acceptance criterion
  -- about accepted and rejected attempts sharing a correlation is read here.
  CREATE INDEX command_audit_by_correlation ON command_audit (correlation_id);
  CREATE INDEX command_audit_by_agent ON command_audit (agent, decided_at);
  `,

  // ---------------------------------------------------------------------
  // MAR-428 (DASH-11b): the handoff ledger.
  //
  // Every `dash://handoff` link DASH has decided about, and what it decided.
  // ---------------------------------------------------------------------
  `
  -- One row per handoff DASH reached a decision about, including the ones it
  -- refused. A ledger that recorded only successes could not answer "why did
  -- nothing happen when I clicked that", which is the question a user actually
  -- asks — and an expired or mismatched link is exactly the event worth having
  -- written down.
  --
  -- **The nonce is not here, and must never be.** It is proof of possession of
  -- the handoff file, it is single-use, and it has no purpose after the decision
  -- is made. Storing it would turn a value that evaporates into one DASH keeps.
  --
  -- source is the agent's project directory: a path the user chose and can
  -- recognise. It is not a secret, and it is the one piece of context that makes
  -- a row in here mean something to a person six weeks later.
  CREATE TABLE agent_handoffs (
    handoff_id TEXT PRIMARY KEY,
    agent      TEXT NOT NULL,
    outcome    TEXT NOT NULL,
    source     TEXT NOT NULL,
    -- Plain language, never a credential and never a command line. The command
    -- line lives in the registration file, which is the artifact that actually
    -- needs it; repeating it in a durable ledger would spread it for nothing.
    detail     TEXT,
    decided_at TEXT NOT NULL
  );

  CREATE INDEX agent_handoffs_by_agent ON agent_handoffs (agent, decided_at);
  `,

  // ---------------------------------------------------------------------
  // MAR-457: what a run produced.
  //
  // Wave 0 proved a "digest artifact" by looking for a file in the agent's own
  // project folder (`electron/smoke.ts`, proof 6e). That proves the agent wrote
  // something; it says nothing about whether DASH can show it. This table is
  // what turns the second claim into one that can be made.
  //
  // The file in the agent's folder stays the primary record, exactly as
  // `runs/events.jsonl` does for telemetry. This is a projection DASH can render
  // and join on, never the original.
  //
  // **No foreign key to `runs`.** An artifact can arrive before the run row
  // exists — the pipe delivers what the agent wrote, in the order it wrote it,
  // and a fetch that finished before the first telemetry drain is ordinary. A
  // foreign key would drop exactly the artifacts that arrived promptly.
  `
  CREATE TABLE run_artifacts (
    agent        TEXT NOT NULL,
    run_id       TEXT NOT NULL,
    -- Stable within a run, which is what makes "open that digest again" resolve
    -- to the same document rather than to whatever is newest. Re-sending the
    -- same id replaces the body: an agent that revises a digest mid-run is
    -- correcting it, not producing a second one.
    artifact_id  TEXT NOT NULL,
    kind         TEXT NOT NULL,
    title        TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    -- The validated artifact verbatim, for the reason the events table stores
    -- its event JSON whole: exploding it into columns would make this schema a
    -- second copy of run-artifact.schema.json, free to drift from it.
    artifact_json TEXT NOT NULL,
    received_at  TEXT NOT NULL,
    PRIMARY KEY (agent, run_id, artifact_id)
  );

  CREATE INDEX run_artifacts_by_agent ON run_artifacts (agent, generated_at);
  `,

  // ---------------------------------------------------------------------
  // MAR-464: what `observed_at` binds to.
  //
  // Migration 1's comment above says observed_at "gets its own column because
  // the command layer binds to it". That stayed true and the binding was wrong:
  // the runner mints observed_at per build and DASH rebuilds every five seconds,
  // so the column tracked the poll rather than the world, and every control
  // bound to a rendered snapshot expired on a timer.
  //
  // observed_at now advances only when the decision context does, which needs
  // two facts the old row could not hold: what the runner last actually said,
  // and what the decision context currently hashes to.
  // ---------------------------------------------------------------------
  `
  -- The runner's own timestamp for the newest snapshot received, untouched.
  --
  -- Kept separately because it is the only value that can order two snapshots
  -- honestly. The out-of-order guard in putAgentDomState compares against this,
  -- not against observed_at: once observed_at is allowed to stand still, using
  -- it to answer "is this one older than what I have?" would let a genuinely
  -- stale snapshot in through the gap the freeze opened.
  ALTER TABLE agent_dom_state ADD COLUMN runner_observed_at TEXT;

  -- decisionIdentity() of the stored snapshot. See lib/agent-dom/enforce.ts.
  --
  -- Stored rather than recomputed on read so that the comparison is against the
  -- digest of the document as it was accepted, not against a digest a later
  -- version of the projection would produce for it. A projection change is then
  -- a one-off advance of observed_at, which is honest — DASH really is deciding
  -- against a different notion of context — rather than a silent reinterpretation.
  ALTER TABLE agent_dom_state ADD COLUMN decision_identity TEXT;
  `,

  // ---------------------------------------------------------------------
  // MAR-458 (ADR 0002): the connection permission broker.
  //
  // The agent stopped receiving a provider token and started receiving answers
  // to named operations. Two things follow that the store has to hold: a
  // receipt the user can read, and a trail of what was actually done with the
  // access they granted.
  // ---------------------------------------------------------------------
  `
  -- One receipt per (agent, connection): ADR 0002 invariant 4.
  --
  -- "Every grant has a user-visible receipt: account, provider, capabilities,
  -- requesting agent, grant time, last use, and revoke action." Six of those
  -- seven are columns here; the seventh is a button, and it is the existing
  -- disconnect action rather than a second way to revoke.
  --
  -- **This table is a record, never an authority.** What an agent may do is
  -- recomputed from the manifest and the live credential on every single call
  -- (see lib/broker/execute.ts on why). A row here that disagreed with that
  -- computation would be stale display, not extra permission — which is the
  -- property that makes it safe for a receipt to be a cached projection.
  --
  -- account_hint is masked at the point of writing and the column never holds a
  -- full address: the question a receipt answers is "which of my accounts",
  -- and lib/secret-refs.ts already owns the masking.
  CREATE TABLE broker_grants (
    agent         TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    field_id      TEXT NOT NULL,
    account_hint  TEXT,
    -- The granted operation ids as a JSON array, for the receipt's capability
    -- list. Ids and not labels: the label is DASH's own copy and may be
    -- rewritten between releases, and a receipt that froze old wording would
    -- describe an action in words the app no longer uses.
    operations    TEXT NOT NULL,
    granted_at    TEXT NOT NULL,
    last_used_at  TEXT,
    PRIMARY KEY (agent, connection_id)
  );

  -- Every brokered call, allowed or refused: ADR 0002 invariant 5.
  --
  -- **No token, and no message content.** input_keys holds the *names* of the
  -- fields an agent supplied and never their values, which is the same rule
  -- command_audit.payload_keys has held since MAR-417. A search query is the
  -- user's own words about their own mail; a durable table of every phrase an
  -- agent searched for is a record nobody asked DASH to keep, and it would be
  -- the single most sensitive table in the store.
  --
  -- result_count is a number. It says a call returned eleven things and never
  -- what any of them were.
  --
  -- No foreign key to broker_grants, for the reason command_audit has none to
  -- runs: the rows most worth having are the refusals, and a refusal against a
  -- connection with no grant row is exactly one of them.
  CREATE TABLE broker_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    agent         TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    operation     TEXT NOT NULL,
    request_id    TEXT NOT NULL,
    decision      TEXT NOT NULL,
    refusal       TEXT,
    input_keys    TEXT NOT NULL,
    result_count  INTEGER,
    account_hint  TEXT,
    duration_ms   INTEGER NOT NULL,
    decided_at    TEXT NOT NULL
  );

  CREATE INDEX broker_audit_by_agent ON broker_audit (agent, decided_at);
  CREATE INDEX broker_audit_by_connection ON broker_audit (agent, connection_id, decided_at);
  `,

  // MAR-467: the two facts that make broker_audit an incomplete account of what
  // an agent tried to do.
  `
  -- Whether the answer DASH decided could be confirmed to reach the agent.
  --
  -- Two values are used and neither is 1. A 0 means **DASH could not confirm
  -- delivery** — the child had exited, or the POST carrying the answer failed,
  -- or its reply did not parse. That wording is chosen over "the agent never
  -- got it" because one of those three cases genuinely cannot be distinguished
  -- from a delivery whose acknowledgement was lost, and a column asserting a
  -- failure it cannot see is the same error as a row asserting a decision
  -- nobody made, in the other direction.
  --
  -- NULL is the ordinary case: nothing went wrong, or DASH stopped between
  -- deciding and finding out. The renderer must not read NULL as "no".
  --
  -- On the audit row rather than in broker_lapses below, and this is the whole
  -- distinction the table split rests on: an undelivered answer IS a decision
  -- DASH made. It has an operation, a request id and a result count, all of them
  -- real. What went wrong happened after the decision, so it belongs to the
  -- decision as a property and not to some separate population of near-misses.
  ALTER TABLE broker_audit ADD COLUMN delivered INTEGER;

  -- Attempts and gaps that broker_audit cannot represent, because DASH did not
  -- decide them (MAR-467).
  --
  -- **Look at what this table cannot say.** There is no decision column, no
  -- refusal, no operation, no connection_id and no request_id. That is not an
  -- oversight to be corrected by a later migration: those are the fields of an
  -- adjudication, DASH performed none, and a table without the columns cannot be
  -- made to imply one by a careless join or a future renderer. The audit trail is
  -- believable precisely because every row in it is a decision DASH actually
  -- made, and the way to keep it that way is to give the other facts a shape that
  -- could never be mistaken for one.
  --
  -- Two kinds live here, and they differ in who observed them:
  --
  --   dropped_by_runner  The runner read a brokered request off an agent's stdout
  --                      and destroyed it because its bounded buffer was full. It
  --                      knows the agent and the wall-clock time. It does not know
  --                      the operation, because the runner never parses a broker
  --                      request — that happens on the DASH side, where the
  --                      allowlist and the vault are — so attempts is a count of
  --                      things nobody read.
  --
  --   dash_closed        DASH was not running between from_at and until_at. Nobody
  --                      observed any request in that window; this row asserts
  --                      only DASH's own absence, which DASH does observe. Whether
  --                      an agent asked for anything is unknown and stays unknown,
  --                      and attempts is NULL to say so rather than 0, which
  --                      would be a claim.
  --
  -- The agent column is nullable for that second kind. A closed window is a fact about
  -- DASH, not about any one agent; which agents it *mattered* for is derived at
  -- render time from whose runtime keeps running while DASH is closed, and
  -- deriving it beats storing it because the answer changes when a manifest does.
  CREATE TABLE broker_lapses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    kind        TEXT NOT NULL,
    agent       TEXT,
    attempts    INTEGER,
    from_at     TEXT NOT NULL,
    until_at    TEXT,
    observed_by TEXT NOT NULL
  );

  CREATE INDEX broker_lapses_by_agent ON broker_lapses (agent, from_at);
  CREATE INDEX broker_lapses_by_kind ON broker_lapses (kind, from_at);
  `,
  // MAR-434. DASH's projection of the runner's file-backed artifacts.
  //
  // **This table is a copy and is named as one.** The runner's own
  // `workspace_artifacts` is the record; this is what DASH drained from it on
  // the last poll so a page can render without opening a socket. Where the two
  // disagree the runner is right, which is why `observed_at` is a column: an
  // availability is a statement about a moment, and a row that could not say
  // which moment would be read as a statement about now.
  //
  // It is a separate table from `run_artifacts` rather than columns added to it,
  // and the reason is the one MAR-457's schema gives for artifacts not being
  // events. A `run_artifacts` row is a *body an agent sent* — the digest itself,
  // stored here because there is no file. A row here is *metadata about a file
  // the runner holds*, whose bytes are deliberately not in this database. One
  // table with both would have half its columns null in every row and a renderer
  // deciding which half it was looking at.
  `
  CREATE TABLE workspace_artifacts (
    artifact_id   TEXT PRIMARY KEY,
    agent         TEXT NOT NULL,
    run_id        TEXT NOT NULL,
    task_id       TEXT NOT NULL,
    role          TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    media_type    TEXT NOT NULL,
    byte_size     INTEGER NOT NULL,
    sha256        TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    retention     TEXT NOT NULL,
    -- available | moved | quarantined | deleted | missing. The five states
    -- lib/copy/artifacts.ts has vocabulary for, with the runner as the producer.
    availability  TEXT NOT NULL,
    -- Where the bytes were found when availability is "moved", and why DASH
    -- cannot read them when it is "quarantined". Null otherwise: a column that
    -- always held something would invite a renderer to print it in states where
    -- it means nothing.
    availability_detail TEXT,
    -- When the runner last looked. Not when DASH wrote the row: the runner is
    -- what stat'd the file, and attributing its observation to DASH's clock is
    -- the same small promotion "received_at" exists to prevent for a digest.
    observed_at   TEXT NOT NULL
  );

  CREATE INDEX workspace_artifacts_by_run ON workspace_artifacts (agent, run_id);
  `,
  // MAR-500. The agent's costume, as a column on the agent.
  //
  // **Assigned once and never recomputed**, which is the whole point of storing
  // it. MAR-435 asks for an avatar identifier independent of the agent's name
  // and runtime state; `oFor(name)` is the *default* assignment and is not
  // independent of the name, so a render path that called it would put the
  // dependency back. Written on insert by `importManifest`, backfilled here for
  // every agent imported before this column existed, and touched by nothing
  // else — the `ON CONFLICT DO UPDATE` that re-imports a manifest deliberately
  // leaves this column alone.
  //
  // Nullable rather than NOT NULL, and the reason is the store this repository
  // has already had damaged twice: a NOT NULL column added to a live table is a
  // migration that can fail on a row nobody can read. A null here is recoverable
  // by anything that reads it (`lib/store.ts` falls back to the same seed); a
  // failed migration is not.
  (database) => {
    database.exec("ALTER TABLE agents ADD COLUMN avatar TEXT");
    const rows = database.prepare("SELECT name FROM agents").all();
    const assign = database.prepare("UPDATE agents SET avatar = ? WHERE name = ?");
    for (const row of rows) {
      const name = String(row["name"]);
      assign.run(oFor(name), name);
    }
  },
  // MAR-488. When DASH last looked at a runner, and what was already gone.
  //
  // **A table about DASH's own reading, not about any agent's work**, which is
  // why it keys on the source rather than on an agent and holds no run id. Every
  // other evidence table here answers "what happened"; this one answers "how
  // complete is the answer above", and ADR 0005's argument for keeping
  // `broker_lapses` structurally unmistakable applies unchanged — a row here
  // must not be joinable into something that reads like a run.
  //
  // One row per source, overwritten, because this is a state and not a history.
  // The question a Runs page asks is "when did DASH last look and what had the
  // buffer already destroyed by then", and a log of every five-second poll on a
  // machine that has been open for a week would answer it worse and cost more.
  //
  // `dropped` counts existed before this table and were written to a console
  // line and thrown away. That is the defect: the number that says the record is
  // incomplete was the one number no surface could see.
  `
  CREATE TABLE evidence_pulls (
    source              TEXT PRIMARY KEY,
    -- this_machine | another_machine. Not the transport: what the record is a
    -- record OF. A host the user administers keeps running while DASH is closed
    -- and can lose evidence before DASH ever asks; the runner DASH spawned
    -- cannot do either without DASH noticing.
    kind                TEXT NOT NULL,
    -- DASH's own clock when it asked. Deliberately not the runner's
    -- observed_at, which workspace_artifacts already carries and which answers a
    -- different question.
    observed_at         TEXT NOT NULL,
    reached             INTEGER NOT NULL,
    telemetry_dropped   INTEGER NOT NULL,
    artifacts_dropped   INTEGER NOT NULL,
    workspace_truncated INTEGER NOT NULL
  );
  `,
  // MAR-553, ADR 0008 slice 2. Materialise the new authoritative folder from
  // every readable row, and nothing else. In particular this does not follow a
  // registration's `cwd` into the author's project: acquiring code without a
  // user at the import door would turn a migration into an undisclosed copy.
  // Kept at this index at merge time: a database migrated on master before the
  // hosts table arrived records this position as applied, so the hosts
  // migration below must come after, never before.
  (database) => {
    materializeAgentFoldersFromRows(database);
  },
  // MAR-536. One server DASH may reach, and never its credential.
  //
  // `key_name` is a stable identifier resolved by electron/ssh-host.ts inside
  // the per-user data directory. It is deliberately not a path: moving the
  // data directory must not change the record, and a row this renderer can
  // eventually read must have no field that names a private-key location.
  // `host_fingerprint` begins null; the future enrollment flow must make the
  // first pin explicit rather than teaching SSH to accept a new identity.
  // `IF NOT EXISTS` is intentional: a downgrade test, and a restored backup,
  // can retain this independent table while reporting an older schema version.
  // Reapplying the same shape is safe; changing it needs a new migration.
  `
  CREATE TABLE IF NOT EXISTS hosts (
    host_id          TEXT PRIMARY KEY,
    label            TEXT NOT NULL,
    address          TEXT NOT NULL,
    port             INTEGER NOT NULL,
    username         TEXT NOT NULL,
    key_name         TEXT NOT NULL UNIQUE,
    host_fingerprint TEXT,
    added_at         TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS hosts_by_added_at ON hosts (added_at);
  `,
  // MAR-582. What a model provider said about a key DASH holds, and when.
  //
  // **A table of observations, not of state.** The distinction is the whole
  // reason it exists rather than a column on connection_secrets: DASH cannot
  // know whether a key works, only what a provider said last time it was asked,
  // and a boolean beside the credential would read as a property of the key. Two
  // columns carry the honesty — state names what was observed, checked_at names
  // when — and lib/ai/liveness.ts makes them inseparable by giving the
  // never-asked case its own state with a null date.
  //
  // No row means never checked. That is deliberate rather than a default to be
  // filled in on connect: a key pasted a second ago has not been checked, and
  // writing a row at connect time would need a state meaning "not checked" in a
  // table whose every other row is a real observation.
  //
  // model_count is a number and never a list. Which models a key can reach is
  // the provider's own content (ADR 0002 invariant 7), and a durable table of
  // them would be the same mistake broker_audit.result_count already refuses.
  // There is no place here for a message, a body, or an error string from the
  // provider: what happened is one of five states this repository wrote down.
  `
  CREATE TABLE ai_key_checks (
    agent         TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    state         TEXT NOT NULL,
    checked_at    TEXT NOT NULL,
    model_count   INTEGER,
    PRIMARY KEY (agent, connection_id)
  );
  `,
  // MAR-586. When the person last opened one agent's page.
  //
  // **A table about the reader, not about any agent's work**, and it is here for
  // exactly the reason `evidence_pulls` above is its own table rather than
  // columns on a run: every other table in this schema records something an
  // agent or a runner did, and this one records something the person at the
  // keyboard did. A column on `agents` would have put it inside the row
  // `importManifest` rewrites on every re-import, where the next `ON CONFLICT DO
  // UPDATE` would either have to remember to leave it alone — the trap
  // `avatar`'s own note describes — or quietly reset it. Nothing here is ever
  // touched by an import.
  //
  // One row per agent, overwritten, because this is a state and not a history.
  // The question a fleet card asks is "has anything arrived since they last
  // looked", and a log of every page view would answer it no better and would be
  // a durable record of what somebody read and when, which is not a record DASH
  // was asked to keep.
  //
  // No foreign key to `agents`, for the reason `command_audit` has none to
  // `runs`: a row for an agent that has since been removed costs nothing, and a
  // constraint here would make deleting an agent fail on a table about reading.
  //
  // This is the one new fact MAR-586 stores. The other three questions its
  // cards answer — a pending approval, an unconnected requirement, a schedule
  // gone by — are already recorded elsewhere and are derived at render time.
  //
  // `IF NOT EXISTS` for the reason the hosts migration above states, and it is
  // the same situation exactly: this table stands on its own, and a database
  // that has it while reporting an older schema version — a downgrade test, a
  // restored backup — must not die on the way back up. Reapplying the same shape
  // is safe; changing it needs a new migration.
  //
  // **Placed after MAR-582's `ai_key_checks` at merge time, and the order is not
  // a preference.** Both issues authored a migration at the same index on
  // branches cut from the same tip. MAR-582 reached master first, so every
  // database migrated there has already recorded it at that position — putting
  // this one ahead of it would make an already-migrated store re-run somebody
  // else's step. Same rule MAR-553's entry states about its own position, and
  // the next parallel pair should resolve it the same way: whichever landed
  // first keeps its index.
  `
  CREATE TABLE IF NOT EXISTS agent_looks (
    agent          TEXT PRIMARY KEY,
    -- DASH's own clock at the moment the agent's page was opened. Compared only
    -- against other DASH-clock timestamps -- run_artifacts.received_at -- and
    -- never against an agent's own claim about when it made something.
    last_looked_at TEXT NOT NULL
  );
  `,
  // MAR-584, ADR 0010. What DASH sent to a server, and when.
  //
  // **Read ADR 0010 before adding a column here.** This table records DASH's own
  // outbound act and nothing about the machine it reached. MAR-574 forbade
  // "a record of what it has deployed where" on the grounds that DASH has no
  // inventory of somebody else's computer -- which is still true, and is still
  // why host.probe returns a count from the server's own answer rather than a
  // list of names. What that rule got wrong was its scope: it also forbade DASH
  // remembering what DASH did, which is the one thing DASH is entitled to know.
  //
  // So there is no `running` column, no `status`, no `last_seen_at`, and there
  // never will be. Those are properties of the remote machine, and a row here
  // asserting one would be exactly the inventory the previous rule was right to
  // refuse. The columns that exist are four facts DASH observed at the moment it
  // acted, and `sent_at` is what keeps every sentence derived from them in the
  // past tense.
  //
  // manifest_sha256 and files_sha256 are of the bundle **as it left**. They are
  // here so the agent page can answer "is what I sent still what this agent is?"
  // by comparing two things DASH holds -- never by claiming anything about what
  // is on the server now.
  //
  // One row per (agent, host), overwritten. A history of every push would be a
  // log nobody asked for; the question a surface asks is "did DASH ever send
  // this there, and was it before or after the change I just accepted".
  //
  // No foreign key to `hosts`, for `agent_looks`'s reason -- but note that
  // host.forget deletes these rows explicitly (see ADR 0010): once the label is
  // gone the row could only produce an orphaned present-tense claim.
  //
  // `IF NOT EXISTS` for the reason the two migrations above state.
  `
  CREATE TABLE IF NOT EXISTS agent_deploys (
    agent           TEXT NOT NULL,
    host_id         TEXT NOT NULL,
    sent_at         TEXT NOT NULL,
    manifest_sha256 TEXT NOT NULL,
    files_sha256    TEXT,
    PRIMARY KEY (agent, host_id)
  );

  CREATE INDEX IF NOT EXISTS agent_deploys_by_agent ON agent_deploys (agent, sent_at);
  `,
  // MAR-583. Which model an agent uses, and what that setting was when a run
  // started.
  //
  // Three tables and every one of them is **empty for an agent nobody has
  // configured**, which is the load-bearing property rather than a space saving.
  // `lib/ai/model-choice.ts` treats no row as "match each step to the level its
  // plan asked for", so the recommended setting needs no row to be in force and
  // DASH never has to tell "nobody touched this" apart from "somebody chose the
  // default". Same argument `ai_key_checks` makes for having no row until a
  // provider has actually been asked something.
  //
  // **No cost column, in any of them, deliberately.** MAR-299 owns spend, and it
  // owns it because a number DASH derived from a price list it does not hold
  // would be DASH's arithmetic presented as somebody's bill. When real
  // per-request numbers exist they join onto `run_models` by (agent, run_id),
  // which is what this table is shaped to be joinable on.
  //
  // `model_id` is provider content and is checked against `isModelId` before it
  // is written -- ADR 0002 invariant 7, and the pattern MAR-582 already hardened
  // after its first draft accepted a traversal.
  `
  -- One named model for the whole agent. A row exists only when somebody chose
  -- one; deleting it is how a person goes back to matching each step.
  CREATE TABLE IF NOT EXISTS agent_model_choice (
    agent       TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    chosen_at   TEXT NOT NULL
  );

  -- One step's level, when a person set it to something other than what the
  -- manifest declared. A row per override and never a row per step: the plan is
  -- the default and copying it in here would make a manifest change silently
  -- lose to a stale copy of its own old answer.
  CREATE TABLE IF NOT EXISTS agent_step_levels (
    agent     TEXT NOT NULL,
    step      INTEGER NOT NULL,
    level     TEXT NOT NULL,
    chosen_at TEXT NOT NULL,
    PRIMARY KEY (agent, step)
  );

  -- What the setting was when DASH first saw this run.
  --
  -- Written where the runs anchor is written and never revised, so changing the
  -- setting mid-run cannot rewrite what an earlier run reports. It records
  -- **DASH's own setting**, not an observation of a model: DASH makes no
  -- completion call (MAR-582's boundary is one models-list operation), so it has
  -- never watched a model do an agent's work and no column here may imply it
  -- did. choice is 'one_model' or 'match_each_step'; the two id columns are set
  -- exactly when it is the first.
  --
  -- No foreign key to the runs table, for agent_looks's reason.
  CREATE TABLE IF NOT EXISTS run_models (
    agent       TEXT NOT NULL,
    run_id      TEXT NOT NULL,
    choice      TEXT NOT NULL,
    provider_id TEXT,
    model_id    TEXT,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (agent, run_id)
  );
  `,
  // MAR-588. Where DASH is set up to post when an agent needs somebody, and
  // which kinds of thing it posts about.
  //
  // **There is no column an address could go in, and that is the design.** The
  // Discord webhook address is a credential -- anybody holding it can post to
  // that channel -- so it lives in the OS vault under one name, and this table
  // holds what every other connection in DASH holds beside a vault entry: a
  // masked hint and a date. The same rule `connection_secrets` follows, and
  // `tests/redaction.test.ts` is what checks the database bytes never contain
  // the value.
  //
  // One row, not one per agent. The channel is a property of the *person* --
  // this is where they want to be told -- and a per-agent table would invite a
  // surface asking somebody to configure notifications once per agent, which is
  // exactly the setup burden this feature exists to remove.
  //
  // `CHECK (id = 1)` states that singleton to SQLite rather than to a reader: a
  // second row cannot be inserted, so no code path has to decide which of two
  // rows is the real one.
  //
  // The two switches default to on. Somebody who has just pasted an address
  // wants messages, and making them then turn both on would be a setup step that
  // exists only because a schema was cautious.
  //
  // `IF NOT EXISTS` for the reason every migration since the hosts one states.
  `
  CREATE TABLE IF NOT EXISTS notify_discord (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    -- Four trailing characters of the webhook's token, masked. Never a value:
    -- isMaskedHint in lib/secret-refs.ts is what a raw credential cannot pass.
    masked_hint    TEXT NOT NULL,
    -- DASH's own clock at the moment it was stored.
    configured_at  TEXT NOT NULL,
    send_approvals INTEGER NOT NULL DEFAULT 1,
    send_reports   INTEGER NOT NULL DEFAULT 1
  );
  `,

  // MAR-545. The conversation: what a person asked one agent, what came back,
  // and what the provider said that cost.
  //
  // **This is the first cost column in DASH, and MAR-583 said there was none.**
  // Its three tables carry no amount, deliberately, because MAR-299 needed an
  // answer to "whose number is this" before any surface repeated one. The answer
  // is here in the schema rather than only in a document: `amount_usd` is
  // nullable and is written **only** from a figure the provider stated in the
  // reply it charged for. Nothing in DASH multiplies a token count by a rate,
  // so there is no code path that could fill this column with DASH's own
  // arithmetic, and a provider that prices nothing leaves it null forever.
  //
  // The question and the answer are stored in full, which is a departure worth
  // naming beside `broker_audit.input_keys` -- that table records the *names* of
  // an agent's inputs and never their values, because a durable record of every
  // phrase an agent searched for is something nobody asked DASH to keep. This is
  // the opposite case: a person typed these words into a conversation, on their
  // own computer, expecting to be able to scroll back through it. A chat that
  // forgot everything when the page closed would not be a conversation.
  //
  // `citations_json` is DASH's own record of which saved things went with the
  // question -- see `AskCitation` in `lib/ai/ask.ts`. It is stored rather than
  // recomputed because the reports behind an old answer can change, and an
  // answer shown beside a list of what it was *actually* built from is the only
  // version of that list worth having.
  //
  // `IF NOT EXISTS` for the reason every migration since the hosts one states.
  `
  CREATE TABLE IF NOT EXISTS agent_questions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    agent          TEXT NOT NULL,
    -- DASH's own clock at the moment the question was sent.
    asked_at       TEXT NOT NULL,
    question       TEXT NOT NULL,
    -- The answer's text, or NULL when the question produced none.
    answer         TEXT,
    -- Which failure, when there is no answer. One of AskFailureReason.
    failure        TEXT,
    -- Why these saved things and not others: one of SelectionBasis. An enum and
    -- never a sentence -- the words live in lib/copy/ask.ts, and a column
    -- holding prose would be copy no sweep ever looks at. Stored rather than
    -- re-derived from the citation list, because selection searched each item's
    -- summary as well and a citation keeps only its headline: re-deriving would
    -- report "nothing mentioned that" about an answer that matched on a summary.
    basis          TEXT NOT NULL,
    -- Which provider was asked, from DASH's own closed registry.
    provider_id    TEXT NOT NULL,
    -- The model the provider says answered, which may not be the one asked for.
    model_id       TEXT,
    tokens_in      INTEGER,
    tokens_out     INTEGER,
    -- The provider's own figure for what it charged. NULL means it stated none.
    amount_usd     REAL,
    citations_json TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS agent_questions_by_agent
    ON agent_questions (agent, id DESC);
  `,

  // MAR-593, ADR 0013. A connection that exists before an agent does.
  //
  // Every other connection table here is keyed by agent, because until now a
  // connection was a thing an agent asked for. `connection_secrets` is the
  // per-agent credential and `broker_grants` the per-agent receipt. Neither is
  // changed by this migration and neither is repurposed: this is the *consent*,
  // and those two stay the *grant*.
  //
  // The split is what makes the boundary claim free. `lib/broker/execute.ts`
  // computes the same per-agent vault name it always has, so what the broker
  // resolves for an agent is indistinguishable from a grant that agent received
  // directly — not because a test says so, but because the read path was not
  // touched. See docs/adr/0013-fleet-connections.md.
  //
  // `IF NOT EXISTS` for the reason every migration since the hosts one states.
  `
  CREATE TABLE IF NOT EXISTS fleet_connections (
    -- The manifest's provider string, e.g. google-gmail. The key everywhere in
    -- this feature: the same one buildConnectorTiles groups on and
    -- findGrantSharers fans out over. One account per provider is a v1 limit and
    -- is why this is the primary key rather than a column beside an id.
    provider       TEXT PRIMARY KEY,
    -- One of CONNECTOR_KINDS_V1. Stored rather than re-derived, so a row written
    -- by a build that offered a kind this one does not can be read and shown
    -- rather than silently reinterpreted as the other one.
    connector_kind TEXT NOT NULL,
    field_id       TEXT NOT NULL,
    -- A key into the OS vault, never a value, in the dash.fleet. namespace that
    -- connectionSecretName cannot produce for any agent name.
    secret_name    TEXT NOT NULL,
    -- Masked at the point the value is in hand and accepted only in masked form:
    -- isDisplayableHint in lib/secret-refs.ts is what a raw credential cannot
    -- pass, and lib/fleet/store.ts applies it before writing.
    masked_hint    TEXT,
    -- Which of the person's accounts this is, masked. NULL for a key, which
    -- identifies nobody — ADR 0002 amendment 5.
    account_hint   TEXT,
    -- What the consent actually issued, as a JSON array of scope strings. The
    -- credential's own copy is authoritative and is in the vault; this is the
    -- readable projection, with broker_grants.operations' standing: a row that
    -- has gone stale shows out-of-date wording and grants nobody anything.
    scopes         TEXT NOT NULL,
    backend        TEXT NOT NULL,
    -- The date the person first connected this. Survives a re-key, for
    -- recordReceipt's reason: it is the one number somebody would use to notice
    -- access they no longer remember giving.
    connected_at   TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );

  -- A decision a person made about one agent's access to one fleet connection.
  --
  -- **Only decisions somebody made.** No row means nobody has decided, which
  -- materializes — that is Henrik's MAR-570 ruling ("connect once, every agent
  -- that needs it lights up"), and a default of withheld would break it.
  --
  -- A withheld row exists so that importing a second agent, or re-pasting a key,
  -- cannot silently re-grant an agent whose access somebody deliberately took
  -- away. That is the failure CredentialState.revoked already guards one level
  -- down: somebody withdrew this access, and that somebody may have been the
  -- user on purpose.
  CREATE TABLE IF NOT EXISTS fleet_grants (
    provider   TEXT NOT NULL,
    agent      TEXT NOT NULL,
    -- 'granted' or 'withheld'. A granted row only ever appears after a withheld
    -- one was reversed; absence is the ordinary state and is not this value.
    standing   TEXT NOT NULL,
    decided_at TEXT NOT NULL,
    PRIMARY KEY (provider, agent)
  );

  CREATE INDEX IF NOT EXISTS fleet_grants_by_agent ON fleet_grants (agent);
  `,
  // MAR-589. A name DASH itself owns, separate from the author's `display_name`.
  //
  // **Nullable, and never backfilled.** `avatar` above backfills every existing
  // row because every agent needs a character; this column means something
  // different — "somebody renamed this agent" — and no existing agent has. A
  // null here reads through `agentDisplayName` to the manifest's own
  // `display_name` and then to the humanized id, exactly as it did before this
  // column existed, so a database migrated straight to this version shows
  // nothing different until somebody actually renames something.
  //
  // **Omitted from `importManifest`'s `ON CONFLICT DO UPDATE`, for the reason
  // `avatar` states on its own migration.** `display_name` is what a person
  // reads and is free to change from what the manifest says; an author
  // republishing their manifest must not silently rename an agent the user has
  // already renamed. The insert still lists the column — new agents start
  // unrenamed — and only the update clause leaves it alone.
  `
  ALTER TABLE agents ADD COLUMN display_name TEXT
  `,

  // ---------------------------------------------------------------------
  // MAR-611 (ADR 0017): an agent can come back off a server.
  //
  // Deploy was one-way. `agent_deploys` recorded that DASH sent bytes on a date
  // and there was no second date to record, because there was no second act.
  //
  // The column is on `agent_deploys` rather than in a table of its own, and the
  // reason is ADR 0010's own: this table holds **DASH's memory of its own
  // outbound acts**, and taking an agent back off a server is one of those. It
  // is the same (agent, server) pair, and the pair is the primary key -- a
  // separate table would be a second row about one relationship, joined on the
  // key it would have been a column of.
  //
  // What must NOT be read out of it: anything present-tense. `brought_home_at`
  // is "DASH removed this on that date", exactly as `sent_at` is "DASH sent this
  // on that date". Neither is a claim about what is on the server now, and the
  // ADR 0010 rule that forbids a `running` column here forbids a `present` one
  // just as firmly.
  //
  // NULL is the ordinary state and means "DASH has not brought this back",
  // which is deliberately NOT the same as "it is still there" -- somebody may
  // have removed it by hand on a machine DASH does not administer.
  //
  // recordAgentDeploy clears it on a fresh push, because a row whose two dates
  // both stood would say DASH sent something and then removed it, about a copy
  // that is the newest thing DASH has sent.
  //
  // ## Why this one is a function and asks first
  //
  // The two `ALTER TABLE` steps above it are bare SQL, and they can be: they
  // sit below migration 10, which nothing rewinds past. This one is the newest
  // step, and `tests/store-sqlite.test.ts` re-creates a pre-MAR-553 store by
  // setting `user_version` back to 10 and letting every later migration run
  // again — a shape that has already forced two of those tests to drop a table
  // by hand so the step that created it would not fail on the duplicate.
  //
  // A guard is the better answer than a third compensation, and not only for the
  // tests. `ADD COLUMN` is the one migration form whose failure mode is a store
  // that will not open: this repository has had its store damaged twice, and
  // `retireDamagedStore` exists because the recovery from that is worse than any
  // amount of care taken here. A step that asks what is already there costs one
  // pragma and cannot be the reason somebody's history becomes unreachable.
  (database) => {
    const columns = database.prepare("PRAGMA table_info(agent_deploys)").all();
    if (!columns.some((column) => String(column["name"]) === "brought_home_at")) {
      database.exec("ALTER TABLE agent_deploys ADD COLUMN brought_home_at TEXT");
    }
  },

  // ---------------------------------------------------------------------
  // MAR-640. Favourites: the first per-agent preference DASH keeps for the
  // reader rather than about the agent.
  //
  // Its own table rather than a column on `agents`, for `agent_looks`' own
  // reason: this is a fact about the person at the keyboard, and `agents` is
  // the row an author's manifest fills in. A row here that outlives the agent
  // it named would cost nothing, so there is no foreign key to `agents` —
  // `agent_looks`' reasoning again, and `command_audit`'s before it.
  //
  // `favourite` is `INTEGER` rather than a second table of starred ids,
  // because unlike `agent_looks` this fact has a false state that matters:
  // a person can star an agent and then unstar it, and the row should say so
  // rather than simply not exist — the same shape `workspace_truncated`
  // already reads back as `=== 1`.
  `
  CREATE TABLE IF NOT EXISTS agent_prefs (
    agent      TEXT PRIMARY KEY,
    favourite  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  `,

  // MAR-642. One model DASH falls back to, for an agent nobody has configured.
  // (Migration 23: MAR-640's agent_prefs reached master first and holds 22, so
  // this step runs after it on every store that already recorded 0 to 22.)
  //
  // **A fallback and never an override**, which is Henrik's 2026-08-15 ruling and
  // the whole of what this table is allowed to mean: an agent with a row in
  // `agent_model_choice` keeps that row when this one changes, and this one is
  // read only where that one is absent. `applyFleetDefault` is the single place
  // that precedence is expressed; nothing else may compare the two.
  //
  // One row, `CHECK (id = 1)`, for `notify_discord`'s reason — the default is a
  // property of the *person*, and a second row would leave code deciding which
  // of two is real. Absence is the ordinary state: DASH ships with no default,
  // and clearing one deletes the row rather than writing an empty string,
  // exactly as `clearAgentModelChoice` deletes rather than storing a name for
  // "match each step".
  //
  // `provider_id` is DASH's own registry id and `model_id` is provider content —
  // it arrives from a catalogue a third party wrote, through a renderer — so
  // both are checked (`aiProviderById`, `isModelId`) before they are written and
  // again when they are read back. ADR 0002 invariant 7.
  //
  // There is no key here and no column one could go in. What a person picks on
  // the AI tab is which model to ask for; the key that reaches it stays in the
  // vault under `fleetSecretName`, and this table names neither.
  `
  CREATE TABLE IF NOT EXISTS fleet_model_default (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    chosen_at   TEXT NOT NULL
  );
  `,

  // MAR-659, ADR 0023 decision 6. The chief's own conversation, kept.
  //
  // **This reverses a decision, and the reasoning it reverses is quoted.**
  // MAR-648 made the chief's scrollback session-only on the argument that its
  // answers are statements about the fleet *now*, and a stored one would be "a
  // sentence that was true last Tuesday sitting in a scrollback looking like a
  // sentence about today". That is an argument against undated
  // re-presentation, not against storage — and `receipt_json` is the missing
  // date. A turn renders with its timestamp and the exact facts it was built
  // from, and DASH marks it when those facts no longer match its own records.
  //
  // Beside `agent_questions` and on that table's own precedent, which ADR 0012
  // argued in exactly these terms: a person typed these words, on their own
  // computer, into something shaped like a conversation, and a conversation
  // that forgets everything when the page closes is not one.
  //
  // Two columns differ from `agent_questions` and both are the point:
  //
  // `receipt_json` is the fleet briefing **as it stood** — one row per agent,
  // every field a string DASH already rendered on a card. Frozen rather than
  // recomputed, for `citations_json`'s reason turned up one notch: recomputing
  // would silently rewrite what an old answer was built from, which is the
  // precise way a sentence about last Tuesday starts reading like one about
  // today. An empty array is a real and common value — a greeting used no
  // records, and its receipt says so.
  //
  // There is no `agent` column and there cannot be one. ADR 0023 decision 8:
  // the fleet room and an agent's room are two transcripts in two tables with
  // no shared thread, because `{ kind: "chief" }` carries no agent id and there
  // is no value a chief question could be aimed at an agent with.
  //
  // Kept until the person clears the thread, from a control in the chat room.
  // ADR 0008 is untouched: nothing is added to the author's panel.
  `
  CREATE TABLE IF NOT EXISTS chief_messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    -- DASH's own clock at the moment the question was sent.
    asked_at     TEXT NOT NULL,
    question     TEXT NOT NULL,
    -- The answer's text, or NULL when the question produced none.
    answer       TEXT,
    -- Which failure, when there is no answer. One of AskFailureReason.
    failure      TEXT,
    -- Which provider was asked, from DASH's own closed registry — and NULL when
    -- none was, which is the difference from agent_questions.provider_id and
    -- is ADR 0023's "records first, model second" written into the schema. A
    -- standing question is answered from DASH's own records with no model, no
    -- charge and no latency; its row has NULL here and NULL in all four columns
    -- below, and the surface says so per turn rather than leaving somebody to
    -- infer from an absent price that a free answer was a broken one.
    provider_id  TEXT,
    -- The model the provider says answered, which may not be the one asked for.
    model_id     TEXT,
    tokens_in    INTEGER,
    tokens_out   INTEGER,
    -- The provider's own figure for what it charged. NULL means it stated none.
    -- Written only from a number a provider stated, exactly as agent_questions
    -- is: nothing in DASH multiplies a token count by a rate.
    amount_usd   REAL,
    -- The briefing rows that were sent, frozen. See the note above.
    receipt_json TEXT NOT NULL
  );
  `,

  // MAR-628, ADR 0019: what DASH asked its own browser to do, and what it
  // stopped a page from doing.
  //
  // Two tables and not one, on `broker_audit` / `broker_lapses`' exact terms.
  // **Look at what the second one cannot say.** It has no request id, no
  // operation and no decision column, because the agent asked for none of it: a
  // script, a font or a redirect chose those addresses and DASH refused them.
  // Giving them the columns of an adjudication would let a careless join, or a
  // later renderer, present a publisher's advertising network as something an
  // agent did. `browser_actions` stays believable precisely because every row in
  // it is a request an agent made and a decision DASH took.
  //
  // What is deliberately absent from `browser_actions` is as much of the design
  // as what is present. There is no `target` column and no `typed_value` column,
  // because no operation in `BROWSER_OPERATIONS` resolves a target or supplies a
  // value — this slice's catalogue is `browser.open` and `browser.read` and
  // neither dispatches an input event. A column null in every row is a column
  // inviting a later reader to believe DASH once recorded something it never
  // did; ADR 0019 amendment 1 records that the first operation which types or
  // clicks adds them, along with the redaction rule that has to arrive with
  // them.
  //
  // `url_before` and `url_after` hold an origin and a path and never a query
  // string — see `trailUrl`. An article URL routinely carries a session id, a
  // tracking parameter and occasionally somebody's email address in its query,
  // and a durable table of every one of them is a record nobody asked DASH to
  // keep.
  //
  // `frame_after` is a file name inside the run's own frame folder, never a
  // path: `lib/copy/identifiers.ts`'s rule that a renderer names a kind of file
  // and never a file, applied to the one column that points at bytes on disk.
  `
  CREATE TABLE IF NOT EXISTS browser_sessions (
    session_id       TEXT PRIMARY KEY,
    agent            TEXT NOT NULL,
    -- Null when DASH could observe no run. A session outside a run is a real
    -- situation and a null says so rather than inventing an id to group by.
    run_id           TEXT,
    -- The exact origins this run was set up for, as JSON. Written once, at open
    -- time, so a manifest edited mid-run cannot change what a finished receipt
    -- says the person agreed to.
    declared_origins TEXT NOT NULL,
    -- The origins the view actually reached, as JSON, in the order first
    -- allowed. A subset of the above by construction.
    visited_origins  TEXT NOT NULL,
    opened_at        TEXT NOT NULL,
    -- When this session first returned page content, or NULL. It is the moment
    -- the read-then-reach rule started applying to the rest of the run.
    first_read_at    TEXT,
    ended_at         TEXT,
    end_reason       TEXT
  );

  CREATE INDEX IF NOT EXISTS browser_sessions_by_agent
    ON browser_sessions (agent, opened_at);

  CREATE TABLE IF NOT EXISTS browser_actions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    agent       TEXT NOT NULL,
    run_id      TEXT,
    session_id  TEXT NOT NULL,
    request_id  TEXT NOT NULL,
    -- Verbatim, even when DASH has no such operation. A row saying an agent
    -- asked for browser.evaluate and was refused is the most interesting row
    -- this table can hold, and normalising it away would lose it.
    operation   TEXT NOT NULL,
    decision    TEXT NOT NULL,
    refusal     TEXT,
    origin      TEXT,
    url_before  TEXT,
    url_after   TEXT,
    frame_after TEXT,
    decided_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS browser_actions_by_session
    ON browser_actions (session_id, decided_at);
  CREATE INDEX IF NOT EXISTS browser_actions_by_agent
    ON browser_actions (agent, decided_at);

  CREATE TABLE IF NOT EXISTS browser_blocked (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent      TEXT NOT NULL,
    session_id TEXT NOT NULL,
    kind       TEXT NOT NULL,
    -- The refused origin, or a scheme such as data: when the URL had no origin
    -- DASH was willing to name.
    origin     TEXT,
    reason     TEXT NOT NULL,
    blocked_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS browser_blocked_by_session
    ON browser_blocked (session_id, blocked_at);
  `,

  // MAR-673, ADR 0024: the decisions half of the fleet's memory.
  //
  // A row is a *transition* in standing state — what may the fleet do, or with
  // what — filed by the write-site that committed the change, in the same
  // transaction. The tables this sits beside answer "what is the setting";
  // this one answers "when did it change, from what, decided by whom, and
  // why". Activity is deliberately NOT here and never will be: runs, events
  // and audits are already DASH's account of what the fleet did, and a second
  // summarized copy would be the cached projection the `runs` table's own
  // comment refuses.
  //
  // Append-only. Supersession is computed at read time from the chain key
  // (subject_kind, subject_id, kind, topic) by ordering — there is no
  // `superseded` column to mutate, because editing history is exactly what a
  // memory must never do. Staleness is likewise computed: `outcome_json`
  // froze the standing state this decision produced, and a reader compares it
  // with the same state now (ADR 0024 decision 3, `fleetChangedSince`'s
  // discipline applied to a decision's outcome).
  //
  // `reason` is the person's own words, verbatim, or NULL — never composed by
  // DASH, never by a model, never by an agent (ADR 0024 decision 2). NULL is
  // the ordinary value and renders as "no reason was recorded", which is the
  // true sentence. `reason_added_at` is set only when the reason arrived
  // after the decision, so a recollection cannot impersonate a
  // contemporaneous note.
  //
  // No foreign keys, for `command_audit`'s stated reason: a decision about an
  // agent that is later removed must remain insertable and readable, and the
  // rows most worth keeping are exactly the ones whose subject is gone.
  `
  CREATE TABLE IF NOT EXISTS fleet_decisions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    -- DASH's own clock at the moment the change was committed.
    decided_at      TEXT NOT NULL,
    -- 'agent' | 'connection' | 'fleet'. What the decision is about.
    subject_kind    TEXT NOT NULL,
    -- The agent id or provider. NULL exactly when subject_kind is 'fleet'.
    subject_id      TEXT,
    -- One of DECISION_KINDS in lib/fleet/decisions.ts — a closed list, on
    -- WRITE_PATHS' terms: the complete answer to "what can appear in my
    -- decisions log", short enough to read in ten seconds.
    kind            TEXT NOT NULL,
    -- The chain key within a kind — a connection id, a provider, a command
    -- name. Empty string when the kind needs none, so the chain key is never
    -- NULL and (subject, kind, topic) always compares.
    topic           TEXT NOT NULL,
    -- DASH's own sentence of what changed, composed by the write-site from
    -- the copy it already renders. Frozen phrasing: re-rendering from
    -- outcome_json with today's copy would quietly rewrite what was said.
    summary         TEXT NOT NULL,
    -- The resulting standing state, frozen — including, for a re-import, the
    -- declared diff itself, because the agents table keeps only the latest
    -- document and the delta exists nowhere else the moment after.
    outcome_json    TEXT NOT NULL,
    -- 'person' or 'dash-rule'. Who committed the change — never asserted by
    -- a request, always decided by which write-site filed.
    decided_by      TEXT NOT NULL,
    -- The rule's name when decided_by is 'dash-rule', NULL otherwise.
    rule            TEXT,
    reason          TEXT,
    reason_added_at TEXT,
    -- JSON array of record references this row was filed from — a
    -- command_audit id, an import timestamp, run ids. References, never
    -- prose: AskCitation's discipline at the write end.
    receipts_json   TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS fleet_decisions_by_chain
    ON fleet_decisions (subject_kind, subject_id, kind, topic, id);
  CREATE INDEX IF NOT EXISTS fleet_decisions_by_time
    ON fleet_decisions (decided_at);
  `,

  // MAR-643. A service may hold more than one account, with one default for
  // agents that have not been assigned yet. Migration 27: MAR-659's chief
  // transcript, MAR-628's browser ledger and MAR-673's decisions log reached
  // master first as 24, 25 and 26, so this incoming step moves to the end
  // without renumbering any of them. (It was authored as 24 and renumbered
  // twice; the one master already has keeps its number, every time.)
  //
  // This is a table replacement rather than ALTER TABLE additions because the
  // shipped primary key is `provider`. SQLite cannot widen that key in place.
  // The old row becomes account `account-1`, remains the default, and keeps its
  // existing `secret_name` verbatim. Keeping that vault alias is what lets an
  // installed store upgrade without asking the person to enter the credential
  // again; newly connected accounts use the account-segmented name generated by
  // `fleetSecretName`.
  //
  // Per-agent selection is a separate table. A NULL account in a composite key
  // is not equal to another NULL in SQLite and therefore cannot express one
  // unassigned/default row reliably. Absence means "use the default" and a row
  // always names one real, non-null account. `fleet_grants` remains the separate
  // record of granted/withheld access; selection and revocation are different
  // decisions and must not be encoded as values of one column.
  //
  // The old `dash.fleet` reference in `connection_secrets` is removed. That
  // table is one row per (agent, connection, field) and cannot describe two
  // fleet accounts. `fleet_connections` is now the sole readable reference for
  // fleet vault entries. Agent materializations remain in `connection_secrets`
  // and the broker continues to resolve only their `dash.connection.*` names.
  (database) => {
    const columns = database.prepare("PRAGMA table_info(fleet_connections)").all();
    if (columns.some((column) => String(column["name"]) === "account_id")) {
      // The migration tests deliberately rewind user_version on a current
      // store. Schema migrations must therefore be idempotent against the
      // shape, not merely against the pragma.
      database.exec(`
        CREATE TABLE IF NOT EXISTS fleet_account_assignments (
          provider   TEXT NOT NULL,
          agent      TEXT NOT NULL,
          account_id TEXT NOT NULL,
          decided_at TEXT NOT NULL,
          PRIMARY KEY (provider, agent)
        );
        CREATE INDEX IF NOT EXISTS fleet_account_assignments_by_account
          ON fleet_account_assignments (provider, account_id, agent);
        DELETE FROM connection_secrets WHERE agent = 'dash.fleet';
      `);
      return;
    }
    database.exec(`
      ALTER TABLE fleet_connections RENAME TO fleet_connections_v23;

      CREATE TABLE fleet_connections (
        provider       TEXT NOT NULL,
        account_id     TEXT NOT NULL,
        connector_kind TEXT NOT NULL,
        field_id       TEXT NOT NULL,
        secret_name    TEXT NOT NULL UNIQUE,
        masked_hint    TEXT,
        account_hint   TEXT,
        scopes         TEXT NOT NULL,
        backend        TEXT NOT NULL,
        is_default     INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
        connected_at   TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        PRIMARY KEY (provider, account_id)
      );

      INSERT INTO fleet_connections (
        provider, account_id, connector_kind, field_id, secret_name,
        masked_hint, account_hint, scopes, backend, is_default,
        connected_at, updated_at
      )
      SELECT
        provider, 'account-1', connector_kind, field_id, secret_name,
        masked_hint, account_hint, scopes, backend, 1,
        connected_at, updated_at
      FROM fleet_connections_v23;

      DROP TABLE fleet_connections_v23;

      CREATE UNIQUE INDEX fleet_connections_one_default
        ON fleet_connections (provider) WHERE is_default = 1;
      CREATE INDEX fleet_connections_by_provider
        ON fleet_connections (provider, connected_at, account_id);

      CREATE TABLE fleet_account_assignments (
        provider   TEXT NOT NULL,
        agent      TEXT NOT NULL,
        account_id TEXT NOT NULL,
        decided_at TEXT NOT NULL,
        PRIMARY KEY (provider, agent)
      );
      CREATE INDEX fleet_account_assignments_by_account
        ON fleet_account_assignments (provider, account_id, agent);

      DELETE FROM connection_secrets WHERE agent = 'dash.fleet';
    `);
  },

  // MAR-654, ADR 0011 amendment 1. A person may map a level to a model, and
  // DASH still maps none. (Migration 28: master records 27 — MAR-643's
  // multi-account replacement — so this is the next free index, and an installed
  // store that has recorded 0 to 27 runs exactly one more.)
  //
  // ## `fleet_level_models` — three rows per provider, every one the person's
  //
  // The table decision 1 declined to keep, reopened by A1.1 on the distinction
  // the refusal itself names: what was refused is **a ranking DASH invents** over
  // somebody else's catalogue, and a second copy of the emitter's `model_tier`
  // table. Every row here was written by the person, out of a catalogue their own
  // key returned. DASH ranks nothing, ships nothing and seeds nothing.
  //
  // **Keyed by provider**, for `fleet_model_default`'s reason exactly: a model id
  // means nothing without one, and `moonshotai/kimi-k2` presented to Anthropic
  // would be DASH asking a provider for something it never offered.
  //
  // **Fleet-wide and not per agent.** The level vocabulary is fleet-wide by
  // construction — `cheap` means the same thing in every manifest DASH holds,
  // because the emitter writes it against one closed set — so a per-agent copy
  // would be N copies of one answer, and a fourth rung in the precedence rule
  // `applyFleetDefault` is the single expression of. The per-agent escape already
  // exists and already wins: an agent that must run its standard steps on
  // something else gets pinned in `agent_model_choice`.
  //
  // **Zero rows ship and none is ever seeded.** Absence is the recommended state
  // — `fleet_model_default`'s rule one level along — and clearing a level deletes
  // its row rather than writing a sentinel. That is what makes this amendment
  // safe to land: no existing DASH changes behaviour until a person writes a row.
  //
  // `level` is one of the three in `DEFAULT_MODEL_LEVELS` and `model_id` is
  // provider content, so both are checked on the way in and again on the way back
  // out (`isDefaultModelLevel`, `isModelId`). There is no key here and no column
  // one could go in.
  //
  // ## `run_step_models` — what DASH resolved for each step, frozen
  //
  // ADR 0011 decision 4's table survives whole; what changes is that its left
  // column — DASH's own setting at first sight of the run — stops being one
  // model. `run_models` keeps its columns and its write-once rule and gains a
  // third `choice` value, `matched`, with `provider_id` set and `model_id` NULL,
  // because "the setting was a table" is not a model id and must not be squeezed
  // into a column shaped for one.
  //
  // **Keyed by step rather than by level**, for the reason the deploy bundle
  // freezes levels rather than re-reading them: a person's `agent_step_levels`
  // overrides participate in the resolution and the manifest does not know about
  // them, and a plan re-imported next week may have different steps.
  //
  // Written in the same transaction as the `run_models` row, so a run has both or
  // neither. Never revised, for `recordRunModel`'s reason: somebody who changes a
  // level map halfway through a run must not thereby change what an
  // already-started run reports it began under.
  //
  // A step that resolved to nothing gets **no row**, which is what keeps the NOT
  // NULLs honest: `no_model_chosen` is an absence, and a row of empty strings
  // would be a record of a resolution that never happened.
  `
  CREATE TABLE IF NOT EXISTS fleet_level_models (
    provider_id TEXT NOT NULL,
    level       TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    chosen_at   TEXT NOT NULL,
    PRIMARY KEY (provider_id, level)
  );

  CREATE TABLE IF NOT EXISTS run_step_models (
    agent       TEXT NOT NULL,
    run_id      TEXT NOT NULL,
    step        INTEGER NOT NULL,
    level       TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    resolved_by TEXT NOT NULL,
    PRIMARY KEY (agent, run_id, step)
  );
  `,

  // MAR-681. A standing answer: a person's own choice for one agent's question,
  // recorded once and read back before the question is ever asked again.
  // (Migration 29: master records 28 — MAR-654's per-step models — so this is
  // the next free index, and an installed store that has recorded 0 to 28 runs
  // exactly one more.)
  //
  // ## What this table is not
  //
  // It is not `agent_questions` (migration 18). That table is the Ask feature's
  // transcript — a person asking an agent a question about what it has saved,
  // answered by a model. This is the Agent DOM's `choices[]`: a runtime fork in
  // an agent's own plan, answered by a person clicking one of the options the
  // agent offered. The two have never shared a table and do not start now.
  //
  // ## Keyed by a question's own words, because nothing else is durable
  //
  // The Agent DOM v1 contract mints `choice.id` fresh per occurrence — it is an
  // instance id, not a question id, and two runs of the same agent asking "which
  // competitor to focus on?" have no field in common except the label the agent's
  // author wrote. So the key is `question_key`, a normalised form of that label
  // (`standingAnswerQuestionKey` in `lib/agent-dom/standing-answers.ts` is the one
  // place that decides what "the same question" means), and `question_label`
  // beside it keeps the exact words a person answered — a receipt, in ADR 0012's
  // sense, rather than a value nothing can render back verbatim.
  //
  // **Not filed through `fleet_decisions`' point-lookup.** ADR 0024's memory is
  // retrieved by subject and chain, never by equality, and answering "is there a
  // standing answer for this exact question, right now" on every poll is
  // precisely the access pattern that table is not for. Setting or clearing one
  // still files a decision (`standing_answer` in `DECISION_KINDS`) — the same
  // split `agent_model_choice` draws between its own row and `fleet_model_default`'s
  // audit trail.
  `
  CREATE TABLE IF NOT EXISTS standing_answers (
    agent         TEXT NOT NULL,
    question_key  TEXT NOT NULL,
    question_label TEXT NOT NULL,
    option_id     TEXT NOT NULL,
    option_label  TEXT NOT NULL,
    chosen_at     TEXT NOT NULL,
    PRIMARY KEY (agent, question_key)
  );
  `,

  // MAR-696. The chief's own model, independent of `fleet_model_default`.
  //
  // `fleet_model_default`'s exact shape — one row, `CHECK (id = 1)`, absence
  // is the shipped state — because the two are separate standing states for
  // the same reason `fleet_level_model` is separate from the default it falls
  // back to: `readEffectiveChiefModel` reads this row only where it exists and
  // reads `fleet_model_default` only where it does not, and a view that
  // resolved one against the other's current value would report a setting
  // nobody made. Before this table, `lib/views/chief.ts` read the fleet
  // default directly and ADR 0023's own record said the chief "has no picker
  // at all" — this is that reversal, made once here rather than by a second
  // write into the fleet default's row under a borrowed decision kind (a
  // decision kind resolves against its own row).
  //
  // `provider_id`/`model_id` are checked exactly as every other model row is
  // (`aiProviderById`, `isModelId`) before they are written and again when
  // they are read back. ADR 0002 invariant 7.
  `
  CREATE TABLE IF NOT EXISTS chief_model_choice (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    provider_id TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    chosen_at   TEXT NOT NULL
  );
  `,

  // MAR-479, ADR 0026. Whether this DASH tells a LAB anything, and the record
  // of everything it has told one.
  //
  // ## `lab_telemetry`: no column a token could go in
  //
  // `notify_discord`'s shape and its reasons. The bearer token is a credential
  // -- anybody holding it can post into that LAB's insights -- so it lives in
  // the OS vault under one name (`LAB_TELEMETRY_SECRET_NAME`) and this table
  // holds what every other credential-adjacent row in DASH holds: a masked hint
  // and a date. `tests/redaction.test.ts` is what checks the database bytes
  // never contain the value.
  //
  // `enabled` is a column rather than the presence of the row, and the two are
  // deliberately independent: a person can paste a token and leave the switch
  // off, and can switch off without losing the record that they once set it up.
  // Absence of the row is the shipped state and reads as `LAB_TELEMETRY_OFF` --
  // ADR 0026 decision 7's "off is an absence, not a default value".
  //
  // `CHECK (id = 1)` states the singleton to SQLite. One DASH talks to one LAB
  // (LAB's own ingest route says so, contrasting itself with the per-agent
  // tokens in `/api/events`), so a second row cannot be inserted and no code
  // path has to decide which of two is real.
  //
  // ## `lab_telemetry_sends`: the receipt, and why it holds the whole body
  //
  // MAR-479's second constraint is a receipt of **exactly** what is sent -- not
  // a policy document describing categories. So `body` is the literal string
  // that went over the socket, stored verbatim rather than re-composed for
  // display: a receipt assembled a second time is a receipt free to differ from
  // the act it claims to record. It is safe to keep at rest for the reason ADR
  // 0026 decision 2 makes the payload safe to send at all -- every field in it
  // is a registry id, an enum, a digest or a date, and nothing a person typed
  // can reach it.
  //
  // `status` is `-1` for an attempt that never got an answer: a sentinel rather
  // than a null, so "DASH tried and heard nothing" is a row that renders rather
  // than one a page has to special-case. Failures are kept beside successes,
  // deliberately -- somebody checking what was sent is at least as interested in
  // the attempt that failed.
  //
  // ## `lab_telemetry_sent`: what may be skipped next time
  //
  // One row per accepted `(goal_slug, observed_on)`. Written **only** on a
  // fully-accepted batch, because LAB answers with counts and not with which
  // entries landed -- after a partial answer DASH does not know which half
  // succeeded, and marking any of them would be DASH recording a fact it does
  // not have. The cost of that honesty is re-sending an entry LAB already took,
  // which LAB's own per-day de-duplication absorbs.
  `
  CREATE TABLE IF NOT EXISTS lab_telemetry (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    enabled       INTEGER NOT NULL DEFAULT 0,
    endpoint      TEXT NOT NULL,
    -- Four trailing characters of the token, masked, or '' for none. Never a
    -- value: isMaskedHint in lib/secret-refs.ts is what a raw token cannot pass.
    masked_hint   TEXT NOT NULL DEFAULT '',
    configured_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS lab_telemetry_sends (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    sent_at   TEXT NOT NULL,
    endpoint  TEXT NOT NULL,
    -- The literal bytes posted. See the note above for why verbatim.
    body      TEXT NOT NULL,
    outcome   TEXT NOT NULL,
    status    INTEGER NOT NULL,
    detail    TEXT NOT NULL,
    accepted  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS lab_telemetry_sent (
    key     TEXT PRIMARY KEY,
    sent_at TEXT NOT NULL
  );
  `,

  // MAR-743, ADR 0028: the chief's second room, and the two columns that keep a
  // drained row honest about where it came from.
  //
  // ## `chief_discord`: where the chief may be spoken to, and by whom
  //
  // One row, like `notify_discord` and `lab_telemetry` beside it, and the same
  // rule: **no column a credential could go in**. The bot token lives in the OS
  // vault and the only part of it that exists out here is `masked_hint`.
  //
  // `channel_id` and `allowed_user_id` are Discord snowflakes and are *not*
  // secrets — a channel id names a room nobody can reach without the token, and
  // a user id is what Discord shows anybody who right-clicks a name. They are
  // here rather than in the vault because they are configuration a person
  // should be able to see and correct, and a value nobody can read back is a
  // value nobody can correct.
  //
  // `allowed_user_id` is the whole of ADR 0028 decision 4 written into the
  // schema, and its shape is the argument: one TEXT column, not a table,
  // because there is exactly one identity and a table would be an invitation to
  // add a second. A bridge with two allowed speakers is a bridge whose owner
  // cannot say who asked.
  //
  // ## Why this one is a function, like MAR-611's before it
  //
  // Two `ALTER TABLE ... ADD COLUMN`s, and `tests/store-sqlite.test.ts`
  // re-creates a pre-MAR-553 store by setting `user_version` back to 10 and
  // letting every later migration run again. A bare `ADD COLUMN` fails on the
  // second pass with `duplicate column name`, which is a store that will not
  // open — the one migration failure this repository has already paid for
  // twice. Asking first costs one pragma per column and cannot be the reason
  // somebody's history becomes unreachable.
  (database) => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS chief_discord (
        id              INTEGER PRIMARY KEY CHECK (id = 1),
        -- Off until a person turns it on, and off is the absence of a row as
        -- well as a 0 here: lab_telemetry's rule, for the same reason. Nothing
        -- about this feature happens to somebody who has not asked for it.
        enabled         INTEGER NOT NULL DEFAULT 0,
        -- The channel the runner posts answers into. A snowflake, not an
        -- address.
        channel_id      TEXT NOT NULL DEFAULT '',
        -- The one Discord user id whose messages become questions. Everybody
        -- else's are ignored in silence -- ADR 0028 decision 4.
        allowed_user_id TEXT NOT NULL DEFAULT '',
        -- Four trailing characters of the bot token, masked, or '' for none.
        -- Never a value: isMaskedHint in lib/secret-refs.ts is what a raw token
        -- cannot pass, and recordChiefDiscordToken throws on anything that
        -- would.
        masked_hint     TEXT NOT NULL DEFAULT '',
        configured_at   TEXT NOT NULL DEFAULT ''
      );
    `);

    /*
     * Which room the question was asked in (ADR 0028 decision 7).
     *
     * 'window' or 'discord'. Given a default rather than left to be filled,
     * because every row already in somebody's store was asked at the window and
     * backfilling them all to that value is a true statement about every one of
     * them.
     *
     * The column exists so a transcript cannot misrepresent the conversation it
     * is a record of. A turn that arrived from Discord while DASH was closed
     * and was drained in afterwards is indistinguishable from one typed at the
     * composer without it, and the two are not the same event.
     */
    addColumn(database, "chief_messages", "origin", "TEXT NOT NULL DEFAULT 'window'");

    /*
     * Which broker decided this (ADR 0028 decision 7, ADR 0021's own reason).
     *
     * 'dash' for a decision Electron main made, 'runner' for one the detached
     * runner made while nobody was looking, and 'host' for a row eventually
     * pulled off a machine ADR 0021 put a key on. The third value is written
     * into the vocabulary now so that day is a value and not a migration.
     *
     * A drained row is evidence DASH **observed** a decision, not DASH making
     * one. Carrying that on the row rather than adding it at ingest is what
     * stops a row losing its provenance by being copied.
     */
    addColumn(database, "broker_audit", "decided_on", "TEXT NOT NULL DEFAULT 'dash'");
  },

  /*
   * What the chief's tools produced on one turn (MAR-744).
   *
   * `receipt_json` already holds the fleet briefing a turn was built from, and
   * this is deliberately **not** that column widened. The two are different
   * claims about an answer and only one of them can go stale: `fleetChangedSince`
   * compares a frozen briefing against the fleet today and marks the turn when
   * they disagree, which is a sentence about agents. A citation is a sentence
   * about a headline an agent saved or a page DASH fetched, and neither of those
   * changes because an agent was renamed. Folding them into one column would
   * have made every news answer report *your fleet changed* the next time
   * somebody imported an agent.
   *
   * NULL is the ordinary state for every row already in somebody's store and
   * for every turn where no tool ran. `readChiefEvidence` reads NULL, unparsable
   * JSON and an unknown `kind` all as "no evidence to show" -- the weaker claim,
   * which is the right one for a row this build did not write.
   *
   * A column rather than a table, `broker_audit`'s own reasoning inverted: the
   * evidence has no life apart from the turn it belongs to, is never queried
   * across turns, and is deleted when the thread is cleared. A join would be a
   * second place for a turn's receipt to go missing from.
   */
  (database: DatabaseSync): void => {
    addColumn(database, "chief_messages", "evidence_json", "TEXT");
  },

  // MAR-742 item 8, ADR 0029: when a person asked for this agent to be started
  // without them, and what became of each time it came round.
  //
  // ## `agent_schedules`: the standing instruction, and its one home
  //
  // One row per agent — the primary key is the agent id, and that is a decision
  // rather than a convenience. Two schedules on one agent is a thing to build
  // when somebody asks for it; a table shaped to allow it now would be an
  // invitation to design a list UI for a feature whose novice default is *"every
  // day at eight"*. `chief_discord.allowed_user_id` is a column and not a table
  // for the same reason and says so.
  //
  // **The runner never reads this.** ADR 0029 decision 1: DASH pushes a copy
  // over the authenticated local channel and the runner holds it in memory, so
  // `dash.sqlite` keeps the single writer ADR 0027 was written to protect. A
  // `schedules/` directory beside `agents/` would have given the runner its own
  // durable copy and was refused for making two homes for one fact — see the
  // ADR.
  //
  // `at_local` is `HH:MM` in this machine's own local time and there is
  // deliberately **no timezone column**. The schedule fires on this computer and
  // nowhere else; a stored zone would be a promise about portability that
  // nothing in DASH keeps.
  //
  // `kind` is `'daily'` for every row this build can write. It exists so that
  // the weekly and cron shapes ADR 0029 decision 9 declines are a value and not
  // a migration, which is `broker_audit.decided_on`'s own argument for carrying
  // `'host'` before anything writes one.
  //
  // ## `agent_schedule_runs`: what became of each window
  //
  // Written only by draining the runner's spool — never by the window, which
  // has no way to know. A run that happened at 03:00 reaches the store as
  // ordinary telemetry the next time DASH opens; what telemetry cannot carry is
  // *that a schedule caused it*, because the agent minting the run id has never
  // heard of the schedule. This is where that fact travels.
  //
  // `due_at` is the scheduled moment and `settled_at` is when the runner decided
  // about it, and they are two columns rather than one because for a missed
  // window they are hours apart — which is the whole content of the row. ADR
  // 0029 decision 7: the runner cannot record a thing at a moment it did not
  // exist for, so a missed window is stamped when the machine came back and the
  // pair says so.
  //
  // `outcome` is `'ran' | 'missed' | 'refused'`. Failures sit beside successes
  // for `lab_telemetry_sends`' reason: somebody checking whether their agent has
  // been running is at least as interested in the times it did not.
  `
  CREATE TABLE IF NOT EXISTS agent_schedules (
    agent      TEXT PRIMARY KEY,
    -- Off until a person turns it on, and off is the absence of a row as well
    -- as a 0 here: notify_discord's rule, for its reason. Nothing about this
    -- feature happens to an agent nobody has asked it for.
    enabled    INTEGER NOT NULL DEFAULT 0,
    -- 'daily' for everything this build writes. See the note above.
    kind       TEXT NOT NULL DEFAULT 'daily',
    -- 'HH:MM', 24-hour, this machine's local time. Never a timezone.
    at_local   TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS agent_schedule_runs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    agent      TEXT NOT NULL,
    -- The scheduled moment, ISO 8601. Not the moment anything happened.
    due_at     TEXT NOT NULL,
    -- When the runner decided about it. Hours after due_at for a missed window.
    settled_at TEXT NOT NULL,
    -- 'ran' | 'missed' | 'refused'.
    outcome    TEXT NOT NULL,
    -- One sentence, the runner's own words. Never a path and never a payload.
    detail     TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS agent_schedule_runs_by_agent
    ON agent_schedule_runs (agent, due_at DESC);
  `,

  /**
   * MAR-784, ADR 0029 amendment 1: what a scheduled run of this agent may spend,
   * and what the one that already happened was given.
   *
   * Two columns and no table, on `chief_messages.evidence_json`'s terms: neither
   * fact has any life apart from the row it hangs off, neither is ever queried
   * across agents, and both die with the thing they are about. A join would be a
   * second place for a ceiling to go missing from.
   *
   * ## `agent_schedules.allowance_calls`: the ceiling, and why zero is the default
   *
   * **Zero, and zero is the whole of ADR 0029 decision 6 kept as the default.**
   * Every schedule that exists in an installed store today was set under a rule
   * that said an unattended run may not spend, and a migration that opened one
   * for them would be DASH changing what somebody has already agreed to. So the
   * column arrives at 0 for every existing row, and the only thing that can make
   * it anything else is a person opening the panel and asking for it.
   *
   * A count of model calls rather than an amount of money, `SPEND_ALLOWANCE_CALLS`'
   * own reason restated where the number is stored: two of the three providers
   * never state a price at all and the third states it after the call, so a
   * dollar ceiling could only ever be checked once the money was gone. Calls are
   * the unit DASH holds exactly and in advance. `lib/schedule/plan.ts` bounds the
   * value, and re-checks it on the way back out of this column.
   *
   * ## `agent_schedule_runs.allowance_calls`: what that window was actually given
   *
   * Written by the drain from the runner's own settlement, never derived from the
   * schedule row at read time. Those are two different facts the moment somebody
   * edits a ceiling: the schedule says what the *next* run may spend, and this
   * says what *that* run was handed. A panel showing today's ceiling against last
   * night's spend would report a pairing nothing ever agreed to.
   * `broker_audit.decided_on`'s rule — a row must not be able to lose the thing
   * that makes it true by being read later.
   */
  (database: DatabaseSync): void => {
    addColumn(database, "agent_schedules", "allowance_calls", "INTEGER NOT NULL DEFAULT 0");
    addColumn(database, "agent_schedule_runs", "allowance_calls", "INTEGER NOT NULL DEFAULT 0");
  },

  /**
   * MAR-794, ADR 0018: which of the user's keys DASH has placed on which server.
   *
   * ## What this table is a record of, and what it is not
   *
   * It is DASH's memory of **its own outbound act** — this key record, to this
   * server, for this installed copy, at this time — which is exactly what
   * `agent_deploys` is for a bundle, one custody class over. ADR 0010's rule
   * carries across unchanged: a row is written after the helper proved the
   * placement and never on an attempt, and no column here may become a claim
   * about the state of somebody else's machine.
   *
   * So there is deliberately **no `present` column and no `last_seen`**. DASH
   * never asks a host to enumerate its secret store — `pack`'s answer has no
   * room to reply if it did, on purpose (ADR 0021 section 4) — so the only
   * honest reading of a row is the one ADR 0018 writes: *"DASH last proved
   * placement at that time and has not proved removal since."* An unreachable
   * host makes a row stale, not false.
   *
   * ## And no value, no digest, and nothing derived from one
   *
   * `connection_id` and `field_id` name the *local key record* the placement
   * satisfied, which is what every receipt in ADR 0018 is a projection of.
   * ADR 0018 refuses a fingerprint by name — *"a stable fingerprint of a
   * low-entropy or reused credential would become another identifier to
   * protect"* — and DASH already knows which of its own records it sent, so
   * there is nothing a digest would buy.
   *
   * ## The primary key is the slot, because a slot holds one key
   *
   * `(host_id, bundle_id, connection_id)` — the same triple the host stores by.
   * A replacement overwrites, which is what a replacement is: ADR 0018 says a
   * successful replacement *"earns a new receipt and makes the old receipt
   * historical"*, and two rows for one file would be two receipts claiming one
   * placement.
   *
   * `bundle_id` is carried beside nothing else that could stand in for it. It
   * is the agent id for every placement this build can make, and it is
   * `RESERVED_HOST_BUNDLE_ID` for a slot that belongs to no agent — which is why
   * this is not a foreign key onto `agents`, and why `lib/deploy/key-placement.ts`
   * is the one place that knows the reserved id is never orphaned.
   */
  `
  CREATE TABLE IF NOT EXISTS host_key_placements (
    host_id       TEXT NOT NULL,
    -- The installed bundle the key was placed for, or the reserved id for a
    -- slot that belongs to no agent. Never a path.
    bundle_id     TEXT NOT NULL,
    -- The declared need it satisfies, and the field of it. Names a local key
    -- record; never the value, never a digest of one.
    connection_id TEXT NOT NULL,
    field_id      TEXT NOT NULL,
    -- When the helper proved the owner-only write. DASH's clock, ISO 8601.
    placed_at     TEXT NOT NULL,
    PRIMARY KEY (host_id, bundle_id, connection_id)
  );

  CREATE INDEX IF NOT EXISTS host_key_placements_by_host
    ON host_key_placements (host_id, placed_at DESC);
  `,
];

/**
 * Add one column, unless it is already there (MAR-743).
 *
 * MAR-611's guard, lifted into a helper the moment a second step needed it.
 * `PRAGMA table_info` rather than catching the error, because a catch around
 * `ALTER TABLE` swallows every other reason it can fail — a locked database, a
 * table that is not there at all — and turns a migration that did not happen
 * into one that silently claims it did.
 */
function addColumn(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((one) => String(one["name"]) === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/* ---------------------------------------------------------------------- *
 * Connection
 * ---------------------------------------------------------------------- */

let handle: DatabaseSync | null = null;

/**
 * The open database, opened on first use.
 *
 * Lazy rather than at import time so that merely importing the store — which a
 * Next build does while collecting page data — does not create files.
 */
export function db(): DatabaseSync {
  if (handle !== null) {
    return handle;
  }

  mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(databasePath);

  // WAL: a crash mid-write leaves a replayable log, never a truncated database.
  // This is the write-then-rename property the JSON store had, at transaction
  // granularity instead of whole-document granularity.
  database.exec("PRAGMA journal_mode = WAL");
  // FULL: a commit is durable before it is acknowledged. DASH writes rarely and
  // in batches, so the fsync cost is irrelevant and losing an acknowledged
  // ingest would be a monitor lying about what it saw.
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");

  /*
   * A failed open must not leave the file open (MAR-676).
   *
   * `migrate` can now refuse — it does when it meets a store whose history it
   * cannot honestly reconcile — and before this the thrown error left an open
   * `DatabaseSync` that no longer had a reference anywhere. `handle` stays null,
   * so `closeDb` cannot reach it and the next attempt opens a second one. On
   * Windows that is also a handle holding its own directory, which is why the
   * refusal tests could not clean up after themselves.
   */
  try {
    migrate(database);
    importLegacyJson(database);
    reconcileAgentFolders(database);
  } catch (error: unknown) {
    try {
      database.close();
    } catch {
      // The open failed and the close failed with it. The original error is the
      // one worth reporting; a close error on top of it would bury the reason.
    }
    throw error;
  }

  handle = database;
  return handle;
}

/**
 * Close the handle. For tests and for a clean shutdown; reopening is cheap.
 *
 * ## The checkpoint is explicit, and that is the point (MAR-700)
 *
 * `close()` already checkpoints when it is the last connection — but only then,
 * and it says nothing when it is not. That silence is what the store paid for.
 * A `TRUNCATE` checkpoint asked for by name folds the log back into
 * `dash.sqlite`, empties the WAL, and **throws when another process holds the
 * database** rather than leaving the caller believing a self-contained file was
 * written. A DASH left mid-WAL is a DASH whose every copy, backup and abrupt
 * termination lands on a two-file structure that has to be recovered rather than
 * read — and `malformed-20260819/dash.sqlite` is what that costs when the
 * recovery does not happen: a header claiming 474 pages over a file holding 356,
 * three runs and 47 rows unreachable by SQLite.
 *
 * The throw is swallowed, deliberately. This runs on the way out of a process
 * that is leaving anyway, `synchronous = FULL` means every acknowledged commit
 * is already durable, and `will-quit` turning into an exception would trade one
 * unwritten checkpoint for a DASH that never exits at all — the failure
 * `AGENTS.md` forbids resolving with a kill.
 *
 * `handle` is cleared **first**, so a throw from either call cannot leave a live
 * `DatabaseSync` that nothing has a reference to any more. That is MAR-676's
 * lesson from the open path, applied to the close path: on Windows a leaked
 * handle also holds its own directory.
 */
export function closeDb(): void {
  const database = handle;
  handle = null;
  if (database === null) {
    return;
  }
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // Another process has the database, or it was never in WAL mode. Neither is
    // worth failing a shutdown over; `close()` below still attempts its own.
  }
  try {
    database.close();
  } catch {
    // Already closed, or closed out from under us. The handle is gone either
    // way, which is the postcondition callers depend on.
  }
}

/**
 * Run `work` inside one transaction, rolling back if it throws.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front rather than on first write,
 * so two writers fail fast instead of one dying halfway through with an
 * upgrade conflict.
 */
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

/* ---------------------------------------------------------------------- *
 * Reading a table whose pages may be damaged
 * ---------------------------------------------------------------------- */

export interface TolerantRead {
  rows: Array<Record<string, unknown>>;
  /**
   * How many rows a damaged page put out of reach. Zero on a healthy table, and
   * zero on a table this could not size — see below for why those are the same
   * number and why that is the honest choice.
   */
  lost: number;
}

/**
 * Every row of a table, falling back to one row at a time when a page is bad.
 *
 * `lib/store.ts` guards each row's JSON because a damaged store returned a
 * *truncated* manifest. That is only one of the two ways damage arrives, and the
 * store that prompted this exhibited both at once: `agents` read short, while
 * `SELECT * FROM command_audit` threw `SQLITE_CORRUPT` outright — even though
 * `SELECT count(*)` still answered 12, because a count is served from an index
 * that never touches the damaged leaf.
 *
 * A bulk `SELECT *` walks every leaf page, so one bad page loses the whole
 * table. Reading by rowid touches only the page a row is on, so the loss is
 * confined to the rows actually sitting on the damaged page. That is the same
 * argument the per-row JSON guard makes one level up: a partial loss must never
 * be rounded up to a total one.
 *
 * The fast path is unchanged and unconditional — an intact table costs exactly
 * one prepared statement, as before. The row-by-row walk happens only after a
 * throw, which on a healthy store never happens.
 *
 * ## Sizing the walk
 *
 * It has to know how far to count. `max(rowid)` is asked first and reads the
 * rightmost leaf, so on a badly damaged table it throws too — which is not
 * hypothetical: on the store that prompted this, `max(rowid)`, `min(rowid)` and
 * `SELECT *` on `command_audit` all threw while `count(*)` and `SELECT id`
 * answered, because that table's *data pages* were unreachable and only its
 * indexes had survived.
 *
 * So `sqlite_sequence` is the second source. It records the highest rowid ever
 * issued for an AUTOINCREMENT table and lives in its own table, which a damaged
 * page in the subject table does not touch. It over-estimates after deletions —
 * harmless, because a rowid with no row simply yields nothing.
 *
 * When neither answers there is no range to walk, and this returns nothing with
 * `lost` at zero rather than a guess. Reporting a fabricated count would be
 * worse than reporting none: callers render these numbers to a user.
 */
export function readRowsTolerantly(
  database: DatabaseSync,
  options: {
    table: string;
    /** The ordinary query. Tried first and used whole whenever it succeeds. */
    bulk: string;
    /**
     * The same query narrowed to one row. Its first `?` is the rowid; any
     * further ones take `parameters` in order, so a filtered read stays filtered
     * on the slow path and does not quietly widen to the whole table.
     */
    byRowid: string;
    parameters?: readonly string[];
  },
): TolerantRead {
  const parameters = options.parameters ?? [];

  try {
    return { rows: database.prepare(options.bulk).all(...parameters), lost: 0 };
  } catch {
    // Deliberately not inspected. SQLITE_CORRUPT is the case this exists for,
    // and any other failure of a plain SELECT is equally not something a caller
    // can act on — both mean "these rows are not available", which is what the
    // walk below establishes precisely rather than assuming.
  }

  let highest = 0;
  try {
    const row = database.prepare(`SELECT max(rowid) AS high FROM ${options.table}`).get();
    highest = Number(row?.["high"] ?? 0);
  } catch {
    try {
      const row = database
        .prepare("SELECT seq FROM sqlite_sequence WHERE name = ?")
        .get(options.table);
      highest = Number(row?.["seq"] ?? 0);
    } catch {
      highest = 0;
    }
  }
  if (highest === 0) {
    return { rows: [], lost: 0 };
  }

  const rows: Array<Record<string, unknown>> = [];
  let lost = 0;
  for (let rowid = 1; rowid <= highest; rowid += 1) {
    try {
      const row = database.prepare(options.byRowid).get(rowid, ...parameters);
      if (row !== undefined) {
        rows.push(row);
      }
    } catch {
      lost += 1;
    }
  }
  return { rows, lost };
}

/**
 * Function-form migration 10: rows become manifest-only folders.
 *
 * Exported for the installed smoke's upgrade witness. Production reaches it
 * through `MIGRATIONS` exactly once; the witness calls the same function over a
 * deliberately row-only sample standing and then proves the old registration
 * still starts it.
 */
export function materializeAgentFoldersFromRows(
  database: DatabaseSync,
): AgentFolderMigrationResult {
  const now = new Date().toISOString();
  const result: AgentFolderMigrationResult = {
    materialized_agents: [],
    already_materialized: [],
    skipped_agents: [],
    unreadable_rows: 0,
    migrated_at: now,
  };

  const rows = readRowsTolerantly(database, {
    table: "agents",
    bulk: "SELECT rowid, name, manifest_json FROM agents ORDER BY name",
    byRowid: "SELECT rowid, name, manifest_json FROM agents WHERE rowid = ?",
  });
  result.unreadable_rows = rows.lost;

  for (const row of rows.rows) {
    const name = String(row["name"]);
    const raw = String(row["manifest_json"]);
    let candidate: unknown;
    try {
      candidate = JSON.parse(raw);
    } catch {
      result.skipped_agents.push({ name, errors: ["manifest_json is not readable JSON"] });
      continue;
    }
    const validation = validateManifest(candidate);
    if (!validation.ok) {
      result.skipped_agents.push({ name, errors: validation.errors });
      continue;
    }
    if (validation.value.agent.name !== name) {
      result.skipped_agents.push({
        name,
        errors: ["the row name and manifest agent name disagree"],
      });
      continue;
    }
    const component = inspectAgentFolderName(name);
    if (component !== null) {
      result.skipped_agents.push({
        name,
        errors: [`the name is not a safe folder component (${component.refusal})`],
      });
      continue;
    }

    const materialized = materializeManifestOnlyFolder(dataDir, name, raw);
    (materialized.created
      ? result.materialized_agents
      : result.already_materialized
    ).push(name);
  }

  setMeta(database, AGENT_FOLDER_MIGRATION_KEY, JSON.stringify(result));
  return result;
}

/**
 * Re-project folders into rows at startup and persist the disagreement report.
 *
 * Updating the row is not allowed to erase the evidence that it disagreed.
 * `readStore` reads this report for the lifetime of the session and routes it
 * through the existing damage surface. The next clean startup clears it only
 * after observing agreement, which is the point at which the claim is fresh.
 */
export function reconcileAgentFolders(
  database: DatabaseSync,
): AgentFolderReconciliationResult {
  recoverAgentFolderSwaps(dataDir);

  const now = new Date().toISOString();
  const result: AgentFolderReconciliationResult = {
    checked_at: now,
    projected_agents: [],
    issues: [],
  };
  const rows = readRowsTolerantly(database, {
    table: "agents",
    bulk: "SELECT rowid, name, manifest_version, manifest_json, imported_at, avatar FROM agents",
    byRowid:
      "SELECT rowid, name, manifest_version, manifest_json, imported_at, avatar FROM agents WHERE rowid = ?",
  });
  const byName = new Map(rows.rows.map((row) => [String(row["name"]), row]));
  const folderNames = listAgentFolderNames(dataDir);
  const folders = new Set(folderNames);
  /*
   * The digest of the document DASH accepted, per agent it owns (MAR-584).
   *
   * Read once for the whole pass rather than per agent, and only for
   * registrations DASH wrote: an `external` block carries an empty
   * `manifest_sha256`, which is not a digest of anything and must not be
   * compared against one. Absent from this map means "no baseline", which the
   * projection below treats as the pre-MAR-584 behaviour.
   */
  const accepted = new Map(
    listRegistrations(dataDir)
      .filter(
        (registration) =>
          registration.dash.owner === "dash_handoff" && registration.dash.manifest_sha256 !== "",
      )
      .map((registration) => [registration.agent_id, registration.dash.manifest_sha256]),
  );

  transact(database, () => {
    for (const agent of folderNames) {
      const read = readAgentFolderManifest(dataDir, agent);
      if (!read.ok) {
        result.issues.push({ agent, kind: "folder_unreadable" });
        continue;
      }

      let candidate: unknown;
      try {
        candidate = JSON.parse(read.json);
      } catch {
        result.issues.push({ agent, kind: "folder_unreadable" });
        continue;
      }
      const validation = validateManifest(candidate);
      if (!validation.ok || validation.value.agent.name !== agent) {
        // Import constraints deliberately do not run here. Tightening a
        // constraint later cannot strand an agent already accepted; schema
        // readability and folder/name identity are the startup invariants.
        result.issues.push({ agent, kind: "folder_unreadable" });
        continue;
      }

      const existing = byName.get(agent);
      if (existing === undefined) {
        database
          .prepare(
            "INSERT INTO agents (name, manifest_version, manifest_json, imported_at, avatar) " +
              "VALUES (?, ?, ?, ?, ?)",
          )
          .run(agent, validation.value.manifest_version, read.json, now, oFor(agent));
        result.projected_agents.push(agent);
        result.issues.push({ agent, kind: "missing_index" });
        continue;
      }

      if (
        String(existing["manifest_json"]) !== read.json ||
        Number(existing["manifest_version"]) !== validation.value.manifest_version
      ) {
        /*
         * Two very different events reach this line, and until MAR-584 both got
         * the same treatment (MAR-553, ADR 0008).
         *
         * **Index drift** is the one this projection was built for: DASH
         * committed the folder and died before writing the row, so the folder is
         * what DASH accepted and the row is stale. Projecting is a repair.
         *
         * **An external edit** is the opposite. Claude Code changed the folder
         * after DASH accepted it; the row is the version the person approved and
         * the folder is a proposal nobody has looked at. Projecting *that* is the
         * silent swap MAR-584 exists to stop — and it happened on every restart,
         * quietly, with no surface anywhere saying an agent's declaration had
         * been replaced.
         *
         * The registration tells them apart, because it records the digest of
         * the document DASH accepted at the moment it accepted it. A folder that
         * still hashes to that digest is the accepted document and the row is
         * behind it; a folder that does not is somebody's edit, and
         * `lib/folder-changes.ts` is where it gets read out and offered.
         *
         * No baseline, no registration, or a registration DASH did not write:
         * project, exactly as before. Those are the row-only and hand-written
         * standings MAR-553 keeps supported on purpose, and a rule that needed a
         * digest they never had would strand them on a stale index forever.
         */
        const acceptedDigest = accepted.get(agent);
        if (acceptedDigest !== undefined && manifestDigest(read.json) !== acceptedDigest) {
          // An edit, not drift. The row stays; nothing here reports it, because
          // it is not damage and `describeStoreDamage` would render it as some.
          continue;
        }
        database
          .prepare(
            "UPDATE agents SET manifest_version = ?, manifest_json = ? WHERE name = ?",
          )
          .run(validation.value.manifest_version, read.json, agent);
        result.projected_agents.push(agent);
        result.issues.push({ agent, kind: "index_drift" });
      }
    }

    for (const [agent] of byName) {
      // A legacy name that cannot be a component is the supported row-only
      // standing the migration reports. It is not re-labelled as fresh damage
      // on every startup.
      if (inspectAgentFolderName(agent) === null && !folders.has(agent)) {
        result.issues.push({ agent, kind: "folder_missing" });
      }
    }

    result.projected_agents.sort((a, b) => a.localeCompare(b));
    result.issues.sort(
      (a, b) => a.agent.localeCompare(b.agent) || a.kind.localeCompare(b.kind),
    );
    setMeta(database, AGENT_FOLDER_RECONCILIATION_KEY, JSON.stringify(result));
  });
  return result;
}

function migrate(database: DatabaseSync): void {
  /*
   * MAR-676, and it runs **before** `user_version` is read rather than inside the
   * loop below, for two reasons.
   *
   * It has to be before, because it *changes* `user_version`: a store it repairs
   * records 24, 25 or 26 and comes out of it recording 27, and the loop must read
   * the number after the repair rather than the number that made the repair
   * necessary. Reading first and reconciling second would run steps 25 to 27 over
   * tables the repair had just built.
   *
   * And it is here rather than as a step in `MIGRATIONS`, because it is not one.
   * Every entry in that array runs on every store exactly once, in order, forever.
   * This runs on one store on one machine and is a no-op everywhere else, and
   * `inspectDivergedStore` costs three pragmas to say so.
   */
  const reconciliation = reconcileRenumberedStore(database, {
    storePath: databasePath,
    // Sliced here rather than imported there: the repair runs *these definitions*
    // and holds no copy of their SQL. The window is named by the module that
    // knows why those indexes are not the numbers the version pin uses — an index
    // into this array is one less than the `user_version` its step produces.
    steps: MIGRATIONS.slice(RENUMBERED_SLICE.from, RENUMBERED_SLICE.to),
    record: (handle, done) => {
      setMeta(handle, STORE_RECONCILIATION_KEY, JSON.stringify(done));
    },
  });
  if (reconciliation !== null) {
    // The console line is in `reconcileRenumberedStore`. This one is the record
    // a surface can read back afterwards, which is what makes "verify together"
    // possible without re-deriving anything from the schema.
    console.warn(`[dash-store] reconciliation recorded as store_meta.${STORE_RECONCILIATION_KEY}`);
  }

  /*
   * MAR-682, immediately beside MAR-676's own call and for the same two
   * reasons: it must run before `user_version` is read for the loop below,
   * and it is not a step in `MIGRATIONS` — it fires on one store on one
   * machine and costs a pragma and two lookups everywhere else.
   *
   * It cannot fire on a store `reconcileRenumberedStore` just repaired: that
   * repair's first step is master's migration 24, `chief_messages` itself, so
   * a store leaving it above already has the table this one looks for.
   * `inspectChieflessStore` only recognises `user_version` = 27 with
   * `chief_messages` absent, which the two signatures' own version ranges
   * (24-26 versus 27) keep disjoint regardless.
   */
  const chieflessReconciliation = reconcileChieflessStore(database, {
    storePath: databasePath,
    steps: MIGRATIONS.slice(CHIEFLESS_SLICE.from, CHIEFLESS_SLICE.to),
    record: (handle, done) => {
      setMeta(handle, STORE_RECONCILIATION_KEY, JSON.stringify(done));
    },
  });
  if (chieflessReconciliation !== null) {
    console.warn(`[dash-store] reconciliation recorded as store_meta.${STORE_RECONCILIATION_KEY}`);
  }

  const row = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const applied = Number(row?.user_version ?? 0);

  for (let version = applied; version < MIGRATIONS.length; version += 1) {
    const step = MIGRATIONS[version];
    if (step === undefined) {
      continue;
    }
    transact(database, () => {
      applyMigrationStep(database, step);
      // Interpolated because SQLite does not accept a parameter in a PRAGMA.
      // The value is a loop index over a module constant, never caller input.
      database.exec(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/* ---------------------------------------------------------------------- *
 * store_meta
 * ---------------------------------------------------------------------- */

export function getMeta(database: DatabaseSync, key: string): string | null {
  const row = database.prepare("SELECT value FROM store_meta WHERE key = ?").get(key);
  return row === undefined ? null : String(row["value"]);
}

export function setMeta(database: DatabaseSync, key: string, value: string): void {
  database
    .prepare(
      "INSERT INTO store_meta (key, value) VALUES (?, ?) " +
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

/* ---------------------------------------------------------------------- *
 * Migration from .data/dash.json
 * ---------------------------------------------------------------------- */

const LEGACY_IMPORT_KEY = "legacy_json_import";

export interface LegacyImportResult {
  /** Whether a `dash.json` was found and read at all. */
  found: boolean;
  agents: number;
  events: number;
  /**
   * Manifests present in the JSON file that no longer pass schema validation.
   * Recorded rather than dropped silently: a manifest that was accepted once
   * and is rejected now is a fact about the contract layer, and a store that
   * quietly loses an agent is worse than one that says which.
   */
  skipped_agents: Array<{ name: string; errors: string[] }>;
  skipped_events: number;
  /** Set when the file existed but could not be read or parsed. */
  failure?: string;
  imported_at: string;
}

/**
 * Import an existing `dash.json` on first run.
 *
 * Three properties, all deliberate:
 *
 * 1. **The original file is not touched.** Not renamed, not moved, not deleted.
 *    A user who downgrades to a build that predates SQLite finds their JSON
 *    store exactly where it was and keeps working.
 * 2. **The "already imported" marker lives in the database, not on the
 *    filesystem.** A marker file beside `dash.json` would be invisible to the
 *    old build and would survive deleting the database; a row in `store_meta`
 *    is scoped to the store that actually needs to know.
 * 3. **One transaction.** A crash during migration leaves either a fully
 *    migrated database or an untouched one that retries on next launch. There
 *    is no half-migrated state to reason about.
 *
 * Everything is re-validated on the way in. The JSON store only ever wrote
 * validated documents, so a rejection here should be impossible — which is
 * exactly why it is worth recording instead of assuming.
 */
function importLegacyJson(database: DatabaseSync): void {
  if (getMeta(database, LEGACY_IMPORT_KEY) !== null) {
    return;
  }
  if (!existsSync(legacyJsonPath)) {
    return;
  }

  const now = new Date().toISOString();
  const result: LegacyImportResult = {
    found: true,
    agents: 0,
    events: 0,
    skipped_agents: [],
    skipped_events: 0,
    imported_at: now,
  };

  let parsed: LegacyStoreShape | null = null;
  try {
    parsed = JSON.parse(readFileSync(legacyJsonPath, "utf8")) as LegacyStoreShape;
  } catch (error: unknown) {
    // An unreadable file is recorded and the store starts empty. Retrying a
    // corrupt parse on every launch would be noise, and the file is still there
    // for a human to look at.
    //
    // The parser's own message is deliberately not kept. Node quotes the first
    // several characters of the offending input back at you, and this record is
    // written to the store and printed to the log — so a file whose contents we
    // by definition could not inspect must not be quoted into either. The error
    // *type* is safe and is enough to tell "no permission" from "not JSON".
    result.failure =
      error instanceof Error
        ? `${error.name}: dash.json could not be read or parsed`
        : "dash.json could not be read or parsed";
  }

  transact(database, () => {
    for (const [key, stored] of Object.entries(parsed?.agents ?? {})) {
      const validation = validateManifest(stored?.manifest);
      if (!validation.ok) {
        result.skipped_agents.push({ name: key, errors: validation.errors });
        continue;
      }
      const manifest = validation.value;
      const manifestJson = JSON.stringify(manifest);
      const component = inspectAgentFolderName(manifest.agent.name);
      if (component !== null) {
        result.skipped_agents.push({
          name: key,
          errors: [`the name is not a safe folder component (${component.refusal})`],
        });
        continue;
      }

      // Folder first, row second. A crash after this call and before SQLite's
      // commit leaves a folder startup reconciliation can index; the reverse
      // ordering would leave a row claiming DASH held bytes it never acquired.
      materializeManifestOnlyFolder(dataDir, manifest.agent.name, manifestJson);
      database
        .prepare(
          "INSERT INTO agents (name, manifest_version, manifest_json, imported_at, avatar) " +
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO NOTHING",
        )
        .run(
          manifest.agent.name,
          manifest.manifest_version,
          manifestJson,
          importedAt(stored?.imported_at, now),
          // MAR-500. This is a creation, so it assigns — the same seed and the
          // same function `importManifest` uses. An agent that arrives from
          // dash.json has never had a character before, so there is nothing here
          // to preserve and nothing to recompute.
          oFor(manifest.agent.name),
        );
      result.agents += 1;
    }

    for (const candidate of parsed?.events ?? []) {
      const validation = validateEvent(candidate);
      if (!validation.ok) {
        result.skipped_events += 1;
        continue;
      }
      // `received_at` is the migration time, not the event time: DASH's SQLite
      // store genuinely first saw these rows now, and back-dating it would
      // invent a receipt record that never existed.
      insertEventRow(database, validation.value, now);
      result.events += 1;
    }

    setMeta(database, LEGACY_IMPORT_KEY, JSON.stringify(result));
  });
}

/**
 * A timestamp from the legacy file, or now.
 *
 * The old check was `typeof === "string"`, which accepted `""` — and `""` passes
 * the column's `NOT NULL` while being no more a timestamp than `null` is. Every
 * other field in a migrated row is re-validated on the way in (that is what
 * `validateManifest` is doing three lines up); this one was trusted because it
 * came from a file DASH wrote, which is the same reasoning the manifest is
 * deliberately *not* given.
 *
 * `dash.json` is an ordinary file in the user's data directory. It can be edited,
 * truncated, restored from a partial backup or written by a build that had a bug.
 * The falsehood a bad value produces is small but permanent — an agent listed as
 * imported at a time it was not — so an unusable value is replaced with the
 * honest one: DASH first saw this row now.
 */
function importedAt(value: unknown, now: string): string {
  if (typeof value !== "string") {
    return now;
  }
  // Parseable as a date, and round-trips — which `new Date("")` does not, and
  // neither does anything else the column would otherwise have accepted whole.
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? now : value;
}

/** What we expect to find in a `dash.json`. Everything is checked before use. */
interface LegacyStoreShape {
  agents?: Record<string, { manifest?: unknown; imported_at?: unknown } | undefined>;
  events?: unknown[];
}

/**
 * Insert one validated event and make sure its run exists.
 *
 * Shared by the legacy import and by live ingest so both maintain the `runs`
 * anchor the same way — the foreign key means a path that forgot would fail
 * loudly rather than silently orphan the row.
 */
export function insertEventRow(
  database: DatabaseSync,
  event: { agent: string; run_id: string; seq: number; ts: string; type: string },
  receivedAt: string,
): void {
  database
    .prepare("INSERT INTO runs (agent, run_id, first_seen_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
    .run(event.agent, event.run_id, receivedAt);
  database
    .prepare(
      "INSERT INTO events (agent, run_id, seq, ts, type, event_json, received_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(event.agent, event.run_id, event.seq, event.ts, event.type, JSON.stringify(event), receivedAt);
}

/**
 * What the first-run migration did, if it ran. Null when there was nothing to
 * migrate. Read by the docs' offline/restart story and safe to log: it contains
 * counts and agent names, never a manifest body and never a credential.
 */
export function describeLegacyImport(): LegacyImportResult | null {
  const raw = getMeta(db(), LEGACY_IMPORT_KEY);
  return raw === null ? null : (JSON.parse(raw) as LegacyImportResult);
}

/** What migration 10 materialised, including every row it deliberately skipped. */
export function describeAgentFolderMigration(): AgentFolderMigrationResult | null {
  const raw = getMeta(db(), AGENT_FOLDER_MIGRATION_KEY);
  return raw === null ? null : (JSON.parse(raw) as AgentFolderMigrationResult);
}

/**
 * What MAR-676's one-time repair did, or null on every store that never needed it.
 *
 * Kept rather than only logged, and that is the difference between "the log said
 * something last Tuesday" and a fact the store itself can be asked for. The
 * attended verification MAR-676 ends with — `user_version` 27, the tables
 * present, the backup beside the store — reads this instead of re-deriving the
 * story from the schema, which is the same reason `describeAgentFolderMigration`
 * exists beside migration 10 rather than a line in a console.
 */
export function describeStoreReconciliation(): StoreReconciliation | null {
  const raw = getMeta(db(), STORE_RECONCILIATION_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoreReconciliation);
}

/** The drift or folder damage found at this process's startup. */
export function describeAgentFolderReconciliation(): AgentFolderReconciliationResult | null {
  const raw = getMeta(db(), AGENT_FOLDER_RECONCILIATION_KEY);
  return raw === null ? null : (JSON.parse(raw) as AgentFolderReconciliationResult);
}

/**
 * A successful re-import/removal resolves that agent's startup issue now.
 * Other issues stay visible; clearing the whole report would let one repaired
 * folder hide a second one nobody touched.
 */
export function clearAgentFolderIssue(database: DatabaseSync, agent: string): void {
  const raw = getMeta(database, AGENT_FOLDER_RECONCILIATION_KEY);
  if (raw === null) return;
  let report: AgentFolderReconciliationResult;
  try {
    report = JSON.parse(raw) as AgentFolderReconciliationResult;
  } catch {
    return;
  }
  report.issues = (report.issues ?? []).filter((issue) => issue.agent !== agent);
  setMeta(database, AGENT_FOLDER_RECONCILIATION_KEY, JSON.stringify(report));
}
