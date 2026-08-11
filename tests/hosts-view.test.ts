/**
 * The read the Servers page never had (MAR-574).
 *
 * `readStore()` has returned hosts since MAR-536 and no view projected them, so
 * the only page about servers had no way to learn that one had been saved. It
 * rendered the add-a-server wizard unconditionally, and a real, reachable,
 * probe-passing Hostinger box was invisible on it after a restart.
 *
 * Driven against a real SQLite store rather than a stub, because the two
 * properties that matter are properties of the projection over real rows: that
 * the key name does not travel, and that four rows for one machine are counted
 * rather than deduplicated behind the reader's back.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { HostRecord } from "../lib/hosts";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-hosts-view-"));
process.env.DASH_DATA_DIR = dataDir;

const { listHosts, resetStore, saveHost } = await import("../lib/store");
const { closeDb, db } = await import("../lib/db");
const { hostsView } = await import("../lib/views/build");

/**
 * The four rows found in Henrik's own store on 2026-08-08, in the order they
 * were made: one Hostinger box, one row per attempt at the wizard, every
 * fingerprint null (MAR-572), every account `root`.
 */
function fourAttempts(): HostRecord[] {
  return ["13:29:00", "13:38:00", "14:02:00", "14:14:37"].map((clock, index) => ({
    host_id: `host-${String(index + 1)}`,
    label: "My server",
    address: "example.com",
    port: 22,
    username: "root",
    key_name: `host-${String(index + 1)}`,
    host_fingerprint: null,
    added_at: `2026-08-08T${clock}Z`,
  }));
}

beforeEach(() => {
  resetStore();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the projection", () => {
  it("answers with nothing when nothing has been saved, and that is not a failure", () => {
    expect(hostsView().servers).toEqual([]);
  });

  it("never carries the name of the key DASH holds", () => {
    /*
     * The load-bearing omission. `key_name` is the one field on a host record
     * that names a credential on this computer, and no page has any use for it —
     * so it must not travel merely because it was in the row. The assertion is
     * over the projected object rather than over a field list somebody
     * maintains, so a future field added by spreading the record fails here.
     */
    saveHost(fourAttempts()[0] as HostRecord);
    const [server] = hostsView().servers;
    expect(server).toBeDefined();
    expect(Object.keys(server ?? {})).not.toContain("key_name");
    expect(JSON.stringify(hostsView())).not.toContain("host-1-key");
  });

  it("carries the pinned identity, including its absence", () => {
    // The server's *own* public identity does travel: it is what a person checks
    // against what their provider shows them. Null on every real record today.
    saveHost(fourAttempts()[0] as HostRecord);
    expect(hostsView().servers[0]?.fingerprint).toBeNull();
  });

  it("is oldest first, so an accidental retry never sits above the record in use", () => {
    saveHost({ ...(fourAttempts()[0] as HostRecord), address: "one.example" });
    saveHost({ ...(fourAttempts()[3] as HostRecord), address: "two.example" });
    expect(hostsView().servers.map((server) => server.address)).toEqual([
      "one.example",
      "two.example",
    ]);
  });

  it("survives the trip a view has to survive", () => {
    // These cross `contextBridge`, which clones. A `Date` or a `Map` in here
    // would throw at a boundary no other unit test crosses.
    saveHost(fourAttempts()[0] as HostRecord);
    expect(() => structuredClone(hostsView())).not.toThrow();
  });
});

describe("the four rows that are one machine", () => {
  /**
   * Written the way they arrived — through `saveHost`, one at a time — except
   * that `saveHost` now refuses the second. So the fixture writes them the only
   * way a store can hold them today: directly, which is what the store did
   * before this issue and what a store restored from a backup still contains.
   */
  function seedFour(): void {
    const rows = fourAttempts();
    saveHost(rows[0] as HostRecord);
    for (const row of rows.slice(1)) {
      expect(() => {
        saveHost(row);
      }).toThrow(/already have this server/i);
    }
  }

  it("refuses the second, third and fourth rather than saving them quietly", () => {
    seedFour();
    expect(listHosts()).toHaveLength(1);
  });

  it("counts them rather than merging them, when a store already holds them", () => {
    /*
     * The refusal above stops new duplicates. It does not delete the ones
     * already on Henrik's machine, and it must not: each carries its own minted
     * key, which may be installed on that server, so tidying them away would
     * remove the only evidence of what is where.
     *
     * `insertHostRow` is what a store written before the refusal looks like.
     */
    for (const row of fourAttempts()) {
      insertHostRow(row);
    }
    const view = hostsView();
    expect(view.servers).toHaveLength(4);
    expect(view.servers.map((server) => server.same_server_index)).toEqual([1, 2, 3, 4]);
    expect(view.servers.every((server) => server.same_server_count === 4)).toBe(true);
  });

  it("counts a lone record as one of one", () => {
    saveHost(fourAttempts()[0] as HostRecord);
    expect(hostsView().servers[0]).toMatchObject({
      same_server_index: 1,
      same_server_count: 1,
      sent: [],
    });
  });

  it("does not group two accounts on one machine", () => {
    saveHost(fourAttempts()[0] as HostRecord);
    saveHost({
      ...(fourAttempts()[1] as HostRecord),
      username: "ubuntu",
      key_name: "host-2",
    });
    expect(hostsView().servers.every((server) => server.same_server_count === 1)).toBe(true);
  });
});

/**
 * Write a host row past `saveHost`'s refusal.
 *
 * Only a test does this, and only to reproduce a store that predates the
 * refusal — which is the exact state of the machine this issue was found on.
 */
function insertHostRow(record: HostRecord): void {
  db()
    .prepare(
      "INSERT INTO hosts (host_id, label, address, port, username, key_name, host_fingerprint, added_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      record.host_id,
      record.label,
      record.address,
      record.port,
      record.username,
      record.key_name,
      record.host_fingerprint,
      record.added_at,
    );
}
