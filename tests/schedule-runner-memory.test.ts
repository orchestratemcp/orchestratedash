/**
 * What the runner remembers when nothing started it but Windows (MAR-785,
 * ADR 0030 decision 5).
 *
 * ## The gap this closes, stated as the test's subject
 *
 * `RunnerSchedule` begins life with `{ schedules: [], since: {} }` and is filled
 * by DASH's push on the evidence poll — twelve times a minute, and only while
 * DASH's window is open. That was complete while DASH was the only thing that
 * could start a runner. ADR 0030 lets Windows start one at login, at which point
 * a runner with no memory is a runner that exists and fires nothing: the login
 * entry would be machinery with no observable effect, and MAR-785's proof bar —
 * reboot, never open DASH, the window fires — could not be met by the login task
 * alone.
 *
 * So the assertions below are about a **second process**: one `RunnerSchedule`
 * is pushed a set and thrown away, and a fresh one over the same store is asked
 * what it knows. Reusing one instance would prove nothing, because the answer
 * would come out of the field the push wrote.
 *
 * No processes are spawned here. `tests/schedule-runner.test.ts` owns the firing
 * and spawns real children for it; this owns the memory, which is a store
 * question and answerable without one.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RunnerSchedule, readScheduleConfiguration } from "../runner/schedule";
import type { Supervisor } from "../runner/supervisor";
import type { RunnerStore } from "../runner/store";
import { openHealthyRunnerStore } from "./helpers/runner-store";
import type { AgentSchedule } from "../lib/schedule/plan";

const directories: string[] = [];
const stores: RunnerStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

function scratchStore(): RunnerStore {
  const directory = mkdtempSync(path.join(tmpdir(), "dash-schedule-memory-"));
  directories.push(directory);
  const store = openHealthyRunnerStore(directory);
  stores.push(store);
  return store;
}

/**
 * A scheduler over one store, with a supervisor that would throw if reached.
 *
 * Nothing here ticks, so nothing reaches it — and a stub that threw loudly is
 * better than one that answers, because a test that accidentally started firing
 * would otherwise pass while doing something entirely different.
 */
function schedulerOver(store: RunnerStore, log: string[] = []): RunnerSchedule {
  return new RunnerSchedule({
    database: () => store.database,
    supervisor: new Proxy({} as Supervisor, {
      get() {
        throw new Error("the memory tests must not reach the supervisor");
      },
    }),
    log: (line) => log.push(line),
  });
}

const DAILY: AgentSchedule = {
  agent: "ai-agent-news",
  enabled: true,
  kind: "daily",
  at_local: "08:00",
  created_at: "2026-08-25T06:00:00.000Z",
};

describe("a runner that started without DASH", () => {
  it("honours the set the previous process was pushed", () => {
    const store = scratchStore();
    schedulerOver(store).configure({ schedules: [DAILY], since: { "ai-agent-news": "2026-08-24T06:00:00.000Z" } });

    // A second scheduler over the same store: the reboot, in the only form a
    // unit test can stage it.
    const afterReboot = schedulerOver(store);
    expect(afterReboot.describe()).toMatchObject({ schedules: 0, enabled: 0 });
    expect(afterReboot.restore()).toBe(true);
    expect(afterReboot.describe()).toMatchObject({ schedules: 1, enabled: 1 });
  });

  it("remembers the cursor as well as the times", () => {
    // `since` is what stops a runner which has just started from reading this
    // morning's completed window as one it missed. Without it restored, the
    // first tick after a login would spool a `missed` row for a run that
    // happened — the exact class of lie ADR 0029 decision 7's record exists to
    // prevent.
    const store = scratchStore();
    schedulerOver(store).configure({ schedules: [DAILY], since: { "ai-agent-news": "2026-08-25T06:00:00.000Z" } });

    const database = store.database;
    const row = database.prepare("SELECT configuration FROM schedule_standing WHERE id = 1").get() as {
      configuration: string;
    };
    expect(JSON.parse(row.configuration)).toMatchObject({
      since: { "ai-agent-news": "2026-08-25T06:00:00.000Z" },
    });
  });

  it("keeps exactly one row however many pushes arrive", () => {
    // The push is twelve a minute for as long as DASH is open. A table that
    // accumulated would be a store that grew without bound on the machine of
    // anybody who left DASH running.
    const store = scratchStore();
    const scheduler = schedulerOver(store);
    for (let i = 0; i < 5; i += 1) {
      scheduler.configure({ schedules: [DAILY], since: {} });
    }
    const count = store.database.prepare("SELECT COUNT(*) AS n FROM schedule_standing").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it("forgets a schedule the person deleted, because the push is the whole set", () => {
    // ADR 0029 decision 2's property, extended across a restart: an empty push
    // has to be able to withdraw an instruction, or a schedule turned off while
    // DASH was open would come back at the next login.
    const store = scratchStore();
    const scheduler = schedulerOver(store);
    scheduler.configure({ schedules: [DAILY], since: {} });
    scheduler.configure({ schedules: [], since: {} });

    const afterReboot = schedulerOver(store);
    expect(afterReboot.restore()).toBe(false);
    expect(afterReboot.describe()).toMatchObject({ schedules: 0 });
  });

  it("restores a disabled schedule as disabled rather than dropping it", () => {
    const store = scratchStore();
    schedulerOver(store).configure({ schedules: [{ ...DAILY, enabled: false }], since: {} });

    const afterReboot = schedulerOver(store);
    // `restore` answers "is anything standing", and a disabled row is not.
    expect(afterReboot.restore()).toBe(true);
    expect(afterReboot.describe()).toMatchObject({ schedules: 1, enabled: 0 });
  });

  it("says so, and holds nothing, when there is no row at all", () => {
    const afterReboot = schedulerOver(scratchStore());
    expect(afterReboot.restore()).toBe(false);
    expect(afterReboot.describe()).toMatchObject({ schedules: 0 });
  });
});

describe("a row this runner would not have accepted over the channel", () => {
  it("is discarded rather than honoured", () => {
    // The property that makes the memory safe: a set off this machine's own
    // disk gets no more trust than a body off the socket. `configuration` is
    // written by DASH today, and a row that named an unknown `kind` would be an
    // instruction nobody wrote, honoured at a time nobody picked.
    const store = scratchStore();
    const log: string[] = [];
    store.database
      .prepare("INSERT INTO schedule_standing (id, configuration, received_at) VALUES (1, ?, ?)")
      .run(
        JSON.stringify({ schedules: [{ ...DAILY, kind: "hourly" }], since: {} }),
        "2026-08-25T06:00:00.000Z",
      );

    const scheduler = schedulerOver(store, log);
    // The row parses and the bad member is dropped — `readScheduleConfiguration`
    // keeps the rest rather than refusing everything, which is the same
    // behaviour the channel has for the same reason.
    expect(scheduler.restore()).toBe(false);
    expect(scheduler.describe()).toMatchObject({ schedules: 0 });
  });

  it("is discarded when it is not JSON at all, without throwing", () => {
    const store = scratchStore();
    const log: string[] = [];
    store.database
      .prepare("INSERT INTO schedule_standing (id, configuration, received_at) VALUES (1, ?, ?)")
      .run("{not json", "2026-08-25T06:00:00.000Z");

    const scheduler = schedulerOver(store, log);
    expect(scheduler.restore()).toBe(false);
    expect(log.join(" ")).toMatch(/not valid JSON/u);
  });

  it("is discarded when it is JSON but not a configuration", () => {
    const store = scratchStore();
    const log: string[] = [];
    store.database
      .prepare("INSERT INTO schedule_standing (id, configuration, received_at) VALUES (1, ?, ?)")
      .run(JSON.stringify({ schedules: "all of them" }), "2026-08-25T06:00:00.000Z");

    const scheduler = schedulerOver(store, log);
    expect(scheduler.restore()).toBe(false);
    expect(log.join(" ")).toMatch(/not understood/u);
  });

  it("uses the same parser the channel uses", () => {
    // Asserted directly, because the whole safety argument is that there is one
    // implementation of "checked field by field" rather than two. This is the
    // export `runner/server.ts` now imports.
    expect(readScheduleConfiguration({ schedules: [DAILY], since: {} })).toMatchObject({
      schedules: [DAILY],
    });
    expect(readScheduleConfiguration("nonsense")).toBe("malformed");
  });
});

describe("a runner whose store is unusable", () => {
  it("neither writes nor restores, and does not throw", () => {
    // `database: () => null` is the damaged-store state `runner/store-damage.ts`
    // puts the runner into. A scheduler that threw here would take the whole
    // runner down over a feature that is meant to degrade to "wait for DASH".
    const log: string[] = [];
    const scheduler = new RunnerSchedule({
      database: () => null,
      supervisor: new Proxy({} as Supervisor, {
        get() {
          throw new Error("unreachable");
        },
      }),
      log: (line) => log.push(line),
    });
    expect(() => scheduler.configure({ schedules: [DAILY], since: {} })).not.toThrow();
    expect(scheduler.restore()).toBe(false);
  });
});
