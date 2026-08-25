/**
 * The per-schedule spend ceiling (MAR-784, ADR 0029 amendment 1).
 *
 * ADR 0029 decision 6 refused to open a spend allowance on an unattended run and
 * named the lift precisely: *a per-schedule ceiling the person sets when they set
 * the time.* This is that ceiling, tested at every boundary it crosses, because
 * the thing it bounds is somebody's money and every one of those boundaries is a
 * place a number could quietly get larger.
 *
 * There are five of them and each has its own `describe`:
 *
 * 1. **The bound itself** — one constant, tied by identity to what a person's
 *    own press of Run now buys, so an unattended run can never be worth more
 *    than a watched one.
 * 2. **The store** — refuses out of range on the way in, falls to zero on the
 *    way out.
 * 3. **The channel** — a bad ceiling loses the ceiling and never the schedule.
 * 4. **The runner** — a fire opens a ceiling with a fire id, and drops it when
 *    the window is over.
 * 5. **The broker** — the clamp, and the refusal that is the degrade.
 *
 * And one for the panel, because MAR-784's fourth scope item is copy and the
 * failure it guards against is a page that says "cannot spend" about a schedule
 * that can.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_TRIGGER_COPY } from "../lib/copy/agent-page";
import {
  SPEND_ALLOWANCE_CALLS,
  SPEND_ALLOWANCE_MS,
  openRunSpend,
  spendAllowed,
  spendOne,
} from "../lib/broker/spend-allowance";
import {
  DEFAULT_SCHEDULE_ALLOWANCE_CALLS,
  MAX_SCHEDULE_ALLOWANCE_CALLS,
  allowanceCalls,
  type AgentSchedule,
} from "../lib/schedule/plan";
import { buildAgentScheduleView } from "../lib/views/agent-schedule";
import { RunnerSchedule } from "../runner/schedule";
import { openRunnerStore, type RunnerStore } from "../runner/store";
import { Supervisor, type AgentRegistration } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_AGENT = path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs");

const workDir = mkdtempSync(path.join(tmpdir(), "dash-allowance-"));
const manifestPath = path.join(workDir, "valid.manifest.json");
writeFileSync(
  manifestPath,
  readFileSync(
    path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
    "utf8",
  ),
  "utf8",
);

/* ---------------------------------------------------------------------- *
 * 1. The bound
 * ---------------------------------------------------------------------- */

describe("what a schedule may be allowed at all", () => {
  /**
   * The pin, and it is an identity rather than a number.
   *
   * ADR 0029 decision 6's argument against an unattended allowance is
   * repetition — *"a schedule is typed once and fires forever"* — and the answer
   * to repetition is not a bigger per-firing ceiling. So the widest a scheduled
   * run can be is exactly the width of the press it stands in for, and writing
   * that as one symbol is what stops the two drifting apart in a later diff.
   */
  it("can never be worth more than a person's own press of Run now", () => {
    expect(MAX_SCHEDULE_ALLOWANCE_CALLS).toBe(SPEND_ALLOWANCE_CALLS);
    expect(DEFAULT_SCHEDULE_ALLOWANCE_CALLS).toBe(MAX_SCHEDULE_ALLOWANCE_CALLS);
  });

  /**
   * The direction to be wrong in.
   *
   * Every one of these could plausibly have been clamped *up* to the maximum,
   * and clamping up would turn a corrupt column into the largest spend this
   * build permits. Falling to zero turns it into the behaviour DASH had before
   * the field existed: a schedule that runs and does not spend.
   */
  it("reads anything it does not recognise as no allowance at all", () => {
    expect(allowanceCalls(0)).toBe(0);
    expect(allowanceCalls(1)).toBe(1);
    expect(allowanceCalls(MAX_SCHEDULE_ALLOWANCE_CALLS)).toBe(MAX_SCHEDULE_ALLOWANCE_CALLS);

    expect(allowanceCalls(MAX_SCHEDULE_ALLOWANCE_CALLS + 1)).toBe(0);
    expect(allowanceCalls(-1)).toBe(0);
    expect(allowanceCalls(1.5)).toBe(0);
    expect(allowanceCalls(Number.NaN)).toBe(0);
    expect(allowanceCalls(Number.POSITIVE_INFINITY)).toBe(0);
    expect(allowanceCalls("2")).toBe(0);
    expect(allowanceCalls(null)).toBe(0);
    expect(allowanceCalls(undefined)).toBe(0);
  });
});

/* ---------------------------------------------------------------------- *
 * 2. The store
 * ---------------------------------------------------------------------- */

const opened: Array<{ dataDir: string; closeDb: () => void }> = [];

async function freshStore(): Promise<{
  db: typeof import("../lib/db");
  schedules: typeof import("../lib/schedule/store");
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-allowance-store-"));
  process.env.DASH_DATA_DIR = dataDir;
  vi.resetModules();
  const db = await import("../lib/db");
  const schedules = await import("../lib/schedule/store");
  opened.push({ dataDir, closeDb: db.closeDb });
  return { db, schedules };
}

const runnersOpen: Array<{ store: RunnerStore; supervisor: Supervisor; dataDir: string }> = [];

afterEach(() => {
  for (const entry of runnersOpen.splice(0)) {
    entry.supervisor.stopAll();
    entry.store.close();
    rmSync(entry.dataDir, { recursive: true, force: true });
  }
  const entries = opened.splice(0);
  for (const { closeDb } of entries) {
    closeDb();
  }
  for (const dataDir of new Set(entries.map((entry) => entry.dataDir))) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("the ceiling in the store", () => {
  it("defaults to no spend, which is what every schedule set before this had", async () => {
    const { schedules } = await freshStore();
    expect(schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z")).toEqual({
      ok: true,
    });
    expect(schedules.readAgentSchedule("scout")?.allowance_calls).toBe(0);
  });

  it("stores a ceiling a person set and reads it back", async () => {
    const { schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z", 2);
    expect(schedules.readAgentSchedule("scout")?.allowance_calls).toBe(2);
    expect(schedules.readAgentSchedules()[0]?.allowance_calls).toBe(2);
  });

  /**
   * Refused rather than clamped, which is the opposite of what every *read* of
   * this column does — and the asymmetry is the point. A value arriving at the
   * write came from a person pressing Save, so quietly storing a different
   * number than the one on screen would be the page lying about what it saved.
   */
  it("refuses a ceiling out of range instead of quietly reducing it", async () => {
    const { schedules } = await freshStore();
    const refused = schedules.writeAgentSchedule(
      "scout",
      "08:00",
      "2026-08-24T12:00:00.000Z",
      MAX_SCHEDULE_ALLOWANCE_CALLS + 5,
    );
    expect(refused.ok).toBe(false);
    expect(refused.refusal).toContain("model calls");
    // And nothing was written, so a refused save cannot leave a schedule behind.
    expect(schedules.readAgentSchedule("scout")).toBeNull();
  });

  /**
   * The column is on the user's own disk and anything could be in it. A row this
   * build could not have written must not become permission to spend that much.
   */
  it("reads a ceiling nothing could have written as no ceiling", async () => {
    const { db, schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z", 1);
    db.db().prepare("UPDATE agent_schedules SET allowance_calls = 99 WHERE agent = ?").run("scout");
    expect(schedules.readAgentSchedule("scout")?.allowance_calls).toBe(0);
  });

  /**
   * What the window was handed, kept apart from what the schedule says today.
   *
   * The two come apart the moment somebody edits a ceiling, and a panel showing
   * today's ceiling against last night's spend would report a pairing nothing
   * ever agreed to.
   */
  it("keeps what a settled window was allowed, even after the ceiling changes", async () => {
    const { schedules } = await freshStore();
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z", 2);
    schedules.recordScheduleRuns([
      {
        agent: "scout",
        due_at: "2026-08-25T06:00:00.000Z",
        settled_at: "2026-08-25T06:00:12.000Z",
        outcome: "ran",
        detail: "Started on time.",
        allowance_calls: 2,
      },
    ]);
    // The person turns the ceiling down at lunchtime.
    schedules.writeAgentSchedule("scout", "08:00", "2026-08-24T12:00:00.000Z", 0);

    expect(schedules.readAgentSchedule("scout")?.allowance_calls).toBe(0);
    expect(schedules.readScheduleRuns("scout")[0]?.allowance_calls).toBe(2);
  });

  /**
   * The receipt, counted from the rows DASH's own broker wrote rather than
   * reported by the agent — `readScheduleSpend`'s whole argument. A spend count
   * an agent supplied would be the party being reported on doing the reporting.
   */
  it("counts what a window spent, and what it was refused, from the broker's own rows", async () => {
    const { db, schedules } = await freshStore();
    const settled = "2026-08-25T06:00:12.000Z";
    const write = (operation: string, decision: string, refusal: string | null, at: string): void => {
      db.db()
        .prepare(
          "INSERT INTO broker_audit (agent, connection_id, operation, request_id, decision, " +
            "refusal, input_keys, result_count, account_hint, duration_ms, decided_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, NULL, 1, ?)",
        )
        .run("scout", "model_provider", operation, `req-${at}-${operation}`, decision, refusal, at);
    };

    write("openrouter.digest.curate", "allowed", null, "2026-08-25T06:00:20.000Z");
    write("openrouter.digest.curate", "refused", "needs_a_person", "2026-08-25T06:00:25.000Z");
    // A read in the same window, which costs nothing and must not be counted.
    write("gmail.search", "allowed", null, "2026-08-25T06:00:22.000Z");
    // And a spend well outside the window, which belongs to some other press.
    write("openrouter.digest.curate", "allowed", null, "2026-08-25T09:00:00.000Z");

    expect(schedules.readScheduleSpend("scout", settled, SPEND_ALLOWANCE_MS)).toEqual({
      allowed: 1,
      refused: 1,
    });
  });
});

/* ---------------------------------------------------------------------- *
 * 3. The runner
 *
 * The channel's own half — a ceiling that does not parse losing the ceiling and
 * never the schedule — is in `tests/schedule-runner.test.ts`, beside the harness
 * that already serves `POST /schedules` over a real endpoint. A second copy of
 * that arrangement here would be a second thing to keep in step.
 * ---------------------------------------------------------------------- */

function scheduleFor(at: string, created: string, allowance: number): AgentSchedule {
  return {
    agent: "scout",
    enabled: true,
    kind: "daily",
    at_local: at,
    created_at: created,
    allowance_calls: allowance,
  };
}

function hhmm(when: Date): string {
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
}

function runnerHarness(now: () => Date): {
  schedule: RunnerSchedule;
  database: DatabaseSync;
} {
  const dataDir = mkdtempSync(path.join(tmpdir(), "dash-allowance-runner-"));
  const opened = openRunnerStore(dataDir);
  if (!opened.ok) {
    throw new Error(`the runner store would not open: ${opened.damage.detail}`);
  }
  const registration: AgentRegistration = {
    agent_id: "scout",
    manifest_path: manifestPath,
    command: process.execPath,
    args: [FIXTURE_AGENT],
    env: { AGENT_PENDING: "1" },
  };
  const supervisor = new Supervisor([registration], () => {
    // Silence the runner's logging; the assertions are on the allowances.
  });
  runnersOpen.push({ store: opened.store, supervisor, dataDir });

  return {
    database: opened.store.database,
    schedule: new RunnerSchedule({
      database: () => opened.store.database,
      supervisor,
      log: () => {
        // Silenced.
      },
      now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 25))),
    }),
  };
}

describe("what a fire opens", () => {
  it("reports a live ceiling with a fire id, and stamps it on the settlement", async () => {
    const at = new Date();
    const { schedule } = runnerHarness(() => at);
    schedule.configure({
      schedules: [scheduleFor(hhmm(at), new Date(at.getTime() - 3_600_000).toISOString(), 2)],
      since: {},
    });

    await schedule.tick();

    const settled = schedule.drain();
    expect(settled).toHaveLength(1);
    expect(settled[0]?.outcome).toBe("ran");
    expect(settled[0]?.allowance_calls).toBe(2);
    // The sentence a person reads says the number too, not only the column.
    expect(settled[0]?.detail).toContain("2 model calls");

    const live = schedule.allowances();
    expect(live).toHaveLength(1);
    expect(live[0]?.agent_id).toBe("scout");
    expect(live[0]?.calls).toBe(2);
    expect(live[0]?.fire_id).not.toBe("");
    // Reported over and over with the same id, which is what lets the reader
    // open it exactly once. A second read that minted a new id would refresh
    // the ceiling on every poll.
    expect(schedule.allowances()[0]?.fire_id).toBe(live[0]?.fire_id);
  }, 30_000);

  /**
   * ADR 0029 decision 6 is still the default, and this is the test that says so.
   * A schedule nobody opted in for opens nothing, so there is no entry for a
   * reader to corroborate and nothing downstream to clamp.
   */
  it("opens nothing at all for a schedule with no ceiling", async () => {
    const at = new Date();
    const { schedule } = runnerHarness(() => at);
    schedule.configure({
      schedules: [scheduleFor(hhmm(at), new Date(at.getTime() - 3_600_000).toISOString(), 0)],
      since: {},
    });

    await schedule.tick();

    const settled = schedule.drain();
    expect(settled[0]?.outcome).toBe("ran");
    expect(settled[0]?.allowance_calls).toBe(0);
    expect(settled[0]?.detail).not.toContain("model call");
    expect(schedule.allowances()).toEqual([]);
  }, 30_000);

  /**
   * A clock cannot be argued with, and an allowance older than the window DASH's
   * own broker would honour is one this process should stop asking for.
   * Reporting it would be the runner requesting something it knows will be
   * refused, which is how a reader learns to ignore a field.
   */
  it("drops a ceiling once its window has passed", async () => {
    const at = new Date();
    let clock = at;
    const { schedule } = runnerHarness(() => clock);
    schedule.configure({
      schedules: [scheduleFor(hhmm(at), new Date(at.getTime() - 3_600_000).toISOString(), 1)],
      since: {},
    });

    await schedule.tick();
    expect(schedule.allowances()).toHaveLength(1);

    clock = new Date(at.getTime() + SPEND_ALLOWANCE_MS);
    expect(schedule.allowances()).toEqual([]);
    expect(schedule.describe().allowances).toBe(0);
  }, 30_000);
});

/* ---------------------------------------------------------------------- *
 * 4. The broker
 * ---------------------------------------------------------------------- */

describe("the allowance the broker actually opens", () => {
  /**
   * `Math.min` and not `Math.max`, in the one function that constructs the type.
   *
   * A caller asking for more than a person's own press buys gets a person's own
   * press. That bound lives at the constructor rather than at the call site
   * because a bound stated where the value is built cannot be forgotten by a
   * second caller — and MAR-784 is the packet that adds the second caller.
   */
  it("clamps a ceiling down and never up", () => {
    const at = 1_000;
    expect(openRunSpend(at).remaining).toBe(SPEND_ALLOWANCE_CALLS);
    expect(openRunSpend(at, 1).remaining).toBe(1);
    expect(openRunSpend(at, SPEND_ALLOWANCE_CALLS + 10).remaining).toBe(SPEND_ALLOWANCE_CALLS);
  });

  it("treats a ceiling of nothing as an allowance that is not open", () => {
    const at = 1_000;
    for (const calls of [0, -1, 1.5, Number.NaN]) {
      expect(spendAllowed(openRunSpend(at, calls), at)).toBe(false);
    }
  });

  /**
   * The degrade, at the level the broker sees it.
   *
   * A ceiling of one is spent by one call, and the second is refused exactly the
   * way an absent allowance is refused — `spendAllowed` deliberately cannot tell
   * absent, expired and spent apart, so an agent cannot learn the shape of the
   * budget by probing it. That equivalence is what makes "degrades exactly like
   * today's no-spend run" true rather than aspirational.
   */
  it("stops at the ceiling, and stops the same way an absent allowance does", () => {
    const at = 1_000;
    let allowance = openRunSpend(at, 1);
    expect(spendAllowed(allowance, at)).toBe(true);
    allowance = spendOne(allowance);
    expect(spendAllowed(allowance, at)).toBe(false);
    expect(spendAllowed(undefined, at)).toBe(false);
  });
});

/* ---------------------------------------------------------------------- *
 * The panel
 * ---------------------------------------------------------------------- */

describe("what the panel says about money", () => {
  const standing: AgentSchedule = {
    agent: "scout",
    enabled: true,
    kind: "daily",
    at_local: "03:00",
    created_at: "2026-08-24T12:00:00.000Z",
    allowance_calls: 0,
  };

  it("says a scheduled run cannot spend while nobody has opted in", () => {
    const view = buildAgentScheduleView(standing, []);
    expect(view.spend_line).toBe(AGENT_TRIGGER_COPY.spend.none);
    expect(view.spend_bound).toBe("");
    expect(view.allowance_calls).toBe(0);
  });

  /**
   * MAR-784's copy item, and the honesty that has to travel with it: the
   * allowance sentence never appears without the sentence bounding it.
   */
  it("swaps to the allowance sentence, with its bound, once one is set", () => {
    const view = buildAgentScheduleView({ ...standing, allowance_calls: 2 }, []);
    expect(view.spend_line).toBe(AGENT_TRIGGER_COPY.spend.allowed(2));
    expect(view.spend_bound).toBe(AGENT_TRIGGER_COPY.spend.needs_dash_open);
    expect(view.allowance_calls).toBe(2);
  });

  it("draws no receipt for a window that was allowed nothing", () => {
    const view = buildAgentScheduleView(standing, [
      {
        agent: "scout",
        due_at: "2026-08-25T03:00:00.000Z",
        settled_at: "2026-08-25T03:00:09.000Z",
        outcome: "ran",
        detail: "Started on time.",
        allowance_calls: 0,
      },
    ]);
    expect(view.last?.spend).toBeNull();
  });

  it("reports what the last run used against what it was allowed", () => {
    const view = buildAgentScheduleView(
      { ...standing, allowance_calls: 2 },
      [
        {
          agent: "scout",
          due_at: "2026-08-25T03:00:00.000Z",
          settled_at: "2026-08-25T03:00:09.000Z",
          outcome: "ran",
          detail: "Started on time.",
          allowance_calls: 2,
        },
      ],
      { allowed: 1, refused: 0 },
    );
    expect(view.last?.spend?.line).toBe("Used 1 of 2 model calls.");
    expect(view.last?.spend?.ceiling_line).toBeNull();
  });

  /**
   * The ceiling is reported as reached when DASH **refused** a call, not when
   * the arithmetic says the allowance is used up. Those come apart in the case
   * that matters: an agent whose plan needed exactly its two calls used both and
   * asked for no third, and telling that person the run was cut short would be
   * DASH inventing a degrade.
   */
  it("names the degrade only when a call was actually refused", () => {
    const settled = {
      agent: "scout",
      due_at: "2026-08-25T03:00:00.000Z",
      settled_at: "2026-08-25T03:00:09.000Z",
      outcome: "ran" as const,
      detail: "Started on time.",
      allowance_calls: 2,
    };
    const schedule = { ...standing, allowance_calls: 2 };

    const exact = buildAgentScheduleView(schedule, [settled], { allowed: 2, refused: 0 });
    expect(exact.last?.spend?.ceiling_line).toBeNull();

    const ranOut = buildAgentScheduleView(schedule, [settled], { allowed: 2, refused: 1 });
    expect(ranOut.last?.spend?.ceiling_line).toBe(AGENT_TRIGGER_COPY.ceiling_hit(2));
    expect(ranOut.last?.spend?.ceiling_line).toContain("still published");
  });
});
