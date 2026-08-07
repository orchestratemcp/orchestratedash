/**
 * What the Runs page is allowed to claim about its own completeness (MAR-488).
 *
 * The rules being asserted are the ones a future edit would loosen without
 * meaning to:
 *
 * - a runner on a machine the user administers always produces a notice, even
 *   when nothing was reported lost, because the evidence such a host has already
 *   discarded increments no counter;
 * - the runner on this machine produces one only when something actually went;
 * - the timestamp is the **oldest** look across sources, since "DASH last
 *   looked" is only true of a list if it is true of every source in it;
 * - every sentence passes `lib/copy/identifiers.ts`, swept over the whole
 *   product of the union rather than over a list somebody maintains.
 */

import { describe, expect, it } from "vitest";

import { describeEvidenceRecord } from "../lib/copy/evidence";
import { describeRawIdentifiers, rawIdentifiersIn } from "../lib/copy/identifiers";
import type { EvidencePullRecord } from "../lib/store";

function pull(over: Partial<EvidencePullRecord> = {}): EvidencePullRecord {
  return {
    source: "local",
    kind: "this_machine",
    observed_at: "2026-08-07T09:00:00.000Z",
    reached: true,
    telemetry_dropped: 0,
    artifacts_dropped: 0,
    workspace_truncated: false,
    ...over,
  };
}

describe("when there is nothing qualified to say", () => {
  it("says nothing at all rather than reassuring", () => {
    expect(describeEvidenceRecord([])).toBeNull();
    expect(describeEvidenceRecord([pull()])).toBeNull();
  });
});

describe("a runner on this machine", () => {
  it("speaks when its bounded buffer actually destroyed something", () => {
    const notice = describeEvidenceRecord([pull({ telemetry_dropped: 136 })]);
    expect(notice).not.toBeNull();
    expect(notice?.standing).toBe(false);
    expect(notice?.detail).toContain("136");
  });

  /**
   * An unreachable runner means the list is as old as the last successful look,
   * which is a different claim from "there were no runs" — and the page would
   * otherwise render the second.
   */
  it("speaks when it could not be reached at all", () => {
    const notice = describeEvidenceRecord([pull({ reached: false })]);
    expect(notice?.detail).toContain("did not answer");
  });

  it("speaks when the runner's own index was longer than one answer carries", () => {
    expect(describeEvidenceRecord([pull({ workspace_truncated: true })])).not.toBeNull();
  });
});

describe("a runner on a machine the user administers", () => {
  /**
   * The asymmetry this module exists for. A zero here is not evidence of
   * completeness — the things DASH cannot know it lost are exactly the ones the
   * sentence is about — so the notice is unconditional and the counts are
   * additional detail rather than its reason for existing.
   */
  it("speaks even when nothing was reported lost", () => {
    const notice = describeEvidenceRecord([pull({ source: "host-1", kind: "another_machine" })]);
    expect(notice).not.toBeNull();
    expect(notice?.detail).toBeNull();
    expect(notice?.standing).toBe(true);
  });

  it("says the record is what the server still had, not what happened", () => {
    const notice = describeEvidenceRecord([pull({ source: "host-1", kind: "another_machine" })]);
    expect(notice?.headline).toContain("still had when DASH last looked");
    expect(notice?.meaning).toContain("keep working while DASH is closed");
  });

  /**
   * The flattering answer would be the most recent look. It is not true of the
   * list, and the list is what the notice is about.
   */
  it("quotes the oldest look across sources, not the newest", () => {
    const notice = describeEvidenceRecord([
      pull({ source: "host-1", kind: "another_machine", observed_at: "2026-08-07T09:00:00.000Z" }),
      pull({ source: "host-2", kind: "another_machine", observed_at: "2026-08-01T09:00:00.000Z" }),
    ]);
    expect(notice?.last_looked_at).toBe("2026-08-01T09:00:00.000Z");
  });

  it("adds up what every source reported losing", () => {
    const notice = describeEvidenceRecord([
      pull({ source: "host-1", kind: "another_machine", telemetry_dropped: 10 }),
      pull({ source: "host-2", kind: "another_machine", artifacts_dropped: 5 }),
    ]);
    expect(notice?.detail).toContain("15");
  });

  /**
   * A remote source in the set decides the wording for the whole notice, because
   * one list containing a host's runs is a list with a host's uncertainty in it.
   */
  it("takes precedence over a local source in the same list", () => {
    const notice = describeEvidenceRecord([
      pull({ telemetry_dropped: 3 }),
      pull({ source: "host-1", kind: "another_machine" }),
    ]);
    expect(notice?.standing).toBe(true);
  });
});

describe("the sentences themselves", () => {
  /**
   * Every notice this module can produce, from the shapes rather than from a
   * transcription — so a branch added without being described is still swept.
   */
  const everyNotice = [
    describeEvidenceRecord([pull({ telemetry_dropped: 1 })]),
    describeEvidenceRecord([pull({ telemetry_dropped: 136, artifacts_dropped: 4 })]),
    describeEvidenceRecord([pull({ reached: false })]),
    describeEvidenceRecord([pull({ workspace_truncated: true })]),
    describeEvidenceRecord([pull({ source: "host-1", kind: "another_machine" })]),
    describeEvidenceRecord([
      pull({ source: "host-1", kind: "another_machine", reached: false, artifacts_dropped: 2 }),
      pull({ source: "host-2", kind: "another_machine", reached: false }),
    ]),
  ].filter((notice) => notice !== null);

  it("produces one for each shape, so the sweep below is not sweeping an empty list", () => {
    expect(everyNotice).toHaveLength(6);
  });

  it("uses no raw identifier anywhere a person reads", () => {
    for (const notice of everyNotice) {
      for (const sentence of [notice.headline, notice.meaning, notice.detail ?? ""]) {
        const findings = rawIdentifiersIn(sentence);
        expect(findings, `${sentence} — ${describeRawIdentifiers(findings)}`).toEqual([]);
      }
    }
  });

  /**
   * The notice must never read as a fault report. "Error", "failed" and
   * "problem" are how a standing property of the arrangement becomes something
   * a person tries to fix — and on a host there is nothing to fix.
   */
  it("never reads as a fault", () => {
    for (const notice of everyNotice) {
      const text = `${notice.headline} ${notice.meaning} ${notice.detail ?? ""}`.toLowerCase();
      for (const word of ["error", "failed", "failure", "problem", "broken", "corrupt"]) {
        expect(text).not.toContain(word);
      }
    }
  });

  /**
   * And it must never claim the opposite of what it is for. A sentence
   * containing "every run" or "complete record" would undo the module.
   */
  it("never claims the list is complete", () => {
    for (const notice of everyNotice) {
      const text = `${notice.headline} ${notice.meaning}`.toLowerCase();
      expect(text).not.toContain("complete record");
      expect(text).not.toContain("all of your runs");
      expect(text).not.toContain("everything your agents");
    }
  });

  /**
   * "At least", because the number is what DASH's sources told it they threw
   * away — which cannot include anything thrown away by something that never
   * reported. A bare count would read as the size of the gap.
   */
  it("never states a loss as an exact size", () => {
    const notice = describeEvidenceRecord([pull({ telemetry_dropped: 136 })]);
    expect(notice?.detail).toContain("At least 136");
  });
});
