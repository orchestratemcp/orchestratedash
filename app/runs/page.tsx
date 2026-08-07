"use client";

import type { ReactNode } from "react";
import type { EvidenceNotice } from "../../lib/copy/evidence";
import { TechnicalDetails } from "../_components/record-card";
import { RunVerdictChips } from "../_components/verdict";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { useHost, useView } from "../_data/use-view";
import { runDetailHref } from "../_data/routes";

/**
 * How complete this list is, when DASH has something qualified to say
 * (MAR-488).
 *
 * **Above the list, not beside a row**, because it is a statement about the
 * list. A per-run badge would attach an uncertainty about *which runs exist* to
 * runs that do — the opposite of what it means.
 *
 * `notice` rather than a red state, deliberately, and `standing` is what decides
 * the wording rather than the colour: for a runner on a server the user owns
 * this is a permanent property of the arrangement, and a permanent caveat
 * rendered as a failure teaches people to ignore failures. The same argument
 * PROJECT_STATE makes about grounding never rendering in the same red as an
 * unapproved irreversible action.
 */
function EvidenceRecordNotice({ notice }: { notice: EvidenceNotice | null }): ReactNode {
  if (notice === null) {
    return null;
  }
  return (
    <aside className="notice" data-evidence-standing={notice.standing ? "true" : "false"}>
      <p>
        <strong>{notice.headline}</strong>
      </p>
      <p>{notice.meaning}</p>
      {notice.detail === null ? null : <p>{notice.detail}</p>}
      <p>
        DASH last collected{" "}
        {/* A value, so mono — and the raw timestamp, because a relative one
            ("2 hours ago") would be computed at render and go stale on a page
            nobody reloaded, which is exactly the failure this notice is about. */}
        <code>{notice.last_looked_at}</code>.
      </p>
    </aside>
  );
}

/**
 * When a run started, as a person would say it (MAR-491).
 *
 * The stored value is an ISO-8601 instant — `2026-08-06T20:09:04.029Z` — which
 * is exact, sortable and unreadable at a glance, and it was being rendered
 * verbatim on a card whose whole job is to be scanned. This is the same string
 * put through the machine's own locale, and the exact one is still on the card,
 * under `Started`, inside the disclosure.
 *
 * Formatted at render rather than in `lib/views/`, and that is deliberate: a
 * locale belongs to the machine looking at the screen, and a view built in main
 * and cloned across a boundary would be formatting for whichever process
 * happened to build it. The raw instant is what crosses; the reading is local.
 *
 * A value it cannot parse is returned unchanged. A run whose timestamp is
 * malformed is a real thing DASH stores, and inventing "Unknown" for it would
 * hide the one clue about what went wrong.
 */
export function describeRunStart(startedAt: string): string {
  const at = new Date(startedAt);
  if (Number.isNaN(at.getTime())) {
    return startedAt;
  }
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
      ) : (
        <EvidenceRecordNotice notice={state.data.evidence} />
      )}

      {state.status !== "ready" ? null : state.data.runs.length === 0 ? (
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
                {/*
                  MAR-491. The heading used to be the run id — a UUID, wrapped
                  over two lines at 375px, as the largest thing on the card.
                  That is DASH's handle for a run, not a person's: nobody scans
                  a list by `52570734-ae5e-…`, and `lib/copy/identifiers.ts`
                  spends a module on why internal vocabulary must not be the
                  first thing a guided surface says.

                  What names a run to a person is which agent did it and when.
                  The id stays — it is how somebody reports a problem — as a
                  value inside the disclosure, where it is findable and is not
                  the headline.
                */}
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      <code>{run.agent}</code>
                    </p>
                    <h3>
                      <a className="plain" href={runDetailHref(run.agent, run.run_id)}>
                        {describeRunStart(run.started_at)}
                      </a>
                    </h3>
                  </div>
                  <div className="chips">
                    <RunVerdictChips analysis={run.analysis} />
                    <span className={`status-${run.status}`}>{run.status}</span>
                  </div>
                </div>
                {/*
                  The flags stay on the primary face. A sequence gap and a
                  missing manifest are the two things on this card that are
                  about whether the record can be trusted, and a caveat behind
                  a disclosure is a caveat for the people who already suspected
                  something.
                */}
                {run.has_sequence_gap || !run.known_agent ? (
                  <p className="card-meta">
                    {run.has_sequence_gap ? <span className="flag">sequence gap</span> : null}
                    {run.has_sequence_gap && !run.known_agent ? (
                      <span aria-hidden="true"> · </span>
                    ) : null}
                    {run.known_agent ? null : (
                      <span className="flag">manifest not imported</span>
                    )}
                  </p>
                ) : null}
                <TechnicalDetails>
                  <dl className="facts">
                    <div>
                      <dt>Run</dt>
                      <dd>
                        <code>{run.run_id}</code>
                      </dd>
                    </div>
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
                  </dl>
                </TechnicalDetails>
              </article>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
