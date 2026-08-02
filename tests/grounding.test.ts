/**
 * Grounding: the second verdict axis (MAR-457).
 *
 * The load-bearing property these protect is the *separation*. A missing
 * citation and an unapproved irreversible action are both worth showing, and
 * they are not the same kind of thing — so the first must never be able to move
 * `RunAnalysis.compliant`, and the second must never be able to move the
 * grounding verdict. A suite that only checked each in isolation would not
 * notice the day somebody helpfully merged them.
 */

import { describe, expect, it } from "vitest";

import { analyzeGrounding, analyzeRun } from "../lib/analyze";
import { describeDigestGaps, describeSourceFailure } from "../lib/copy/recovery";
import type { AgentManifestBody, RunArtifact, RunEvent } from "../lib/contracts";

function artifact(overrides: Partial<RunArtifact> = {}): RunArtifact {
  return {
    artifact_version: 1,
    agent: "ai-news-scout",
    run_id: "run-1",
    artifact_id: "digest-1",
    kind: "digest",
    title: "Today",
    generated_at: "2026-08-01T09:00:00.000Z",
    sources_fetched: [
      { source_name: "A feed", source_url: "https://example.com/feed", status: "ok" },
    ],
    items: [
      { headline: "Something happened", source_url: "https://example.com/feed" },
    ],
    ...overrides,
  };
}

describe("grounding", () => {
  it("is grounded when every item cites a source the run reported reading", () => {
    const analysis = analyzeGrounding(artifact());
    expect(analysis.verdict).toBe("grounded");
    expect(analysis.items_cited).toBe(1);
    expect(analysis.uncited).toEqual([]);
  });

  it("names the uncited items rather than only counting them", () => {
    // The count says a digest is imperfect; the headline says which line the
    // user should not rely on. Only the second is actionable.
    const analysis = analyzeGrounding(
      artifact({
        items: [
          { headline: "Sourced", source_url: "https://example.com/feed" },
          { headline: "Bare assertion" },
        ],
      }),
    );
    expect(analysis.verdict).toBe("ungrounded");
    expect(analysis.uncited).toEqual(["Bare assertion"]);
    expect(analysis.items_cited).toBe(1);
    expect(analysis.items_total).toBe(2);
  });

  it("catches an item attributed to a source this run never read", () => {
    // The failure worth catching: a digest quietly crediting a feed it did not
    // touch. Nothing about the item's own shape is wrong, so only the
    // cross-check against what the run says it fetched can find it.
    const analysis = analyzeGrounding(
      artifact({
        items: [{ headline: "Borrowed", source_url: "https://elsewhere.example/feed" }],
      }),
    );
    expect(analysis.verdict).toBe("ungrounded");
    expect(analysis.unsupported).toEqual([
      { headline: "Borrowed", source_url: "https://elsewhere.example/feed" },
    ]);
  });

  it("says unverifiable, not grounded, when the artifact never said what it read", () => {
    // Reporting this as grounded would be DASH vouching for a claim it has not
    // examined. The third state exists so it does not have to.
    const analysis = analyzeGrounding(artifact({ sources_fetched: undefined }));
    expect(analysis.verdict).toBe("unverifiable");
  });

  it("does not treat a near-miss address as a match", () => {
    // Normalising would let a fabricated citation match a real source by
    // resembling it. Two spellings are two addresses until the agent says
    // otherwise.
    const analysis = analyzeGrounding(
      artifact({
        items: [{ headline: "Close", source_url: "https://example.com/feed/" }],
      }),
    );
    expect(analysis.verdict).toBe("ungrounded");
  });

  it("carries the failed sources through for the recovery copy", () => {
    const analysis = analyzeGrounding(
      artifact({
        sources_fetched: [
          { source_name: "A feed", source_url: "https://example.com/feed", status: "ok" },
          { source_name: "A broken one", source_url: "https://down.example/feed", status: "unreachable" },
        ],
      }),
    );
    expect(analysis.failed_sources).toEqual([
      { source_name: "A broken one", status: "unreachable" },
    ]);
    // A source that failed does not make the items that did arrive uncited.
    expect(analysis.verdict).toBe("grounded");
  });

  it("keeps the safety verdict and the grounding verdict independent", () => {
    const manifest: AgentManifestBody = {
      agent: {
        name: "ai-news-scout",
        goal: "g",
        plan_source: "composed",
        playbook_id: "",
        route_id: "",
        build_target: "code",
      },
      planned_route: [
        { step: 1, component_id: "public_feed_fetch", risk_level: "low", model_tier: "none" },
      ],
      safety_contract: {
        automation_clearance: "L1",
        enforced_approval_gates: [],
        irreversible_components: [],
      },
      monitoring: {},
      provenance: {},
    };
    const events: RunEvent[] = [
      {
        event_version: 1,
        agent: "ai-news-scout",
        run_id: "run-1",
        seq: 0,
        ts: "2026-08-01T09:00:00.000Z",
        type: "run_started",
      },
      {
        event_version: 1,
        agent: "ai-news-scout",
        run_id: "run-1",
        seq: 1,
        ts: "2026-08-01T09:00:01.000Z",
        type: "step_started",
        component_id: "public_feed_fetch",
      },
    ];

    // A wholly uncited digest, from a run that honoured its safety contract.
    const grounding = analyzeGrounding(
      artifact({ items: [{ headline: "No source" }] }),
    );
    const safety = analyzeRun(manifest, events);

    expect(grounding.verdict).toBe("ungrounded");
    // The point of the whole separation: this stays true. An uncited line is
    // not an unapproved irreversible action and must not read as one.
    expect(safety.compliant).toBe(true);
    expect(safety).not.toHaveProperty("grounded");
  });
});

describe("source recovery copy", () => {
  it("returns nothing for a source that worked", () => {
    expect(describeSourceFailure({ source_name: "A feed", status: "ok" })).toBeNull();
  });

  it("keeps unreachable and not-a-feed apart", () => {
    const unreachable = describeSourceFailure({ source_name: "A feed", status: "unreachable" });
    const notAFeed = describeSourceFailure({ source_name: "A feed", status: "not_a_feed" });

    expect(unreachable?.next_action).not.toBe(notAFeed?.next_action);
    // The distinction that matters: a reachable address must not send anybody
    // to check the one thing demonstrably working.
    expect(notAFeed?.meaning).not.toMatch(/online|connection/i);
    expect(unreachable?.headline).toMatch(/could not reach/i);
  });

  it("does not word an empty feed as a fault", () => {
    const empty = describeSourceFailure({ source_name: "A feed", status: "empty" });
    expect(empty?.actor).toBe("elsewhere");
    expect(empty?.next_action).toMatch(/nothing to do/i);
  });

  it("says the machine is probably offline only when every source failed", () => {
    const all = describeDigestGaps([
      { source_name: "One", status: "unreachable" },
      { source_name: "Two", status: "unreachable" },
    ]);
    expect(all?.next_action).toMatch(/online/i);

    // One failure among several is the per-source story, told once, not a
    // verdict about the computer.
    expect(
      describeDigestGaps([
        { source_name: "One", status: "unreachable" },
        { source_name: "Two", status: "ok" },
      ]),
    ).toBeNull();
  });

  it("treats having no sources as something to do, not something that broke", () => {
    const none = describeDigestGaps([]);
    expect(none?.meaning).toMatch(/nothing went wrong/i);
    expect(none?.next_action).toMatch(/add a source/i);
  });

  it("gives every recovery all three fields", () => {
    // The shape rule the module exists for: a surface cannot render two of
    // headline/meaning/next_action and silently drop the third.
    const recoveries = [
      describeSourceFailure({ source_name: "A feed", status: "unreachable" }),
      describeSourceFailure({ source_name: "A feed", status: "not_a_feed" }),
      describeSourceFailure({ source_name: "A feed", status: "empty" }),
      describeDigestGaps([]),
      describeDigestGaps([{ source_name: "One", status: "unreachable" }]),
    ].filter((recovery) => recovery !== null);

    expect(recoveries.length).toBeGreaterThan(3);
    for (const recovery of recoveries) {
      expect(recovery.headline.length).toBeGreaterThan(0);
      expect(recovery.meaning.length).toBeGreaterThan(0);
      expect(recovery.next_action.length).toBeGreaterThan(0);
    }
  });
});
