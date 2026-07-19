import type { ReactNode } from "react";
import type { RunAnalysis } from "../../lib/analyze";
import type { AgentCompliance } from "../../lib/insights";

/**
 * Shared rendering of a plan-vs-actual verdict, so the run list, the run detail
 * view and the agent card cannot drift from one another on what counts as red.
 */

/**
 * The compact verdict shown in a table row. A gate violation outranks
 * everything else — it is the finding that says an irreversible action ran
 * without approval.
 */
export function RunVerdictChips({
  analysis,
}: {
  analysis: RunAnalysis | null;
}): ReactNode {
  if (analysis === null) {
    return (
      <span className="chip chip-muted" title="Import the agent manifest to judge this run against its plan">
        no plan
      </span>
    );
  }

  const chips: ReactNode[] = [];

  if (analysis.gate_violations.length > 0) {
    chips.push(
      <span key="gate" className="chip chip-err">
        gate violation ({analysis.gate_violations.length})
      </span>,
    );
  }

  if (analysis.clearance_findings.length > 0) {
    chips.push(
      <span key="clearance" className="chip chip-err">
        ran unattended
      </span>,
    );
  }

  if (analysis.drift.length > 0) {
    chips.push(
      <span key="drift" className="chip chip-warn">
        drift ({analysis.drift.length})
      </span>,
    );
  }

  if (chips.length === 0) {
    chips.push(
      <span key="ok" className="chip chip-ok">
        matches plan
      </span>,
    );
  }

  return <div className="chips">{chips}</div>;
}

/** The at-a-glance rollup on the agent card: how the last N runs behaved. */
export function AgentComplianceChips({
  compliance,
}: {
  compliance: AgentCompliance;
}): ReactNode {
  if (compliance.runs_considered === 0) {
    return <span className="chip chip-muted">no analyzed runs</span>;
  }

  const chips: ReactNode[] = [];
  const total = compliance.runs_considered;

  if (compliance.gate_violation_runs > 0) {
    chips.push(
      <span key="gate" className="chip chip-err">
        {compliance.gate_violation_runs}/{total} gate violation
      </span>,
    );
  }

  if (compliance.clearance_flagged_runs > 0) {
    chips.push(
      <span key="clearance" className="chip chip-err">
        {compliance.clearance_flagged_runs}/{total} unattended
      </span>,
    );
  }

  if (compliance.drifted_runs > 0) {
    chips.push(
      <span key="drift" className="chip chip-warn">
        {compliance.drifted_runs}/{total} drifted
      </span>,
    );
  }

  if (chips.length === 0) {
    chips.push(
      <span key="ok" className="chip chip-ok">
        {total}/{total} clean
      </span>,
    );
  }

  return <div className="chips">{chips}</div>;
}
