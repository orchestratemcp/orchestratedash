import type {
  AgentManifestBody,
  ArtifactSourceStatus,
  RunArtifact,
  RunEvent,
} from "./contracts";

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

/* ---------------------------------------------------------------------- *
 * Grounding
 * ---------------------------------------------------------------------- */

/**
 * Whether a digest's claims are backed by sources the run says it read
 * (MAR-457).
 *
 * ## Why this is a second axis and not part of `compliant`
 *
 * `RunAnalysis.compliant` means one thing: the run honoured its **safety
 * contract** — no irreversible step ran without an approval gate, and an
 * attended plan did not run unattended. Grounding is a property of the run's
 * **output**. Folding the two together would render a missing citation in the
 * same red as an unapproved irreversible action, which does not make citations
 * matter more; it makes gate violations matter less. The chip that means
 * "something acted without permission" has to keep meaning only that.
 *
 * So the two are computed separately, reported separately, and neither can move
 * the other. Drift already sits outside `compliant` for the same reason.
 *
 * ## What this can and cannot prove
 *
 * It checks the artifact against **its own report of what it fetched**: every
 * item must cite a source that appears in `sources_fetched`. That catches an
 * item attributed to a feed this run never touched, which is the failure worth
 * catching — a digest quietly attributing a claim to a source it did not read.
 *
 * It is **not** independent proof that a fetch happened. DASH does not see the
 * network; it sees what the agent said. An agent that fabricates both halves
 * consistently passes this check, and no copy built on it may imply otherwise.
 * The honest sentence is "every item names a source this run reported reading",
 * not "every item was verified against its source".
 */
export type GroundingVerdict = "grounded" | "ungrounded" | "unverifiable";

export interface GroundingAnalysis {
  verdict: GroundingVerdict;
  items_total: number;
  items_cited: number;
  /** Headlines carrying no source at all. */
  uncited: string[];
  /** Headlines citing a source this run never reported reading. */
  unsupported: Array<{ headline: string; source_url: string }>;
  /** Sources the run tried and could not use, for the recovery copy. */
  failed_sources: Array<{ source_name: string; status: ArtifactSourceStatus }>;
}

export function analyzeGrounding(artifact: RunArtifact): GroundingAnalysis {
  const fetched = artifact.sources_fetched;
  const failed = (fetched ?? [])
    .filter((source) => source.status !== "ok")
    .map((source) => ({ source_name: source.source_name, status: source.status }));

  const uncited: string[] = [];
  const unsupported: Array<{ headline: string; source_url: string }> = [];

  // Compared as the agent wrote them, not normalised. A redirect or a trailing
  // slash would make two spellings of one address look like two addresses — but
  // guessing that two strings mean the same endpoint is exactly the leniency
  // that would let a fabricated citation match a real source by resembling it.
  const readable = new Set((fetched ?? []).map((source) => source.source_url));

  for (const item of artifact.items) {
    if (item.source_url === undefined || item.source_url.length === 0) {
      uncited.push(item.headline);
      continue;
    }
    if (fetched !== undefined && !readable.has(item.source_url)) {
      unsupported.push({ headline: item.headline, source_url: item.source_url });
    }
  }

  const cited = artifact.items.length - uncited.length;

  const verdict = ((): GroundingVerdict => {
    if (uncited.length > 0 || unsupported.length > 0) {
      return "ungrounded";
    }
    if (fetched === undefined) {
      // The artifact never said what it read, so there is nothing to check
      // against. Reporting that as "grounded" would be DASH vouching for a
      // claim it has not examined.
      return "unverifiable";
    }
    return "grounded";
  })();

  return {
    verdict,
    items_total: artifact.items.length,
    items_cited: cited,
    uncited,
    unsupported,
    failed_sources: failed,
  };
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
