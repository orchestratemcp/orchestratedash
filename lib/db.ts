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
type Migration = string | ((database: DatabaseSync) => void);

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
  (database) => {
    materializeAgentFoldersFromRows(database);
  },
];

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

  migrate(database);
  importLegacyJson(database);
  reconcileAgentFolders(database);

  handle = database;
  return handle;
}

/** Close the handle. For tests and for a clean shutdown; reopening is cheap. */
export function closeDb(): void {
  handle?.close();
  handle = null;
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
  const row = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const applied = Number(row?.user_version ?? 0);

  for (let version = applied; version < MIGRATIONS.length; version += 1) {
    const step = MIGRATIONS[version];
    if (step === undefined) {
      continue;
    }
    transact(database, () => {
      if (typeof step === "function") {
        step(database);
      } else {
        database.exec(step);
      }
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
