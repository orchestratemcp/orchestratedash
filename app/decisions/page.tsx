"use client";

import type { ReactNode } from "react";

import { FleetDecisions } from "../_components/fleet-decisions";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { useHost, useRefreshOnWindowFocus, useView } from "../_data/use-view";

/**
 * The decisions log's own page (MAR-679 interim).
 *
 * Until this packet `<FleetDecisions>` mounted directly on the fleet page,
 * under the cards, with no way to leave it collapsed — five-plus full-width
 * cards on a fresh fleet, pushing the fleet itself off screen. Henrik: *"the
 * fleet view is so cluttered now I can't even see the fleet."*
 *
 * This page is where the log lives now: a surface a person visits
 * deliberately, reached by the count-and-link `app/page.tsx` shows whenever
 * there is at least one decision to read. The component itself is unchanged —
 * `tests/fleet-decisions.test.ts` and `tests/fleet-decisions-render.test.tsx`
 * still drive the same read-only render — only where it is mounted moved.
 *
 * MAR-679's own next slice is the redesign this stands in for: an indicator on
 * the card, small popups to handle on interaction. That is a different shape
 * from a log, not a bigger version of this page, so it is not attempted here.
 */
export default function DecisionsPage(): ReactNode {
  const focusKey = useRefreshOnWindowFocus();
  const state = useView((source) => source.agents(), focusKey);
  const host = useHost();

  return (
    <>
      <h1>Decisions</h1>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="your fleet's decisions" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : state.data.decisions.total === 0 ? (
        <div className="empty">
          <p>Nothing has been decided yet. What your fleet decides, and what you approve or refuse, will appear here.</p>
        </div>
      ) : (
        <FleetDecisions view={state.data.decisions} />
      )}
    </>
  );
}
