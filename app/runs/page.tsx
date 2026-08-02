"use client";

import type { ReactNode } from "react";
import { RunVerdictChips } from "../_components/verdict";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { useHost, useView } from "../_data/use-view";
import { runDetailHref } from "../_data/routes";

export default function RunsPage(): ReactNode {
  const state = useView((source) => source.runs());
  const host = useHost();

  return (
    <>
      <h1>Runs</h1>
      <p className="lede">
        Every time one of your agents has done its job, and whether it went the
        way its plan said it would.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your runs" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : state.data.runs.length === 0 ? (
        /**
         * MAR-432's one deliberate copy change.
         *
         * This used to print a `curl` command aimed at a development server's
         * port. In the installed app there is no such port, no terminal, and no
         * user who was going to type that — so porting it here unchanged would
         * have shipped an instruction that is not merely unhelpful but false.
         * The rest of MAR-423's empty-state work is still MAR-423's; this one
         * had to move with the renderer that made it wrong.
         */
        <div className="empty">
          <p>Nothing has run yet.</p>
          {/*
            MAR-457 fixed two false claims in this paragraph. It named the Help
            menu, and there is no Help menu — the item is the first entry in the
            DASH menu — so anybody who followed it found nothing. And it said the
            sample "runs it for you", which stopped being true when the sample
            became manual-first: it is added ready and waits to be asked.
          */}
          <p>
            Agents report here as they work. If you have not made one,{" "}
            <a href="/">start with AI News Scout</a> — or{" "}
            <a href="/agents/add">add an agent</a> you built yourself.
          </p>
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
              {state.data.runs.map((run) => (
                <tr key={`${run.agent} ${run.run_id}`}>
                  <td>
                    <a className="plain" href={runDetailHref(run.agent, run.run_id)}>
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
