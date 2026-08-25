/**
 * What DASH remembers about asking a server to keep running (MAR-795,
 * ADR 0031).
 *
 * `tests/deploy-record.test.ts`'s subject one act over, and the same rule
 * decides it: **a record of DASH's own act is a fact DASH observed; a claim
 * about a remote machine is not.** So the row below says *this person turned
 * residency on* and *DASH last told this server N schedules on this date*, and
 * nothing anywhere in it says whether the boot entry is enabled right now. That
 * is the server's own answer, read live on a press, and a column mirroring it
 * would be a cache that reads *On* over a boot that does nothing — ADR 0030
 * decision 2's failure, one machine over.
 *
 * The second half of this file is the consequence that makes the row durable
 * rather than a nicety: while it exists, that server's agents are kept out of
 * the local runner's schedule push. A DASH restart with the flag in memory would
 * quietly resume firing one instruction on two machines.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(path.join(tmpdir(), "dash-host-residency-"));
process.env.DASH_DATA_DIR = dataDir;

const {
  forgetHostResidency,
  listHostResidency,
  readHostResidency,
  readResidentHosts,
  recordAgentBroughtHome,
  recordAgentDeploy,
  recordHostResidency,
  recordHostSchedulesTold,
  resetStore,
  saveHost,
} = await import("../lib/store");
const { closeDb, db } = await import("../lib/db");
const { splitSchedules } = await import("../lib/schedule/delegation");
const { hostsView } = await import("../lib/views/build");

const DEPLOY = {
  agent: "ai-agent-news",
  host_id: "host-1",
  manifest_sha256: "a".repeat(64),
  files_sha256: "b".repeat(64),
};

beforeEach(() => {
  resetStore();
  db().prepare("DELETE FROM host_residency").run();
  db().prepare("DELETE FROM agent_deploys").run();
  db().prepare("DELETE FROM hosts").run();
});

afterAll(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("the residency record", () => {
  it("holds what DASH asked for and never what the server is doing", () => {
    const columns = (
      db().prepare("PRAGMA table_info(host_residency)").all() as { name: string }[]
    ).map((column) => column.name);
    /*
     * Asserted by name, `tests/deploy-record.test.ts`'s way and for its reason:
     * this fails the day somebody adds `enabled`, `state` or `starts_at_boot`,
     * which is the exact edit ADR 0031 decision 3 exists to stop and the one
     * that would be easiest to make while being helpful.
     */
    expect(columns.sort()).toEqual(["asked_at", "host_id", "told_at", "told_count"]);
  });

  it("records the press once and does not move its date on a second one", () => {
    recordHostResidency("host-1", "2026-08-25T20:00:00.000Z");
    recordHostResidency("host-1", "2026-08-26T09:00:00.000Z");
    // The column answers *when did this person decide this*. A switch pressed
    // again after a failed enable must not rewrite the date of a decision that
    // was taken once.
    expect(readHostResidency("host-1")?.asked_at).toBe("2026-08-25T20:00:00.000Z");
    expect(listHostResidency()).toHaveLength(1);
  });

  it("has no row at all until somebody presses, and none after they press again", () => {
    expect(readHostResidency("host-1")).toBeNull();
    recordHostResidency("host-1");
    expect(readHostResidency("host-1")).not.toBeNull();
    forgetHostResidency("host-1");
    // Deleted rather than flagged: there is no state meaning *was on once*, so
    // nothing anywhere has to branch on one.
    expect(readHostResidency("host-1")).toBeNull();
  });

  it("writes nothing about a push to a server residency is off for", () => {
    // The `UPDATE` is the guard rather than a caller's check. A push to a server
    // whose switch is off is a push that should not have happened, and a row
    // appearing from one would start excluding an agent nobody asked to move.
    recordHostSchedulesTold("host-1", 2);
    expect(readHostResidency("host-1")).toBeNull();
  });

  it("keeps what DASH last told the server across a second press", () => {
    recordHostResidency("host-1", "2026-08-25T20:00:00.000Z");
    recordHostSchedulesTold("host-1", 2, "2026-08-25T20:05:00.000Z");
    recordHostResidency("host-1", "2026-08-26T09:00:00.000Z");
    const row = readHostResidency("host-1");
    expect(row?.told_at).toBe("2026-08-25T20:05:00.000Z");
    expect(row?.told_count).toBe(2);
  });

  it("reaches the server card as days, with null meaning never told", () => {
    saveHost({
      host_id: "host-1",
      label: "My server",
      address: "example.com",
      port: 22,
      username: "dash",
      key_name: "host-1",
      host_fingerprint: null,
      added_at: "2026-08-20T09:00:00.000Z",
    });

    const before = hostsView().servers.find((server) => server.host_id === "host-1");
    // Off, which is every server until somebody presses the switch — and null
    // `asked_on` is the whole of that fact.
    expect(before?.residency).toEqual({ asked_on: null, told_on: null, told_count: null });

    recordHostResidency("host-1", "2026-08-25T20:00:00.000Z");
    const asked = hostsView().servers.find((server) => server.host_id === "host-1");
    expect(asked?.residency.asked_on).not.toBeNull();
    // Never told is a real state and not a blank: a server holding nothing runs
    // nothing, which is a different sentence from one holding last month's set.
    expect(asked?.residency.told_on).toBeNull();
    expect(asked?.residency.told_count).toBeNull();

    recordHostSchedulesTold("host-1", 2, "2026-08-25T20:05:00.000Z");
    const told = hostsView().servers.find((server) => server.host_id === "host-1");
    expect(told?.residency.told_count).toBe(2);
    // A day rather than a stamp: every sentence built from it is a report with
    // an age on it, and a surface formatting a raw stamp would be a second place
    // that decides how a date reads.
    expect(told?.residency.told_on).toMatch(/2026/);
  });
});

describe("what a resident server takes out of the local push", () => {
  it("names the agents whose copies are on it, and drops the ones brought home", () => {
    recordHostResidency("host-1");
    recordAgentDeploy(DEPLOY);
    expect(readResidentHosts()).toEqual([{ host_id: "host-1", agents: ["ai-agent-news"] }]);

    recordAgentBroughtHome("ai-agent-news", "host-1");
    // Brought home means the copy is gone from that machine, so its schedule
    // belongs here again — and because the whole set is re-read on every push,
    // that reverts on the next tick with nothing to turn off.
    expect(readResidentHosts()).toEqual([{ host_id: "host-1", agents: [] }]);
  });

  it("takes nothing out of the local push while the switch is off", () => {
    recordAgentDeploy(DEPLOY);
    expect(readResidentHosts()).toEqual([]);
    const schedules = [
      {
        agent: "ai-agent-news",
        enabled: true,
        kind: "daily" as const,
        at_local: "08:00",
        created_at: "2026-08-25T06:00:00.000Z",
        allowance_calls: 0,
      },
    ];
    // This is the property that makes ADR 0031 decision 4 safe to ship: a
    // deployed agent's schedule goes on firing exactly where it fires today
    // until somebody presses the switch for that server.
    expect(splitSchedules(schedules, readResidentHosts()).local).toEqual(schedules);
  });

  it("hands it over the moment the switch goes on, and back when the server is forgotten", () => {
    recordAgentDeploy(DEPLOY);
    const schedules = [
      {
        agent: "ai-agent-news",
        enabled: true,
        kind: "daily" as const,
        at_local: "08:00",
        created_at: "2026-08-25T06:00:00.000Z",
        allowance_calls: 0,
      },
    ];

    recordHostResidency("host-1");
    const delegated = splitSchedules(schedules, readResidentHosts());
    expect(delegated.local).toEqual([]);
    expect(delegated.byHost.get("host-1")).toEqual(schedules);

    /*
     * And a forgotten server hands them straight back. The boot entry on that
     * machine is not removed — DASH is about to delete the key that reaches it —
     * but a row that survived would leave a person's schedules firing nowhere,
     * on a machine DASH can no longer name.
     */
    forgetHostResidency("host-1");
    expect(splitSchedules(schedules, readResidentHosts()).local).toEqual(schedules);
  });
});
