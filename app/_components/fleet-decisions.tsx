"use client";

import type { ReactNode } from "react";

import {
  DECISION_DRIFTED,
  DECISION_SUPERSEDED,
  NO_REASON_RECORDED,
  REASON_ADDED_LATER,
} from "../../lib/copy/decisions";
import type { FleetDecisionsView } from "../../lib/views/types";

/**
 * The decisions log, read-only (MAR-673, ADR 0024).
 *
 * The surface half of the receipt discipline: every row here is a row the
 * chief's memory briefing will one day cite, and ADR 0023's briefing rule
 * requires every briefed string to be one DASH renders — this is where they
 * are rendered. Placement is the point (*unfindable is the same as missing*):
 * on the fleet page, under the fleet the decisions are about.
 *
 * ## What this component never does
 *
 * No controls, no editing, no re-wording. `summary` is the frozen sentence
 * exactly as filed; a `reason` is the person's own words, quoted and
 * attributed as words; a missing reason renders the one true sentence
 * instead. The markers — superseded, drifted — arrive computed from the
 * view, on the same store read as the cards above (ADR 0024 decision 3).
 * The annotate-later control is the next slice, with the rest of the
 * reasons UI.
 */
export function FleetDecisions({ view }: { view: FleetDecisionsView }): ReactNode {
  if (view.total === 0) {
    // A fresh fleet has decided nothing, and an empty log with a heading
    // would be a card explaining its own absence. The first decision brings
    // the section with it.
    return null;
  }
  return (
    <section className="section fleet-decisions" aria-labelledby="fleet-decisions-heading">
      <h2 id="fleet-decisions-heading">Decisions</h2>
      <ol className="row-list fleet-decisions-list">
        {view.rows.map((row) => (
          <li key={row.id} className="row-card fleet-decisions-row">
            <p className="fleet-decisions-line">
              {row.when !== null ? <span className="fleet-decisions-when">{row.when}</span> : null}
              <span className="fleet-decisions-subject">{row.subject}</span>
              <span className="fleet-decisions-summary">{row.summary}</span>
            </p>
            <p className="fleet-decisions-reason">
              {row.reason !== null ? (
                <>
                  <q>{row.reason}</q>
                  {row.reason_added_on !== null ? (
                    <span className="fleet-decisions-note">
                      {" "}
                      {REASON_ADDED_LATER}, {row.reason_added_on}.
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="fleet-decisions-note">{NO_REASON_RECORDED}</span>
              )}
            </p>
            {row.superseded_on !== null ? (
              <p className="fleet-decisions-note">
                {DECISION_SUPERSEDED}, {row.superseded_on}.
              </p>
            ) : null}
            {row.drifted ? <p className="fleet-decisions-drift">{DECISION_DRIFTED}</p> : null}
          </li>
        ))}
      </ol>
      {view.total > view.rows.length ? (
        <p className="fleet-decisions-note">
          The latest {view.rows.length} of {view.total}.
        </p>
      ) : null}
    </section>
  );
}
