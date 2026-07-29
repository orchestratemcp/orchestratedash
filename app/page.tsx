import type { ReactNode } from "react";
import { AgentComplianceChips } from "./_components/verdict";
import { AgentOrigin } from "./_components/agent-origin";
import { ROLLUP_RUN_COUNT, agentsView } from "../lib/views/build";

export const dynamic = "force-dynamic";

export default function AgentsPage(): ReactNode {
  const { agents } = agentsView();

  return (
    <>
      <h1>Agents</h1>
      <p className="lede">
        Every agent this DASH knows about, and where each one came from.
      </p>

      {agents.length === 0 ? (
        <div className="empty">
          <p>
            No agents yet. <a href="/agents/add">Add one</a> — it takes two
            commands and needs no accounts or passwords.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th>Goal</th>
                <th>Where it came from</th>
                <th>Plan source</th>
                <th>Build target</th>
                <th>Planned steps</th>
                <th>Clearance</th>
                <th>Runs</th>
                <th>Last {ROLLUP_RUN_COUNT} runs</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.name}>
                  <td>
                    <code>{agent.name}</code>
                  </td>
                  <td className="wrap">{agent.goal}</td>
                  <td>
                    <AgentOrigin origin={agent.origin} />
                  </td>
                  <td>{agent.plan_source}</td>
                  <td>{agent.build_target}</td>
                  <td>{agent.planned_steps}</td>
                  <td>{agent.automation_clearance}</td>
                  <td>{agent.run_count}</td>
                  <td>
                    <AgentComplianceChips compliance={agent.compliance} />
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
