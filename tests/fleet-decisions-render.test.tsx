/**
 * The decisions log, drawn (MAR-673, ADR 0024).
 *
 * `tests/fleet-decisions.test.ts` drives the chains and the write-sites; this
 * drives the thing on screen — `service-row-render`'s split, for its reason:
 * a photograph proves a state was drawn once on one machine, this proves each
 * one is still drawn on every run.
 *
 * The load-bearing assertions are ADR 0024's own announcements:
 *
 * - a missing reason renders the one true sentence, never silence;
 * - a superseded row carries its successor's date — "we decided X" is never
 *   presented bare;
 * - a drifted chain head says the fleet moved and no decision says why;
 * - a truncated log says how much it is showing;
 * - an empty log draws nothing at all, not a heading over an absence.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FleetDecisions } from "../app/_components/fleet-decisions";
import {
  DECISION_DRIFTED,
  NO_REASON_RECORDED,
} from "../lib/copy/decisions";
import type { DecisionRowView, FleetDecisionsView } from "../lib/views/types";

function row(overrides: Partial<DecisionRowView>): DecisionRowView {
  return {
    id: 1,
    when: "16 Aug 2026",
    subject: "AI News Scout",
    summary: "Declared connection dropped: reddit.",
    decided_by: "person",
    rule: null,
    reason: null,
    reason_added_on: null,
    superseded_on: null,
    drifted: false,
    receipts: ["agents.imported_at 2026-08-16T12:00:00.000Z"],
    ...overrides,
  };
}

function draw(view: FleetDecisionsView): string {
  return renderToStaticMarkup(<FleetDecisions view={view} />);
}

describe("FleetDecisions", () => {
  it("draws nothing for an empty log", () => {
    expect(draw({ rows: [], total: 0 })).toBe("");
  });

  it("draws the frozen summary, the date and the subject", () => {
    const markup = draw({ rows: [row({})], total: 1 });
    expect(markup).toContain("Declared connection dropped: reddit.");
    expect(markup).toContain("16 Aug 2026");
    expect(markup).toContain("AI News Scout");
  });

  it("says out loud that no reason was recorded", () => {
    expect(draw({ rows: [row({})], total: 1 })).toContain(NO_REASON_RECORDED);
  });

  it("quotes a reason as the person's words, and marks a late one", () => {
    const markup = draw({
      rows: [row({ reason: "rate limits made it worthless", reason_added_on: "20 Aug 2026" })],
      total: 1,
    });
    expect(markup).toContain("rate limits made it worthless");
    expect(markup).toContain("<q>");
    expect(markup).toContain("Added later, 20 Aug 2026.");
    expect(markup).not.toContain(NO_REASON_RECORDED);
  });

  it("never presents a superseded decision bare", () => {
    const markup = draw({ rows: [row({ superseded_on: "3 Sep 2026" })], total: 1 });
    expect(markup).toContain("Later changed, 3 Sep 2026.");
  });

  it("marks a drifted chain head with the drift sentence", () => {
    expect(draw({ rows: [row({ drifted: true })], total: 1 })).toContain(DECISION_DRIFTED);
    expect(draw({ rows: [row({})], total: 1 })).not.toContain(DECISION_DRIFTED);
  });

  it("says how much of the log it is showing when truncated", () => {
    const markup = draw({ rows: [row({})], total: 31 });
    expect(markup).toContain("The latest 1 of 31.");
  });

  it("draws no control anywhere — the surface is read-only in this slice", () => {
    const markup = draw({
      rows: [row({ reason: "words", drifted: true, superseded_on: "3 Sep 2026" })],
      total: 2,
    });
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<a ");
  });
});
