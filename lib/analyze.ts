import type { AgentManifestBody, RunEvent } from "./contracts";

/**
 * Plan-vs-actual analysis: judge a run against the plan its manifest declared.
 *
 * This is the whole point of DASH. A generic agent dashboard can show you that a
 * run happened; only a monitor holding the plan can tell you the run went
 * somewhere the plan never authorised. Everything here is a pure function over
 * (manifest, events) so it is fully unit-testable and carries no I/O.
 *
 * DASH observes and reports. It cannot stop a remote agent, and nothing in this
 * module tries to — a violation is a finding, never an intervention.
 */

export type DriftKind = "missing_step" | "unplanned_step" | "order_violation";

export interface DriftFinding {
  kind: DriftKind;
  component_id: string;
  /** Short human-readable phrasing, safe to render directly as a chip label. */
  detail: string;
}

export interface GateViolation {
  /** The irreversible component that ran without an approval gate before it. */
  component_id: string;
  seq: number;
  ts: string;
}

export interface ClearanceFinding {
  clearance: string;
  detail: string;
}

export interface RunAnalysis {
  agent: string;
  run_id: string;
  /** Component ids of step_started events, in seq order. */
  executed_route: string[];
  drift: DriftFinding[];
  gate_violations: GateViolation[];
  clearance_findings: ClearanceFinding[];
  /** No gate violation and no clearance finding. Drift alone does not fail a run. */
  compliant: boolean;
}

/**
 * Clearance levels at or above L3 mean "a human is expected in the loop" —
 * L3 is an external write to a business system (human by default) and L4 is
 * money/legal/health/deletion/publish (always human). The MAR-298 acceptance
 * criterion names L3; L4 is included because excluding the *stricter* level
 * would let the highest-blast-radius plans run unattended unflagged.
 */
const ATTENDED_CLEARANCES = new Set(["L3", "L4"]);

function orderEvents(events: RunEvent[]): RunEvent[] {
  return [...events].sort((a, b) => a.seq - b.seq);
}

/**
 * Route drift: what the run executed versus what the plan said it would.
 *
 * Order violations are reported per component that arrives earlier in the run
 * than a planned step already executed — the plan is a sequence, so a step that
 * jumps its predecessor is drift even when every planned step eventually ran.
 */
function analyzeDrift(
  manifest: AgentManifestBody,
  executed: string[],
): DriftFinding[] {
  const plannedOrder = [...manifest.planned_route].sort((a, b) => a.step - b.step);
  const plannedIndex = new Map<string, number>();
  plannedOrder.forEach((entry, index) => {
    if (!plannedIndex.has(entry.component_id)) {
      plannedIndex.set(entry.component_id, index);
    }
  });

  const executedSet = new Set(executed);
  const drift: DriftFinding[] = [];

  for (const entry of plannedOrder) {
    if (!executedSet.has(entry.component_id)) {
      drift.push({
        kind: "missing_step",
        component_id: entry.component_id,
        detail: `planned step ${entry.step} never ran`,
      });
    }
  }

  const reportedUnplanned = new Set<string>();
  for (const component of executed) {
    if (!plannedIndex.has(component) && !reportedUnplanned.has(component)) {
      reportedUnplanned.add(component);
      drift.push({
        kind: "unplanned_step",
        component_id: component,
        detail: "ran but was never planned",
      });
    }
  }

  let highestSeen = -1;
  let highestComponent = "";
  for (const component of executed) {
    const index = plannedIndex.get(component);
    if (index === undefined) {
      // Unplanned steps have no position in the plan, so they cannot violate
      // its order; they are already reported as unplanned_step above.
      continue;
    }
    if (index < highestSeen) {
      drift.push({
        kind: "order_violation",
        component_id: component,
        detail: `ran after ${highestComponent}, but the plan orders it before`,
      });
    } else {
      highestSeen = index;
      highestComponent = component;
    }
  }

  return drift;
}

/**
 * Gate compliance — the headline check. Any step_started for a component the
 * manifest lists as irreversible, with no gate_resolved earlier in the same run,
 * is a violation: the agent took an unrecoverable action nobody approved.
 *
 * The check is run-scoped, matching the MAR-298 acceptance criterion: one
 * resolved gate clears the irreversible steps that follow it. The event schema
 * allows gate_resolved to carry a component_id, so a stricter per-component
 * pairing is expressible — see the DASH-04 notes in the PR for that follow-up.
 */
function analyzeGates(
  manifest: AgentManifestBody,
  ordered: RunEvent[],
): GateViolation[] {
  const irreversible = new Set(manifest.safety_contract.irreversible_components);
  const violations: GateViolation[] = [];
  let gateResolved = false;

  for (const event of ordered) {
    if (event.type === "gate_resolved") {
      gateResolved = true;
      continue;
    }
    if (
      event.type === "step_started" &&
      event.component_id !== undefined &&
      irreversible.has(event.component_id) &&
      !gateResolved
    ) {
      violations.push({
        component_id: event.component_id,
        seq: event.seq,
        ts: event.ts,
      });
    }
  }

  return violations;
}

/**
 * Clearance behavior: a plan that expects a human in the loop, executed with no
 * gate traffic at all, ran unattended against an attended plan.
 */
function analyzeClearance(
  manifest: AgentManifestBody,
  ordered: RunEvent[],
): ClearanceFinding[] {
  const clearance = manifest.safety_contract.automation_clearance;
  if (!ATTENDED_CLEARANCES.has(clearance)) {
    return [];
  }

  const sawGateTraffic = ordered.some(
    (event) => event.type === "gate_requested" || event.type === "gate_resolved",
  );
  if (sawGateTraffic) {
    return [];
  }

  return [
    {
      clearance,
      detail: `ran unattended against an attended plan (clearance ${clearance}, no gate events in this run)`,
    },
  ];
}

/**
 * Analyze one run. `events` may arrive in any order and may contain events for
 * other runs' concerns only if the caller mixed them — callers are expected to
 * pass a single run's events (see `analyzeRunsForAgent`).
 */
export function analyzeRun(
  manifest: AgentManifestBody,
  events: RunEvent[],
): RunAnalysis {
  const ordered = orderEvents(events);
  const first = ordered[0];

  const executed = ordered
    .filter((event) => event.type === "step_started")
    .map((event) => event.component_id)
    .filter((component): component is string => component !== undefined);

  const drift = analyzeDrift(manifest, executed);
  const gateViolations = analyzeGates(manifest, ordered);
  const clearanceFindings = analyzeClearance(manifest, ordered);

  return {
    agent: first?.agent ?? manifest.agent.name,
    run_id: first?.run_id ?? "",
    executed_route: executed,
    drift,
    gate_violations: gateViolations,
    clearance_findings: clearanceFindings,
    compliant: gateViolations.length === 0 && clearanceFindings.length === 0,
  };
}
