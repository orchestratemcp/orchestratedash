import type { ReactNode } from "react";
import { listAgents } from "../lib/store";

export const dynamic = "force-dynamic";

export default function AgentsPage(): ReactNode {
  const agents = listAgents();

  return (
    <>
      <h1>Agents</h1>
      <p className="lede">
        Agents whose <code>agent.manifest.json</code> has been imported into this
        local DASH.
      </p>

      {agents.length === 0 ? (
        <div className="empty">
          <p>No agents imported yet. Import the bundled example:</p>
          <pre>
            {
              "curl -X POST http://localhost:3000/api/agents \\\n  -H 'Content-Type: application/json' \\\n  --data-binary @examples/agent.manifest.example.json"
            }
          </pre>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Goal</th>
                <th>Plan source</th>
                <th>Build target</th>
                <th>Planned steps</th>
                <th>Clearance</th>
                <th>Runs</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.name}>
                  <td>
                    <code>{agent.name}</code>
                  </td>
                  <td className="wrap">{agent.goal}</td>
                  <td>{agent.plan_source}</td>
                  <td>{agent.build_target}</td>
                  <td>{agent.planned_steps}</td>
                  <td>{agent.automation_clearance}</td>
                  <td>{agent.run_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
