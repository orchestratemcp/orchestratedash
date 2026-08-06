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
        <ol className="row-list">
          {state.data.runs.map((run) => (
            <li key={`${run.agent} ${run.run_id}`}>
              <article className="row-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      <code>{run.agent}</code>
                    </p>
                    <h3>
                      <a className="plain" href={runDetailHref(run.agent, run.run_id)}>
                        <code>{run.run_id}</code>
                      </a>
                    </h3>
                  </div>
                  <div className="chips">
                    <RunVerdictChips analysis={run.analysis} />
                    <span className={`status-${run.status}`}>{run.status}</span>
                  </div>
                </div>
                <dl className="facts">
                  <div>
                    <dt>Events</dt>
                    <dd>{run.event_count}</dd>
                  </div>
                  <div>
                    <dt>Started</dt>
                    <dd>{run.started_at}</dd>
                  </div>
                  <div>
                    <dt>Last event</dt>
                    <dd>{run.last_event_at}</dd>
                  </div>
                  {run.has_sequence_gap || !run.known_agent ? (
                    <div>
                      <dt>Notes</dt>
                      <dd>
                        {run.has_sequence_gap ? (
                          <span className="flag">sequence gap</span>
                        ) : null}
                        {run.has_sequence_gap && !run.known_agent ? " · " : null}
                        {run.known_agent ? null : (
                          <span className="flag">manifest not imported</span>
                        )}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </article>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
