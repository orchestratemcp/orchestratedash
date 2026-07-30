"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AgentComplianceChips } from "./_components/verdict";
import { AgentOrigin } from "./_components/agent-origin";
import { HostNotice, ViewFailed, ViewLoading } from "./_components/view-state";
import { useHost, useView } from "./_data/use-view";
import { agentWorkspaceHref } from "./_data/routes";
import { ROLLUP_RUN_COUNT } from "../lib/views/rollup";

/**
 * The agents list.
 *
 * A client component since MAR-432, like every page here. What it renders is
 * unchanged; where the data comes from is not. See `app/_data/source.ts`.
 */
export default function AgentsPage(): ReactNode {
  const state = useView((source) => source.agents());
  const host = useHost();

  return (
    <>
      <h1>Agents</h1>
      <p className="lede">
        Every agent this DASH knows about, and where each one came from.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your agents" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <>
          {/*
            Above the list, not instead of it. Damage to one agent's record says
            nothing about the others, and hiding a working list behind a notice
            about a row that is gone would turn a partial loss into a total one
            on screen — which is the failure this whole change exists to undo.
          */}
          {state.data.damage !== null ? <ViewFailed recovery={state.data.damage} /> : null}
          {state.data.agents.length === 0 ? (
            /*
             * "No agents yet" is a claim about history, and it is false when the
             * agents are in the store and unreadable. The recovery above already
             * says what happened, so this says only what is true either way.
             */
            state.data.damage !== null ? null : (
              <div className="empty">
                <p>
                  No agents yet. <a href="/agents/add">Add one</a> — it takes two
                  commands and needs no accounts or passwords.
                </p>
              </div>
            )
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
              {state.data.agents.map((agent) => (
                <tr key={agent.name}>
                  <td>
                    <Link className="plain" href={agentWorkspaceHref(agent.name)}>
                      <code>{agent.name}</code>
                    </Link>
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
      )}
    </>
  );
}
