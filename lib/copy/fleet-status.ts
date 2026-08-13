/**
 * The one status a fleet card draws, from facts the row already holds.
 *
 * Henrik, 2026-08-13, looking at a filter of Working / Needs input / Ready for
 * review / Completed: those four on the card, as icons, showing the correct
 * state. This module is the mapping. It does not invent a fifth.
 *
 * ## What each label is allowed to mean
 *
 * MAR-547's ruling still holds: every mark is a recorded fact. The four names
 * are Henrik's; the facts behind them are DASH's:
 *
 * - **Needs input** — a glance chip of `needs_you` (an approval or a choice
 *   waiting). Same priority `lib/views/fleet-motion.ts` already settled: the
 *   person is the blocker, so this outranks a run in flight.
 * - **Working** — a run of this agent's is in flight (`running` on the row).
 * - **Ready for review** — a glance chip of `new_output`.
 * - **Completed** — the agent has run, nothing is waiting, and it is not
 *   working. An agent that has never run is not completed; this returns null
 *   rather than stretching "nothing needs you" over a first-run card.
 *
 * One mark, not four. A card that stacked every true chip would be the text
 * we just took off it.
 *
 * Pure: no clock, no store. `running` arrives already decided.
 */

import type { GlanceChip } from "./glance";

export const FLEET_CARD_STATUSES = [
  "needs_input",
  "working",
  "ready_for_review",
  "completed",
] as const;

export type FleetCardStatus = (typeof FLEET_CARD_STATUSES)[number];

export interface FleetCardStatusView {
  id: FleetCardStatus;
  /** Two or three ordinary words. Caps are typography. */
  label: string;
}

export interface FleetCardStatusFacts {
  /** A run of this agent's is in flight right now. */
  running: boolean;
  /** How many times it has worked. Zero means it has never run. */
  run_count: number;
  glance: readonly GlanceChip[];
}

/**
 * The one status to draw, or null when none of the four is true.
 */
export function describeFleetCardStatus(facts: FleetCardStatusFacts): FleetCardStatusView | null {
  if (facts.glance.some((chip) => chip.question === "needs_you")) {
    return { id: "needs_input", label: "Needs input" };
  }
  if (facts.running) {
    return { id: "working", label: "Working" };
  }
  if (facts.glance.some((chip) => chip.question === "new_output")) {
    return { id: "ready_for_review", label: "Ready for review" };
  }
  if (facts.run_count > 0) {
    return { id: "completed", label: "Completed" };
  }
  return null;
}

/**
 * Where this agent runs, as two words.
 *
 * `hosted_on` is DASH's own record of sending the agent to a server (MAR-606).
 * Empty means it lives on this computer. That is not a live sighting — ADR 0015
 * still forbids a present-tense "is running on the VPS" from a deploy date.
 */
export function describeFleetPlace(hostedOn: readonly unknown[]): { id: "cloud" | "local"; label: string } {
  return hostedOn.length > 0
    ? { id: "cloud", label: "Cloud" }
    : { id: "local", label: "Local" };
}
