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

import { validateEvent, validateManifest } from "./contracts";

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
const MIGRATIONS: readonly string[] = [
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

function migrate(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const applied = Number(row?.user_version ?? 0);

  for (let version = applied; version < MIGRATIONS.length; version += 1) {
    const statements = MIGRATIONS[version];
    if (statements === undefined) {
      continue;
    }
    transact(database, () => {
      database.exec(statements);
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
      database
        .prepare(
          "INSERT INTO agents (name, manifest_version, manifest_json, imported_at) " +
            "VALUES (?, ?, ?, ?) ON CONFLICT (name) DO NOTHING",
        )
        .run(
          manifest.agent.name,
          manifest.manifest_version,
          JSON.stringify(manifest),
          typeof stored?.imported_at === "string" ? stored.imported_at : now,
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
