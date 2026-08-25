/**
 * Reading and writing a schedule, and the record of what became of one
 * (MAR-742 item 8, ADR 0029).
 *
 * The impure half of `lib/schedule/plan.ts`, in `lib/ai/model-store.ts`'s shape:
 * it stores decisions that module already made and reads them back for whoever
 * is drawing a control. **No policy lives here.** A function in this file that
 * decided whether a window counted as missed would be a second authority beside
 * `decideSchedule`, free to drift from it, on the one path where nobody is
 * watching.
 *
 * ## Absence is the default
 *
 * There is no row for an agent nobody has scheduled, and reading one returns
 * `null` rather than a disabled row somebody has to interpret. Turning a schedule
 * off **deletes** the row rather than writing `enabled = 0` into it: `off` and
 * `never asked for` are the same state to every reader, and keeping two
 * representations of it would mean every caller either checked both or was
 * quietly wrong about one. `notify_discord`'s own rule.
 *
 * ## Every value is re-checked on the way out
 *
 * `readNotificationSettings`' discipline, and it earns its place here more than
 * anywhere: these columns are on the user's own disk, this is the module that
 * decides what time an agent gets started at, and a value that would not have
 * been accepted going in must not become a cadence on the strength of having
 * been written once. A row whose `at_local` no longer parses reads as no
 * schedule at all.
 */

import { db } from "../db";
import { isSpendOperation, operationById } from "../broker/operations";
import {
  allowanceCalls,
  isLocalTime,
  MAX_SCHEDULE_ALLOWANCE_CALLS,
  type AgentSchedule,
  type ScheduleSettlement,
} from "./plan";

/**
 * How many settled windows are kept per agent.
 *
 * Thirty — about a month of a daily schedule, which is the span over which "has
 * this been running?" is a question somebody actually asks. Pruned at the write
 * rather than by anything sweeping later, `chief_turn_spool`'s reason: a bound
 * enforced where rows arrive cannot be a bound somebody forgets to run.
 */
export const MAX_SCHEDULE_RUNS_KEPT = 30;

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function toSchedule(row: Record<string, unknown>): AgentSchedule | null {
  const agent = text(row, "agent");
  const at = text(row, "at_local");
  const kind = text(row, "kind");
  // The three re-checks. A row failing any of them is a row this build could not
  // have written, and reporting "no schedule" is the weaker claim — which is the
  // right one for a value DASH did not produce.
  if (agent.length === 0 || kind !== "daily" || !isLocalTime(at)) {
    return null;
  }
  return {
    agent,
    enabled: Number(row["enabled"] ?? 0) === 1,
    kind: "daily",
    at_local: at,
    created_at: text(row, "created_at"),
    /*
     * The fourth re-check, and the one this module's header is most about
     * (MAR-784). `allowanceCalls` answers zero for anything it does not
     * recognise, so a column somebody widened with a database browser reads back
     * as the no-spend default rather than as permission to spend that much.
     */
    allowance_calls: allowanceCalls(Number(row["allowance_calls"] ?? 0)),
  };
}

/** One agent's schedule, or null for an agent nobody has scheduled. */
export function readAgentSchedule(agent: string): AgentSchedule | null {
  const row = db()
    .prepare(
      "SELECT agent, enabled, kind, at_local, created_at, allowance_calls " +
        "FROM agent_schedules WHERE agent = ?",
    )
    .get(agent) as Record<string, unknown> | undefined;
  return row === undefined ? null : toSchedule(row);
}

/**
 * Every schedule DASH holds, for the push to the runner.
 *
 * Disabled rows are included rather than filtered here. The runner is what
 * decides whether to fire — `decideSchedule` reads `enabled` as its first line —
 * and a push that pre-filtered would leave a runner still holding a schedule the
 * person had just switched off, waiting for a push that said nothing about it.
 * Sending the whole set every time is what makes the re-assertion in ADR 0029
 * decision 2 total rather than incremental.
 */
export function readAgentSchedules(): AgentSchedule[] {
  return db()
    .prepare(
      "SELECT agent, enabled, kind, at_local, created_at, allowance_calls " +
        "FROM agent_schedules ORDER BY agent",
    )
    .all()
    .map((row) => toSchedule(row as Record<string, unknown>))
    .filter((schedule): schedule is AgentSchedule => schedule !== null);
}

/**
 * Set — or replace — one agent's schedule.
 *
 * Refuses a time this build would not accept rather than storing it, because the
 * alternative is a row that reads back as "no schedule" from `toSchedule` while
 * the person who typed it is looking at a page that said it saved.
 *
 * `created_at` is **not** rewritten when an existing schedule's time changes, and
 * that is deliberate: it is the floor `decideSchedule` measures missed windows
 * from, and resetting it on every edit would erase the record of a window that
 * was missed before somebody adjusted the minute.
 */
export function writeAgentSchedule(
  agent: string,
  atLocal: string,
  now: string,
  allowance = 0,
): { ok: boolean; refusal?: string } {
  if (agent.trim().length === 0) {
    return { ok: false, refusal: "A schedule has to name an agent." };
  }
  if (!isLocalTime(atLocal)) {
    return { ok: false, refusal: "A daily schedule needs a time of day written as HH:MM." };
  }
  /*
   * MAR-784. Refused rather than quietly reduced, unlike every *read* of this
   * column, and the asymmetry is deliberate. A value arriving here came from a
   * person pressing Save on a panel, so silently storing a different number than
   * the one on screen would be the page lying about what it saved. A value
   * arriving from the column came from a disk, where the honest response to
   * something unrecognised is the safe default and no sentence at all.
   */
  if (!Number.isInteger(allowance) || allowance < 0 || allowance > MAX_SCHEDULE_ALLOWANCE_CALLS) {
    return {
      ok: false,
      refusal:
        `A scheduled run may be allowed between 0 and ${String(MAX_SCHEDULE_ALLOWANCE_CALLS)} ` +
        "model calls.",
    };
  }
  db()
    .prepare(
      "INSERT INTO agent_schedules (agent, enabled, kind, at_local, created_at, allowance_calls) " +
        "VALUES (?, 1, 'daily', ?, ?, ?) " +
        "ON CONFLICT(agent) DO UPDATE SET enabled = 1, kind = 'daily', " +
        "at_local = excluded.at_local, allowance_calls = excluded.allowance_calls",
    )
    .run(agent, atLocal.trim(), now, allowance);
  return { ok: true };
}

/**
 * Turn a schedule off, which is to delete it.
 *
 * The settled windows are deliberately **kept**. They are the record of what
 * DASH did while somebody was not watching, and a person switching a cadence off
 * because it kept failing is exactly the person who wants to still be able to
 * read why. `forgetAgent` is what clears them, because that is the act that
 * removes the thing they are about.
 */
export function clearAgentSchedule(agent: string): { ok: boolean } {
  db().prepare("DELETE FROM agent_schedules WHERE agent = ?").run(agent);
  return { ok: true };
}

/**
 * The newest window DASH has a record of, per agent.
 *
 * Pushed to the runner with the schedules so a runner that has just started
 * knows where to resume from. Without it a fresh runner would either re-settle
 * every window back to the schedule's creation, or hold a cursor of its own
 * across restarts — and the second is the thing ADR 0029 decision 1 refuses.
 */
export function newestScheduleWindows(): Record<string, string> {
  const rows = db()
    .prepare("SELECT agent, MAX(due_at) AS newest FROM agent_schedule_runs GROUP BY agent")
    .all() as Record<string, unknown>[];
  const seen: Record<string, string> = {};
  for (const row of rows) {
    const agent = text(row, "agent");
    const newest = text(row, "newest");
    if (agent.length > 0 && newest.length > 0) {
      seen[agent] = newest;
    }
  }
  return seen;
}

/**
 * Take what the runner settled while DASH was closed.
 *
 * Returns how many rows were written, so the caller can say nothing at all on
 * the ordinary tick where the answer is zero.
 *
 * De-duplicated on `(agent, due_at)` rather than trusted to arrive once. The
 * spool is drained read-then-delete in one transaction so a duplicate should be
 * impossible, but *should be impossible* is not the standard for a row that
 * would show a person the same run twice and make a schedule look like it
 * double-fired — which is the first thing anybody would suspect of a scheduler.
 */
export function recordScheduleRuns(settlements: readonly ScheduleSettlement[]): number {
  if (settlements.length === 0) {
    return 0;
  }
  const database = db();
  const insert = database.prepare(
    "INSERT INTO agent_schedule_runs (agent, due_at, settled_at, outcome, detail, allowance_calls) " +
      "SELECT ?, ?, ?, ?, ?, ? " +
      "WHERE NOT EXISTS (SELECT 1 FROM agent_schedule_runs WHERE agent = ? AND due_at = ?)",
  );
  const prune = database.prepare(
    "DELETE FROM agent_schedule_runs WHERE agent = ? AND id NOT IN " +
      "(SELECT id FROM agent_schedule_runs WHERE agent = ? ORDER BY due_at DESC, id DESC LIMIT ?)",
  );

  let written = 0;
  const touched = new Set<string>();
  for (const settlement of settlements) {
    if (settlement.agent.length === 0 || settlement.due_at.length === 0) {
      continue;
    }
    const result = insert.run(
      settlement.agent,
      settlement.due_at,
      settlement.settled_at,
      settlement.outcome,
      settlement.detail,
      /*
       * MAR-784. Re-checked here even though the runner already checked it, for
       * `readScheduleConfiguration`'s reason pointed the other way down the
       * channel: this is the boundary between a number another process sent and
       * a number DASH's own store will report back as what it permitted.
       */
      allowanceCalls(settlement.allowance_calls),
      settlement.agent,
      settlement.due_at,
    );
    if (Number(result.changes) > 0) {
      written += 1;
      touched.add(settlement.agent);
    }
  }
  for (const agent of touched) {
    prune.run(agent, agent, MAX_SCHEDULE_RUNS_KEPT);
  }
  return written;
}

/** What became of this agent's recent windows, newest first. */
export function readScheduleRuns(agent: string, limit = MAX_SCHEDULE_RUNS_KEPT): ScheduleSettlement[] {
  return db()
    .prepare(
      "SELECT agent, due_at, settled_at, outcome, detail, allowance_calls " +
        "FROM agent_schedule_runs WHERE agent = ? ORDER BY due_at DESC, id DESC LIMIT ?",
    )
    .all(agent, limit)
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      const outcome = text(row, "outcome");
      return {
        agent: text(row, "agent"),
        due_at: text(row, "due_at"),
        settled_at: text(row, "settled_at"),
        // Re-checked on the way out, this module's own discipline: an unknown
        // value renders as `refused`, which is the honest reading of "DASH wrote
        // something here and this build does not recognise it".
        outcome:
          outcome === "ran" || outcome === "missed" || outcome === "refused" ? outcome : "refused",
        detail: text(row, "detail"),
        allowance_calls: allowanceCalls(Number(row["allowance_calls"] ?? 0)),
      };
    });
}

/**
 * What a scheduled run actually spent, counted from the rows DASH already writes
 * (MAR-784).
 *
 * ## Why this is counted and not recorded
 *
 * The obvious implementation is a `spent_calls` column on `agent_schedule_runs`,
 * written when the run ends. It is refused, and the reason is the one ADR 0029
 * decision 8 gives for the spool existing at all: **the party that would report
 * the number is the party being reported on.** A run's end reaches DASH as a
 * `run_completed` event the agent emits, so a spend count written from it would
 * be a child process telling DASH how much of somebody's money it had used.
 *
 * `broker_audit` is the opposite kind of fact. DASH's broker writes one row per
 * adjudicated request, at the moment it adjudicates, and it writes the refusals
 * too. So the answer to *"what did last night's run cost, and did it run out?"*
 * is already in the store, written by the only party that could know, and this
 * function reads it rather than asking anybody.
 *
 * ## The window
 *
 * From the moment the runner settled the window to `SPEND_ALLOWANCE_MS` after it,
 * which is the exact life of the allowance the fire opened. Bounding it by the
 * allowance rather than by "until the next scheduled run" is what stops a press
 * of Run now at nine in the morning being counted against the 03:00 schedule —
 * that press opens its own allowance and its calls land outside this window.
 *
 * The imprecision that remains is stated rather than papered over: a person who
 * presses Run now *within ten minutes of a scheduled fire* has their press
 * counted here too. DASH cannot tell those apart — `broker_audit` records which
 * agent and which operation, never which press — and the alternative is a
 * request that carries its own provenance, which is the one thing
 * `BrokerOrigin` exists to refuse.
 */
export interface ScheduleSpend {
  /** Spend calls this window's allowance actually paid for. */
  allowed: number;
  /**
   * Spend calls refused for want of an allowance in the same window.
   *
   * Non-zero is the ceiling being reached: the fire opened an allowance, the
   * agent spent it, and the next model step was refused with the same
   * `needs_a_person` a schedule with no allowance at all gets. That equivalence
   * is deliberate — see ADR 0029 amendment 1 — and this counter is how a person
   * finds out it happened without reading a log.
   */
  refused: number;
}

export function readScheduleSpend(
  agent: string,
  from: string,
  windowMs: number,
): ScheduleSpend {
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) {
    return { allowed: 0, refused: 0 };
  }
  const until = new Date(start.getTime() + windowMs).toISOString();

  const rows = db()
    .prepare(
      "SELECT operation, decision FROM broker_audit " +
        "WHERE agent = ? AND decided_at >= ? AND decided_at < ?",
    )
    .all(agent, start.toISOString(), until) as Record<string, unknown>[];

  let allowed = 0;
  let refused = 0;
  for (const row of rows) {
    /*
     * Resolved through the catalogue rather than matched on the id's shape. A
     * `LIKE '%.digest.curate'` would have counted one of the three spend
     * operations and silently missed the other two the day a plan used them —
     * `isSpendOperation` is the predicate the broker itself charges by, and
     * asking the same question here is what keeps the receipt and the charge in
     * agreement.
     */
    const operation = operationById(text(row, "operation"));
    if (operation === null || !isSpendOperation(operation)) {
      continue;
    }
    if (text(row, "decision") === "allowed") {
      allowed += 1;
    } else {
      refused += 1;
    }
  }
  return { allowed, refused };
}
