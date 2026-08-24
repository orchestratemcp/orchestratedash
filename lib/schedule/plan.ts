/**
 * When a schedule is due, and what to do about a window nobody was there for
 * (MAR-742 item 8, ADR 0029).
 *
 * Pure, and it holds nothing. Everything here takes a clock as an argument and
 * returns a decision, so the whole of "did this fire on time, was it missed, how
 * many were missed" is reachable by the test suite without a timer, a runner, or
 * a machine that has been asleep.
 *
 * That is not a stylistic preference. The failure this module exists to prevent
 * is a schedule that silently does nothing, and a silent failure is exactly the
 * kind that a test which has to wait for real minutes will not be written to
 * catch. `runner/schedule.ts` is the impure half and is deliberately thin.
 *
 * ## The one thing this module is opinionated about
 *
 * A due moment is either **fresh enough to act on** or **already history**, and
 * there is a line between the two rather than a spectrum. `SCHEDULE_GRACE_MS` is
 * that line, and ADR 0029 decision 7 is the argument for having one: without it,
 * "the machine woke up at 14:20 and it is now time to do the 08:00 run" and "the
 * tick ran fifteen seconds late" are the same sentence, and only one of them
 * should start an agent.
 */

/** How a schedule says when. One member; ADR 0029 decision 9 for why. */
export type ScheduleKind = "daily";

/** One agent's standing instruction, as `agent_schedules` holds it. */
export interface AgentSchedule {
  agent: string;
  enabled: boolean;
  kind: ScheduleKind;
  /** `HH:MM`, 24-hour, this machine's own local time. Never a timezone. */
  at_local: string;
  /** ISO 8601. When the person set it — the earliest window that can be due. */
  created_at: string;
}

/**
 * What became of one window.
 *
 * `refused` is its own value rather than a flavour of `missed` because they are
 * different facts about different parties: `missed` says DASH was not there, and
 * `refused` says DASH was there, tried, and the runner or the agent said no. A
 * person reading a week of rows needs to tell "my laptop was shut" from "this
 * agent has been failing to start since Tuesday".
 */
export type ScheduleOutcome = "ran" | "missed" | "refused";

/** One settled window, as it travels from the runner to the store. */
export interface ScheduleSettlement {
  agent: string;
  /** The scheduled moment, ISO 8601. */
  due_at: string;
  /** When the runner decided about it, ISO 8601. */
  settled_at: string;
  outcome: ScheduleOutcome;
  detail: string;
}

/**
 * How late a due moment may be and still fire.
 *
 * Five minutes. Long enough that a tick delayed by a busy machine, a slow store
 * open, or a laptop lid that was closed for ninety seconds still runs the thing
 * the person asked for. Short enough that "I opened it after lunch" is never
 * mistaken for "it is 08:00".
 *
 * The number is the whole of ADR 0029 decision 7's boundary and is pinned by
 * value in `tests/schedule-plan.test.ts`, so moving it is a diff somebody reads
 * rather than a constant that drifted.
 */
export const SCHEDULE_GRACE_MS = 5 * 60 * 1000;

/**
 * How far back a single tick will look for windows nobody settled.
 *
 * Thirty days. A machine that has been off for a year has not "missed" three
 * hundred and sixty-five runs in any sense a person cares about, and walking
 * them all would be a loop whose length is set by how long somebody was on
 * holiday. What is reported instead is one row saying windows were missed and
 * how many were counted — see `missedRowFor`.
 */
const MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `HH:MM` into minutes past local midnight, or null.
 *
 * Strict on purpose. This value comes out of a column on the user's own disk and
 * anything could have been written into it, so `readAgentSchedules`' discipline
 * applies here too: a value that would not have been accepted going in is not
 * turned into a time an agent gets started at.
 */
export function parseLocalTime(value: string): { hours: number; minutes: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (match === null) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return null;
  }
  return { hours, minutes };
}

/** Whether a string is a time this build would accept. The UI's own gate. */
export function isLocalTime(value: string): boolean {
  return parseLocalTime(value) !== null;
}

/**
 * The next moment at or after `from` at which this schedule is due.
 *
 * Local time throughout, by way of `Date`'s own local accessors rather than any
 * arithmetic on UTC offsets. That is the correct implementation for the thing
 * this measures: "every day at 08:00 on this computer" means the clock on the
 * wall, so a daylight-saving change should move the wall time and not preserve
 * the interval. Doing it with `setHours` gets that for free from the platform;
 * doing it by adding 86,400,000 milliseconds would silently drift to 07:00 for
 * half the year.
 */
export function nextDueAfter(schedule: AgentSchedule, from: Date): Date | null {
  const time = parseLocalTime(schedule.at_local);
  if (time === null) {
    return null;
  }
  const candidate = new Date(from.getTime());
  candidate.setHours(time.hours, time.minutes, 0, 0);
  if (candidate.getTime() < from.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
    // Re-applied after the date moves. Across a daylight-saving boundary the
    // day-shift alone can land on 07:00 or 09:00, and the wall time is the
    // thing the person set.
    candidate.setHours(time.hours, time.minutes, 0, 0);
  }
  return candidate;
}

/** What one tick decided for one agent. */
export type ScheduleDecision =
  | { kind: "idle" }
  /** Fire now, for this window. */
  | { kind: "due"; due_at: Date }
  /**
   * One or more windows came round while nothing was watching.
   *
   * `count` is how many, and `due_at` is the newest of them — the one a person
   * would say was "missed today". The older ones are covered by the count rather
   * than by a row each, ADR 0029 decision 7's own bound.
   */
  | { kind: "missed"; due_at: Date; count: number };

/**
 * Decide what this tick owes this schedule.
 *
 * `since` is the newest window DASH already has a record of, or null for a
 * schedule nothing has ever settled. It arrives from DASH on the push rather
 * than being remembered by the runner, which is what lets a runner that has just
 * started know where to resume from while holding nothing across a restart — ADR
 * 0029 decision 2.
 *
 * ## Why the newest due window fires and the older ones do not
 *
 * A machine that was off from Monday to Thursday reaches this function with
 * three unsettled windows. Exactly one thing is offered — *these were missed* —
 * and no run is started, because ADR 0029 decision 7 refuses backfill: an 08:00
 * news run delivered at 14:20 is a stale artifact with a fresh timestamp, and
 * three of them at once is a person's laptop starting three agents because they
 * went away for the weekend.
 *
 * The newest window is the only one that can be `due`, and only while it is
 * inside the grace period.
 */
export function decideSchedule(
  schedule: AgentSchedule,
  since: Date | null,
  now: Date,
): ScheduleDecision {
  if (!schedule.enabled || schedule.kind !== "daily") {
    return { kind: "idle" };
  }
  if (parseLocalTime(schedule.at_local) === null) {
    return { kind: "idle" };
  }

  /*
   * Windows before the person set the schedule are not windows. A schedule
   * created at 14:00 for 08:00 daily is next due tomorrow morning, and a first
   * tick that reported this morning as missed would be DASH complaining about
   * a window that predates the instruction.
   */
  const created = new Date(schedule.created_at);
  const createdMs = Number.isNaN(created.getTime()) ? now.getTime() : created.getTime();
  const floorMs = Math.max(
    createdMs,
    since?.getTime() ?? Number.NEGATIVE_INFINITY,
    now.getTime() - MAX_LOOKBACK_MS,
  );

  let cursor = nextDueAfter(schedule, new Date(floorMs));
  if (cursor === null) {
    return { kind: "idle" };
  }
  /*
   * `nextDueAfter` returns the window at or after its argument, so a `since`
   * that *is* a due moment would be handed back unchanged and settled twice.
   * Stepping past it here rather than making `nextDueAfter` exclusive keeps that
   * function answering the question its name asks.
   */
  if (since !== null && cursor.getTime() <= since.getTime()) {
    cursor = nextDueAfter(schedule, new Date(since.getTime() + 60_000));
    if (cursor === null) {
      return { kind: "idle" };
    }
  }

  if (cursor.getTime() > now.getTime()) {
    return { kind: "idle" };
  }

  // Walk to the newest window that has already come round, counting as we go.
  let count = 0;
  let newest = cursor;
  while (cursor !== null && cursor.getTime() <= now.getTime()) {
    count += 1;
    newest = cursor;
    cursor = nextDueAfter(schedule, new Date(cursor.getTime() + 60_000));
  }

  const late = now.getTime() - newest.getTime();
  if (count === 1 && late <= SCHEDULE_GRACE_MS) {
    return { kind: "due", due_at: newest };
  }
  return { kind: "missed", due_at: newest, count };
}

/**
 * The sentence a missed window is recorded with.
 *
 * Here rather than in the runner because it is copy, and copy in this repository
 * is pure and tested. It names the machine's own state as the cause without
 * claiming to know which of asleep, off or restarted it was — the runner cannot
 * tell those apart, and a row that picked one would be a guess rendered as a
 * fact.
 */
export function missedRowFor(
  agent: string,
  due: Date,
  count: number,
  now: Date,
): ScheduleSettlement {
  return {
    agent,
    due_at: due.toISOString(),
    settled_at: now.toISOString(),
    outcome: "missed",
    detail:
      count === 1
        ? "This computer was asleep, off, or restarting when this run was due, so nothing started. DASH does not run it late."
        : `${String(count)} scheduled runs came round while this computer was asleep, off, or restarting. DASH does not run them late.`,
  };
}
