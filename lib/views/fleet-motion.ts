/**
 * What each O is doing, derived from what its agent is actually doing (MAR-544).
 *
 * ## The rule this module exists to enforce
 *
 * Henrik's issue states it as a hard rule and it is the only thing that makes
 * the feature honest: **motion signals real state, or it doesn't run.** An O
 * that looks busy while its agent is asleep is a lie, and lies are the one
 * thing DASH doesn't ship. So the behaviour is a pure function of signals the
 * store actually holds, there is no randomness anywhere in it, and every
 * branch below names the fact it reads.
 *
 * ## This supersedes MAR-503's "presence, not telemetry" — deliberately
 *
 * `lib/views/fleet-strip.ts` argued that a single-frame character invented
 * into motion would be motion pretending to be state. That argument was about
 * *decorative* motion, and it still holds: nothing here invents a frame, a
 * random fidget, or a loop that runs while nothing happens. What Henrik asked
 * for in MAR-544 is the opposite thing — motion that *is* state, the fleet's
 * health read ambiently, as behaviour, without reading a word of text. The
 * sprites stay the vendored single frames; what moves is the box they are
 * drawn in, on `--motion-*` tokens, so `prefers-reduced-motion` stills the
 * whole fleet for free and the strip degrades to exactly what it was before
 * this module existed.
 *
 * ## The four behaviours, and the facts they read
 *
 * - `waiting` — a decision is sitting in the work inbox for this agent, or the
 *   agent is stalled past its own schedule. The person is the blocker, so this
 *   outranks everything: an agent that is working *and* waiting for an answer
 *   is shown asking for the answer.
 * - `working` — a run is in flight right now (`RunStatus === "running"`).
 * - `walking` — idle, but recently active: something ran within the last hour.
 *   The agent is "up and about".
 * - `sleeping` — idle and quiet for over an hour, or never run. Rendered as
 *   stillness: sleep is the one state whose honest animation is none.
 */

import type { RunRow, StalledAgentRow, WorkInboxRow } from "./types";

export const FLEET_MOTIONS = ["waiting", "working", "walking", "sleeping"] as const;

export type FleetMotion = (typeof FLEET_MOTIONS)[number];

/**
 * How recently an agent must have done anything to be "up and about".
 *
 * One hour, and the number is a design choice rather than a measurement — the
 * distinction it draws is "this did something while you were here" against
 * "this has been quiet all afternoon", which is a human sense of recency, not
 * a protocol constant. It is exported so the test and the strip cannot drift.
 */
export const FLEET_RECENT_MS = 60 * 60 * 1000;

/** The real signals one agent's behaviour is derived from. */
export interface FleetMotionSignals {
  /** A run of this agent's is in flight right now. */
  running: boolean;
  /** A choice or approval is waiting on the person, or the agent is stalled. */
  needs_decision: boolean;
  /** When this agent last did anything DASH heard about, or null for never. */
  last_event_at: string | null;
}

/**
 * Collect the signals for one agent out of the two views that carry them.
 *
 * Null views are the degraded case, not an error: the strip renders on every
 * page, and a runs read that failed should cost the fleet its motion — every
 * agent stands still, exactly the pre-MAR-544 strip — rather than cost the
 * page its bottom edge or, worse, invent a behaviour from data it does not
 * have.
 */
export function fleetMotionSignals(
  agent: string,
  runs: readonly RunRow[] | null,
  inbox: { items: readonly WorkInboxRow[]; stalled: readonly StalledAgentRow[] } | null,
): FleetMotionSignals {
  const own = (runs ?? []).filter((run) => run.agent === agent);
  let lastEventAt: string | null = null;
  for (const run of own) {
    if (lastEventAt === null || run.last_event_at > lastEventAt) {
      lastEventAt = run.last_event_at;
    }
  }
  return {
    running: own.some((run) => run.status === "running"),
    needs_decision:
      inbox !== null &&
      (inbox.items.some((item) => item.agent === agent) ||
        inbox.stalled.some((row) => row.agent === agent)),
    last_event_at: lastEventAt,
  };
}

/**
 * The behaviour, from the signals. Priority is the person's: a needed decision
 * outranks work in flight, because the person is what the agent is blocked on.
 */
export function fleetMotion(signals: FleetMotionSignals, now: Date): FleetMotion {
  if (signals.needs_decision) {
    return "waiting";
  }
  if (signals.running) {
    return "working";
  }
  if (signals.last_event_at !== null) {
    const at = Date.parse(signals.last_event_at);
    if (Number.isFinite(at) && now.getTime() - at < FLEET_RECENT_MS) {
      return "walking";
    }
  }
  return "sleeping";
}

/**
 * The caption under the strip, now carrying the counts the motion draws.
 *
 * This is the disclosure half of "nothing moves or refreshes without saying it
 * did": the behaviour is ambient, and the sentence beside it says the same
 * facts in words. Counts of zero say nothing — a strip whose whole fleet is
 * asleep reads "3 agents", not "3 agents · 0 working", because a zero is a
 * number nobody asked about.
 */
export function describeFleetActivity(
  total: number,
  overflow: number,
  working: number,
  waiting: number,
): string {
  const parts = [total === 1 ? "1 agent" : `${String(total)} agents`];
  if (waiting > 0) {
    parts.push(waiting === 1 ? "1 waiting for you" : `${String(waiting)} waiting for you`);
  }
  if (working > 0) {
    parts.push(working === 1 ? "1 working" : `${String(working)} working`);
  }
  if (overflow > 0) {
    parts.push(`${String(overflow)} not shown`);
  }
  return parts.join(" · ");
}
