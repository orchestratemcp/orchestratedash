/**
 * The schedule rows, and what happens to them (MAR-742 item 8, ADR 0029).
 *
 * `tests/schedule-plan.test.ts` covers *when* a window is due. This covers the
 * store side of the same feature: what may be written, what a row that should
 * not exist reads back as, and the two lifetimes ADR 0029 keeps apart —
 * switching a schedule off keeps its history, and removing the agent takes both.
 *
 * Against a real SQLite store in a temporary directory, `tests/store-sqlite.
 * test.ts`' arrangement, because every claim here is about a migration, a
 * constraint or a delete and none of them can be made against a fake.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, "examples", "agent.manifest.example.json"), "utf8"),
) as Record<string, unknown>;

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(): Promise<{
  dataDir: string;
  db: typeof import("../lib/db");
  store: typeof import("../lib/store");
  schedules: typeof import("../lib/schedule/store");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-schedule-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const store = await import("../lib/store");
  const schedules = await import("../lib/schedule/store");
  opened.push({ dataDir, closeDb: db.closeDb });
  return { dataDir, db, store, schedules };
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

describe("writing a schedule", () => {
  it("stores a daily time and reads it back enabled", async () => {
    const { schedules } = await freshStore();
    expect(schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z")).toEqual({
      ok: true,
    });

    const read = schedules.readAgentSchedule("scout");
    expect(read).toEqual({
      agent: "scout",
      enabled: true,
      kind: "daily",
      at_local: "08:00",
      created_at: "2026-08-24T12:00:00.000Z",
      // MAR-784. A schedule saved without naming a ceiling is a schedule that
      // may not spend, which is ADR 0029 decision 6 kept as the default.
      allowance_calls: 0,
    });
  });

  /**
   * The refusal is the gate, and it lives beside the write.
   *
   * A time this build would not accept must not reach the column, because
   * `toSchedule` reads such a row back as "no schedule" — so storing one would
   * produce a person who was told their schedule saved looking at a panel that
   * says they have none.
   */
  it("refuses a time it would not be able to read back", async () => {
    const { schedules } = await freshStore();
    for (const bad of ["", "8:00", "24:00", "tea time", "08:00:00"]) {
      const result = schedules.writeAgentSchedule("scout", bad, "2026-08-24T12:00:00.000Z");
      expect(result.ok, bad).toBe(false);
      expect(result.refusal, bad).toContain("HH:MM");
    }
    expect(schedules.readAgentSchedule("scout")).toBeNull();
  });

  it("has no row, and therefore no schedule, for an agent nobody has scheduled", async () => {
    const { schedules } = await freshStore();
    expect(schedules.readAgentSchedule("scout")).toBeNull();
    expect(schedules.readAgentSchedules()).toEqual([]);
  });

  /**
   * `created_at` is the floor `decideSchedule` measures missed windows from, so
   * rewriting it on every edit would erase the record of a window that was
   * missed before somebody adjusted the minute.
   */
  it("keeps the original created_at when the time is changed", async () => {
    const { schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z");
    schedules.writeAgentSchedule("scout", "09:30", "2026-08-25T12:00:00.000Z");

    const read = schedules.readAgentSchedule("scout");
    expect(read?.at_local).toBe("09:30");
    expect(read?.created_at).toBe("2026-08-24T12:00:00.000Z");
  });

  /**
   * One row per agent. The primary key is the decision, and this is what it
   * means in practice: setting a second time replaces the first rather than
   * leaving two cadences on one agent with nothing on screen to show the second.
   */
  it("keeps exactly one schedule per agent", async () => {
    const { schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z");
    schedules.writeAgentSchedule("scout", "17:30", "2026-08-24T13:00:00.000Z");
    expect(schedules.readAgentSchedules()).toHaveLength(1);
  });
});

describe("turning a schedule off", () => {
  it("deletes the row rather than disabling it", async () => {
    const { schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z");
    schedules.clearAgentSchedule("scout");

    expect(schedules.readAgentSchedule("scout")).toBeNull();
    // And nothing is pushed to the runner for it, which is the point of the
    // whole-set push: a withdrawn instruction disappears from the set rather
    // than arriving as a disabled member the runner has to interpret.
    expect(schedules.readAgentSchedules()).toEqual([]);
  });

  /**
   * ADR 0029: the history outlives the instruction on purpose. Somebody who
   * switched a cadence off because it kept failing is exactly the person who
   * still wants to read that it kept failing.
   */
  it("keeps what the schedule already did", async () => {
    const { schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z");
    schedules.recordScheduleRuns([
      {
        agent: "scout",
        due_at: "2026-08-25T06:00:00.000Z",
        settled_at: "2026-08-25T06:00:12.000Z",
        outcome: "ran",
        detail: "Started on time.",
        allowance_calls: 0,
      },
    ]);
    schedules.clearAgentSchedule("scout");

    expect(schedules.readScheduleRuns("scout")).toHaveLength(1);
  });
});

describe("recording what the runner settled", () => {
  it("takes a batch and reports how many were new", async () => {
    const { schedules } = await freshStore();
    const written = schedules.recordScheduleRuns([
      {
        agent: "scout",
        due_at: "2026-08-25T06:00:00.000Z",
        settled_at: "2026-08-25T06:00:12.000Z",
        outcome: "ran",
        detail: "Started on time.",
        allowance_calls: 0,
      },
      {
        agent: "scout",
        due_at: "2026-08-26T06:00:00.000Z",
        settled_at: "2026-08-26T12:20:00.000Z",
        outcome: "missed",
        detail: "This computer was asleep.",
        allowance_calls: 0,
      },
    ]);
    expect(written).toBe(2);
    expect(schedules.readScheduleRuns("scout").map((row) => row.outcome)).toEqual([
      "missed",
      "ran",
    ]);
  });

  /**
   * A duplicate would show a person the same run twice and make a schedule look
   * like it double-fired — which is the first thing anybody would suspect of a
   * scheduler, and therefore the last thing DASH should be able to imply by
   * accident.
   */
  it("ignores a window it already has", async () => {
    const { schedules } = await freshStore();
    const row = {
      agent: "scout",
      due_at: "2026-08-25T06:00:00.000Z",
      settled_at: "2026-08-25T06:00:12.000Z",
      outcome: "ran" as const,
      detail: "Started on time.",
      allowance_calls: 0,
    };
    expect(schedules.recordScheduleRuns([row])).toBe(1);
    expect(schedules.recordScheduleRuns([row])).toBe(0);
    expect(schedules.readScheduleRuns("scout")).toHaveLength(1);
  });

  it("keeps a bounded history, newest first", async () => {
    const { schedules } = await freshStore();
    const rows = Array.from({ length: schedules.MAX_SCHEDULE_RUNS_KEPT + 10 }, (_, index) => ({
      agent: "scout",
      // Day 1 upward, so the newest is the highest number and the pruned ones
      // are the oldest.
      due_at: `2026-09-${String(index + 1).padStart(2, "0")}T06:00:00.000Z`,
      settled_at: `2026-09-${String(index + 1).padStart(2, "0")}T06:00:05.000Z`,
      outcome: "ran" as const,
      detail: "Started on time.",
      allowance_calls: 0,
    }));
    schedules.recordScheduleRuns(rows);

    const kept = schedules.readScheduleRuns("scout");
    expect(kept).toHaveLength(schedules.MAX_SCHEDULE_RUNS_KEPT);
    expect(kept[0]?.due_at).toBe(rows[rows.length - 1]?.due_at);
  });

  /**
   * The cursor DASH pushes so a freshly started runner knows where to resume
   * from. Per agent, and the newest — ADR 0029 decision 2.
   */
  it("reports the newest window per agent", async () => {
    const { schedules } = await freshStore();
    schedules.recordScheduleRuns([
      {
        agent: "scout",
        due_at: "2026-08-25T06:00:00.000Z",
        settled_at: "2026-08-25T06:00:12.000Z",
        outcome: "ran",
        detail: "",
        allowance_calls: 0,
      },
      {
        agent: "scout",
        due_at: "2026-08-26T06:00:00.000Z",
        settled_at: "2026-08-26T06:00:12.000Z",
        outcome: "ran",
        detail: "",
        allowance_calls: 0,
      },
      {
        agent: "digest",
        due_at: "2026-08-20T06:00:00.000Z",
        settled_at: "2026-08-20T06:00:12.000Z",
        outcome: "refused",
        detail: "",
        allowance_calls: 0,
      },
    ]);
    expect(schedules.newestScheduleWindows()).toEqual({
      scout: "2026-08-26T06:00:00.000Z",
      digest: "2026-08-20T06:00:00.000Z",
    });
  });

  /**
   * A value this build did not write reads as the weaker claim.
   *
   * `refused` rather than `ran`, because "DASH tried and something said no" is
   * the honest reading of a row DASH cannot interpret — claiming a run happened
   * on the strength of an unrecognised string is the one direction this must not
   * fail in.
   */
  it("reads an unrecognised outcome as refused rather than as a run", async () => {
    const { db, schedules } = await freshStore();
    db.db()
      .prepare(
        "INSERT INTO agent_schedule_runs (agent, due_at, settled_at, outcome, detail) VALUES (?, ?, ?, ?, ?)",
      )
      .run("scout", "2026-08-25T06:00:00.000Z", "2026-08-25T06:00:12.000Z", "who knows", "");
    expect(schedules.readScheduleRuns("scout")[0]?.outcome).toBe("refused");
  });

  /**
   * Same discipline one table along: a row on disk whose `at_local` no longer
   * parses is not turned into a time an agent gets started at.
   */
  it("reads a corrupted schedule row as no schedule", async () => {
    const { db, schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z");
    db.db().prepare("UPDATE agent_schedules SET at_local = ? WHERE agent = ?").run("25:99", "scout");

    expect(schedules.readAgentSchedule("scout")).toBeNull();
    expect(schedules.readAgentSchedules()).toEqual([]);
  });
});

describe("removing the agent", () => {
  /**
   * ADR 0029, and the reason it is stronger than the standing-answers case it
   * sits beside: a schedule that outlived its agent is not a stale row, it is a
   * standing instruction DASH would go on pushing to the runner every five
   * seconds — and an agent later added under the same name would inherit a
   * cadence nobody set for it.
   */
  it("takes the schedule and its history with it", async () => {
    const { store, schedules } = await freshStore();
    // A real agent, imported the way one arrives, so this exercises the cascade
    // on a row that exists rather than the unconditional deletes it would run
    // for a name nobody has heard of.
    const imported = store.importManifest(manifest);
    expect(imported).toMatchObject({ ok: true });
    const agent = (imported as { agent: string }).agent;

    schedules.writeAgentSchedule(agent, "08:00", "2026-08-24T12:00:00.000Z");
    schedules.recordScheduleRuns([
      {
        agent,
        due_at: "2026-08-25T06:00:00.000Z",
        settled_at: "2026-08-25T06:00:12.000Z",
        outcome: "ran",
        detail: "Started on time.",
        allowance_calls: 0,
      },
    ]);
    expect(schedules.readAgentSchedule(agent)).not.toBeNull();

    expect(store.forgetAgent(agent)).toEqual({ existed: true });

    expect(schedules.readAgentSchedule(agent)).toBeNull();
    expect(schedules.readScheduleRuns(agent)).toEqual([]);
  });
});
