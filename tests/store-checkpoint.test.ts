/**
 * What `closeDb` leaves on disk (MAR-700).
 *
 * The store is opened in WAL mode, so between a write and a checkpoint
 * `dash.sqlite` is a *two-file* structure: the database plus a `-wal` holding
 * committed transactions that are not in it yet. That is a fine state to run in
 * and a bad state to be abandoned in — every copy, every backup and every abrupt
 * termination then lands on something that has to be recovered rather than read.
 *
 * On 2026-08-19 a store abandoned that way was left with a header claiming 474
 * pages over a file holding 356, and SQLite refused every statement against it:
 * three runs and forty-seven rows unreachable, including MAR-674's attended run
 * `3d71bed5`. `scripts/salvage-store.mjs` exists because of that file.
 *
 * So these tests are about the postcondition rather than the call: after
 * `closeDb`, the directory holds one self-contained file and no log beside it.
 * `close()` did checkpoint before this issue — when it happened to be the last
 * connection, and silently when it was not. What MAR-700 added is asking by
 * name, so the intent is visible and a failure is a failure.
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-checkpoint-"));
process.env.DASH_DATA_DIR = dataDir;

const { closeDb, databasePath, db } = await import("../lib/db");

const walPath = `${databasePath}-wal`;
const shmPath = `${databasePath}-shm`;

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("closeDb", () => {
  it("leaves one self-contained file, with no write-ahead log beside it", () => {
    const database = db();
    // A committed write with nothing after it: the shape a quit interrupts.
    database.exec("CREATE TABLE IF NOT EXISTS checkpoint_probe (n INTEGER)");
    database.exec("INSERT INTO checkpoint_probe (n) VALUES (1)");

    // The premise. If WAL were off, the rest of this test would prove nothing —
    // and `lib/db.ts` sets it precisely so a crash leaves a replayable log.
    expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(existsSync(walPath)).toBe(true);

    closeDb();

    // The postcondition the store was abandoned without, twice.
    expect(existsSync(databasePath)).toBe(true);
    expect(existsSync(walPath)).toBe(false);
    expect(existsSync(shmPath)).toBe(false);
  });

  it("keeps the committed row, which is what makes the checkpoint a fold and not a discard", () => {
    // Emptying the log is only correct if its contents reached the database
    // first. TRUNCATE does that by definition; asserting it is what stops a
    // future "just delete the -wal" from passing the test above.
    const row = db().prepare("SELECT n FROM checkpoint_probe").get();
    expect(row).toEqual({ n: 1 });
  });

  it("is idempotent, because the exit guards can reach it twice", () => {
    // `installStoreExitGuards` registers both a signal handler and `exit`, and a
    // Ctrl-C runs the first and then the second. The second must be a no-op
    // rather than a double close on a handle that is already gone.
    closeDb();
    expect(() => {
      closeDb();
    }).not.toThrow();
    expect(existsSync(walPath)).toBe(false);
  });

  it("reopens cleanly afterwards, so a close is never a one-way door", () => {
    const row = db().prepare("SELECT count(*) AS n FROM checkpoint_probe").get();
    expect(row).toEqual({ n: 1 });
    expect(existsSync(walPath)).toBe(true);
  });
});
