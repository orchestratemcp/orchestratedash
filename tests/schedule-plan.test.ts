/**
 * When a schedule is due, and what a window nobody was there for becomes
 * (MAR-742 item 8, ADR 0029).
 *
 * `lib/schedule/plan.ts` is pure and takes its clock as an argument, which is
 * the whole reason this file can exist: every case below is a machine that was
 * asleep, a tick that ran late, or a daylight-saving boundary, and none of them
 * costs a real second to reach.
 *
 * That is not a convenience. A scheduler's failures are silent by construction —
 * nothing happens, at a moment nobody is watching — so the difference between a
 * tested planner and an untested one is the difference between a bug found here
 * and a bug found by somebody wondering why their agent has been quiet since
 * Tuesday.
 */

import { describe, expect, it } from "vitest";

import {
  SCHEDULE_GRACE_MS,
  decideSchedule,
  isLocalTime,
  missedRowFor,
  nextDueAfter,
  parseLocalTime,
  type AgentSchedule,
} from "../lib/schedule/plan";

/**
 * A schedule created far enough in the past that nothing below trips the
 * created-at floor unless it means to.
 */
function scheduleAt(at: string, created = "2026-01-01T00:00:00.000Z"): AgentSchedule {
  return { agent: "scout", enabled: true, kind: "daily", at_local: at, created_at: created };
}

/** A local-time `Date`, so the tests read in the same clock the planner uses. */
function local(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds = 0,
): Date {
  return new Date(year, month - 1, day, hours, minutes, seconds, 0);
}

describe("parsing a time of day", () => {
  it("takes 24-hour HH:MM and nothing else", () => {
    expect(parseLocalTime("08:00")).toEqual({ hours: 8, minutes: 0 });
    expect(parseLocalTime("00:00")).toEqual({ hours: 0, minutes: 0 });
    expect(parseLocalTime("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(parseLocalTime(" 17:30 ")).toEqual({ hours: 17, minutes: 30 });
  });

  /**
   * The refusals matter more than the acceptances.
   *
   * `lib/schedule/store.ts` reads this column back off the user's own disk and
   * `runner/server.ts` reads it off a channel, and both treat a value that fails
   * here as "no schedule". So anything this function lets through is a time an
   * agent gets started at.
   */
  it("refuses anything that is not one", () => {
    for (const bad of [
      "",
      "8:00",
      "24:00",
      "23:60",
      "08:00:00",
      "0800",
      "8am",
      "08:0O",
      "08:00Z",
      "-1:00",
      "08:00 UTC",
    ]) {
      expect(parseLocalTime(bad), bad).toBeNull();
      expect(isLocalTime(bad), bad).toBe(false);
    }
  });
});

describe("the next due moment", () => {
  it("is today when the time has not passed yet", () => {
    const due = nextDueAfter(scheduleAt("08:00"), local(2026, 3, 10, 6, 0));
    expect(due).toEqual(local(2026, 3, 10, 8, 0));
  });

  it("is tomorrow once it has", () => {
    const due = nextDueAfter(scheduleAt("08:00"), local(2026, 3, 10, 9, 0));
    expect(due).toEqual(local(2026, 3, 11, 8, 0));
  });

  it("is now, when now is exactly the moment", () => {
    const at = local(2026, 3, 10, 8, 0);
    expect(nextDueAfter(scheduleAt("08:00"), at)).toEqual(at);
  });

  /**
   * The wall clock is the thing the person set, so the next due moment is
   * always the same *reading* — never the same number of milliseconds later.
   *
   * Asserted as "the hour and minute a person would see" rather than as an
   * interval, because on the two days a year a timezone shifts, those two claims
   * disagree and only one of them is what somebody meant by "every day at
   * eight". This test passes in a zone with no DST too, which is the point: it
   * pins the property rather than a particular offset.
   */
  it("keeps the wall time across a day boundary rather than adding 24 hours", () => {
    let cursor = local(2026, 3, 6, 12, 0);
    for (let day = 0; day < 10; day += 1) {
      const due = nextDueAfter(scheduleAt("08:00"), cursor);
      expect(due).not.toBeNull();
      expect(due?.getHours()).toBe(8);
      expect(due?.getMinutes()).toBe(0);
      cursor = new Date((due?.getTime() ?? 0) + 60_000);
    }
  });

  it("has no answer for a time it cannot read", () => {
    expect(nextDueAfter(scheduleAt("nope"), local(2026, 3, 10, 6, 0))).toBeNull();
  });
});

describe("deciding one tick", () => {
  /**
   * The steady state: a daily schedule that ran yesterday.
   *
   * `since` is what DASH pushes — the newest window it has a record of — so a
   * schedule in its ordinary life always has one, and passing it here is what
   * makes each case below about **one** window rather than about every window
   * since the schedule was created. The no-cursor case is its own test at the
   * bottom, because it is a different situation with a different right answer.
   */
  const yesterday = local(2026, 3, 9, 8, 0);

  it("does nothing before the window", () => {
    const decision = decideSchedule(scheduleAt("08:00"), yesterday, local(2026, 3, 10, 7, 59));
    expect(decision.kind).toBe("idle");
  });

  it("fires on the tick that finds the window", () => {
    const decision = decideSchedule(scheduleAt("08:00"), yesterday, local(2026, 3, 10, 8, 0, 15));
    expect(decision).toEqual({ kind: "due", due_at: local(2026, 3, 10, 8, 0) });
  });

  /**
   * The grace window is the line between "late" and "history", and it is pinned
   * by value because moving it moves what a person is told happened.
   */
  it("still fires a tick that is late but inside the grace window", () => {
    const now = new Date(local(2026, 3, 10, 8, 0).getTime() + SCHEDULE_GRACE_MS - 1000);
    expect(decideSchedule(scheduleAt("08:00"), yesterday, now).kind).toBe("due");
  });

  it("reports a window past the grace as missed, and does not run it late", () => {
    const now = new Date(local(2026, 3, 10, 8, 0).getTime() + SCHEDULE_GRACE_MS + 1000);
    const decision = decideSchedule(scheduleAt("08:00"), yesterday, now);
    expect(decision).toEqual({ kind: "missed", due_at: local(2026, 3, 10, 8, 0), count: 1 });
  });

  /**
   * A schedule that has never come round yet measures from the moment the
   * person set it, and that is the whole job of `created_at`.
   *
   * The case is the first day of every schedule there will ever be: set at
   * 07:00, due at 08:00, no cursor because nothing has run. It has to fire once
   * and count once — a first tick that reported a backlog would greet somebody
   * with a list of runs they missed before they had asked for any.
   */
  it("fires the first window of a schedule that has never run", () => {
    const created = local(2026, 3, 10, 7, 0);
    const decision = decideSchedule(
      scheduleAt("08:00", created.toISOString()),
      null,
      local(2026, 3, 10, 8, 0, 20),
    );
    expect(decision).toEqual({ kind: "due", due_at: local(2026, 3, 10, 8, 0) });
  });

  /**
   * And the honest converse: a schedule set on Monday on a laptop that was then
   * shut until Thursday reports what it missed, measured from the instruction
   * and not from a cursor that does not exist.
   */
  it("reports what a never-run schedule missed, measured from when it was set", () => {
    const created = local(2026, 3, 9, 7, 0);
    const decision = decideSchedule(
      scheduleAt("08:00", created.toISOString()),
      null,
      local(2026, 3, 12, 14, 20),
    );
    expect(decision).toEqual({ kind: "missed", due_at: local(2026, 3, 12, 8, 0), count: 4 });
  });

  it("pins the grace window at five minutes", () => {
    expect(SCHEDULE_GRACE_MS).toBe(5 * 60 * 1000);
  });

  /**
   * ADR 0029 decision 7, the case it was written for: a laptop shut on Monday
   * and opened on Thursday.
   *
   * One decision, not three, and it starts nothing. Three runs at once because
   * somebody went away for the weekend is the outcome the decision refuses, and
   * a count is what tells them what they lost.
   */
  it("collapses several sleeping days into one missed report and starts nothing", () => {
    const decision = decideSchedule(
      scheduleAt("08:00"),
      local(2026, 3, 9, 8, 0),
      local(2026, 3, 12, 14, 20),
    );
    expect(decision).toEqual({ kind: "missed", due_at: local(2026, 3, 12, 8, 0), count: 3 });
  });

  it("does not re-settle the window it was last told about", () => {
    const decision = decideSchedule(
      scheduleAt("08:00"),
      local(2026, 3, 10, 8, 0),
      local(2026, 3, 10, 8, 0, 30),
    );
    expect(decision.kind).toBe("idle");
  });

  /**
   * A schedule set at two in the afternoon for eight in the morning is next due
   * tomorrow, and this morning is not a window it missed — that window predates
   * the instruction.
   */
  it("never reports a window from before the person set the schedule", () => {
    const decision = decideSchedule(
      scheduleAt("08:00", local(2026, 3, 10, 14, 0).toISOString()),
      null,
      local(2026, 3, 10, 14, 5),
    );
    expect(decision.kind).toBe("idle");
  });

  it("is idle for a schedule that is switched off", () => {
    const off: AgentSchedule = { ...scheduleAt("08:00"), enabled: false };
    expect(decideSchedule(off, yesterday, local(2026, 3, 10, 8, 0, 15)).kind).toBe("idle");
  });

  /**
   * A row this build could not have written starts nothing.
   *
   * The store and the runner both re-check these values, so reaching this
   * function with a bad one means something on disk or on the wire was already
   * wrong — and the safe reading of "DASH cannot tell when you meant" is to do
   * nothing rather than to guess an hour.
   */
  it("is idle for a time it cannot read and for a kind it does not know", () => {
    expect(decideSchedule(scheduleAt("half eight"), yesterday, local(2026, 3, 10, 9, 0)).kind).toBe(
      "idle",
    );
    const weekly = { ...scheduleAt("08:00"), kind: "weekly" as unknown as "daily" };
    expect(decideSchedule(weekly, yesterday, local(2026, 3, 10, 8, 0, 15)).kind).toBe("idle");
  });

  /**
   * A year of absence is not three hundred and sixty-five missed runs in any
   * sense a person cares about, and the walk that counted them would be a loop
   * whose length is set by how long somebody was away.
   */
  it("bounds how far back one tick will look", () => {
    const decision = decideSchedule(
      scheduleAt("08:00", "2020-01-01T00:00:00.000Z"),
      null,
      local(2026, 3, 12, 14, 20),
    );
    expect(decision.kind).toBe("missed");
    if (decision.kind === "missed") {
      expect(decision.count).toBeGreaterThan(0);
      expect(decision.count).toBeLessThanOrEqual(31);
    }
  });
});

describe("the missed row", () => {
  it("names the machine's own state without claiming to know which", () => {
    const row = missedRowFor("scout", local(2026, 3, 10, 8, 0), 1, local(2026, 3, 10, 14, 20));
    expect(row.outcome).toBe("missed");
    expect(row.agent).toBe("scout");
    expect(row.due_at).toBe(local(2026, 3, 10, 8, 0).toISOString());
    expect(row.settled_at).toBe(local(2026, 3, 10, 14, 20).toISOString());
    expect(row.detail).toContain("asleep, off, or restarting");
    // ADR 0029 decision 7, said on the row rather than only in the ADR.
    expect(row.detail).toContain("does not run it late");
  });

  it("says how many when it was more than one", () => {
    const row = missedRowFor("scout", local(2026, 3, 12, 8, 0), 3, local(2026, 3, 12, 14, 20));
    expect(row.detail).toContain("3 scheduled runs");
  });

  /**
   * `settled_at` is when the runner decided and `due_at` is when it should have
   * happened, and for a missed window they are hours apart. A row that carried
   * one stamp would be DASH claiming it was present at a moment it was not.
   */
  it("keeps the two stamps apart", () => {
    const row = missedRowFor("scout", local(2026, 3, 10, 8, 0), 1, local(2026, 3, 10, 14, 20));
    expect(row.due_at).not.toBe(row.settled_at);
  });
});
