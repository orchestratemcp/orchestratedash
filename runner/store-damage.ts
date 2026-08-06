/**
 * When the runner's own database cannot be used (MAR-506).
 *
 * Found by running `pnpm verify:shell` on a machine whose `runner.sqlite` had
 * been damaged: eight smoke checks failed, `runner.log` ended with
 * `[runner] request failed: database disk image is malformed`, and what a person
 * saw on screen was **"The runner answered 500."**
 *
 * That sentence names the transport. Everything a user needs is elsewhere: DASH
 * reached the runner, the runner is running, and the file it keeps its own
 * records in cannot be read. This module is where the difference is established;
 * `lib/copy/recovery.ts` is where it is said.
 *
 * ## Two detections, because one is not enough
 *
 * The issue asks whether the runner should "detect `SQLITE_CORRUPT` at open and
 * refuse to start with a named reason, rather than 500-ing per request". The
 * honest answer is **both**, and the reason is what the damaged machine actually
 * did: the store *opened*. `PRAGMA journal_mode`, `synchronous`, `foreign_keys`
 * and the migration check all succeeded, because a header page and a
 * `user_version` are read from pages that were intact. Only the queries against
 * damaged leaves threw.
 *
 * So open-time detection needs a **probe** — `PRAGMA quick_check`, which walks
 * the pages rather than the header — and even a probe cannot be complete: a
 * store can pass `quick_check` and throw an hour later when a write reaches the
 * page that is going. `classifyStoreError` is the second half, and it turns a
 * throw on any request into the same named state rather than a 500.
 *
 * ## `quick_check`, not `integrity_check`
 *
 * `integrity_check` additionally verifies every index against its table, which
 * is the expensive part and is not what this is looking for. `quick_check`
 * reports the same "database disk image is malformed" for a damaged page at a
 * fraction of the cost, and this runs on every runner start — a startup probe
 * that made launching DASH visibly slower would be a probe somebody eventually
 * removes.
 */

import { existsSync, renameSync, statSync } from "node:fs";
import path from "node:path";

import { STORE_DAMAGED_REASON, type RunnerStoreDamageKind } from "../lib/copy/recovery";

export type { RunnerStoreDamageKind };
/** Re-exported so the runner's own modules read it from one import. */
export { STORE_DAMAGED_REASON };

export interface RunnerStoreDamage {
  kind: RunnerStoreDamageKind;
  /**
   * SQLite's own status sentence, for the runner's log and for a developer
   * disclosure. **Never the path, never a row, never a fragment of the damaged
   * bytes** — `lib/store.ts` explains at length why a value we by definition
   * could not inspect must not be quoted out of a damaged store, and the same
   * rule holds one database over. What is kept here is a message from SQLite's
   * fixed set, which describes the failure and not the contents.
   */
  detail: string;
}

/**
 * What a thrown SQLite error means, or null when it means nothing about the
 * store's integrity.
 *
 * Null is the important half. A constraint violation, a busy database, a
 * programming error in a statement — all of those throw too, and treating them
 * as damage would take a runner offline over a bug in one route and tell the
 * user their records are broken when they are not.
 */
export function classifyStoreError(error: unknown): RunnerStoreDamage | null {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();

  // SQLITE_NOTADB. Checked first: its message also contains "database", and the
  // two cases lead somewhere genuinely different — a file that was never a
  // database is something else having been put there, not a disk going bad.
  if (
    lowered.includes("file is not a database") ||
    lowered.includes("file is encrypted or is not a database")
  ) {
    return { kind: "not_a_database", detail: message };
  }

  // SQLITE_CORRUPT, in the spellings SQLite actually emits.
  if (
    lowered.includes("database disk image is malformed") ||
    lowered.includes("database corruption") ||
    lowered.includes("malformed database schema") ||
    lowered.includes("sqlite_corrupt")
  ) {
    return { kind: "malformed", detail: message };
  }

  // SQLITE_CANTOPEN / SQLITE_PERM / SQLITE_READONLY, and the OS errors underneath
  // them. Not damage: the bytes may be perfectly good and simply out of reach,
  // which is why `describeRunnerStoreDamage` never offers to throw this one away.
  if (
    lowered.includes("unable to open database") ||
    lowered.includes("sqlite_cantopen") ||
    lowered.includes("attempt to write a readonly database") ||
    lowered.includes("access is denied") ||
    lowered.includes("eacces") ||
    lowered.includes("eperm") ||
    lowered.includes("ebusy")
  ) {
    return { kind: "unreadable", detail: message };
  }

  return null;
}

export interface RetiredStore {
  /** The name the damaged file now has, for the log and for a receipt. */
  moved_to: string;
  /** How many files were moved: the database, and its `-wal`/`-shm` siblings. */
  moved: number;
}

export type RetireOutcome =
  | { ok: true; retired: RetiredStore }
  | { ok: false; detail: string };

/**
 * Move a damaged store aside so a fresh one can be created beside it.
 *
 * **It renames and never deletes**, and that is not caution for its own sake.
 * The file holds approval decisions — `runner/store.ts`'s header records that
 * the runner is the one place a user's free-text reason for approving something
 * comes to rest — and a damaged database is frequently still readable by a
 * recovery tool. Deleting it would destroy the only copy of a record DASH
 * deliberately keeps nowhere else, in order to fix a fault the user did not
 * cause.
 *
 * The `-wal` and `-shm` siblings move with it. Leaving a WAL beside a fresh
 * database is how a repair turns into a second, stranger corruption: SQLite
 * would find a log referring to pages the new file does not have.
 *
 * The suffix carries the moment rather than a counter, so two attempts on the
 * same day cannot collide and the order they happened in is readable from the
 * directory listing.
 */
export function retireDamagedStore(
  directory: string,
  storeFileName: string,
  at: Date,
): RetireOutcome {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const suffix = `.damaged-${stamp}`;
  const main = path.join(directory, storeFileName);

  if (!existsSync(main)) {
    // Nothing to set aside is not a success: the caller asked for a repair, and
    // reporting one that did not happen would leave the runner in exactly the
    // state the user was told had been fixed.
    return { ok: false, detail: "There is no runner store file to set aside." };
  }

  let moved = 0;
  try {
    for (const sibling of ["", "-wal", "-shm"]) {
      const from = `${main}${sibling}`;
      if (!existsSync(from)) {
        continue;
      }
      // A directory where a database should be is not something to rename over.
      if (!statSync(from).isFile()) {
        return { ok: false, detail: "The runner's store is not a file." };
      }
      // `runner.sqlite.damaged-…` and `runner.sqlite.damaged-….-wal`, rather
      // than suffixing each name where it sits. The point is that a recovery
      // tool opening the set-aside database finds its log where SQLite looks
      // for it: `runner.sqlite-wal.damaged-…` would be an orphan.
      renameSync(from, `${main}${suffix}${sibling}`);
      moved += 1;
    }
  } catch (error: unknown) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, retired: { moved_to: `${storeFileName}${suffix}`, moved } };
}
