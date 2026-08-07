/**
 * A damaged runner store, from the bytes on disk to the sentence on screen
 * (MAR-506).
 *
 * The fault is real throughout. Nothing here mocks SQLite or asserts against a
 * hand-written error string: each case writes bytes that genuinely are not a
 * usable database, opens them with the same `openRunnerStore` the runner uses,
 * and drives the same HTTP surface DASH talks to. The machine that prompted
 * this issue had a `runner.sqlite` that could not be opened at all and a
 * `runner.log` ending in `database disk image is malformed`; these are those two
 * conditions, made on purpose.
 *
 * ## The one case worth reading twice
 *
 * "a store that opens, passes its pragmas, and is damaged anyway" is the exact
 * shape of the reported fault, and it is the reason `openRunnerStore` runs a
 * `quick_check` rather than trusting that opening a database means the database
 * is readable. Take the probe out and that test fails while everything else here
 * still passes.
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import { describeRunnerStoreDamage } from "../lib/copy/recovery";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
  type RunnerEndpoint,
} from "../runner/endpoint";
import { DASH_LOCAL_PRINCIPAL } from "../runner/execute";
import { createRunnerServer, type StoreRetirement } from "../runner/server";
import { RUNNER_STORE_FILE, openRunnerStore } from "../runner/store";
import {
  classifyStoreError,
  retireDamagedStore,
  type RunnerStoreDamage,
} from "../runner/store-damage";
import { Supervisor } from "../runner/supervisor";
import { expectPlainLanguage } from "./helpers/plain-language";

const TOKEN = "test-channel-token-0123456789";
const directories: string[] = [];
const servers: Array<{ server: Server; endpoint: RunnerEndpoint }> = [];

function freshDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dash-runner-damage-"));
  directories.push(dir);
  return dir;
}

afterEach(async () => {
  for (const { server, endpoint } of servers.splice(0)) {
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    releaseEndpoint(endpoint);
  }
  for (const dir of directories.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------------- *
 * Making a store that is genuinely broken
 * ---------------------------------------------------------------------- */

/** A file where a database should be, holding something else entirely. */
function writeNotADatabase(directory: string): void {
  writeFileSync(
    path.join(directory, RUNNER_STORE_FILE),
    "This is a text file that a sync client left here.\n".repeat(40),
    "utf8",
  );
}

/**
 * A real SQLite database with real rows, whose pages are then overwritten.
 *
 * The header is left alone deliberately. That is what makes this the reported
 * fault rather than a simpler one: the file still identifies as SQLite, opens
 * without complaint, and answers `PRAGMA user_version` from a page that was
 * never touched — so every check the runner did before this issue passed, and
 * the queries did not.
 */
function writeMalformedStore(directory: string): void {
  const file = path.join(directory, RUNNER_STORE_FILE);
  const seed = new DatabaseSync(file);
  // Not WAL: this has to be one file whose pages we can then damage, and a
  // checkpointed WAL would put half the truth somewhere else.
  seed.exec("PRAGMA journal_mode = DELETE");
  seed.exec("CREATE TABLE wreckage (id INTEGER PRIMARY KEY, blob TEXT NOT NULL)");
  const insert = seed.prepare("INSERT INTO wreckage (blob) VALUES (?)");
  /*
   * One transaction, and it is a fix rather than a tidy-up (MAR-537).
   *
   * Each `run()` outside a transaction is its own commit, and on
   * `journal_mode = DELETE` a commit means creating and deleting a rollback
   * journal beside the database. Four hundred of those is four hundred
   * file-create/file-delete pairs, which is cheap on an idle Linux box and is
   * not cheap on Windows with a filter driver watching the directory: the two
   * cases that build this fixture were killed by vitest's 5-second default
   * under full-suite load, twice, while passing in under two seconds alone.
   *
   * Nothing about the file this produces changes. The same four hundred rows
   * land on the same pages; what goes away is four hundred journal round-trips
   * that were never part of what the test is about.
   */
  seed.exec("BEGIN");
  for (let index = 0; index < 400; index += 1) {
    insert.run(randomBytes(200).toString("hex"));
  }
  seed.exec("COMMIT");
  seed.exec("PRAGMA user_version = 2");
  seed.close();

  const bytes = readFileSync(file);
  const pageSize = bytes.readUInt16BE(16) === 1 ? 65_536 : bytes.readUInt16BE(16);
  // Every leaf page after the first, filled with noise. The first page carries
  // the header and the schema, and keeping it intact is the whole point.
  for (let offset = pageSize; offset + pageSize <= bytes.length; offset += pageSize) {
    randomBytes(pageSize).copy(bytes, offset);
  }
  writeFileSync(file, bytes);
}

/* ---------------------------------------------------------------------- *
 * Detection
 * ---------------------------------------------------------------------- */

describe("classifying what SQLite threw", () => {
  it.each([
    ["database disk image is malformed", "malformed"],
    ["SQLITE_CORRUPT: database disk image is malformed", "malformed"],
    ["file is not a database", "not_a_database"],
    ["file is encrypted or is not a database", "not_a_database"],
    ["unable to open database file", "unreadable"],
    ["EPERM: operation not permitted, open 'runner.sqlite'", "unreadable"],
  ])("reads %s as %s", (message, kind) => {
    expect(classifyStoreError(new Error(message))?.kind).toBe(kind);
  });

  it.each([
    "UNIQUE constraint failed: command_nonces.nonce",
    "database is locked",
    "no such table: wreckage",
    "Cannot read properties of undefined",
  ])("says nothing about integrity for %s", (message) => {
    // The important half. A constraint violation or a bug in one route must not
    // take the runner offline and tell the user their records are broken.
    expect(classifyStoreError(new Error(message))).toBeNull();
  });
});

describe("opening a store that cannot be used", () => {
  it("opens a healthy store and says so", () => {
    const opened = openRunnerStore(freshDir());
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      opened.store.close();
    }
  });

  it("names a file that is not a database", () => {
    const dir = freshDir();
    writeNotADatabase(dir);
    const opened = openRunnerStore(dir);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.damage.kind).toBe("not_a_database");
    }
  });

  it("names a store that opens, passes its pragmas, and is damaged anyway", () => {
    /*
     * The reported fault exactly, and the case detection at open exists for.
     * Remove the `quick_check` from `openRunnerStore` and this is the only test
     * in the file that fails — which is the whole argument for the probe: every
     * step the runner already performed succeeded against this file.
     */
    const dir = freshDir();
    writeMalformedStore(dir);

    // First, establish that the naive checks are not enough. If this stops
    // being true the test above it stops meaning anything.
    const naive = new DatabaseSync(path.join(dir, RUNNER_STORE_FILE));
    expect(() => {
      naive.exec("PRAGMA foreign_keys = ON");
      naive.prepare("PRAGMA user_version").get();
    }).not.toThrow();
    naive.close();

    const opened = openRunnerStore(dir);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.damage.kind).toBe("malformed");
    }
    /*
     * Sized from the observed worst case rather than the median (MAR-537's own
     * third preference), and stated rather than left as a number.
     *
     * What is slow here is deliberate: building a real multi-page database,
     * overwriting every page after the first with noise, and then asking SQLite
     * to walk a b-tree that is noise. Solo that is ~2s; under a full-suite run
     * on Windows it was killed at vitest's 5s default. 30s is roughly fifteen
     * times the solo cost, which is the room a loaded machine needs and is still
     * short enough that a genuine hang fails the run rather than hanging it.
     */
  }, 30_000);
});

/* ---------------------------------------------------------------------- *
 * The repair
 * ---------------------------------------------------------------------- */

describe("setting a damaged store aside", () => {
  it("renames rather than deletes, and takes the WAL with it", () => {
    const dir = freshDir();
    writeNotADatabase(dir);
    const before = readFileSync(path.join(dir, RUNNER_STORE_FILE));
    writeFileSync(`${path.join(dir, RUNNER_STORE_FILE)}-wal`, "leftover", "utf8");

    const outcome = retireDamagedStore(dir, RUNNER_STORE_FILE, new Date("2026-08-07T09:15:00.000Z"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) {
      return;
    }
    expect(outcome.retired.moved).toBe(2);

    const listing = readdirSync(dir);
    expect(listing).not.toContain(RUNNER_STORE_FILE);
    expect(listing).toContain(outcome.retired.moved_to);
    // Byte-identical. `runner/store.ts` records that the runner's database is
    // the one place a user's free-text approval reason comes to rest, and a
    // damaged database is frequently still readable by a recovery tool — so a
    // repair that destroyed it would destroy the only copy of a record DASH
    // deliberately keeps nowhere else.
    expect(createHash("sha256").update(readFileSync(path.join(dir, outcome.retired.moved_to))).digest("hex")).toBe(
      createHash("sha256").update(before).digest("hex"),
    );
    expect(listing).toContain(`${outcome.retired.moved_to}-wal`);
  });

  it("lets a fresh store open in its place", () => {
    const dir = freshDir();
    writeMalformedStore(dir);
    expect(openRunnerStore(dir).ok).toBe(false);

    expect(retireDamagedStore(dir, RUNNER_STORE_FILE, new Date()).ok).toBe(true);

    const reopened = openRunnerStore(dir);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) {
      // A fresh store, migrated and usable — not merely a file that opens.
      const tables = reopened.store.database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => String(row["name"]));
      expect(tables).toContain("command_nonces");
      expect(tables).toContain("approval_decisions");
      reopened.store.close();
    }
    // The same budget and the same reason as the case above: this one builds the
    // damaged fixture, fails to open it, retires it, and opens a fresh one.
  }, 30_000);

  it("refuses when there is nothing to set aside", () => {
    // Reporting a repair that did not happen would leave the runner in exactly
    // the state the user was just told had been fixed.
    expect(retireDamagedStore(freshDir(), RUNNER_STORE_FILE, new Date())).toEqual({
      ok: false,
      detail: "There is no runner store file to set aside.",
    });
  });

  /* -------------------------------------------------------------------- *
   * MAR-520: all three move, or none of them do
   * -------------------------------------------------------------------- */

  it("leaves nothing half-moved when one of the files cannot be renamed", () => {
    /*
     * The disaster this function's own header describes, produced by the
     * function written to prevent it. The first draft renamed each file in turn
     * and returned the first failure where it stood, so a main database moved
     * away while its `-wal` stayed behind — and the header says exactly what
     * that costs: "a log referring to pages the new file does not have".
     *
     * A directory standing where `runner.sqlite-shm` should be is the reachable
     * way to make a rename fail on every platform, which matters because the
     * real cause on Windows is `EBUSY` from a file SQLite still has open and
     * that cannot be provoked on Linux. The point of the case is the *state
     * afterwards*, and that is platform-independent.
     */
    const dir = freshDir();
    writeNotADatabase(dir);
    const main = path.join(dir, RUNNER_STORE_FILE);
    const before = readFileSync(main);
    writeFileSync(`${main}-wal`, "leftover", "utf8");
    mkdirSync(`${main}-shm`);

    const outcome = retireDamagedStore(dir, RUNNER_STORE_FILE, new Date());
    expect(outcome.ok).toBe(false);

    // Everything is back. Not "the failure was reported" — the directory is in
    // the state it was in before the repair was attempted, because a caller
    // that reads `ok: false` and retries must not be retrying against a
    // half-moved store.
    const listing = readdirSync(dir);
    expect(listing).toContain(RUNNER_STORE_FILE);
    expect(listing).toContain(`${RUNNER_STORE_FILE}-wal`);
    expect(listing.filter((name) => name.includes(".damaged-"))).toEqual([]);
    expect(readFileSync(main)).toEqual(before);
    expect(readFileSync(`${main}-wal`, "utf8")).toBe("leftover");
  });

  it("never separates a database from its write-ahead log", () => {
    // The property, rather than one arrangement of it: whatever the outcome,
    // the main database and its `-wal` are on the same side of the move. This
    // is what the observed quarantine directory on this machine violated — it
    // held `runner.sqlite-wal` and `runner.sqlite-shm` and no database.
    const dir = freshDir();
    writeNotADatabase(dir);
    const main = path.join(dir, RUNNER_STORE_FILE);
    writeFileSync(`${main}-wal`, "leftover", "utf8");
    writeFileSync(`${main}-shm`, "leftover", "utf8");

    const outcome = retireDamagedStore(dir, RUNNER_STORE_FILE, new Date());
    const listing = readdirSync(dir);
    const setAside = listing.filter((name) => name.includes(".damaged-"));
    const inPlace = listing.filter((name) => !name.includes(".damaged-"));

    if (outcome.ok) {
      expect(setAside).toHaveLength(3);
      expect(inPlace).toEqual([]);
    } else {
      expect(setAside).toEqual([]);
      expect(inPlace).toHaveLength(3);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * What DASH is told
 * ---------------------------------------------------------------------- */

async function serveDamaged(
  damage: RunnerStoreDamage | null,
  retire?: () => StoreRetirement,
): Promise<{ call: typeof fetch; endpoint: RunnerEndpoint }> {
  const dir = freshDir();
  const endpoint = runnerEndpoint(dir, randomBytes(6).toString("hex"));
  await prepareEndpoint(endpoint);
  let current = damage;
  const server = createRunnerServer({
    supervisor: new Supervisor([]),
    // No database at all, which is the runner's real state when its store is
    // damaged. A test that passed one would be testing a guard against a
    // situation that cannot arise.
    token: TOKEN,
    principal: DASH_LOCAL_PRINCIPAL,
    storeDamage: () => current,
    retireStore:
      retire === undefined
        ? undefined
        : () => {
            const outcome = retire();
            if (outcome.ok) {
              current = null;
            }
            return outcome;
          },
    log: () => {
      /* quiet */
    },
  });
  await listenOnEndpoint(server, endpoint);
  servers.push({ server, endpoint });
  return { call: ipcFetch(endpoint.path), endpoint };
}

describe("the runner's answer to DASH", () => {
  const malformed: RunnerStoreDamage = {
    kind: "malformed",
    detail: "database disk image is malformed",
  };

  it("refuses a store-backed route with a named reason rather than a 500", async () => {
    const { call } = await serveDamaged(malformed);
    const response = await call(`${IPC_ORIGIN}/agents`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body["reason"]).toBe("store_damaged");
    expect(body["kind"]).toBe("malformed");
  });

  /*
   * MAR-520. The half of MAR-506's two detections that was wired to nothing.
   *
   * This is the case that actually happened. The damaged store in this
   * machine's installed data directory **passed `quick_check` at open** — the
   * runner's log has no "records cannot be read" line anywhere — and then threw
   * on twelve subsequent requests. Each throw produced the right answer to the
   * caller and left `storeDamage()` saying null, so `/health` kept reporting
   * `ok`, and `POST /store/retire` kept replying "There is nothing to set
   * aside." to somebody looking at a page that had just offered to set their
   * records aside.
   *
   * The repair was unreachable through the only route a person has, on exactly
   * the machine it was written for.
   */
  it("reports damage it discovers mid-request, so the repair becomes reachable", async () => {
    let observed: RunnerStoreDamage | null = null;
    const dir = freshDir();
    const endpoint = runnerEndpoint(dir, randomBytes(6).toString("hex"));
    await prepareEndpoint(endpoint);
    const server = createRunnerServer({
      supervisor: new Supervisor([]),
      token: TOKEN,
      principal: DASH_LOCAL_PRINCIPAL,
      // Null throughout: this is a store that opened cleanly and is about to
      // throw, which is the shape the open-time probe cannot catch.
      storeDamage: () => observed,
      database: () => {
        throw new Error("database disk image is malformed");
      },
      onStoreDamage: (damage) => {
        observed = damage;
      },
      log: () => {
        /* quiet */
      },
    });
    await listenOnEndpoint(server, endpoint);
    servers.push({ server, endpoint });
    const call = ipcFetch(endpoint.path);

    const before = (await (await call(`${IPC_ORIGIN}/health`)).json()) as Record<string, unknown>;
    expect(before["store_damaged"]).toBe(false);

    // A command is the route that reaches the database, and a command is what
    // was being attempted on the machine this happened to.
    const failed = await call(`${IPC_ORIGIN}/agents/scout/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ command: "run_now" }),
    });
    const failedBody = (await failed.json()) as Record<string, unknown>;
    expect(failedBody["reason"]).toBe("store_damaged");

    // The finding survived the request that produced it. Without this the
    // runner forgets, `/health` keeps claiming `ok`, and the button is a
    // dead end.
    expect(observed).not.toBeNull();
    const after = (await (await call(`${IPC_ORIGIN}/health`)).json()) as Record<string, unknown>;
    expect(after["store_damaged"]).toBe(true);
    expect(after["ok"]).toBe(false);
  });

  it("still answers /health, and says the store is damaged there", async () => {
    // Unauthenticated, and it stays inside that route's rule: this is a liveness
    // fact about the process, carrying no path and no classification.
    const { call } = await serveDamaged(malformed);
    const body = (await (await call(`${IPC_ORIGIN}/health`)).json()) as Record<string, unknown>;
    expect(body["store_damaged"]).toBe(true);
    expect(body["ok"]).toBe(false);
    expect(body["kind"]).toBeUndefined();
  });

  it("keeps the retire route above the guard, and authenticated", async () => {
    const { call } = await serveDamaged(malformed, () => ({
      ok: true,
      moved_to: "runner.sqlite.damaged-x",
      moved: 1,
    }));

    // Unauthenticated is refused before anything else. A runner that could be
    // made to abandon its replay records by anyone who reached its socket would
    // have a way to make an executed command executable again.
    expect((await call(`${IPC_ORIGIN}/store/retire`, { method: "POST" })).status).toBe(401);

    const response = await call(`${IPC_ORIGIN}/store/retire`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
    expect((await response.json())["moved_to"]).toBe("runner.sqlite.damaged-x");
  });

  it("refuses to retire a store that is not damaged", async () => {
    const { call } = await serveDamaged(null, () => ({
      ok: true,
      moved_to: "never",
      moved: 1,
    }));
    const response = await call(`${IPC_ORIGIN}/store/retire`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    // 409, not 200. Retiring a healthy store throws away the replay records and
    // approval decisions of a runner that was working.
    expect(response.status).toBe(409);
  });

  it("serves its ordinary routes again once the store has been set aside", async () => {
    const { call } = await serveDamaged(malformed, () => ({
      ok: true,
      moved_to: "runner.sqlite.damaged-x",
      moved: 1,
    }));
    const headers = { authorization: `Bearer ${TOKEN}` };

    expect((await call(`${IPC_ORIGIN}/agents`, { headers })).status).toBe(503);
    await call(`${IPC_ORIGIN}/store/retire`, { method: "POST", headers });
    // Without a restart. `storeDamage` is a function for exactly this reason: a
    // captured boolean would be a repair that repaired nothing until relaunch.
    expect((await call(`${IPC_ORIGIN}/agents`, { headers })).status).toBe(200);
  });
});

/* ---------------------------------------------------------------------- *
 * What the person is told
 * ---------------------------------------------------------------------- */

describe("the recovery", () => {
  it("is plain language on every branch", () => {
    // The guided-path rule, run over the surface this issue adds. `runner.sqlite`
    // never appears in a sentence, and neither does a route, a status or a
    // classification — those are the runner's log's business.
    for (const kind of ["malformed", "not_a_database", "unreadable"] as const) {
      for (const can_retire of [true, false]) {
        const recovery = describeRunnerStoreDamage(kind, { can_retire });
        expectPlainLanguage([recovery.headline, recovery.meaning, recovery.next_action]);
      }
    }
  });

  it("never says what the user was shown before this issue", () => {
    for (const kind of ["malformed", "not_a_database", "unreadable"] as const) {
      for (const can_retire of [true, false]) {
        const recovery = describeRunnerStoreDamage(kind, { can_retire });
        const whole = `${recovery.headline} ${recovery.meaning} ${recovery.next_action}`;
        expect(whole).not.toMatch(/\b500\b/);
        expect(whole).not.toMatch(/answered/i);
        // Nothing about a disk image, a status code or SQLite reaches a person.
        expect(whole).not.toMatch(/sqlite|disk image|malformed/i);
      }
    }
  });

  it("says the user's own records are safe, in every case", () => {
    // The sentence that separates this from `describeStoreDamage`. Somebody told
    // that records are damaged will assume the worst thing they can think of,
    // which is their own history.
    for (const kind of ["malformed", "not_a_database", "unreadable"] as const) {
      expect(describeRunnerStoreDamage(kind).meaning).toContain("are intact");
      expect(describeRunnerStoreDamage(kind).meaning).toContain("No agent is running");
    }
  });

  it("offers the repair only where there is one to offer", () => {
    expect(describeRunnerStoreDamage("malformed", { can_retire: true }).next_action).toContain(
      "Set the damaged records aside",
    );
    expect(describeRunnerStoreDamage("malformed", { can_retire: true }).actor).toBe("user");

    // With no control on screen, a next action naming one would send them
    // looking for a button that is not there.
    expect(describeRunnerStoreDamage("malformed", { can_retire: false }).next_action).toContain(
      "Report this",
    );
    expect(describeRunnerStoreDamage("malformed", { can_retire: false }).actor).toBe("dash");
  });

  it("never offers to throw away a file it merely could not open", () => {
    // `unreadable` is a permission or a lock, not damage. Setting aside a file
    // DASH could not read is throwing away a file DASH could not read.
    const recovery = describeRunnerStoreDamage("unreadable", { can_retire: true });
    expect(recovery.next_action).not.toContain("aside");
    expect(recovery.actor).toBe("user");
  });

  it("keeps three different recoveries rather than one", () => {
    const headlines = (["malformed", "not_a_database", "unreadable"] as const).map(
      (kind) => describeRunnerStoreDamage(kind).headline,
    );
    expect(new Set(headlines).size).toBe(3);
  });
});
