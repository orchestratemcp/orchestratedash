"use client";

import { Suspense, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { OutputsPanel } from "../../_components/outputs";
import { RunVerdictChips } from "../../_components/verdict";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { RUN_DETAIL_PARAMS } from "../../_data/routes";
import { useHost, useView } from "../../_data/use-view";

/**
 * Run detail — the plan-vs-actual view (DASH-04).
 *
 * DASH observes and reports. Nothing on this page can stop or roll back a
 * remote agent; a violation here is a finding you act on, not an intervention.
 *
 * **It moved in MAR-432**, from `/runs/{agent}/{run_id}` to a query string. See
 * `app/_data/routes.ts` for why a dynamic segment cannot survive a static
 * export, and note that the reason is not a limitation being worked around: run
 * ids are minted by agents at runtime and no build-time list of them exists or
 * could.
 */
export default function RunDetailPage(): ReactNode {
  return (
    // `useSearchParams` suspends during prerender, so the export needs a
    // boundary to render in its place. Without one the build fails rather than
    // shipping a page that hangs, which is the right way round.
    <Suspense fallback={<ViewLoading what="this run" />}>
      <RunDetail />
    </Suspense>
  );
}

function RunDetail(): ReactNode {
  const params = useSearchParams();
  const agent = params.get(RUN_DETAIL_PARAMS.agent) ?? "";
  const runId = params.get(RUN_DETAIL_PARAMS.runId) ?? "";

  const state = useView((source) => source.run(agent, runId));
  const host = useHost();

  if (state.status === "loading") {
    return <ViewLoading what="this run" />;
  }
  if (state.status === "failed") {
    return <ViewFailed recovery={state.recovery} />;
  }

  if (!state.data.found) {
    // Not `notFound()`: there is no server to produce a 404 in the packaged app,
    // and a run that is absent is a fact this page can state better than an
    // error page can. The next action is the one that exists.
    return (
      <>
        <h1>That run is not here</h1>
        <div className="empty" role="alert">
          <p>DASH has no record of this run.</p>
          <p>
            It may belong to a different DASH, or its events may not have
            arrived.
          </p>
          <p>
            <a href="/runs">Go back to your runs.</a>
          </p>
        </div>
      </>
    );
  }

  const view = state.data;
  const analysis = view.analysis;
  const unplanned = new Set(view.unplanned_component_ids);
  const clean = analysis !== null && analysis.compliant && analysis.drift.length === 0;

  return (
    <>
      <h1>
        Run <code>{view.run_id}</code>
      </h1>
      <p className="lede">
        Agent <code>{view.agent}</code> ·{" "}
        <a className="plain" href="/runs">
          back to runs
        </a>
      </p>
      <HostNotice host={host} />

      <div className={clean ? "findings is-clean" : "findings"}>
        <h2>Plan-vs-actual</h2>
        <RunVerdictChips analysis={analysis} />
        {analysis === null ? (
          <ul>
            <li>
              This agent&rsquo;s <code>agent.manifest.json</code> has not been
              imported, so there is no plan to judge the run against.
            </li>
          </ul>
        ) : (
          <ul>
            {analysis.gate_violations.map((violation) => (
              <li key={`gate-${violation.seq}`}>
                <strong>Gate violation:</strong>{" "}
                <code>{violation.component_id}</code> is irreversible and ran at
                seq {violation.seq} ({violation.ts}) with no approval gate
                resolved before it.
              </li>
            ))}
            {analysis.clearance_findings.map((finding) => (
              <li key={`clearance-${finding.clearance}`}>
                <strong>Clearance:</strong> {finding.detail}.
              </li>
            ))}
            {analysis.drift.map((finding, index) => (
              <li key={`drift-${finding.kind}-${finding.component_id}-${index}`}>
                <strong>Drift:</strong> <code>{finding.component_id}</code>{" "}
                {finding.detail}.
              </li>
            ))}
            {clean ? (
              <li>
                Every planned step ran in order, and no irreversible step ran
                without an approval gate.
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {/* What the run produced, above what it did. Somebody opening a run is
          usually asking "what did it find?" before "which steps ran?", and the
          technical record below answers the second question either way.

          Every output, not just the newest (MAR-434). This page used to render
          `artifacts[0]`, so a run that produced a digest and a reply showed one
          of them and said nothing about the other. */}
      <OutputsPanel cards={view.artifact_cards} grounding={view.grounding} />

      {view.planned_route.length > 0 ? (
        <div className="section">
          <h2>Planned route</h2>
          <ol className="row-list">
            {view.planned_route.map((entry) => (
              <li key={`${entry.step} ${entry.component_id}`}>
                <article className="row-card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Step {entry.step}</p>
                      <h3>
                        <code>{entry.component_id}</code>
                      </h3>
                    </div>
                    {entry.executed ? (
                      <span className="chip chip-ok">ran</span>
                    ) : (
                      <span className="chip chip-warn">never ran</span>
                    )}
                  </div>
                  <dl className="facts">
                    <div>
                      <dt>Risk</dt>
                      <dd>{entry.risk_level}</dd>
                    </div>
                    <div>
                      <dt>Model tier</dt>
                      <dd>{entry.model_tier}</dd>
                    </div>
                  </dl>
                </article>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="section">
        <h2>Events</h2>
        <ol className="row-list">
          {view.events.map((event) => (
            <li key={event.seq}>
              <article className="row-card">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Seq {event.seq}</p>
                    <h3>{event.type}</h3>
                  </div>
                </div>
                <dl className="facts">
                  <div>
                    <dt>Component</dt>
                    <dd>
                      {event.component_id === undefined ? (
                        <span className="chip chip-muted">&mdash;</span>
                      ) : (
                        <>
                          <code>{event.component_id}</code>
                          {event.type === "step_started" && unplanned.has(event.component_id) ? (
                            <>
                              {" "}
                              <span className="chip chip-warn">unplanned</span>
                            </>
                          ) : null}
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{event.status ?? ""}</dd>
                  </div>
                  <div>
                    <dt>Timestamp</dt>
                    <dd>{event.ts}</dd>
                  </div>
                  {event.detail === undefined ? null : (
                    <div>
                      <dt>Detail</dt>
                      <dd className="wrap">{event.detail}</dd>
                    </div>
                  )}
                </dl>
              </article>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}
