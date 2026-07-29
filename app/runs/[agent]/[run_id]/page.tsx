import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { RunVerdictChips } from "../../../_components/verdict";
import { runView } from "../../../../lib/views/build";

export const dynamic = "force-dynamic";

/**
 * Run detail — the plan-vs-actual view (DASH-04).
 *
 * DASH observes and reports. Nothing on this page can stop or roll back a
 * remote agent; a violation here is a finding you act on, not an intervention.
 */
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ agent: string; run_id: string }>;
}): Promise<ReactNode> {
  const { agent: agentParam, run_id: runParam } = await params;
  const agent = decodeURIComponent(agentParam);
  const runId = decodeURIComponent(runParam);

  const view = runView(agent, runId);
  if (!view.found) {
    notFound();
  }

  const { events, analysis, planned_route: plannedRoute } = view;
  const unplannedSet = new Set(view.unplanned_component_ids);

  const clean =
    analysis !== null &&
    analysis.compliant &&
    analysis.drift.length === 0;

  return (
    <>
      <h1>
        Run <code>{runId}</code>
      </h1>
      <p className="lede">
        Agent <code>{agent}</code> ·{" "}
        <a className="plain" href="/runs">
          back to runs
        </a>
      </p>

      <div className={clean ? "findings is-clean" : "findings"}>
        <h2>Plan-vs-actual</h2>
        <RunVerdictChips analysis={analysis} />
        {analysis === null ? (
          <ul>
            <li>
              This agent&rsquo;s <code>agent.manifest.json</code> has not been
              imported, so there is no plan to judge the run against.
            </li>
          </ul>
        ) : (
          <ul>
            {analysis.gate_violations.map((violation) => (
              <li key={`gate-${violation.seq}`}>
                <strong>Gate violation:</strong>{" "}
                <code>{violation.component_id}</code> is irreversible and ran at
                seq {violation.seq} ({violation.ts}) with no approval gate
                resolved before it.
              </li>
            ))}
            {analysis.clearance_findings.map((finding) => (
              <li key={`clearance-${finding.clearance}`}>
                <strong>Clearance:</strong> {finding.detail}.
              </li>
            ))}
            {analysis.drift.map((finding, index) => (
              <li key={`drift-${finding.kind}-${finding.component_id}-${index}`}>
                <strong>Drift:</strong> <code>{finding.component_id}</code>{" "}
                {finding.detail}.
              </li>
            ))}
            {clean ? (
              <li>
                Every planned step ran in order, and no irreversible step ran
                without an approval gate.
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {plannedRoute.length > 0 ? (
        <div className="section">
          <h2>Planned route</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Component</th>
                  <th>Risk</th>
                  <th>Model tier</th>
                  <th>Executed</th>
                </tr>
              </thead>
              <tbody>
                {plannedRoute.map((entry) => (
                  <tr key={`${entry.step} ${entry.component_id}`}>
                    <td>{entry.step}</td>
                    <td>
                      <code>{entry.component_id}</code>
                    </td>
                    <td>{entry.risk_level}</td>
                    <td>{entry.model_tier}</td>
                    <td>
                      {entry.executed ? (
                        <span className="chip chip-ok">ran</span>
                      ) : (
                        <span className="chip chip-warn">never ran</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="section">
        <h2>Events</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Type</th>
                <th>Component</th>
                <th>Status</th>
                <th>Timestamp</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const unplanned =
                  event.type === "step_started" &&
                  event.component_id !== undefined &&
                  unplannedSet.has(event.component_id);
                return (
                  <tr key={event.seq}>
                    <td>{event.seq}</td>
                    <td>{event.type}</td>
                    <td>
                      {event.component_id === undefined ? (
                        <span className="chip chip-muted">&mdash;</span>
                      ) : (
                        <>
                          <code>{event.component_id}</code>
                          {unplanned ? (
                            <>
                              {" "}
                              <span className="chip chip-warn">unplanned</span>
                            </>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td>{event.status ?? ""}</td>
                    <td>{event.ts}</td>
                    <td className="wrap">{event.detail ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
