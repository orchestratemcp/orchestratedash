"use client";

import type { ReactNode } from "react";
import { ConnectionChecklist } from "../_components/connection-checklist";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { useHost, useView } from "../_data/use-view";

/**
 * The Connection Center, read-only for now.
 *
 * This slice answers "what does this agent need to be connected to, and who
 * holds each one?" — the checklist MAR-383 puts at the end of the first-install
 * journey. Connecting, testing and reconnecting are later phases; nothing here
 * accepts a credential, and the page has no inputs at all.
 *
 * It is deliberately honest about its own gaps: v1 agents get an explanation
 * rather than an empty checklist, because "declares no connections" and "is too
 * old to declare any" are different facts.
 */
export default function ConnectionsPage(): ReactNode {
  const state = useView((source) => source.connections());
  const host = useHost();

  return (
    <>
      <h1>Connections</h1>
      <p className="lede">
        What each imported agent needs to be connected to, taken from its
        manifest. DASH does not hold any of these credentials yet.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="what your agents need" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <>
          {state.data.agents.length === 0 ? (
            <div className="empty">
              <p>
                No agent with declared connections has been imported. Connection
                requirements come from a v2 manifest&rsquo;s Agent DOM block.
              </p>
              <p>
                <a href="/agents/add">Add an agent</a> to see what it needs to
                connect to.
              </p>
            </div>
          ) : (
            state.data.agents.map(({ name, rows }) => (
              <section key={name} className="agent-connections">
                <h2>
                  <code>{name}</code>
                </h2>
                <ConnectionChecklist rows={rows} />
              </section>
            ))
          )}

          {state.data.older_agent_names.length > 0 ? (
            <p className="muted">
              {state.data.older_agent_names.length === 1
                ? "1 imported agent uses"
                : `${state.data.older_agent_names.length} imported agents use`}{" "}
              a v1 manifest, which cannot declare connections:{" "}
              {state.data.older_agent_names.join(", ")}. DASH does not guess what
              they need.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
