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
import type { ScheduleOutcome, ScheduleSettlement } from "../schedule/plan";
import type { AgentSchedule } from "../schedule/plan";

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
  /** ADR 0029 decision 6, shown only when one is standing. */
  no_spend: string;
  /** The newest settled window, or null for a schedule that has not come round. */
  last: ScheduleRunView | null;
  /** How many settled windows there are in total, this one included. */
  settled_count: number;
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
): AgentScheduleView {
  const standing = schedule !== null && schedule.enabled;
  const newest = settled[0] ?? null;

  return {
    at_local: standing ? schedule.at_local : null,
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
    no_spend: standing ? AGENT_TRIGGER_COPY.no_spend : "",
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
          },
    settled_count: settled.length,
  };
}
