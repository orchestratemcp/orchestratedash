import type { ReactNode } from "react";
import { RunVerdictChips } from "../_components/verdict";
import { runsView } from "../../lib/views/build";

export const dynamic = "force-dynamic";

export default function RunsPage(): ReactNode {
  const { runs } = runsView();

  return (
    <>
      <h1>Runs</h1>
      <p className="lede">
        Runs reconstructed from telemetry v1 events received at{" "}
        <code>POST /api/events</code>.
      </p>

      {runs.length === 0 ? (
        <div className="empty">
          <p>No run events received yet. Send the bundled example:</p>
          <pre>
            {
              "curl -X POST http://localhost:3000/api/events \\\n  -H 'Content-Type: application/json' \\\n  --data-binary @examples/run-event.example.json"
            }
          </pre>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run</th>
                <th>Agent</th>
                <th>Plan-vs-actual</th>
                <th>Status</th>
                <th>Events</th>
                <th>Started</th>
                <th>Last event</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={`${run.agent} ${run.run_id}`}>
                  <td>
                    <a
                      className="plain"
                      href={`/runs/${encodeURIComponent(run.agent)}/${encodeURIComponent(run.run_id)}`}
                    >
                      <code>{run.run_id}</code>
                    </a>
                  </td>
                  <td>
                    <code>{run.agent}</code>
                  </td>
                  <td>
                    <RunVerdictChips analysis={run.analysis} />
                  </td>
                  <td className={`status-${run.status}`}>{run.status}</td>
                  <td>{run.event_count}</td>
                  <td>{run.started_at}</td>
                  <td>{run.last_event_at}</td>
                  <td>
                    {run.has_sequence_gap ? (
                      <span className="flag">sequence gap</span>
                    ) : null}
                    {run.has_sequence_gap && !run.known_agent ? " · " : null}
                    {run.known_agent ? null : (
                      <span className="flag">manifest not imported</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
