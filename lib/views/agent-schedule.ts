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
  /**
   * The server whose runner keeps this schedule, or null for this computer
   * (MAR-874).
   *
   * ## The defect this exists for
   *
   * Every sentence this view composed named *this computer*, three times in
   * `liveness` alone, and for an agent DASH has enrolled on a server all of
   * them were about the wrong machine. `splitSchedules` in
   * `electron/host-residency.ts` takes an enrolled agent's schedule **out** of
   * the local runner's push and sends it to that server's own runner — one
   * instruction, one machine, deliberately — so the panel was promising a
   * helper on a laptop that is no longer told about this row, and warning about
   * that laptop being asleep when the laptop has nothing to do with it.
   *
   * A label rather than a host id, because everything it reaches is a sentence
   * a person reads. Null is the ordinary answer and stays the default:
   * residency is a switch that is off until somebody presses it, so an agent
   * merely *deployed* to a server still runs its schedule here.
   *
   * Carried on the view as well as consumed by it, so a surface that wants to
   * name the machine need not re-derive it, and so a test can assert the fact
   * separately from the sentences built out of it.
   */
  resident_on: string | null;
  /**
   * ADR 0029's three liveness sentences, worded for the machine that will
   * actually honour this schedule. Shown only when one is standing.
   */
  liveness: readonly string[];
  /**
   * The hint under the time field, worded for the same machine (MAR-874).
   *
   * On the view rather than read straight off `AGENT_TRIGGER_COPY` by the
   * renderer, because it has become a decision — which clock this number is
   * read by — and this module is where every other sentence about that decision
   * is taken. A component choosing between two constants would be a second
   * place the residency rule was expressed.
   *
   * **What it does not fix:** `at_local` still carries no timezone, and on a
   * server it still means that server's local time rather than the person's.
   * That conversion is MAR-872's. This sentence only stops naming the wrong
   * clock, which is the half that can be told truthfully today.
   */
  time_hint: string;
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
  /*
   * MAR-874. `refused` is amber now, and it was red.
   *
   * The argument above still stands for what red is *for* — DASH tried and
   * something said no — but it assumed the person could do something about the
   * no. On the case Henrik was actually looking at they cannot: a scheduled
   * window for an agent living on a server settles as *Did not start* because
   * the remote start is MAR-864's gap, and DASH painted that red on the
   * person's own Settings stage as though they had misconfigured something.
   *
   * Red on this page has to mean *you have something to fix*. A window nobody
   * could have made run is a thing to know, which is what amber already means
   * for `missed` one line up. **The sentence is unchanged** — `detail` still
   * says exactly what happened — so nothing is hidden by the colour being
   * honest about whose problem it is.
   *
   * The finer answer, a tone per refusal reason, needs the settlement to carry
   * one. It does not today, and inventing the distinction here would be this
   * module guessing at a fact `runner/schedule.ts` never sent.
   */
  return "warn";
}

/**
 * Which server, if any, keeps this agent's schedule (MAR-874).
 *
 * The read side of `splitSchedules`, expressed once so the panel and the push
 * cannot disagree about which machine an instruction went to. It answers the
 * same question that function answers — *is this agent on a host with residency
 * switched on* — and the two sets it is given are the same two
 * `readResidentHosts()` builds from.
 *
 * Pure and dependency-injected for this module's stated reason: `readHost` is a
 * store read, and a function here that performed one could not be tested
 * against a fixture. The caller passes the lookup.
 *
 * Null in every ordinary case: no residency anywhere, residency on a server this
 * agent was never sent to, or a host row DASH can no longer read. That last one
 * is deliberately not an error — a schedule with a machine DASH cannot name is
 * described as this computer's, which is the state the sentences were written
 * for and the one they are safe in.
 */
export function residentHostLabel(
  agent: string,
  hosts: readonly { host_id: string; agents: readonly string[] }[],
  labelOf: (hostId: string) => { label: string } | null,
): string | null {
  for (const host of hosts) {
    if (host.agents.includes(agent)) {
      const label = labelOf(host.host_id)?.label ?? "";
      if (label.length > 0) {
        return label;
      }
    }
  }
  return null;
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
  /**
   * The server this agent is enrolled on, or null for this computer (MAR-874).
   *
   * Passed in rather than read, `spend`'s reason and this module's own rule: the
   * answer lives in `readResidentHosts()`, which is a store read, and
   * `lib/views/build.ts` is the half that already opens it. Defaulted to null so
   * every existing caller and every test that does not care goes on describing
   * this computer, which is what they were pinning.
   */
  residentOn: string | null = null,
): AgentScheduleView {
  const standing = schedule !== null && schedule.enabled;
  /*
   * Null unless a schedule is actually standing. Naming a server under a panel
   * with no schedule would be DASH answering "where would this run" for a
   * cadence nobody has set, which is the same call `liveness` makes one field
   * down and for the same reason.
   */
  const host = standing ? residentOn : null;
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
    resident_on: host,
    standing_line: !standing
      ? AGENT_TRIGGER_COPY.none_standing
      : host === null
        ? AGENT_TRIGGER_COPY.standing(schedule.at_local)
        : AGENT_TRIGGER_COPY.standing_on_host(schedule.at_local, host),
    /*
     * MAR-874. The same sentence, about the clock that is actually read.
     *
     * Reads `residentOn` and not `host`, which is the one place in this function
     * the two must come apart. Every other sentence here describes a schedule
     * that exists; this one labels the field somebody is about to type a *new*
     * time into, and an enrolled agent's new schedule goes to its server the
     * moment it is saved. Saying "this computer's own clock" over that field
     * would be wrong at exactly the moment it is read.
     */
    time_hint:
      residentOn === null
        ? AGENT_TRIGGER_COPY.time_hint
        : AGENT_TRIGGER_COPY.time_hint_on_host(residentOn),
    /*
     * Empty when nothing is standing, and that is a decision rather than a
     * saving. The three liveness sentences are about what will happen to *your
     * schedule*; printing them under a panel that has none would be DASH
     * explaining the limits of a feature the person has not asked for, which is
     * the "describing its own internals at somebody" failure `ModelChoice`
     * names.
     */
    liveness: !standing
      ? []
      : host === null
        ? AGENT_TRIGGER_COPY.liveness
        : [
            /*
             * MAR-874. The same three facts about the machine that has the
             * schedule. Built here rather than by a fourth constant array, so
             * the three sentences and the three they replace stay in the same
             * order — a reader comparing the two states is comparing like for
             * like, and a renderer that only knows "three liveness sentences"
             * keeps working.
             */
            AGENT_TRIGGER_COPY.liveness_on_host.open(host),
            AGENT_TRIGGER_COPY.liveness_on_host.closed(host),
            AGENT_TRIGGER_COPY.liveness_on_host.asleep(host),
          ],
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
