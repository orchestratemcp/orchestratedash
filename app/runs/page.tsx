"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { EvidenceNotice } from "../../lib/copy/evidence";
import type { RunOriginNotice } from "../../lib/copy/where-it-ran";
import { TechnicalDetails } from "../_components/record-card";
import { RunVerdictChips } from "../_components/verdict";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { WorkingLine } from "../_components/working";
import { useHost, useLiveView } from "../_data/use-view";
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
 * Which machines the runs below happened on (MAR-602, ADR 0014).
 *
 * **Above the list, like its neighbour, and for a different reason.**
 * `EvidenceRecordNotice` is up there because a per-row completeness badge would
 * attach an uncertainty about *which runs exist* to runs that do. This one is
 * up there because DASH's answer is currently only good at the scale of the
 * list: a run's machine of origin is a property of that run, `runs` has no
 * column for it, and ADR 0014 says the fact must come from the pull that
 * produced the run rather than be inferred from a deploy record. The day a run
 * carries its own origin, this moves onto the row and this component goes away.
 *
 * `unknown` drives emphasis and never colour, which is `EvidenceNotice`'s rule
 * next door: DASH not knowing something is not a fault, and rendering it in the
 * same red as an unapproved irreversible action would teach people to ignore
 * that red.
 */
function RunOriginRecordNotice({ notice }: { notice: RunOriginNotice | null }): ReactNode {
  if (notice === null) {
    return null;
  }
  return (
    <aside className="notice" data-origin-unknown={notice.unknown ? "true" : "false"}>
      <p>
        <strong>{notice.headline}</strong>
      </p>
      <p>{notice.meaning}</p>
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
  /*
   * Follows the list only while a run is actually going (MAR-544), which is
   * `agents/detail`'s pattern exactly: `useLiveView` stops the moment `live`
   * turns false, so a page of finished runs is as still as every other page in
   * DASH. The disclosure the polling rule asks for is the line beside the
   * heading below.
   */
  const [live, setLive] = useState(false);
  const state = useLiveView((source) => source.runs(), "runs", live);
  const host = useHost();

  const anyRunning =
    state.status === "ready" && state.data.runs.some((run) => run.status === "running");
  useEffect(() => {
    setLive(anyRunning);
  }, [anyRunning]);

  return (
    <>
      <h1>Runs</h1>
      <p className="lede">
        Every time one of your agents has done its job, and whether it went the
        way its plan said it would.
      </p>
      {/* A live region so the page's own refreshing is announced as well as
          seen, and it disappears with the running run rather than becoming
          furniture — `agents/detail`'s pattern. */}
      <p aria-live="polite" className="live-note">
        {anyRunning && state.last_read_at !== null
          ? `Following the running work. Last updated ${state.last_read_at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`
          : ""}
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your runs" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <>
          {/* MAR-602, ADR 0014. Above the completeness notice, because "where
              did these happen" is the plainer question and the one a person can
              answer without having read anything else about how DASH collects.
              Both are statements about the list rather than about a row, and
              they are two elements rather than one so neither can soften the
              other. */}
          <RunOriginRecordNotice notice={state.data.origin} />
          <EvidenceRecordNotice notice={state.data.evidence} />
        </>
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
            <a href="/settings/add-agent">add an agent</a> you built yourself.
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
                    {/*
                      A run in flight gets the working line rather than the
                      bare status word (MAR-544): "running" was DASH's
                      vocabulary rendered verbatim, and a person watching work
                      happen deserves the feedback that it is. The finished
                      statuses keep their chips — they are records, and a
                      record does not pulse.
                    */}
                    {run.status === "running" ? (
                      <WorkingLine />
                    ) : (
                      <span className={`status-${run.status}`}>{run.status}</span>
                    )}
                  </div>
                </div>
                {/*
                  The flags stay on the primary face. A sequence gap and a
                  missing manifest are the two things on this card that are
                  about whether the record can be trusted, and a caveat behind
                  a disclosure is a caveat for the people who already suspected
                  something.
                */}
                {/*
                  MAR-583. What this agent was set to use when the run started,
                  on the primary face because the reason to switch models is
                  cost and a setting nobody can see is a setting nobody checks.
                  The short form only — the caveat that DASH watched its own
                  setting rather than a model is on the run's own page, which has
                  room for it. Never a cost: MAR-299 owns spend, and it owns it
                  because a number DASH derived is not somebody's bill.
                */}
                {run.model === null ? null : (
                  <p className="card-meta run-model-line" title={run.model.detail}>
                    <span className="run-model-label">{run.model.label}</span>
                  </p>
                )}
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
