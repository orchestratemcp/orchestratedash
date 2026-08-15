/**
 * The rail's own filter over the fleet (MAR-640).
 *
 * `lib/views/fleet-view.ts` decides the *track* the cards are laid on; this
 * decides *which* cards are laid on it at all. The two compose the same way
 * view and density already do — somebody can want Rows and "Needs action"
 * together, or Grid and "Favourites" — so this is a setting of its own
 * rather than a fourth view.
 *
 * ## Where the six options come from
 *
 * Henrik's own list: All, Needs action, Running, Ready, Not run, Favourites.
 * The middle four read the same one status `lib/copy/fleet-status.ts` already
 * draws on every portrait — this module invents no fifth fact, it only asks
 * which of the four a card is showing. "Favourites" is the one addition
 * MAR-640 makes to the store itself; see `AgentRow.favourite`.
 *
 * ## Counts are read from the whole fleet, never the filtered one
 *
 * The rail is a status summary as much as it is a control — "counts render
 * even unfiltered" is the issue's own instruction — so `fleetFilterCounts`
 * takes every agent DASH holds regardless of what is currently selected.
 * Filtering a list of counts down to the one row somebody is looking at
 * would turn the rail into a control that could no longer answer "what have
 * I got".
 *
 * ## Where the preference is kept
 *
 * Not the store. `lib/views/fleet-view.ts` and `lib/views/density.ts` both
 * make the same argument for their own setting and it holds again here: this
 * is genuinely per-window, has no audit consequence, and costs a schema
 * change for nothing SQLite is asked to account for.
 */

import { describeFleetCardStatus } from "../copy/fleet-status";
import type { AgentRow } from "./types";

export const FLEET_FILTERS = [
  "all",
  "needs_action",
  "running",
  "ready",
  "not_run",
  "favourites",
] as const;

export type FleetFilter = (typeof FLEET_FILTERS)[number];

/** "All" is the default: a filter's first act must not hide anybody's fleet. */
export const DEFAULT_FLEET_FILTER: FleetFilter = "all";

/**
 * Where the preference is kept — `FLEET_VIEW_STORAGE_KEY`'s own reasoning:
 * one real origin in either host (MAR-432), so the same code reads and
 * writes it in both.
 */
export const FLEET_FILTER_STORAGE_KEY = "dash.fleetFilter";

/** The attribute `useFleetFilter`'s pre-paint script writes before first paint. */
export const FLEET_FILTER_ATTRIBUTE = "data-fleet-filter";

/**
 * Read a stored value back, refusing anything that is not one of ours.
 *
 * `parseFleetView`'s own reason: `localStorage` is a string bucket a user can
 * edit, so a stale or hand-edited entry falls back to "all" — showing
 * everybody — rather than to a filter that could quietly hide a fleet from
 * its own owner.
 */
export function parseFleetFilter(value: unknown): FleetFilter {
  return FLEET_FILTERS.includes(value as FleetFilter) ? (value as FleetFilter) : DEFAULT_FLEET_FILTER;
}

/** One word each, `describeFleetView`'s own reason: a row of six competing sentences is the wall of text Henrik has named on every surface since MAR-570. */
export function describeFleetFilter(filter: FleetFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "needs_action":
      return "Needs action";
    case "running":
      return "Running";
    case "ready":
      return "Ready";
    case "not_run":
      return "Not run";
    case "favourites":
      return "Favourites";
  }
}

/**
 * Whether one agent belongs to one filter.
 *
 * Pure and store-free: every fact it reads is already on the row —
 * `describeFleetCardStatus`'s own four statuses, and `favourite`, which
 * MAR-640 adds beside them. No agent can match two of the four status
 * filters at once, because `describeFleetCardStatus` already returns exactly
 * one status or none.
 */
export function matchesFleetFilter(filter: FleetFilter, agent: AgentRow): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "favourites") {
    return agent.favourite;
  }
  const status = describeFleetCardStatus({
    running: agent.running,
    run_count: agent.run_count,
    glance: agent.glance,
  })?.id ?? null;
  switch (filter) {
    case "needs_action":
      return status === "needs_input";
    case "running":
      return status === "working";
    case "ready":
      return status === "ready_for_review";
    case "not_run":
      return status === null;
    default:
      return true;
  }
}

/** How many agents match each filter, over the whole fleet — see this module's own header on why the whole fleet and never the filtered one. */
export function fleetFilterCounts(agents: readonly AgentRow[]): Record<FleetFilter, number> {
  const counts: Record<FleetFilter, number> = {
    all: agents.length,
    needs_action: 0,
    running: 0,
    ready: 0,
    not_run: 0,
    favourites: 0,
  };
  for (const agent of agents) {
    for (const filter of FLEET_FILTERS) {
      if (filter !== "all" && matchesFleetFilter(filter, agent)) {
        counts[filter] += 1;
      }
    }
  }
  return counts;
}
