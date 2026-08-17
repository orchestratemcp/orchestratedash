/**
 * The one-time repair of a store a pre-renumber build migrated (MAR-676).
 *
 * ## What went wrong, stated exactly
 *
 * MAR-643's multi-account replacement of `fleet_connections` was authored as
 * migration **24** and renumbered twice on its way to master, because MAR-659's
 * chief transcript, MAR-628's browser ledger and MAR-673's decisions log each
 * reached master first and each kept the number it shipped with. That renumber is
 * the correct move and `tests/store-sqlite.test.ts`' version pin exists to force
 * somebody to think about it — but the pin protects *branches*. Nothing protected
 * an installed store that a pre-renumber build had already opened.
 *
 * On 2026-08-16 a build of the MAR-643 branch resolved the real userData from a
 * worktree (`electron/data-dir.ts`, and the guard MAR-676 adds beside it) and ran
 * its step 24. So one store on this planet records:
 *
 * * `user_version` = 24, 25 or 26 — however far that build got;
 * * the **multi-account shape**, which on master only step 27 produces;
 * * and **none** of `chief_messages`, the three browser tables or
 *   `fleet_decisions`, which on master are exactly what 24, 25 and 26 produce.
 *
 * No commit of master can produce that combination, which is what makes it safe
 * to recognise. The ordinary runner cannot fix it: it reads "24 applied" and runs
 * 25, 26 and 27, so 27 meets a table it has already rebuilt (it is idempotent
 * against the shape and returns early, which is why nothing crashed) and the
 * three features that landed as 24, 25 and 26 can never come into existence on
 * that store by the normal path. The chief's transcript, the browser trail and
 * the decisions log were unreachable, silently, with every test green.
 *
 * ## Why this is code and not a person with a SQL prompt
 *
 * MAR-676's own constraint: *never hand-edit the installed store.* A hand repair
 * is unreviewable, unrepeatable and untestable, and the one store it would be
 * performed on is the only store that matters. This runs at boot, from the
 * migration runner, on a signature narrow enough that no clean store, no fresh
 * store and no already-27 store can enter it — all three are driven as negatives
 * in `tests/store-reconcile.test.ts`, and the diverged shape is built there from
 * SQL rather than from a copy of anybody's data.
 *
 * ## Four properties, in the order they happen
 *
 * 1. **Back up before touching anything.** `backupStoreBeside` copies the
 *    database and its `-wal`/`-shm` siblings beside themselves under a dated
 *    name, on `retireDamagedStore`'s conventions — all three or none, never a
 *    subdirectory, and it renames-never-deletes in the sense that matters here:
 *    it *copies*, so the original is still the original if anything below fails.
 * 2. **Create the missing tables by running those steps' own definitions.** The
 *    steps arrive as a parameter, sliced out of `MIGRATIONS` by the caller, so
 *    this module holds no second copy of their SQL to drift from them.
 * 3. **Verify the multi-account shape, repair only what is demonstrably
 *    repairable, and refuse by name otherwise.** A reconciliation that guesses is
 *    worse than one that stops: the refusal prints the shape it actually found,
 *    so one attempt yields the answer instead of another guess.
 * 4. **Set `user_version` honestly, in the same transaction as the last change.**
 *    Not `MIGRATIONS.length` — 27, the number of steps this store has genuinely
 *    now had applied. Steps appended after 27 are then run by the ordinary loop,
 *    which is the whole point of leaving it at 27 rather than at "current".
 *
 * A refusal throws, and that stops DASH from starting. That is deliberate and it
 * is the lesser harm: booting the new renderer over a half-old store is precisely
 * the defect this repairs, and it ran for a day without anybody being told. The
 * backup is already on disk by then and the transaction has rolled back, so a
 * refusal leaves the store byte-for-byte as it was found.
 */

import { copyFileSync, constants as fsConstants, existsSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * One migration step, in the two forms `MIGRATIONS` holds.
 *
 * Declared here rather than in `lib/db.ts` so that `applyMigrationStep` below is
 * the single place either form is executed. The runner and this repair used to be
 * two four-line copies of the same `typeof step === "function"` branch, which is
 * two places a step form could be handled differently.
 */
export type StoreMigrationStep = string | ((database: DatabaseSync) => void);

/** Run one step, whichever form it is. */
export function applyMigrationStep(database: DatabaseSync, step: StoreMigrationStep): void {
  if (typeof step === "function") {
    step(database);
  } else {
    database.exec(step);
  }
}

/* ---------------------------------------------------------------------- *
 * The numbers, named once
 * ---------------------------------------------------------------------- */

/**
 * The first and last `user_version` a pre-renumber build could have left.
 *
 * Multi-account was authored as 24 and renumbered to 25 and then to 27, so a
 * build carrying it recorded 24, 25 or 26 depending on which revision ran. Below
 * 24 the step did not exist in any revision; at 27 the store is master's and
 * there is nothing to reconcile.
 *
 * The range is half of what makes the signature narrow. The other half is that
 * the two conditions below it — multi-account present, a master 24-26 table
 * absent — cannot both hold on any master store at any version.
 */
export const DIVERGED_VERSION_RANGE = { first: 24, last: 26 } as const;

/**
 * The steps master shipped as 24, 25 and 26, and the tables each creates.
 *
 * **`index` and `version` are different numbers and conflating them is a real
 * bug this had.** Applying the step at index *i* takes `user_version` from *i* to
 * *i + 1*, so master's "migration 24" — the chief's transcript, in
 * `tests/store-sqlite.test.ts`' own numbering, which counts the version a step
 * produces — is the entry at index **23**. Slicing `MIGRATIONS` at 24 instead
 * created the browser tables and the decisions log and silently left
 * `chief_messages` out, which is the shape of the original defect wearing the
 * repair's clothes.
 *
 * The names are what the signature tests for absence, what the repair reports
 * creating, and what it verifies afterwards. The **SQL** is not here:
 * `reconcileRenumberedStore` receives the steps themselves, and
 * `tests/store-reconcile.test.ts` asserts that the DDL a reconciled store ends up
 * with is byte-identical to a fresh store's — which is what pins these indices,
 * because a wrong one produces a missing table and fails there.
 */
export const RENUMBERED_STEPS: ReadonlyArray<{
  /** Position in `MIGRATIONS`. */
  index: number;
  /** The `user_version` this step produces, which is how master numbers it. */
  version: number;
  tables: readonly string[];
}> = [
  { index: 23, version: 24, tables: ["chief_messages"] },
  { index: 24, version: 25, tables: ["browser_sessions", "browser_actions", "browser_blocked"] },
  { index: 25, version: 26, tables: ["fleet_decisions"] },
];

/** MAR-643's multi-account replacement: the step this verifies rather than runs. */
const MULTI_ACCOUNT_INDEX = 26;
const MULTI_ACCOUNT_VERSION = MULTI_ACCOUNT_INDEX + 1;

/**
 * What `user_version` says after this runs.
 *
 * 27 and not `MIGRATIONS.length`: this repair applies the three steps above and
 * finds multi-account already applied, and it must not claim a step 28 it never
 * ran. The ordinary loop picks up from here.
 */
export const RECONCILED_VERSION = MULTI_ACCOUNT_VERSION;

/**
 * The window of `MIGRATIONS` the repair needs, for the caller to slice with.
 *
 * Exported so `lib/db.ts` names no index of its own: there is one place these
 * numbers are written down, and it is beside the comment explaining why they are
 * not the numbers the version pin uses.
 */
export const RENUMBERED_SLICE = {
  from: RENUMBERED_STEPS[0]?.index ?? 0,
  to: MULTI_ACCOUNT_INDEX,
} as const;

/* ---------------------------------------------------------------------- *
 * The shape migration 27 produces
 * ---------------------------------------------------------------------- */

/**
 * What the multi-account shape *is*, declared once.
 *
 * A declared expectation rather than a comparison against step 27's own SQL,
 * because you cannot compare a shape against a procedure: step 27 is a function
 * that renames a table, copies rows out of it and drops it, and there is no
 * string in it to diff. MAR-676 asks for exactly these three things — "columns,
 * indexes, the `(provider, account_id)` conflict target" — so they are what is
 * declared.
 *
 * **The drift is caught by a test, not by hope.** `tests/store-reconcile.test.ts`
 * migrates a fresh store the ordinary way, inspects it with `inspectFleetShape`
 * below, and asserts it equals this. A change to step 27 that this did not
 * follow fails there.
 */
const EXPECTED_FLEET_CONNECTIONS_COLUMNS = [
  "provider",
  "account_id",
  "connector_kind",
  "field_id",
  "secret_name",
  "masked_hint",
  "account_hint",
  "scopes",
  "backend",
  "is_default",
  "connected_at",
  "updated_at",
] as const;

const EXPECTED_ASSIGNMENT_COLUMNS = ["provider", "agent", "account_id", "decided_at"] as const;

/**
 * The indexes step 27 declares, with the DDL that recreates a missing one.
 *
 * These are the one difference this repair will *fix* rather than refuse. An
 * index is derived data: creating one that should be there changes no row and
 * cannot lose anything, and a pre-renumber revision that declared one fewer index
 * is the most likely difference there is. Everything structural — a column, a
 * primary key, a uniqueness constraint — needs the table rebuilt, and rebuilding
 * somebody's table on a guess is the thing this module refuses to do.
 */
const EXPECTED_INDEXES: ReadonlyArray<{
  name: string;
  table: string;
  columns: readonly string[];
  unique: boolean;
  partial: boolean;
  ddl: string;
}> = [
  {
    name: "fleet_connections_one_default",
    table: "fleet_connections",
    columns: ["provider"],
    unique: true,
    partial: true,
    ddl:
      "CREATE UNIQUE INDEX IF NOT EXISTS fleet_connections_one_default " +
      "ON fleet_connections (provider) WHERE is_default = 1",
  },
  {
    name: "fleet_connections_by_provider",
    table: "fleet_connections",
    columns: ["provider", "connected_at", "account_id"],
    unique: false,
    partial: false,
    ddl:
      "CREATE INDEX IF NOT EXISTS fleet_connections_by_provider " +
      "ON fleet_connections (provider, connected_at, account_id)",
  },
  {
    name: "fleet_account_assignments_by_account",
    table: "fleet_account_assignments",
    columns: ["provider", "account_id", "agent"],
    unique: false,
    partial: false,
    ddl:
      "CREATE INDEX IF NOT EXISTS fleet_account_assignments_by_account " +
      "ON fleet_account_assignments (provider, account_id, agent)",
  },
];

/**
 * `secret_name TEXT NOT NULL UNIQUE`, as SQLite implements it.
 *
 * A column-level UNIQUE becomes an automatic index, so it is checked as one and
 * not as text. It cannot be added afterwards without rebuilding the table, which
 * is why its absence is a refusal.
 */
const UNIQUE_SECRET_NAME_COLUMN = "secret_name";

/**
 * The whole expectation as one value, in the shape a real store reads back as.
 *
 * **This constant is the anti-drift mechanism, and it only works because a test
 * drives it against a real store.** `tests/store-reconcile.test.ts` migrates a
 * fresh store the ordinary way — running step 27 itself — inspects it with
 * `inspectFleetShape` and asserts the result equals this. So a change to step 27
 * that this did not follow fails there rather than turning into a refusal on
 * somebody's machine, and the declaration below can be read as "what migration 27
 * produces" rather than as somebody's recollection of it.
 */
export const EXPECTED_FLEET_SHAPE: FleetShape = {
  connections_columns: [...EXPECTED_FLEET_CONNECTIONS_COLUMNS],
  connections_primary_key: ["provider", "account_id"],
  assignments_columns: [...EXPECTED_ASSIGNMENT_COLUMNS],
  assignments_primary_key: ["provider", "agent"],
  named_indexes: EXPECTED_INDEXES.map((index) => ({
    name: index.name,
    columns: [...index.columns],
    unique: index.unique,
    partial: index.partial,
  })).sort((a, b) => a.name.localeCompare(b.name)),
  unique_columns: [UNIQUE_SECRET_NAME_COLUMN],
  has_is_default_check: true,
  leftover_tables: [],
};

/**
 * `is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))`.
 *
 * The one constraint that has to be read out of `sqlite_master.sql`, because no
 * pragma reports a CHECK. Compared with every space removed and the case folded,
 * so a revision that formatted its DDL differently is not mistaken for one that
 * declared something different.
 */
const EXPECTED_IS_DEFAULT_CHECK = "check(is_defaultin(0,1))";

export interface FleetIndexShape {
  name: string;
  columns: string[];
  unique: boolean;
  partial: boolean;
}

/** The multi-account shape as a store actually holds it. */
export interface FleetShape {
  connections_columns: string[];
  connections_primary_key: string[];
  assignments_columns: string[];
  assignments_primary_key: string[];
  /** Only the indexes DASH named. SQLite's own `sqlite_autoindex_*` are separate. */
  named_indexes: FleetIndexShape[];
  /** Columns carrying a unique automatic index — the column-level UNIQUE constraints. */
  unique_columns: string[];
  /** True when the `is_default` CHECK step 27 declares is in the table's DDL. */
  has_is_default_check: boolean;
  /**
   * Tables left behind by a table replacement that did not finish.
   *
   * Step 27 renames `fleet_connections` to `fleet_connections_v23`, copies the
   * rows out and drops it. One of those still sitting here is the most dangerous
   * shape this repair can meet, and it is a table rather than an index — which is
   * why it is read separately instead of being noticed among the indexes of the
   * two tables above, neither of which it is on.
   */
  leftover_tables: string[];
}

/**
 * Read the multi-account shape out of a store.
 *
 * Exported for the drift test above all: it is the one function that both the
 * expectation and a real migrated store are measured with, so the test comparing
 * them is comparing like with like.
 */
export function inspectFleetShape(database: DatabaseSync): FleetShape {
  const named: FleetIndexShape[] = [];
  const unique: string[] = [];
  for (const table of ["fleet_connections", "fleet_account_assignments"]) {
    for (const index of database.prepare(`PRAGMA index_list(${table})`).all()) {
      const name = String(index["name"]);
      const columns = database
        // Quoted as an identifier: every name here comes out of `sqlite_master`,
        // so it is either one DASH declared or one SQLite generated, and neither
        // needs escaping — but a pragma taking a bare name from a query result is
        // the shape somebody later reuses somewhere it does matter.
        .prepare(`PRAGMA index_info("${name.replace(/"/g, '""')}")`)
        .all()
        // A partial or expression index reports a null name for a column that is
        // not one; those are dropped rather than rendered as "null".
        .map((column) => (column["name"] === null ? null : String(column["name"])))
        .filter((column): column is string => column !== null);
      if (name.startsWith("sqlite_autoindex_")) {
        // An automatic index is a UNIQUE (or PRIMARY KEY) constraint wearing an
        // index's clothes. Only the single-column ones say anything this repair
        // checks; the primary key is read from `table_info` instead.
        if (Number(index["unique"]) === 1 && columns.length === 1 && columns[0] !== undefined) {
          unique.push(columns[0]);
        }
        continue;
      }
      named.push({
        name,
        columns,
        unique: Number(index["unique"]) === 1,
        partial: Number(index["partial"]) === 1,
      });
    }
  }

  return {
    connections_columns: columnNames(database, "fleet_connections"),
    connections_primary_key: primaryKey(database, "fleet_connections"),
    assignments_columns: columnNames(database, "fleet_account_assignments"),
    assignments_primary_key: primaryKey(database, "fleet_account_assignments"),
    named_indexes: named.sort((a, b) => a.name.localeCompare(b.name)),
    unique_columns: unique.sort(),
    has_is_default_check: normaliseDdl(tableDdl(database, "fleet_connections")).includes(
      EXPECTED_IS_DEFAULT_CHECK,
    ),
    leftover_tables: database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fleet_connections\\_v%' " +
          "ESCAPE '\\' ORDER BY name",
      )
      .all()
      .map((row) => String(row["name"])),
  };
}

function columnNames(database: DatabaseSync, table: string): string[] {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((column) => String(column["name"]));
}

/** The primary key columns, in key order rather than in column order. */
function primaryKey(database: DatabaseSync, table: string): string[] {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .filter((column) => Number(column["pk"]) > 0)
    .sort((a, b) => Number(a["pk"]) - Number(b["pk"]))
    .map((column) => String(column["name"]));
}

function tableDdl(database: DatabaseSync, table: string): string {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return row === undefined || row["sql"] === null ? "" : String(row["sql"]);
}

/** Every space gone and the case folded, so formatting is not a difference. */
function normaliseDdl(sql: string): string {
  return sql.replace(/\s+/g, "").toLowerCase();
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) !== undefined
  );
}

/* ---------------------------------------------------------------------- *
 * The signature
 * ---------------------------------------------------------------------- */

export type DivergedStore =
  | { diverged: false }
  | {
      diverged: true;
      /** What the store recorded. 24, 25 or 26. */
      recorded_version: number;
      /** The steps whose tables are absent, by version. */
      missing_versions: number[];
      /** Those steps' tables, by name, for the log and the record. */
      missing_tables: string[];
    };

/**
 * Is this the store a pre-renumber build migrated?
 *
 * Three conditions, all required, and each one alone is common:
 *
 * 1. `user_version` in `DIVERGED_VERSION_RANGE`. Every installed store passes
 *    through those numbers.
 * 2. The multi-account shape is present — `account_id` on `fleet_connections`
 *    **and** `fleet_account_assignments` exists. True of every store on master
 *    that has reached 27.
 * 3. At least one table from master's 24, 25 or 26 is absent. True of every store
 *    that has not reached that step yet.
 *
 * Together they are impossible on master. A master store at 24 has the chief's
 * transcript and no `account_id`; a master store at 27 has `account_id` and all
 * three; there is no master commit at which 2 and 3 both hold. That is the whole
 * argument for recognising this by shape rather than asking somebody.
 *
 * A store that has the multi-account shape recorded as 24 *and* all three tables
 * present is deliberately **not** diverged: nothing is missing, every step from
 * 24 on is idempotent against the shape, and the ordinary loop already leaves it
 * correct. Firing here would mean backing up a store to repair nothing.
 */
export function inspectDivergedStore(database: DatabaseSync): DivergedStore {
  const recorded = Number(
    (database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)
      ?.user_version ?? 0,
  );
  if (recorded < DIVERGED_VERSION_RANGE.first || recorded > DIVERGED_VERSION_RANGE.last) {
    return { diverged: false };
  }
  if (!tableExists(database, "fleet_connections") || !tableExists(database, "fleet_account_assignments")) {
    return { diverged: false };
  }
  if (!columnNames(database, "fleet_connections").includes("account_id")) {
    return { diverged: false };
  }

  const missingVersions: number[] = [];
  const missingTables: string[] = [];
  for (const step of RENUMBERED_STEPS) {
    const absent = step.tables.filter((table) => !tableExists(database, table));
    if (absent.length > 0) {
      missingVersions.push(step.version);
      missingTables.push(...absent);
    }
  }
  if (missingTables.length === 0) {
    return { diverged: false };
  }

  return {
    diverged: true,
    recorded_version: recorded,
    missing_versions: missingVersions,
    missing_tables: missingTables,
  };
}

/* ---------------------------------------------------------------------- *
 * The backup
 * ---------------------------------------------------------------------- */

export interface StoreBackup {
  /** The base name the copy now has, for the log and for a receipt. */
  copied_to: string;
  /** How many files were copied: the database, and its `-wal`/`-shm` siblings. */
  copied: number;
}

export type BackupOutcome = { ok: true; backup: StoreBackup } | { ok: false; detail: string };

/**
 * Copy a store beside itself under a dated name, before anything changes it.
 *
 * `retireDamagedStore`'s conventions, with the one difference the situation
 * requires: this **copies** where that one renames, because the original has to
 * stay where it is and be repaired. Everything else is deliberately the same
 * shape, for the same reasons that function argues at length:
 *
 * * **The `-wal` and `-shm` siblings travel with it.** A backup of the database
 *   without its log is a backup of whatever had last been checkpointed, which is
 *   not what the store said when this ran. The suffix goes before the sibling
 *   marker — `dash.sqlite.before-reconcile-….-wal`, not
 *   `dash.sqlite-wal.before-reconcile-…` — so a recovery tool opening the copy
 *   finds its log where SQLite looks for it.
 * * **All three, or none of them.** A half-written backup reported as a backup is
 *   worse than no backup, so the copies this call made are removed if one fails,
 *   and a removal that itself fails is reported as what it is. Removing a copy
 *   this call just created is not the deletion `retireDamagedStore` refuses: the
 *   user's own file has not been touched at any point.
 * * **The stamp carries the moment**, so two attempts cannot collide and the
 *   order is readable from a directory listing. `COPYFILE_EXCL` makes a collision
 *   a refusal rather than an overwrite.
 * * **Never a subdirectory.** Beside the store, where anybody looking at the
 *   store will see it.
 */
export function backupStoreBeside(
  directory: string,
  storeFileName: string,
  at: Date,
): BackupOutcome {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const suffix = `.before-reconcile-${stamp}`;
  const main = path.join(directory, storeFileName);

  if (!existsSync(main)) {
    // Nothing to copy is not a success. The caller is about to change a store,
    // and telling it there is a backup when there is none would remove the only
    // thing standing between a mistake here and somebody's records.
    return { ok: false, detail: `There is no store at "${main}" to copy.` };
  }

  const done: string[] = [];
  const rollback = (detail: string): BackupOutcome => {
    const stranded: string[] = [];
    for (const copy of done.reverse()) {
      try {
        unlinkSync(copy);
      } catch {
        stranded.push(path.basename(copy));
      }
    }
    if (stranded.length > 0) {
      return {
        ok: false,
        detail:
          `${detail} Part of the backup was written and could not be cleaned up ` +
          `(${stranded.join(", ")}). Your store itself was not touched. Remove those ` +
          `files and start DASH again.`,
      };
    }
    return { ok: false, detail };
  };

  for (const sibling of ["", "-wal", "-shm"]) {
    const from = `${main}${sibling}`;
    if (!existsSync(from)) {
      continue;
    }
    // A directory where a database should be is not something to copy.
    if (!statSync(from).isFile()) {
      return rollback(`"${from}" is not a file.`);
    }
    const to = `${main}${suffix}${sibling}`;
    try {
      copyFileSync(from, to, fsConstants.COPYFILE_EXCL);
    } catch (error: unknown) {
      return rollback(error instanceof Error ? error.message : String(error));
    }
    done.push(to);
  }

  return { ok: true, backup: { copied_to: `${storeFileName}${suffix}`, copied: done.length } };
}

/* ---------------------------------------------------------------------- *
 * The reconciliation
 * ---------------------------------------------------------------------- */

/** What the repair did, kept in `store_meta` and printed to the log. */
export interface StoreReconciliation {
  reconciled_at: string;
  /** What `user_version` said when this ran. */
  recorded_version: number;
  /** What it says now. */
  final_version: number;
  /** The steps whose definitions were run. */
  applied_versions: number[];
  /** The tables they created, by name. */
  created_tables: string[];
  /** Indexes step 27 declares that were absent and were created. */
  created_indexes: string[];
  /** `connection_secrets` rows step 27's own data step removes. */
  removed_fleet_secret_rows: number;
  backup: StoreBackup;
}

export interface ReconcileOptions {
  /** The store's own file, so the backup lands beside it. */
  storePath: string;
  /**
   * `MIGRATIONS[24..26]`, sliced by the caller.
   *
   * A parameter rather than an import so that this module holds no second copy
   * of their SQL. MAR-676: *"by running those steps' own definitions, not copies
   * of their SQL"*, which is a property of the call and is asserted in the test.
   */
  steps: ReadonlyArray<StoreMigrationStep>;
  now?: () => Date;
  /** Injected so the test can read the sentences without a console. */
  log?: (message: string) => void;
  /** Runs inside the transaction, with the record, before the commit. */
  record?: (database: DatabaseSync, reconciliation: StoreReconciliation) => void;
}

/**
 * Reconcile the store a pre-renumber build migrated, or do nothing at all.
 *
 * Returns null on every ordinary store — which is every store but one — and that
 * is the common path this is written to be cheap on: three pragmas and two
 * `sqlite_master` lookups before it decides.
 *
 * @throws when the multi-account shape is not one it recognises. See the module
 * header on why a refusal is preferable to a boot.
 */
export function reconcileRenumberedStore(
  database: DatabaseSync,
  options: ReconcileOptions,
): StoreReconciliation | null {
  const found = inspectDivergedStore(database);
  if (!found.diverged) {
    return null;
  }

  const at = (options.now ?? ((): Date => new Date()))();
  const log = options.log ?? ((message: string): void => console.warn(message));

  if (options.steps.length !== RENUMBERED_STEPS.length) {
    // A caller that sliced the wrong window would create the wrong tables under
    // the right names. Checked here rather than trusted, because the one thing
    // this function may not do is apply a step it was not asked to.
    throw new Error(
      `[dash-store] The reconciliation needs the ${String(RENUMBERED_STEPS.length)} steps master ` +
        `shipped as ${RENUMBERED_STEPS.map((step) => String(step.version)).join(", ")} and was ` +
        `given ${String(options.steps.length)}.`,
    );
  }

  /*
   * The shape check runs before the backup, and that order is deliberate: a
   * refusal should not leave a backup file behind for a repair that never
   * started. Nothing has been written at this point, so a throw here costs
   * nothing but a failed boot with a message in it.
   */
  const shape = inspectFleetShape(database);
  const unrecognised = describeShapeDifference(shape);
  if (unrecognised !== null) {
    throw new Error(
      `[dash-store] DASH will not start, and nothing has been changed.\n\n` +
        `This store records migration ${String(found.recorded_version)} with MAR-643's ` +
        `multi-account tables already built and ${found.missing_tables.join(", ")} missing — the ` +
        `MAR-676 signature. The repair for it is built in, but the multi-account shape here is ` +
        `not one it recognises, and a repair that guessed would be worse than this message:\n\n` +
        `${unrecognised}\n\n` +
        `What was found, in full:\n${JSON.stringify(shape, null, 2)}\n\n` +
        `Send that to whoever maintains DASH. Your store is untouched and there is no backup to ` +
        `clean up. Nothing here is lost.`,
    );
  }

  const directory = path.dirname(options.storePath);
  const backup = backupStoreBeside(directory, path.basename(options.storePath), at);
  if (!backup.ok) {
    throw new Error(
      `[dash-store] DASH will not start, and nothing has been changed.\n\n` +
        `This store needs MAR-676's one-time repair, and that repair copies your store beside ` +
        `itself first. The copy could not be made: ${backup.detail}\n\n` +
        `Free some disk space or close whatever is holding the file, then start DASH again.`,
    );
  }

  const reconciliation: StoreReconciliation = {
    reconciled_at: at.toISOString(),
    recorded_version: found.recorded_version,
    final_version: RECONCILED_VERSION,
    applied_versions: [],
    created_tables: [],
    created_indexes: [],
    removed_fleet_secret_rows: 0,
    backup: backup.backup,
  };

  /*
   * One transaction for every change and for the pragma that claims them. A
   * crash in the middle leaves the store at its recorded version with its tables
   * as they were, which is the state this arrived in and a state the repair can
   * be attempted from again — with the previous attempt's backup still beside it.
   */
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [index, step] of RENUMBERED_STEPS.entries()) {
      const definition = options.steps[index];
      if (definition === undefined) {
        continue;
      }
      // Every one of these steps is written with `IF NOT EXISTS`, so a store
      // missing two of the three tables gets the third left alone rather than
      // failing on a duplicate. That is the property their own comments claim
      // and the reason this can run them whole instead of picking statements
      // out of them.
      applyMigrationStep(database, definition);
      reconciliation.applied_versions.push(step.version);
      reconciliation.created_tables.push(...step.tables.filter((table) => found.missing_tables.includes(table)));
    }

    for (const index of EXPECTED_INDEXES) {
      if (shape.named_indexes.some((present) => present.name === index.name)) {
        continue;
      }
      database.exec(index.ddl);
      reconciliation.created_indexes.push(index.name);
    }

    /*
     * Step 27's own data step, which the shape check cannot speak for.
     *
     * `fleet_connections` became the sole readable reference for fleet vault
     * entries, and the old `dash.fleet` row in `connection_secrets` cannot
     * describe two accounts. A pre-renumber revision may or may not have removed
     * it; deleting a row that is already gone is a no-op, and leaving one behind
     * would keep a second, narrower answer to "where is the fleet credential"
     * alive on the one store where that question is already confused.
     */
    const removed = database.prepare("DELETE FROM connection_secrets WHERE agent = 'dash.fleet'").run();
    reconciliation.removed_fleet_secret_rows = Number(removed.changes);

    /*
     * Did the steps do what this claims they did?
     *
     * `RENUMBERED_STEPS` carries hand-written indexes into `MIGRATIONS`, and a
     * hand-written index is exactly the kind of number that is off by one. The
     * first draft of this was, and the symptom was the quietest one available: the
     * repair reported creating `chief_messages`, `user_version` went to 27, and
     * the table was not there — the original defect reproduced by the code
     * written to fix it. Asserting inside the transaction turns that into a
     * rollback and a message.
     */
    const stillMissing = found.missing_tables.filter((table) => !tableExists(database, table));
    if (stillMissing.length > 0) {
      throw new Error(
        `[dash-store] The MAR-676 repair ran the steps it was given and ` +
          `${stillMissing.join(", ")} still ${stillMissing.length === 1 ? "does" : "do"} not ` +
          `exist. RENUMBERED_STEPS names the wrong index into MIGRATIONS, so nothing has been ` +
          `changed. Your store is as it was and a copy of it is beside it as ` +
          `${backup.backup.copied_to}.`,
      );
    }

    options.record?.(database, reconciliation);

    // Interpolated because SQLite takes no parameter in a PRAGMA. The value is a
    // module constant, never caller input — `migrate`'s own note.
    database.exec(`PRAGMA user_version = ${String(RECONCILED_VERSION)}`);
    database.exec("COMMIT");
  } catch (error: unknown) {
    database.exec("ROLLBACK");
    throw error;
  }

  log(
    `[dash-store] MAR-676 reconciliation: this store recorded migration ` +
      `${String(found.recorded_version)} with MAR-643's multi-account tables already built, which ` +
      `only a pre-release build produces. Copied the store to ${backup.backup.copied_to} ` +
      `(${String(backup.backup.copied)} files), ran the steps master shipped as ` +
      `${reconciliation.applied_versions.map((version) => String(version)).join(", ")} to create ` +
      `${reconciliation.created_tables.join(", ")}, ` +
      (reconciliation.created_indexes.length === 0
        ? `found migration ${String(MULTI_ACCOUNT_VERSION)}'s indexes already in place`
        : `created the missing index ${reconciliation.created_indexes.join(", ")}`) +
      `, removed ${String(reconciliation.removed_fleet_secret_rows)} superseded dash.fleet ` +
      `credential reference(s), and set user_version to ${String(RECONCILED_VERSION)}.`,
  );

  return reconciliation;
}

/**
 * What is unrecognisable about this multi-account shape, or null if nothing is.
 *
 * Only the differences that would make the repair unsafe are refusals. A missing
 * index is not one of them and is repaired above; everything here needs the table
 * rebuilt, and rebuilding somebody's table from a guess about how it got that way
 * is what MAR-676 means by *"a reconciliation that guesses is worse than one that
 * stops"*.
 */
function describeShapeDifference(shape: FleetShape): string | null {
  const problems: string[] = [];
  const expected = EXPECTED_FLEET_SHAPE;

  if (shape.connections_columns.join(",") !== expected.connections_columns.join(",")) {
    problems.push(
      `- fleet_connections has columns [${shape.connections_columns.join(", ")}] where ` +
        `migration ${String(MULTI_ACCOUNT_VERSION)} produces ` +
        `[${expected.connections_columns.join(", ")}].`,
    );
  }
  if (shape.connections_primary_key.join(",") !== expected.connections_primary_key.join(",")) {
    problems.push(
      `- fleet_connections' primary key is [${shape.connections_primary_key.join(", ")}] where ` +
        `migration ${String(MULTI_ACCOUNT_VERSION)} produces ` +
        `[${expected.connections_primary_key.join(", ")}]. That key is the conflict target every ` +
        `fleet write uses, so nothing may proceed on a different one.`,
    );
  }
  if (!shape.unique_columns.includes(UNIQUE_SECRET_NAME_COLUMN)) {
    problems.push(
      `- fleet_connections.${UNIQUE_SECRET_NAME_COLUMN} is not unique. Migration ` +
        `${String(MULTI_ACCOUNT_VERSION)} declares it UNIQUE, and SQLite cannot add that without ` +
        `rebuilding the table.`,
    );
  }
  if (!shape.has_is_default_check) {
    problems.push(
      `- fleet_connections.is_default carries no CHECK (is_default IN (0, 1)). Migration ` +
        `${String(MULTI_ACCOUNT_VERSION)} declares one, and SQLite cannot add it without ` +
        `rebuilding the table.`,
    );
  }
  if (shape.assignments_columns.join(",") !== expected.assignments_columns.join(",")) {
    problems.push(
      `- fleet_account_assignments has columns [${shape.assignments_columns.join(", ")}] where ` +
        `migration ${String(MULTI_ACCOUNT_VERSION)} produces ` +
        `[${expected.assignments_columns.join(", ")}].`,
    );
  }
  if (shape.assignments_primary_key.join(",") !== expected.assignments_primary_key.join(",")) {
    problems.push(
      `- fleet_account_assignments' primary key is [${shape.assignments_primary_key.join(", ")}] ` +
        `where migration ${String(MULTI_ACCOUNT_VERSION)} produces ` +
        `[${expected.assignments_primary_key.join(", ")}].`,
    );
  }

  for (const expected of EXPECTED_INDEXES) {
    const present = shape.named_indexes.find((index) => index.name === expected.name);
    if (present === undefined) {
      // Absent is the repairable case, not a refusal. See `EXPECTED_INDEXES`.
      continue;
    }
    if (
      present.columns.join(",") !== expected.columns.join(",") ||
      present.unique !== expected.unique ||
      present.partial !== expected.partial
    ) {
      problems.push(
        `- the index ${expected.name} covers [${present.columns.join(", ")}] ` +
          `(unique: ${String(present.unique)}, partial: ${String(present.partial)}) where ` +
          `migration ${String(MULTI_ACCOUNT_VERSION)} declares [${expected.columns.join(", ")}] ` +
          `(unique: ${String(expected.unique)}, partial: ${String(expected.partial)}).`,
      );
    }
  }

  /*
   * The half-finished migration, which is its own case and the most dangerous
   * one. Step 27 renames `fleet_connections` to `fleet_connections_v23`, copies
   * the rows out and drops it. A store still holding that table is one where the
   * step died between the rename and the drop, and there is no way to know from
   * here which of the two tables holds the rows somebody actually connected.
   */
  if (shape.leftover_tables.length > 0) {
    problems.push(
      `- a table from a half-finished replacement is still here ` +
        `(${shape.leftover_tables.join(", ")}), so migration ${String(MULTI_ACCOUNT_VERSION)} did ` +
        `not run to completion and which table holds your connections cannot be decided from here.`,
    );
  }

  return problems.length === 0 ? null : problems.join("\n");
}

/* ---------------------------------------------------------------------- *
 * MAR-682: the store one boot before the repair could see it
 * ---------------------------------------------------------------------- */

/**
 * The store MAR-676's own repair cannot reach.
 *
 * A build compiled one merge behind MAR-676 carried the *renumbered*
 * multi-account migration — authored correctly as step 27, no off-by-one —
 * but not the reconciliation itself. Run against a store already sitting at
 * a pre-renumber `user_version` of 24 (MAR-676's own signature, before its
 * repair existed to catch it), that build's ordinary loop read "24 applied"
 * and ran the steps master ships as 25, 26 and 27 — never 24 again, which is
 * the one that creates `chief_messages` and the one the loop believed
 * already ran. The result records `user_version` = 27, MAR-643's
 * multi-account shape complete (27's own DELETE included), and
 * `chief_messages` alone absent: the one table skipped, not three, because
 * everything after it in the loop ran in full.
 *
 * `DIVERGED_VERSION_RANGE` stops at 26 on purpose — a store already at 27 was
 * "finished" as far as MAR-676 could tell, and firing MAR-676's own repair
 * there finds nothing in its three-table window missing and correctly does
 * nothing. This is a narrower, later signature: not a range of versions but
 * the single version multi-account's own step produces, with exactly the one
 * table the loop that thought it already ran it never ran.
 *
 * Recognised by shape for the same reason MAR-676 is: master's loop runs
 * every step in order from zero on a fresh store, and MAR-676's own repair —
 * wherever it does fire — asserts `chief_messages` exists before it will ever
 * claim 27. No honest boot produces `user_version` = 27 without it.
 */
export type ChieflessStore =
  | { chiefless: false }
  | {
      chiefless: true;
      /** Always 27 — the version this signature is defined at. */
      recorded_version: number;
    };

/** The single step this repairs: master's own migration 24, `chief_messages`. */
const CHIEF_STEP = RENUMBERED_STEPS[0];
const CHIEF_MESSAGES_TABLE = CHIEF_STEP?.tables[0] ?? "chief_messages";

/**
 * The window of `MIGRATIONS` this repair needs, for a caller to slice with —
 * `RENUMBERED_SLICE`'s own convention, one entry wide.
 */
export const CHIEFLESS_SLICE = {
  from: CHIEF_STEP?.index ?? 0,
  to: (CHIEF_STEP?.index ?? 0) + 1,
} as const;

/**
 * Is this the store MAR-682 describes?
 *
 * Cheap on the common path, same as `inspectDivergedStore`: a pragma and two
 * `sqlite_master` lookups before it can say no, which every store but the one
 * that matters does.
 */
export function inspectChieflessStore(database: DatabaseSync): ChieflessStore {
  const recorded = Number(
    (database.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined)
      ?.user_version ?? 0,
  );
  if (recorded !== RECONCILED_VERSION) {
    return { chiefless: false };
  }
  if (
    !tableExists(database, "fleet_connections") ||
    !tableExists(database, "fleet_account_assignments") ||
    !columnNames(database, "fleet_connections").includes("account_id")
  ) {
    // 27 with the multi-account shape missing is not a store an honest boot
    // or MAR-676's own repair could produce, and it is not this signature
    // either — MAR-682 only ever fires beside the shape, never instead of it.
    return { chiefless: false };
  }
  if (tableExists(database, CHIEF_MESSAGES_TABLE)) {
    return { chiefless: false };
  }
  return { chiefless: true, recorded_version: recorded };
}

/**
 * Repair the store MAR-682 describes, or do nothing at all.
 *
 * Same shape as `reconcileRenumberedStore`, narrowed to what this signature
 * actually needs: back up, run the one step that was skipped, verify it
 * worked, record it — and leave `user_version` exactly where it was, because
 * this store had already reached 27 honestly. Nothing here re-runs 27's own
 * work; the multi-account shape is verified, never rebuilt.
 *
 * @throws when the multi-account shape beside the missing table is not one
 * this recognises — the same refusal machinery `reconcileRenumberedStore`
 * uses, on the same argument: a repair that guessed would be worse than a
 * message naming exactly what was found.
 */
export function reconcileChieflessStore(
  database: DatabaseSync,
  options: ReconcileOptions,
): StoreReconciliation | null {
  const found = inspectChieflessStore(database);
  if (!found.chiefless) {
    return null;
  }

  const at = (options.now ?? ((): Date => new Date()))();
  const log = options.log ?? ((message: string): void => console.warn(message));

  if (options.steps.length !== 1) {
    // Same defence `reconcileRenumberedStore` takes on its own window: a
    // caller that sliced the wrong span would create the wrong table under
    // the right name.
    throw new Error(
      `[dash-store] The MAR-682 repair needs the one step master shipped as ` +
        `${String(CHIEF_STEP?.version ?? 24)} and was given ${String(options.steps.length)}.`,
    );
  }

  /*
   * Same ordering as MAR-676, and for the same reason: a refusal must not
   * leave a backup file behind for a repair that never started.
   */
  const shape = inspectFleetShape(database);
  const unrecognised = describeShapeDifference(shape);
  if (unrecognised !== null) {
    throw new Error(
      `[dash-store] DASH will not start, and nothing has been changed.\n\n` +
        `This store records migration ${String(RECONCILED_VERSION)} with MAR-643's multi-account ` +
        `tables built and ${CHIEF_MESSAGES_TABLE} missing — the MAR-682 signature, one boot before ` +
        `MAR-676's own repair could have reached this store. The repair for it is built in, but the ` +
        `multi-account shape here is not one it recognises, and a repair that guessed would be worse ` +
        `than this message:\n\n${unrecognised}\n\n` +
        `What was found, in full:\n${JSON.stringify(shape, null, 2)}\n\n` +
        `Send that to whoever maintains DASH. Your store is untouched and there is no backup to ` +
        `clean up. Nothing here is lost.`,
    );
  }

  const directory = path.dirname(options.storePath);
  const backup = backupStoreBeside(directory, path.basename(options.storePath), at);
  if (!backup.ok) {
    throw new Error(
      `[dash-store] DASH will not start, and nothing has been changed.\n\n` +
        `This store needs MAR-682's one-time repair, and that repair copies your store beside itself ` +
        `first. The copy could not be made: ${backup.detail}\n\n` +
        `Free some disk space or close whatever is holding the file, then start DASH again.`,
    );
  }

  const reconciliation: StoreReconciliation = {
    reconciled_at: at.toISOString(),
    recorded_version: found.recorded_version,
    final_version: RECONCILED_VERSION,
    applied_versions: [],
    created_tables: [],
    created_indexes: [],
    removed_fleet_secret_rows: 0,
    backup: backup.backup,
  };

  database.exec("BEGIN IMMEDIATE");
  try {
    const definition = options.steps[0];
    if (definition !== undefined && CHIEF_STEP !== undefined) {
      applyMigrationStep(database, definition);
      reconciliation.applied_versions.push(CHIEF_STEP.version);
      reconciliation.created_tables.push(...CHIEF_STEP.tables);
    }

    /*
     * Did the step do what this claims it did? Same caution as
     * `reconcileRenumberedStore` over the same mistake: an off-by-one into
     * `MIGRATIONS` is silent otherwise — `user_version` never moves here, so
     * there is no version to expose it, which makes this assertion the only
     * thing standing between a wrong index and a store that looks repaired
     * and is not.
     */
    const stillMissing = reconciliation.created_tables.filter((table) => !tableExists(database, table));
    if (stillMissing.length > 0) {
      throw new Error(
        `[dash-store] The MAR-682 repair ran the step it was given and ` +
          `${stillMissing.join(", ")} still ${stillMissing.length === 1 ? "does" : "do"} not exist. ` +
          `Nothing has been changed. Your store is as it was and a copy of it is beside it as ` +
          `${backup.backup.copied_to}.`,
      );
    }

    options.record?.(database, reconciliation);

    // `user_version` is left exactly where it was: this store reached 27
    // honestly, and the only thing wrong with it was the one table the loop
    // that thought it already ran skipped.
    database.exec("COMMIT");
  } catch (error: unknown) {
    database.exec("ROLLBACK");
    throw error;
  }

  log(
    `[dash-store] MAR-682 reconciliation: this store recorded migration ${String(RECONCILED_VERSION)} ` +
      `with MAR-643's multi-account tables built and ${CHIEF_MESSAGES_TABLE} missing, which only a ` +
      `build one merge behind MAR-676's own repair produces. Copied the store to ` +
      `${backup.backup.copied_to} (${String(backup.backup.copied)} files), ran the step master ` +
      `shipped as ${reconciliation.applied_versions.map((version) => String(version)).join(", ")} to ` +
      `create ${reconciliation.created_tables.join(", ")}, and left user_version at ` +
      `${String(RECONCILED_VERSION)}.`,
  );

  return reconciliation;
}
