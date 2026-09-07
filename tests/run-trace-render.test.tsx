/**
 * The trace, drawn (MAR-889).
 *
 * `lib/views/run-trace.ts` decides the shape and `tests/run-trace-view.test.ts`
 * holds it to that. This file is about the thing neither can see: what a person
 * looking at the page actually reads.
 *
 * Four claims, and the last is the one worth the file on its own.
 *
 * 1. The message a step failed with is **on the operation**, not in a log.
 * 2. A retry is drawn beside the try that failed, both visible.
 * 3. Every gap the view named is said out loud — an orphan under its heading, a
 *    truncated trace with its count, an empty trace with its sentence.
 * 4. **No span id, no run id and no component id is in the copy a person reads.**
 *    They are in a `<details>`, and the assertion below is over the text outside
 *    it, which is the only version of this check that means anything.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RunTraceSection } from "../app/_components/run-trace";
import type { RunSpan } from "../lib/contracts";
import { RUN_TRACE_EMPTY, TRACE_ORPHAN_TITLE } from "../lib/copy/run-trace";
import { buildRunTrace } from "../lib/views/run-trace";

const AGENT = "retrying-scout";
const RUN = "run-1";

function span(over: Partial<RunSpan> & Pick<RunSpan, "span_id">): RunSpan {
  return {
    trace_version: 1,
    agent: AGENT,
    run_id: RUN,
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

/** The run this whole file is about: one step, a failed try, then a good one. */
const RETRYING: RunSpan[] = [
  span({ span_id: "root", kind: "run", name: "This run" }),
  span({ span_id: "step-1", parent_span_id: "root", kind: "step", name: "Read the sources" }),
  span({
    span_id: "try-1",
    parent_span_id: "step-1",
    kind: "source_fetch",
    name: "Read the newsroom feed",
    status: "error",
    ended_at: "2026-09-07T10:00:00.400Z",
    error: { code: "threw", message: "the newsroom feed did not answer" },
    attributes: { attempt: 1 },
  }),
  span({
    span_id: "try-2",
    parent_span_id: "step-1",
    kind: "source_fetch",
    name: "Read the newsroom feed",
    started_at: "2026-09-07T10:00:00.500Z",
    ended_at: "2026-09-07T10:00:02.000Z",
    attributes: { attempt: 2 },
  }),
];

function render(spans: readonly RunSpan[], over: { dropped?: number; runIsOver?: boolean } = {}) {
  return renderToStaticMarkup(
    <RunTraceSection
      trace={buildRunTrace(spans, { dropped: over.dropped, runIsOver: over.runIsOver ?? true })}
    />,
  );
}

/**
 * Everything outside a `<details>`, which is what a person reads without asking.
 *
 * A check for identifiers over the whole markup would be a check that fails on
 * the disclosure that exists precisely so they have somewhere to live — see
 * `docs/design-brief.md` and `lib/copy/identifiers.ts` on why the exemption is
 * at the call site rather than in the rule.
 */
function primaryCopy(markup: string): string {
  return markup.replace(/<details[\s\S]*?<\/details>/g, " ");
}

describe("a run that failed once and then worked, on the page", () => {
  it("puts the failure's own message on the operation that failed", () => {
    const markup = render(RETRYING);
    // The line the section exists for. Without it a failed step is a chip and a
    // trip to a log somebody has to know exists.
    expect(markup).toContain("the newsroom feed did not answer");
    expect(markup).toContain("Read the sources");
  });

  it("draws both tries, and labels only the retry", () => {
    const markup = render(RETRYING);
    // Two spans rather than one amended one: the try that failed is still on
    // the page. A "Try 1" chip on the first would make the one chip that
    // matters invisible, so only the second is labelled.
    expect(markup.match(/Read the newsroom feed/g)).toHaveLength(2);
    expect(markup).toContain("Try 2");
    expect(markup).not.toContain("Try 1");
  });

  it("says what finished without saying it was right", () => {
    const markup = render(RETRYING);
    expect(markup).toContain("Finished");
    expect(markup).toContain("Did not finish");
    expect(primaryCopy(markup)).not.toMatch(/\b(succe|correct|verified|confirmed)/i);
    expect(markup).toContain("not whether the result was right");
  });

  it("keeps every identifier out of the copy a person reads", () => {
    /*
     * The check that would pass falsely if it were run over the whole markup:
     * the ids are in the page, deliberately, inside a disclosure. What must not
     * happen is a span id, a run id or a component id appearing in a heading, a
     * chip or a sentence.
     */
    const outside = primaryCopy(
      render([
        ...RETRYING,
        span({
          span_id: "with-component",
          parent_span_id: "root",
          kind: "step",
          name: "Write what it found",
          attributes: { component_id: "digest_write" },
        }),
      ]),
    );

    for (const identifier of ["root", "step-1", "try-1", "try-2", RUN, "digest_write"]) {
      expect(outside, identifier).not.toContain(identifier);
    }
  });
});

describe("every gap is said out loud", () => {
  it("names a run with no trace instead of drawing an empty box", () => {
    // Every agent built before this packet, and every run already in a store.
    const markup = render([]);
    expect(markup).toContain(RUN_TRACE_EMPTY);
    expect(markup).toContain("Agents built before DASH could record one");
  });

  it("gives a span whose parent never arrived its own heading", () => {
    const markup = render([
      span({ span_id: "root", kind: "run", name: "This run" }),
      span({ span_id: "lost", parent_span_id: "never-arrived", name: "Something that happened" }),
    ]);
    expect(markup).toContain(TRACE_ORPHAN_TITLE);
    expect(markup).toContain("Something that happened");
  });

  it("says how much of a truncated trace is missing", () => {
    const markup = render(RETRYING, { dropped: 12 });
    expect(markup).toContain("12");
    expect(markup).toContain("missing from the list below");
  });

  it("tells an operation that is still going apart from one that died", () => {
    const open = [
      span({ span_id: "root", kind: "run", name: "This run", ended_at: null, status: "unknown" }),
      span({
        span_id: "hanging",
        parent_span_id: "root",
        name: "Reading a slow page",
        ended_at: null,
        status: "unknown",
      }),
    ];

    // While the run is going, an open operation is ordinary and says so.
    const live = render(open, { runIsOver: false });
    expect(live).toContain("Still open");
    expect(live).not.toContain("did not report an ending");

    // Once the run has stopped, the same span is one the agent died inside.
    const stopped = render(open, { runIsOver: true });
    expect(stopped).toContain("did not report an ending");
  });

  it("attributes a cost to the agent, on the operation it belongs to", () => {
    const markup = render([
      span({ span_id: "root", kind: "run", name: "This run" }),
      span({
        span_id: "curate",
        parent_span_id: "root",
        kind: "broker",
        name: "Asked DASH to summarise",
        usage: { tokens_in: 1420, tokens_out: 310, cost_usd: 0.0041, source: "reported" },
      }),
    ]);
    // DASH computes no price and this is not a provider's charge. The
    // attribution is in the sentence rather than in a footnote.
    expect(markup).toContain("The agent&#x27;s own figure");
  });
});
