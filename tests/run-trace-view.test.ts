/**
 * The shapes a real run will not produce on demand (MAR-889).
 *
 * `tests/run-trace-agent.test.ts` spawns a real agent and proves the ordinary
 * case: an error, a retry, and both on the right step. This file covers what
 * that test cannot reach without breaking something deliberately — an orphan, a
 * cycle, a run that died mid-operation, a trace the store truncated — because
 * every one of those is a way the tree could quietly become a lie, and the whole
 * design of `lib/views/run-trace.ts` is that none of them is repaired.
 *
 * The copy is held to the plain-language gate here too. `everyRunTraceSentence`
 * is composed from the module's own branches rather than written out, so a
 * sentence added without being enumerated is one this sweep never sees — which
 * is exactly the failure `lib/copy/nouns.ts` records as a scar.
 */

import { describe, expect, it } from "vitest";

import {
  RUN_TRACE_EMPTY,
  RUN_TRACE_LEDE,
  describeAttempt,
  describeDroppedSpans,
  describeSpanDuration,
  describeSpanOutcome,
  describeSpanUsage,
  everyRunTraceSentence,
} from "../lib/copy/run-trace";
import type { RunSpan } from "../lib/contracts";
import { buildRunTrace, emptyRunTrace, spanNeverFinished } from "../lib/views/run-trace";
import { expectPlainLanguage } from "./helpers/plain-language";

function span(over: Partial<RunSpan> & Pick<RunSpan, "span_id">): RunSpan {
  return {
    trace_version: 1,
    agent: "scout",
    run_id: "run-1",
    parent_span_id: null,
    name: "Did a thing",
    kind: "custom",
    started_at: "2026-09-07T10:00:00.000Z",
    ended_at: "2026-09-07T10:00:01.000Z",
    status: "ok",
    error: null,
    attributes: null,
    usage: null,
    ...over,
  };
}

describe("building the tree", () => {
  it("nests children under their parent, in the order they opened", () => {
    const trace = buildRunTrace(
      [
        span({ span_id: "root", kind: "run", started_at: "2026-09-07T10:00:00.000Z" }),
        span({
          span_id: "second",
          parent_span_id: "root",
          started_at: "2026-09-07T10:00:05.000Z",
        }),
        span({
          span_id: "first",
          parent_span_id: "root",
          started_at: "2026-09-07T10:00:02.000Z",
        }),
      ],
      { runIsOver: true },
    );

    expect(trace.roots).toHaveLength(1);
    expect(trace.roots[0]?.children.map((node) => node.span.span_id)).toEqual(["first", "second"]);
    expect(trace.total).toBe(3);
    expect(trace.orphans).toEqual([]);
  });

  it("orders by the instant, not by the string, so an offset cannot reorder a run", () => {
    /*
     * `run-span.schema.json` says date-time and does not say UTC, so both of
     * these are legal and they are eight minutes apart in real time — but the
     * one that happened *first* sorts *second* as a string, by its hour digit.
     * `lib/views/run-progress.ts` carries the same note for the same reason; a
     * lexical comparison here would draw the steps of a run in the wrong order
     * on any machine whose agent stamps a local offset.
     */
    const trace = buildRunTrace(
      [
        span({ span_id: "root", kind: "run" }),
        span({
          span_id: "later",
          parent_span_id: "root",
          started_at: "2026-09-07T13:10:00.000Z",
        }),
        span({
          span_id: "earlier",
          parent_span_id: "root",
          started_at: "2026-09-07T15:02:00.000+02:00",
        }),
      ],
      { runIsOver: true },
    );

    expect(trace.roots[0]?.children.map((node) => node.span.span_id)).toEqual([
      "earlier",
      "later",
    ]);
  });

  it("keeps a span whose parent never arrived apart, rather than promoting it", () => {
    /*
     * The load-bearing case. The runner's buffer is bounded and a drain can lose
     * a candidate, so a child whose parent was dropped is a document DASH will
     * receive. Promoting it to a root would draw a tree that looks complete and
     * is wrong — and the page would say nothing, because there would be nothing
     * to say. Keeping it in `orphans` is what lets the page name the gap.
     */
    const trace = buildRunTrace(
      [
        span({ span_id: "root", kind: "run" }),
        span({ span_id: "lost", parent_span_id: "never-arrived" }),
        span({ span_id: "under-lost", parent_span_id: "lost" }),
      ],
      { runIsOver: true },
    );

    expect(trace.roots.map((node) => node.span.span_id)).toEqual(["root"]);
    expect(trace.orphans.map((node) => node.span.span_id)).toEqual(["lost"]);
    // The orphan keeps its own subtree: what is missing is one link, not a
    // branch, and hiding the children would lose more than the gap did.
    expect(trace.orphans[0]?.children.map((node) => node.span.span_id)).toEqual(["under-lost"]);
    expect(trace.total).toBe(3);
  });

  it("terminates on a cycle and draws it beside the orphans", () => {
    /*
     * Parentage comes from an agent, which is a separate program of unknown
     * quality, so `a → b → a` is a document DASH can receive. A naive walk hangs
     * the renderer on it. Neither span is a root and neither names a missing
     * parent, so nothing would ever draw them — which is why they end up in the
     * same honest bucket as an orphan: DASH cannot say where they belong.
     */
    const trace = buildRunTrace(
      [
        span({ span_id: "a", parent_span_id: "b" }),
        span({ span_id: "b", parent_span_id: "a" }),
      ],
      { runIsOver: true },
    );

    expect(trace.roots).toEqual([]);
    expect(trace.orphans).toHaveLength(1);
    // Both are accounted for, so the count on the page matches the list under
    // it. A cycle that silently dropped one would be a trace quietly missing a
    // span with nothing saying so.
    expect(trace.total).toBe(2);
  });

  it("counts every span exactly once, including a duplicated id", () => {
    const trace = buildRunTrace(
      [
        span({ span_id: "root", kind: "run" }),
        span({ span_id: "child", parent_span_id: "root" }),
        span({ span_id: "child", parent_span_id: "root", name: "A second copy" }),
      ],
      { runIsOver: true },
    );
    expect(trace.total).toBe(2);
    expect(trace.roots[0]?.children).toHaveLength(1);
  });

  it("is empty, and says so, for a run whose agent sent nothing", () => {
    // The compatibility case: every agent built before this packet, and every
    // run already in somebody's store. It is not an error and not a null.
    const trace = buildRunTrace([], { runIsOver: true });
    expect(trace).toEqual({ ...emptyRunTrace(true), dropped: 0 });
    expect(trace.total).toBe(0);
  });

  it("carries the count of what the store refused", () => {
    const trace = buildRunTrace([span({ span_id: "root", kind: "run" })], {
      dropped: 12,
      runIsOver: true,
    });
    expect(trace.dropped).toBe(12);
    expect(describeDroppedSpans(trace.dropped)).toContain("12");
  });
});

describe("what an unfinished span means", () => {
  it("is ordinary while the run is going and a fault once it has stopped", () => {
    const open = span({ span_id: "open", ended_at: null, status: "unknown" });

    expect(spanNeverFinished(open, false)).toBe(false);
    expect(describeSpanOutcome("unknown", false)).toBe("Still open");

    // The same span on a run that has ended is an operation the agent died
    // inside. Saying "still open" about a run from last week would read as a
    // bug in DASH rather than as what happened.
    expect(spanNeverFinished(open, true)).toBe(true);
    expect(describeSpanOutcome("unknown", true)).toBe("Did not finish");
  });

  it("never calls a finished operation a correct one", () => {
    /*
     * The rule the whole surface is written against, asserted rather than left
     * to review. A trace records what was done; whether the result was right is
     * a question DASH cannot answer, and a word that implied it would be the
     * feature's worst failure mode — a column of ticks read as a verdict.
     */
    const forbidden = /\b(succe|correct|verified|confirmed|accurate|valid)/i;
    for (const sentence of everyRunTraceSentence()) {
      expect(sentence, sentence).not.toMatch(forbidden);
    }
    expect(RUN_TRACE_LEDE).toContain("not whether the result was right");
  });
});

describe("the words", () => {
  it("contains no raw identifiers", () => {
    expectPlainLanguage(everyRunTraceSentence());
  });

  it("says nothing rather than zero when it cannot compute a duration", () => {
    // A duration DASH cannot work out is better absent than shown as zero,
    // because a zero is a claim. `lib/copy/when.ts` makes the same choice.
    expect(describeSpanDuration("2026-09-07T10:00:00.000Z", null)).toBeNull();
    expect(describeSpanDuration("not a time", "2026-09-07T10:00:00.000Z")).toBeNull();
    expect(describeSpanDuration("2026-09-07T10:00:05.000Z", "2026-09-07T10:00:00.000Z")).toBeNull();
    expect(describeSpanDuration("2026-09-07T10:00:00.000Z", "2026-09-07T10:00:00.400Z")).toBe(
      "under a second",
    );
    expect(describeSpanDuration("2026-09-07T10:00:00.000Z", "2026-09-07T10:00:09.000Z")).toBe(
      "9 seconds",
    );
  });

  it("labels a retry and stays silent on a first try", () => {
    // The first attempt is not a retry, and a "Try 1" chip on every operation
    // would make the one chip that matters invisible.
    expect(describeAttempt(1)).toBeNull();
    expect(describeAttempt(undefined)).toBeNull();
    expect(describeAttempt(2)).toBe("Try 2");
  });

  it("attributes every figure to the agent, every time it is drawn", () => {
    /*
     * DASH computes no price. `docs/telemetry-contract-v1.md` is explicit and
     * `lib/ai/ask.ts` holds the one place a provider-stated charge is recorded,
     * which is not this one. So the attribution is in the sentence rather than
     * in a footnote a reader may not reach.
     */
    const line = describeSpanUsage({ cost_usd: 0.0041, tokens_in: 100, tokens_out: 20 });
    expect(line).toContain("The agent's own figure");
    expect(describeSpanUsage(null)).toBeNull();
    expect(describeSpanUsage({})).toBeNull();
  });

  it("names the empty case without blaming the reader", () => {
    expect(RUN_TRACE_EMPTY).toBe("This run has no step trace.");
    for (const sentence of everyRunTraceSentence()) {
      expect(sentence, sentence).not.toMatch(/\byou (must|should|need to)\b/i);
    }
  });
});
