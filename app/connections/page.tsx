"use client";

import { useState, type ReactNode } from "react";
import { ConnectionChecklist } from "../_components/connection-checklist";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { submitConnectionCommand } from "../_data/source";
import { useHost, useView } from "../_data/use-view";

/**
 * The Connection Center.
 *
 * This answers "what does this agent need to be connected to, who holds each
 * one, and what has DASH got?" — the checklist MAR-383 puts at the end of the
 * first-install journey, and, since MAR-383's credential slice, the place a
 * user connects one.
 *
 * **This page still has no credential input.** Connect opens a window main owns
 * with its own preload; the value goes from that window to the OS vault without
 * passing through here. What this page sends is three ids, and what it gets
 * back is a state, a masked hint and a sentence.
 *
 * It is deliberately honest about its own gaps: v1 agents get an explanation
 * rather than an empty checklist, because "declares no connections" and "is too
 * old to declare any" are different facts.
 */
export default function ConnectionsPage(): ReactNode {
  // Bumped after any command that changed something, so the page re-reads the
  // view rather than trusting its own optimistic idea of what happened. The
  // rows carry masked hints from the store, and the store is the thing that
  // just changed.
  const [revision, setRevision] = useState(0);
  const state = useView((source) => source.connections(), revision);
  const host = useHost();

  return (
    <>
      <h1>Connections</h1>
      <p className="lede">
        What each imported agent needs to be connected to, taken from its
        manifest. Anything DASH holds is kept in this computer&rsquo;s credential
        vault.
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
                <ConnectionChecklist
                  rows={rows}
                  act={async (action, target) => {
                    const result = await submitConnectionCommand(action, {
                      agent_id: name,
                      ...target,
                    });
                    if (result.ok) {
                      setRevision((current) => current + 1);
                    }
                    return {
                      ok: result.ok,
                      detail: result.detail,
                      recovery: result.recovery,
                    };
                  }}
                />
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
