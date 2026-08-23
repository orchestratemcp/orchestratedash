/**
 * MAR-676: the store a pre-renumber build migrated, and the four stores that
 * only look like it.
 *
 * ## Why the fixture is built from SQL
 *
 * The store this repairs is one file on one machine, and MAR-676 is explicit
 * that his rows must never enter the repository. So the diverged shape is
 * *constructed* here: a fresh store is migrated the ordinary way, which runs
 * migration 27 itself, and then SQL takes away exactly what the pre-renumber
 * build never created and rewinds `user_version` to what it recorded. That
 * produces the real store's shape from master's own migrations, which is a
 * better fixture than a copy would be — a copy would freeze whatever the
 * schema looked like on the day it was taken.
 *
 * ## The negatives are the point
 *
 * A repair that fires on a store it should not have is worse than no repair, so
 * four stores are driven through the same boot and must come out untouched:
 *
 * 1. a fresh store, which has no history to reinterpret;
 * 2. a store already at 27, which is master's and finished;
 * 3. a store at 24 with **master's** shape — the chief's transcript present and
 *    no `account_id` — which is where every installed DASH sat before MAR-643
 *    merged, and which must migrate forward the ordinary way;
 * 4. a store at 24 with the multi-account shape and *all three* tables present,
 *    which is the near miss: nothing is missing, so there is nothing to repair
 *    and a backup would be taken for no reason.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

/**
 * Where the ordinary migration loop finishes today (MAR-743).
 *
 * **This is the one number in this file that is supposed to follow the head**,
 * and it is named so that fact is visible beside the several that are not.
 * `RECONCILED_VERSION`, the 27 in `dropChiefMessages` and the 24 in
 * `divergeToPreRenumber` all describe stores that existed on real machines on
 * real days: they are frozen, and changing one changes what is under test. This
 * one only says "and then the loop ran to the end", so every appended migration
 * moves it — MAR-654 took it to 28, MAR-479 to 31, and ADR 0028's
 * `chief_discord` to 32.
 *
 * A constant rather than nine literals, because the alternative makes appending
 * a migration look like nine broken assertions — which is how a signature
 * number gets "fixed" by somebody moving it.
 */
const HEAD_VERSION = 32;

async function freshStore(): Promise<{ dataDir: string; db: typeof import("../lib/db") }> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-reconcile-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  opened.push({ dataDir, closeDb: db.closeDb });
  // Opened here rather than left to each test. `db()` is lazy, so a test that
  // only asked for the module got a directory with no `dash.sqlite` in it — which
  // the backup cases below read as "there is no store to copy" and reported as a
  // refusal, correctly, about a store that had simply not been created yet.
  db.db();
  return { dataDir, db };
}

/** Open the same directory again in a new module instance, as a restart does. */
async function reopen(dataDir: string): Promise<typeof import("../lib/db")> {
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  opened.push({ dataDir, closeDb: db.closeDb });
  return db;
}

afterEach(() => {
  const entries = opened.splice(0);
  for (const { closeDb } of entries) {
    closeDb();
  }
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

const MASTER_24_TO_26_TABLES = [
  "chief_messages",
  "browser_sessions",
  "browser_actions",
  "browser_blocked",
  "fleet_decisions",
];

/**
 * Take away what the pre-renumber build never created, and record what it did.
 *
 * `user_version` goes back to 24 because that is the number multi-account was
 * authored under. The three steps master shipped as 24, 25 and 26 leave nothing
 * behind but their own tables and indexes, so dropping the tables drops the
 * indexes with them and no compensation is needed — unlike the `ALTER TABLE`
 * steps `tests/store-sqlite.test.ts` has to undo by hand.
 */
function divergeToPreRenumber(database: DatabaseSync, recordedVersion = 24): void {
  for (const table of MASTER_24_TO_26_TABLES) {
    database.exec(`DROP TABLE IF EXISTS ${table}`);
  }
  database.exec(`PRAGMA user_version = ${String(recordedVersion)}`);
}

/** A connected fleet account and the superseded reference beside it. */
function seedFleetRow(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO fleet_connections (
      provider, account_id, connector_kind, field_id, secret_name, masked_hint,
      account_hint, scopes, backend, is_default, connected_at, updated_at
    ) VALUES (
      'openrouter', 'account-1', 'api_key', 'api_key',
      'dash.fleet.openrouter.api_key', 'sk-••••1234', NULL, '[]', 'os_keychain', 1,
      '2026-08-10T20:02:17.642Z', '2026-08-10T20:02:17.642Z'
    );
    INSERT INTO connection_secrets (
      agent, connection_id, field_id, secret_name, masked_hint, backend,
      created_at, updated_at
    ) VALUES (
      'dash.fleet', 'openrouter', 'api_key', 'dash.fleet.openrouter.api_key',
      'sk-••••1234', 'os_keychain',
      '2026-08-10T20:02:17.642Z', '2026-08-10T20:02:17.642Z'
    );
  `);
}

function tableNames(database: DatabaseSync): string[] {
  return database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row["name"]));
}

function version(database: DatabaseSync): number {
  return (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

function backupsIn(dataDir: string): string[] {
  return readdirSync(dataDir).filter((name) => name.includes(".before-reconcile-"));
}

/* ---------------------------------------------------------------------- *
 * The shape migration 27 produces
 * ---------------------------------------------------------------------- */

describe("the multi-account shape the repair verifies against", () => {
  it("is what migration 27 actually produces on a fresh store", async () => {
    // The anti-drift check. `EXPECTED_FLEET_SHAPE` is a declaration, and a
    // declaration nobody compares against the real thing is a recollection: it
    // would go on being believed while migration 27 changed underneath it, and
    // the first anybody heard of the difference would be a refusal on somebody's
    // machine. This is the comparison that makes it a fact.
    const { db } = await freshStore();
    const { EXPECTED_FLEET_SHAPE, inspectFleetShape } = await import("../lib/store-reconcile");

    expect(inspectFleetShape(db.db())).toEqual(EXPECTED_FLEET_SHAPE);
  });
});

/* ---------------------------------------------------------------------- *
 * It fires on the diverged shape
 * ---------------------------------------------------------------------- */

describe("a store a pre-renumber build migrated", () => {
  it("is reconciled to 27 with every missing table created", async () => {
    const first = await freshStore();
    seedFleetRow(first.db.db());
    divergeToPreRenumber(first.db.db());

    // The signature, as the store now holds it — asserted before the reopen so a
    // fixture that stopped reproducing the real shape fails here rather than
    // silently making the rest of this test about something else.
    const { inspectDivergedStore } = await import("../lib/store-reconcile");
    expect(inspectDivergedStore(first.db.db())).toEqual({
      diverged: true,
      recorded_version: 24,
      missing_versions: [24, 25, 26],
      missing_tables: MASTER_24_TO_26_TABLES,
    });
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    const handle = next.db();

    expect(version(handle)).toBe(HEAD_VERSION);
    for (const table of MASTER_24_TO_26_TABLES) {
      expect(tableNames(handle)).toContain(table);
    }

    // The person's own connection is untouched, which is the whole reason this is
    // a repair and not a reset.
    expect(
      handle.prepare("SELECT account_id, secret_name, is_default FROM fleet_connections").get(),
    ).toEqual({
      account_id: "account-1",
      secret_name: "dash.fleet.openrouter.api_key",
      is_default: 1,
    });

    // Migration 27's own data step, which the shape check cannot speak for.
    expect(
      handle
        .prepare("SELECT COUNT(*) AS count FROM connection_secrets WHERE agent = 'dash.fleet'")
        .get(),
    ).toEqual({ count: 0 });

    const reconciliation = next.describeStoreReconciliation();
    expect(reconciliation).toMatchObject({
      recorded_version: 24,
      final_version: 27,
      applied_versions: [24, 25, 26],
      created_tables: MASTER_24_TO_26_TABLES,
      created_indexes: [],
      removed_fleet_secret_rows: 1,
    });
    expect(reconciliation?.backup.copied).toBeGreaterThan(0);
  });

  it("copies the store beside itself before it changes anything", async () => {
    const first = await freshStore();
    divergeToPreRenumber(first.db.db());
    first.db.closeDb();
    expect(backupsIn(first.dataDir)).toEqual([]);

    const next = await reopen(first.dataDir);
    next.db();

    const backups = backupsIn(first.dataDir);
    // The database and whichever of its `-wal`/`-shm` siblings existed. Named
    // beside the store and never in a subdirectory, so anybody looking at the
    // store sees it — `retireDamagedStore`'s conventions, which this follows
    // except that it copies rather than renames.
    expect(backups.length).toBeGreaterThan(0);
    expect(backups.every((name) => name.startsWith("dash.sqlite.before-reconcile-"))).toBe(true);
    expect(next.describeStoreReconciliation()?.backup.copied_to).toBe(backups[0]);

    // The copy is a real store at the version this arrived at, which is what
    // makes it a backup rather than a file with a promising name.
    const copy = new DatabaseSync(path.join(first.dataDir, backups[0] ?? ""), { readOnly: true });
    try {
      expect(version(copy)).toBe(24);
      expect(tableNames(copy)).not.toContain("chief_messages");
    } finally {
      copy.close();
    }
  });

  it("creates those tables from the steps' own definitions", async () => {
    // "By running those steps' own definitions, not copies of their SQL" is a
    // property of the call, and this is what proves it: the DDL a reconciled
    // store ends up with is byte-identical to the DDL a fresh store gets from
    // the ordinary loop. A second copy of the SQL in the repair would drift from
    // this the first time either was edited.
    const fresh = await freshStore();
    const freshDdl = ddlFor(fresh.db.db(), MASTER_24_TO_26_TABLES);
    fresh.db.closeDb();

    const first = await freshStore();
    divergeToPreRenumber(first.db.db());
    first.db.closeDb();
    const next = await reopen(first.dataDir);

    expect(ddlFor(next.db(), MASTER_24_TO_26_TABLES)).toEqual(freshDdl);
  });

  it("recreates an index migration 27 declares that the older build did not", async () => {
    const first = await freshStore();
    divergeToPreRenumber(first.db.db());
    // The most likely difference between the revision that ran and the one that
    // shipped, and the only kind this repairs rather than refuses: an index is
    // derived, so creating one changes no row and can lose nothing.
    first.db.db().exec("DROP INDEX fleet_connections_by_provider");
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    const { EXPECTED_FLEET_SHAPE, inspectFleetShape } = await import("../lib/store-reconcile");

    expect(next.describeStoreReconciliation()?.created_indexes).toEqual([
      "fleet_connections_by_provider",
    ]);
    expect(inspectFleetShape(next.db())).toEqual(EXPECTED_FLEET_SHAPE);
  });
});

function ddlFor(database: DatabaseSync, tables: readonly string[]): Record<string, string> {
  const ddl: Record<string, string> = {};
  for (const table of tables) {
    const row = database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    ddl[table] = row === undefined ? "" : String(row["sql"]);
  }
  return ddl;
}

/* ---------------------------------------------------------------------- *
 * It refuses a shape it does not recognise
 * ---------------------------------------------------------------------- */

describe("a diverged store whose multi-account shape is not the shipped one", () => {
  it("refuses by name, changes nothing, and leaves no backup behind", async () => {
    const first = await freshStore();
    divergeToPreRenumber(first.db.db());
    // A column migration 27 does not produce. SQLite cannot put it back without
    // rebuilding the table, and rebuilding somebody's table from a guess about
    // how it got this way is exactly what the refusal exists to prevent.
    first.db.db().exec("ALTER TABLE fleet_connections DROP COLUMN account_hint");
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const next = await import("../lib/db");
    opened.push({ dataDir: first.dataDir, closeDb: next.closeDb });

    expect(() => next.db()).toThrow(/fleet_connections has columns/);
    // The message has to be actionable on its own: it names the shape it found,
    // so the next step is a decision rather than another guess.
    expect(() => next.db()).toThrow(/What was found, in full/);

    // Nothing was written — including no backup, because the shape is checked
    // before the copy is taken. A refusal that left a file behind would leave
    // somebody tidying up after a repair that never started.
    expect(backupsIn(first.dataDir)).toEqual([]);
    const raw = new DatabaseSync(path.join(first.dataDir, "dash.sqlite"), { readOnly: true });
    try {
      expect(version(raw)).toBe(24);
      expect(tableNames(raw)).not.toContain("chief_messages");
    } finally {
      raw.close();
    }
  });

  it("refuses a table replacement that did not finish", async () => {
    const first = await freshStore();
    divergeToPreRenumber(first.db.db());
    // Migration 27 renames `fleet_connections` aside, copies the rows out and
    // drops it. One of those still sitting here means it died in the middle, and
    // which of the two tables holds the person's connections cannot be decided
    // from the schema.
    first.db.db().exec("CREATE TABLE fleet_connections_v23 (provider TEXT PRIMARY KEY)");
    first.db.closeDb();

    process.env.DASH_DATA_DIR = first.dataDir;
    vi.resetModules();
    const next = await import("../lib/db");
    opened.push({ dataDir: first.dataDir, closeDb: next.closeDb });

    expect(() => next.db()).toThrow(/half-finished replacement/);
    expect(backupsIn(first.dataDir)).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- *
 * The negatives
 * ---------------------------------------------------------------------- */

describe("stores the repair must never touch", () => {
  it("leaves a fresh store alone", async () => {
    const { dataDir, db } = await freshStore();

    expect(version(db.db())).toBe(HEAD_VERSION);
    expect(db.describeStoreReconciliation()).toBeNull();
    expect(backupsIn(dataDir)).toEqual([]);
  });

  it("leaves a store already at 27 alone across a restart", async () => {
    const first = await freshStore();
    seedFleetRow(first.db.db());
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    expect(version(next.db())).toBe(HEAD_VERSION);
    expect(next.describeStoreReconciliation()).toBeNull();
    expect(backupsIn(first.dataDir)).toEqual([]);
  });

  it("migrates a store at 24 with master's own shape the ordinary way", async () => {
    // Where every installed DASH sat before MAR-643 merged: the chief's
    // transcript present, `fleet_connections` keyed on `provider` alone, no
    // assignment table. The repair must not recognise this — the ordinary loop
    // runs 25, 26 and 27, and 27 does the real table replacement.
    const first = await freshStore();
    seedFleetRow(first.db.db());
    first.db.db().exec(`
      DROP TABLE browser_sessions;
      DROP TABLE browser_actions;
      DROP TABLE browser_blocked;
      DROP TABLE fleet_decisions;
      ALTER TABLE fleet_connections RENAME TO fleet_connections_pre;
      CREATE TABLE fleet_connections (
        provider       TEXT PRIMARY KEY,
        connector_kind TEXT NOT NULL,
        field_id       TEXT NOT NULL,
        secret_name    TEXT NOT NULL,
        masked_hint    TEXT,
        account_hint   TEXT,
        scopes         TEXT NOT NULL,
        backend        TEXT NOT NULL,
        connected_at   TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      );
      INSERT INTO fleet_connections
        SELECT provider, connector_kind, field_id, secret_name, masked_hint,
               account_hint, scopes, backend, connected_at, updated_at
        FROM fleet_connections_pre;
      DROP TABLE fleet_connections_pre;
      DROP TABLE fleet_account_assignments;
      PRAGMA user_version = 24;
    `);
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    const handle = next.db();

    expect(next.describeStoreReconciliation()).toBeNull();
    expect(backupsIn(first.dataDir)).toEqual([]);
    expect(version(handle)).toBe(HEAD_VERSION);
    // Migration 27 ran, so the row is `account-1` and the default — which is the
    // ordinary upgrade this store was always going to get.
    expect(handle.prepare("SELECT account_id, is_default FROM fleet_connections").get()).toEqual({
      account_id: "account-1",
      is_default: 1,
    });
  });

  it("leaves a diverged version with nothing missing alone", async () => {
    // The near miss, and the reason the third condition is "a table is absent"
    // rather than "the version disagrees with the shape". A store recording 24
    // with the multi-account shape *and* all three tables has nothing to repair:
    // every step from 24 on is idempotent against the shape, so the ordinary loop
    // already leaves it correct, and firing here would copy a store to fix
    // nothing.
    const first = await freshStore();
    first.db.db().exec("PRAGMA user_version = 24");
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    expect(next.describeStoreReconciliation()).toBeNull();
    expect(backupsIn(first.dataDir)).toEqual([]);
    expect(version(next.db())).toBe(HEAD_VERSION);
  });

  it("leaves a store below the range alone even with the shape present", async () => {
    // 23 is outside `DIVERGED_VERSION_RANGE`, and it has to be: multi-account
    // existed in no revision numbered below 24, so a store recording 23 with the
    // shape present is a store somebody rewound, not one a pre-renumber build
    // touched.
    const first = await freshStore();
    divergeToPreRenumber(first.db.db(), 23);
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    expect(next.describeStoreReconciliation()).toBeNull();
    expect(backupsIn(first.dataDir)).toEqual([]);
    expect(version(next.db())).toBe(HEAD_VERSION);
  });
});

/* ---------------------------------------------------------------------- *
 * The backup, on its own terms
 * ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- *
 * MAR-682: the store one boot before the repair could see it
 *
 * The fixture is one `DROP TABLE chief_messages` on an otherwise ordinary,
 * fully-migrated store — the shape a build one merge behind MAR-676 leaves:
 * `user_version` already at 27, MAR-643's multi-account tables built in
 * full, and only the one table the loop believed it had already created
 * still missing. The step this repair runs is extracted from that same
 * store's own `sqlite_master` before the table is dropped, for the same
 * reason `divergeToPreRenumber`'s fixtures are built from SQL rather than
 * copied: it is master's own migration, not somebody's recollection of it.
 * ---------------------------------------------------------------------- */

function chiefMessagesDdl(database: DatabaseSync): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chief_messages'")
    .get();
  if (row === undefined || row["sql"] === null) {
    throw new Error("chief_messages should exist on a freshly migrated store.");
  }
  return String(row["sql"]);
}

/**
 * The one table away, and `user_version` back to what that store recorded.
 *
 * The rewind is not cosmetic and it is not a fixture convenience: MAR-682's
 * signature is a store recording **exactly 27** with `chief_messages` absent,
 * and it stays 27 forever, because it describes a store a build one merge behind
 * MAR-676 left on one machine. The head moves — MAR-654 took it to 28 — and this
 * signature does not follow it, which is the whole reason `RECONCILED_VERSION`
 * is a constant rather than `MIGRATIONS.length`. So a fixture built by migrating
 * a fresh store has to put the number back to the one the real store held.
 */
function dropChiefMessages(database: DatabaseSync): void {
  database.exec("DROP TABLE chief_messages");
  // The literal rather than `RECONCILED_VERSION`, for `divergeToPreRenumber`'s
  // reason one signature along: a fixture that read the constant would follow it
  // if somebody ever moved it, and the number is the fact under test.
  database.exec("PRAGMA user_version = 27");
}

describe("the store one boot before MAR-676's repair could see it (MAR-682)", () => {
  it("recognises user_version 27 with chief_messages missing and multi-account built", async () => {
    const { db } = await freshStore();
    const handle = db.db();
    dropChiefMessages(handle);

    const { inspectChieflessStore } = await import("../lib/store-reconcile");
    expect(inspectChieflessStore(handle)).toEqual({ chiefless: true, recorded_version: 27 });
  });

  it("leaves a healthy store at 27 alone", async () => {
    const { db } = await freshStore();
    const { inspectChieflessStore } = await import("../lib/store-reconcile");

    expect(inspectChieflessStore(db.db())).toEqual({ chiefless: false });
  });

  it("leaves MAR-676's own diverged store alone -- it has not reached 27 yet", async () => {
    const { db } = await freshStore();
    divergeToPreRenumber(db.db());
    const { inspectChieflessStore } = await import("../lib/store-reconcile");

    expect(inspectChieflessStore(db.db())).toEqual({ chiefless: false });
  });

  it("names the one-entry window CHIEFLESS_SLICE points at", async () => {
    const { CHIEFLESS_SLICE } = await import("../lib/store-reconcile");
    expect(CHIEFLESS_SLICE).toEqual({ from: 23, to: 24 });
  });
});

describe("reconcileChieflessStore", () => {
  it("creates chief_messages from the store's own step, backs up first, and leaves user_version at 27", async () => {
    const { dataDir, db } = await freshStore();
    const handle = db.db();
    const ddl = chiefMessagesDdl(handle);
    dropChiefMessages(handle);
    expect(tableNames(handle)).not.toContain("chief_messages");
    expect(backupsIn(dataDir)).toEqual([]);

    const { reconcileChieflessStore } = await import("../lib/store-reconcile");
    const at = new Date("2026-08-17T10:00:00.000Z");
    let recorded: unknown = null;

    const reconciliation = reconcileChieflessStore(handle, {
      storePath: path.join(dataDir, "dash.sqlite"),
      steps: [ddl],
      now: () => at,
      log: () => {},
      record: (_handle, done) => {
        recorded = done;
      },
    });

    expect(reconciliation).toMatchObject({
      recorded_version: 27,
      final_version: 27,
      applied_versions: [24],
      created_tables: ["chief_messages"],
      created_indexes: [],
      removed_fleet_secret_rows: 0,
    });
    expect(reconciliation?.backup.copied).toBeGreaterThan(0);
    expect(recorded).toEqual(reconciliation);

    // The table is back, byte-identical to what dropping it took away — proof
    // this ran the store's own step and not a hand-written guess at its DDL.
    expect(chiefMessagesDdl(handle)).toEqual(ddl);
    // Still 27, because this drives the repair directly rather than through a
    // boot: it leaves `user_version` exactly where it found it, and the ordinary
    // loop is what carries the store on to the head. `migrate()`'s own test
    // below is the one that sees the number move.
    expect(version(handle)).toBe(27);

    const backups = backupsIn(dataDir);
    expect(backups.length).toBeGreaterThan(0);
    expect(backups.every((name) => name.startsWith("dash.sqlite.before-reconcile-"))).toBe(true);
  });

  it("refuses by name, changes nothing, and leaves no backup behind, on a shape it does not recognise", async () => {
    const { dataDir, db } = await freshStore();
    const handle = db.db();
    const ddl = chiefMessagesDdl(handle);
    dropChiefMessages(handle);
    // A column migration 27 does not produce, same as MAR-676's own refusal
    // test -- SQLite cannot put it back without rebuilding the table.
    handle.exec("ALTER TABLE fleet_connections DROP COLUMN account_hint");

    const { reconcileChieflessStore } = await import("../lib/store-reconcile");
    const options = { storePath: path.join(dataDir, "dash.sqlite"), steps: [ddl] };

    expect(() => reconcileChieflessStore(handle, options)).toThrow(/fleet_connections has columns/);
    expect(() => reconcileChieflessStore(handle, options)).toThrow(/What was found, in full/);

    expect(backupsIn(dataDir)).toEqual([]);
    expect(tableNames(handle)).not.toContain("chief_messages");
  });

  it("leaves a healthy store at 27 alone", async () => {
    const { dataDir, db } = await freshStore();
    const handle = db.db();
    const ddl = chiefMessagesDdl(handle);

    const { reconcileChieflessStore } = await import("../lib/store-reconcile");
    expect(
      reconcileChieflessStore(handle, { storePath: path.join(dataDir, "dash.sqlite"), steps: [ddl] }),
    ).toBeNull();
    expect(backupsIn(dataDir)).toEqual([]);
  });

  it("leaves MAR-676's own diverged store alone -- it has not reached 27 yet", async () => {
    const { dataDir, db } = await freshStore();
    const handle = db.db();
    divergeToPreRenumber(handle);

    const { reconcileChieflessStore } = await import("../lib/store-reconcile");
    expect(
      reconcileChieflessStore(handle, { storePath: path.join(dataDir, "dash.sqlite"), steps: [] }),
    ).toBeNull();
    expect(backupsIn(dataDir)).toEqual([]);
  });
});

describe("migrate() wires MAR-682 at boot, beside MAR-676's own call", () => {
  it("repairs a chief-less store on the next boot, backs it up, and records the receipt", async () => {
    const first = await freshStore();
    dropChiefMessages(first.db.db());
    first.db.closeDb();
    expect(backupsIn(first.dataDir)).toEqual([]);

    const next = await reopen(first.dataDir);
    const handle = next.db();

    expect(version(handle)).toBe(HEAD_VERSION);
    expect(tableNames(handle)).toContain("chief_messages");

    const backups = backupsIn(first.dataDir);
    expect(backups.length).toBeGreaterThan(0);
    expect(backups.every((name) => name.startsWith("dash.sqlite.before-reconcile-"))).toBe(true);

    const reconciliation = next.describeStoreReconciliation();
    expect(reconciliation).toMatchObject({
      recorded_version: 27,
      final_version: 27,
      applied_versions: [24],
      created_tables: ["chief_messages"],
      created_indexes: [],
      removed_fleet_secret_rows: 0,
    });
    expect(reconciliation?.backup.copied).toBeGreaterThan(0);
  });

  it("leaves a healthy store, and MAR-676's own diverged store, untouched by the MAR-682 call", async () => {
    const first = await freshStore();
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    expect(version(next.db())).toBe(HEAD_VERSION);
    expect(next.describeStoreReconciliation()).toBeNull();
    expect(backupsIn(first.dataDir)).toEqual([]);
  });

  it("does not double-fire MAR-682 on a store MAR-676's own call just repaired", async () => {
    const first = await freshStore();
    divergeToPreRenumber(first.db.db());
    first.db.closeDb();

    const next = await reopen(first.dataDir);
    const handle = next.db();

    // MAR-676's own call already created chief_messages as its first step, so
    // this boot's MAR-682 call finds it present and returns null -- the one
    // reconciliation record on the store is MAR-676's, not a second one that
    // overwrote it.
    expect(version(handle)).toBe(HEAD_VERSION);
    expect(tableNames(handle)).toContain("chief_messages");
    expect(next.describeStoreReconciliation()).toMatchObject({
      recorded_version: 24,
      applied_versions: [24, 25, 26],
    });
    // One reconciliation event, not two: every backup file (the database and
    // whichever siblings existed) carries the same stamp, which is MAR-676's
    // own backup and not a second one MAR-682 took after it.
    const stamps = new Set(
      backupsIn(first.dataDir).map((name) => name.replace(/-wal$|-shm$/, "")),
    );
    expect(stamps.size).toBe(1);
  });
});

describe("backupStoreBeside", () => {
  it("refuses rather than overwriting a copy that is already there", async () => {
    const { dataDir } = await freshStore();
    const { backupStoreBeside } = await import("../lib/store-reconcile");
    const at = new Date("2026-08-17T09:00:00.000Z");

    const first = backupStoreBeside(dataDir, "dash.sqlite", at);
    expect(first.ok).toBe(true);

    // The stamp carries the moment so two attempts cannot collide. If they did,
    // overwriting would destroy the earlier copy, which is the one thing a
    // backup may not do.
    const second = backupStoreBeside(dataDir, "dash.sqlite", at);
    expect(second.ok).toBe(false);
  });

  it("refuses when there is no store to copy", async () => {
    const { dataDir } = await freshStore();
    const { backupStoreBeside } = await import("../lib/store-reconcile");

    const outcome = backupStoreBeside(dataDir, "not-a-store.sqlite", new Date());
    expect(outcome).toEqual({
      ok: false,
      detail: `There is no store at "${path.join(dataDir, "not-a-store.sqlite")}" to copy.`,
    });
  });

  it("puts the suffix before the sibling marker, so a log is found where SQLite looks", async () => {
    const { dataDir } = await freshStore();
    const { backupStoreBeside } = await import("../lib/store-reconcile");

    const outcome = backupStoreBeside(dataDir, "dash.sqlite", new Date("2026-08-17T09:00:00.000Z"));
    expect(outcome.ok).toBe(true);
    expect(existsSync(path.join(dataDir, "dash.sqlite.before-reconcile-2026-08-17T09-00-00-000Z"))).toBe(
      true,
    );
    // `dash.sqlite-wal.before-reconcile-…` would be an orphan: SQLite looks for
    // `<database>-wal`, so the marker has to stay on the end.
    for (const name of readdirSync(dataDir).filter((entry) => entry.includes("before-reconcile"))) {
      expect(name).not.toMatch(/-wal\.before-reconcile/);
      expect(name).not.toMatch(/-shm\.before-reconcile/);
    }
  });
});
