/**
 * What the Settings stage says about a schedule (MAR-742 item 8, ADR 0029).
 *
 * Pure, and it decides nothing about *when* — `lib/schedule/plan.ts` owns that.
 * What this owns is the sentence a person reads, which is a separate job with a
 * separate failure mode: the planner being right and the page saying something
 * else is the specific way a scheduler loses somebody's trust, because the only
 * evidence they have is the sentence.
 *
 * ## Why the last outcome is a projection and not a list
 *
 * `agent_schedule_runs` keeps a month. The panel shows the newest one and a
 * count of what is behind it, because the question a person opens this drawer
 * with is *"is it running?"* and a table of thirty rows answers a different one.
 * The whole set is still in the store for anything that wants it later; nothing
 * here throws it away.
 *
 * ## The relative stamp
 *
 * Rendered from a `now` the caller passes rather than read here, `lib/views`'
 * rule throughout: a module that read its own clock could not be tested at the
 * boundaries that matter, and the boundaries that matter for a daily schedule
 * are exactly the ones around midnight.
 */

import { AGENT_TRIGGER_COPY } from "../copy/agent-page";
import { DEFAULT_SCHEDULE_ALLOWANCE_CALLS } from "../schedule/plan";
import type { ScheduleOutcome, ScheduleSettlement } from "../schedule/plan";
import type { AgentSchedule } from "../schedule/plan";
import type { ScheduleSpend } from "../schedule/store";

/** One settled window, worded. */
export interface ScheduleRunView {
  due_at: string;
  outcome: ScheduleOutcome;
  /** "Ran", "Missed" or "Did not start". */
  outcome_label: string;
  /**
   * Which of DASH's three existing status chips this wears.
   *
   * Decided here rather than by the component, and named after the tone rather
   * than after this feature, so that a settled window uses the same three
   * colours every other status in the product uses. A fourth palette named
   * `schedule-*` would be three more places for DASH's status colours to drift
   * apart, which is the drift `.chip-ok` and its two siblings were factored out
   * to stop.
   */
  outcome_tone: "ok" | "warn" | "err";
  detail: string;
  /**
   * What this window was allowed, and what it actually used (MAR-784).
   *
   * Null for every window that was allowed nothing, which is every window under
   * ADR 0029 decision 6's default. Absent rather than a pair of zeroes, for
   * `AgentScheduleView.liveness`' stated reason: a "used 0 of 0" line under a
   * schedule nobody opted in for would be DASH reporting on a budget the person
   * never set.
   */
  spend: {
    allowed: number;
    used: number;
    /** The sentence, already worded. */
    line: string;
    /** Set only when the run ran out, which is the degrade worth naming. */
    ceiling_line: string | null;
  } | null;
}

/**
 * Everything the trigger panel needs, in one document.
 *
 * Never absent, so a page cannot have to decide what a missing field means —
 * `AgentModelSettingsView`'s rule. An agent nobody has scheduled gets
 * `at_local: null` and the "no schedule" sentence, which is the ordinary state
 * rather than a gap.
 */
export interface AgentScheduleView {
  /** `HH:MM`, or null when nothing is standing. */
  at_local: string | null;
  /** The sentence at the top of the panel, either way. */
  standing_line: string;
  /** ADR 0029's three liveness sentences. Shown only when one is standing. */
  liveness: readonly string[];
  /**
   * Whether this schedule may spend, and how much (MAR-784).
   *
   * Zero is the default and the honest reading of "no". Read from the schedule
   * row rather than from anything the runner reported, because this is the
   * control's own state — what the switch is set to, which is a question about
   * DASH's store and never about what happened last night.
   */
  allowance_calls: number;
  /** What the switch should offer when it is turned on. */
  allowance_choice: number;
  /**
   * The money sentences, shown only when a schedule is standing (ADR 0029
   * decision 6 and amendment 1).
   *
   * One or two: `spend_line` is always there and swaps between the no-spend
   * sentence and the allowance one, and `spend_bound` is the "only while DASH is
   * open" sentence that appears only when there is an allowance for it to bound.
   */
  spend_line: string;
  spend_bound: string;
  /** The newest settled window, or null for a schedule that has not come round. */
  last: ScheduleRunView | null;
  /** How many settled windows there are in total, this one included. */
  settled_count: number;
}

/**
 * The receipt for one window, or null.
 *
 * Null in three cases and they are one case: this window was allowed nothing, or
 * DASH holds no count for it, or it is not the window the count was measured
 * over. Only the newest settled window gets a `spend` at all — see
 * `buildAgentScheduleView` — because `readScheduleSpend` measures one window and
 * pretending an older row's receipt had also been read would be a number with
 * nothing behind it.
 */
function spendFor(
  settlement: ScheduleSettlement,
  spend: ScheduleSpend | null,
): ScheduleRunView["spend"] {
  if (settlement.allowance_calls <= 0 || spend === null) {
    return null;
  }
  return {
    allowed: settlement.allowance_calls,
    used: spend.allowed,
    line: AGENT_TRIGGER_COPY.spent(spend.allowed, settlement.allowance_calls),
    /*
     * The ceiling is reported as hit when DASH refused a spend in the window,
     * not when `used === allowed`. Those come apart in the case that matters: an
     * agent whose plan needed exactly its two calls used both and asked for no
     * third, and telling that person their run was cut short would be DASH
     * inventing a degrade out of arithmetic. A refusal is a row DASH wrote.
     */
    ceiling_line:
      spend.refused > 0 ? AGENT_TRIGGER_COPY.ceiling_hit(settlement.allowance_calls) : null,
  };
}

function outcomeLabel(outcome: ScheduleOutcome): string {
  if (outcome === "ran") {
    return AGENT_TRIGGER_COPY.outcome.ran;
  }
  if (outcome === "missed") {
    return AGENT_TRIGGER_COPY.outcome.missed;
  }
  return AGENT_TRIGGER_COPY.outcome.refused;
}

/**
 * `missed` is a warning and not an error, which is the whole distinction the
 * two values carry.
 *
 * A missed window means the computer was not there — nothing is broken, and
 * colouring it red would tell somebody to go and fix a laptop that was asleep
 * because they closed it. `refused` is the one where DASH tried and something
 * said no, and that is the one worth red.
 */
function outcomeTone(outcome: ScheduleOutcome): "ok" | "warn" | "err" {
  if (outcome === "ran") {
    return "ok";
  }
  return outcome === "missed" ? "warn" : "err";
}

export function buildAgentScheduleView(
  schedule: AgentSchedule | null,
  settled: readonly ScheduleSettlement[],
  /**
   * What the newest settled window actually spent, or null (MAR-784).
   *
   * Passed in rather than read here, `lib/views`' rule about the clock applied
   * to a store: this module is pure, and the caller — `lib/views/build.ts` — is
   * the half that already knows how to open `broker_audit`. Null is the ordinary
   * value for a build with no allowance anywhere and for every test that does
   * not care, and it renders as no receipt rather than as a zero.
   */
  spend: ScheduleSpend | null = null,
): AgentScheduleView {
  const standing = schedule !== null && schedule.enabled;
  const newest = settled[0] ?? null;
  /*
   * Read off the row, not derived from anything else. A person who switches a
   * schedule off has the row deleted (`clearAgentSchedule`), so there is no
   * state in which a ceiling outlives the schedule it belonged to — and reading
   * the field straight means the panel's switch reflects the store rather than a
   * guess about it.
   */
  const allowance = standing ? schedule.allowance_calls : 0;

  return {
    at_local: standing ? schedule.at_local : null,
    allowance_calls: allowance,
    allowance_choice: DEFAULT_SCHEDULE_ALLOWANCE_CALLS,
    standing_line: standing
      ? AGENT_TRIGGER_COPY.standing(schedule.at_local)
      : AGENT_TRIGGER_COPY.none_standing,
    /*
     * Empty when nothing is standing, and that is a decision rather than a
     * saving. The three liveness sentences are about what will happen to *your
     * schedule*; printing them under a panel that has none would be DASH
     * explaining the limits of a feature the person has not asked for, which is
     * the "describing its own internals at somebody" failure `ModelChoice`
     * names.
     */
    liveness: standing ? AGENT_TRIGGER_COPY.liveness : [],
    /*
     * The swap, and the whole of MAR-784's copy item 4. Which sentence is on
     * screen is decided by the same number the runner enforces, so the panel
     * cannot say "cannot spend" about a schedule that can — which is the failure
     * a second copy of this condition would eventually produce.
     */
    spend_line: !standing
      ? ""
      : allowance > 0
        ? AGENT_TRIGGER_COPY.spend.allowed(allowance)
        : AGENT_TRIGGER_COPY.spend.none,
    /*
     * Only under the allowance sentence. Under the no-spend sentence it would be
     * bounding a permission that does not exist, which reads as DASH explaining
     * a limitation of something the person has not asked for — `ModelChoice`'s
     * "describing its own internals at somebody", which the `liveness` field
     * above already declines for the same reason.
     */
    spend_bound: standing && allowance > 0 ? AGENT_TRIGGER_COPY.spend.needs_dash_open : "",
    /*
     * The history survives the schedule being turned off — `clearAgentSchedule`
     * keeps the rows on purpose — so this is read whether or not one is
     * standing. Somebody who switched a cadence off because it kept failing is
     * exactly the person who still wants to see that it kept failing.
     */
    last:
      newest === null
        ? null
        : {
            due_at: newest.due_at,
            outcome: newest.outcome,
            outcome_label: outcomeLabel(newest.outcome),
            outcome_tone: outcomeTone(newest.outcome),
            detail: newest.detail,
            spend: spendFor(newest, spend),
          },
    settled_count: settled.length,
  };
}
