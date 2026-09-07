/**
 * What a run's trace says, in words (MAR-889).
 *
 * ## The one thing this copy must never do
 *
 * A trace says **what was done and what failed**. It never says the result was
 * right. Every sentence here is written against that line, because it is the
 * line a step tree is most likely to be read across: a person looking at a
 * column of green ticks will conclude the run was correct unless the words stop
 * them, and DASH has no way to know whether a fetched article was the right one,
 * whether a summary is faithful, or whether the digest is any good. Grounding
 * (`lib/analyze.ts`) is the only surface in DASH that judges *content*, and it
 * judges an artifact against its own sources — not a run against its intent.
 *
 * So the vocabulary is deliberately mechanical. "Finished" rather than
 * "succeeded". "Did not finish" rather than "failed" where the difference is
 * knowable. Nothing says "correct", "verified", "confirmed" or "as expected".
 *
 * ## Pure, and no raw identifiers in the primary copy
 *
 * No imports beyond `./when`, because `app/_components/run-trace.tsx` is a
 * client component and a value import from a Node-only module would drag
 * `node:fs` into a browser chunk (`tests/client-bundle.test.ts`). Span ids and
 * component ids appear nowhere in these sentences: a span id is a UUID an agent
 * minted and belongs behind the developer disclosure, which is where the page
 * puts it.
 */

/** The heading the run detail page gives the trace. */
export const RUN_TRACE_TITLE = "Steps and operations";

/**
 * What the section is, said once, in the place a reader meets it.
 *
 * Both halves are load-bearing. The first says what a person is looking at; the
 * second is the disclaimer above, in the one place somebody will actually read
 * it rather than in a docblock.
 */
export const RUN_TRACE_LEDE =
  "What this run did, in the order it did it. It records what happened, not whether the result was right.";

/** A run whose agent sent no spans at all. */
export const RUN_TRACE_EMPTY = "This run has no step trace.";

/**
 * Why it is empty, and it is never the person's fault.
 *
 * The two causes are indistinguishable from here and lead to the same place, so
 * the sentence names the shape rather than guessing: an agent built before this
 * existed sends no spans, and a runner built before it has no channel to carry
 * them. Neither is a fault and neither is anything to fix on this page, which is
 * why there is no action attached to it.
 */
export const RUN_TRACE_EMPTY_WHY =
  "Agents built before DASH could record one do not send it. Everything else on this page is unaffected.";

/** How a span's outcome is said. */
export type TraceOutcomeWord = "Finished" | "Did not finish" | "Stopped" | "Still open";

/** What a span with no end and no outcome is called. */
export const TRACE_UNFINISHED = "Still open";

/**
 * The sentence for a span whose closing message never arrived.
 *
 * Distinct from "still open" and worth the extra string: a run that is over and
 * a span that is not finished is a span whose agent died inside it, and saying
 * "still open" about a run from last Tuesday would read as a bug in DASH rather
 * than as what actually happened.
 */
export const TRACE_NEVER_FINISHED =
  "This did not report an ending. The run stopped while it was still going.";

/**
 * The heading for spans whose parent DASH never received.
 *
 * They are shown rather than hidden and shown *apart* rather than promoted to
 * the top level. Quietly reparenting an orphan produces a tree that looks
 * complete and is wrong, which is the one outcome worse than a tree that says a
 * piece is missing.
 */
export const TRACE_ORPHAN_TITLE = "Steps whose place in the run is unknown";

export const TRACE_ORPHAN_WHY =
  "These happened during the run. What they happened inside did not reach DASH, so they are listed on their own rather than guessed at.";

/** What DASH calls each kind of operation, for a person. */
const KIND_WORDS: Record<string, string> = {
  run: "The run",
  step: "Step",
  source_fetch: "Read a source",
  broker: "Asked DASH to use a connection",
  browser: "Read a page in DASH's browser",
  artifact: "Handed over a document",
  custom: "Did something",
};

/** The plain word for a span's kind, or the general one. */
export function describeSpanKind(kind: string): string {
  return KIND_WORDS[kind] ?? (KIND_WORDS["custom"] as string);
}

/**
 * How this operation ended, in one word.
 *
 * `unknown` is two different sentences depending on whether the run is over, and
 * that is the only branch here. While the run is going, an unfinished span is
 * ordinary. Once the run has stopped, an unfinished span is a thing that did not
 * report an ending — see `TRACE_NEVER_FINISHED`.
 */
export function describeSpanOutcome(status: string, runIsOver: boolean): TraceOutcomeWord {
  if (status === "ok") {
    // Not "Succeeded". This says the operation ran to its end and stops there;
    // whether what it produced was any good is not a question a span can answer.
    return "Finished";
  }
  if (status === "error") {
    return "Did not finish";
  }
  if (status === "cancelled") {
    return "Stopped";
  }
  return runIsOver ? "Did not finish" : TRACE_UNFINISHED;
}

/**
 * How long an operation took, in words.
 *
 * Null when either end is missing or unreadable, which the caller draws as
 * nothing. `lib/copy/when.ts` makes the same choice for the same reason: a
 * duration DASH cannot compute is better absent than shown as zero, because a
 * zero is a claim.
 *
 * Rounded, and coarsely. Milliseconds on a page are precision nobody can act on,
 * and they make two renders of the same run disagree in a way that is only
 * noise.
 */
export function describeSpanDuration(startedAt: string, endedAt: string | null): string | null {
  if (endedAt === null) {
    return null;
  }
  const from = new Date(startedAt).getTime();
  const to = new Date(endedAt).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) {
    return null;
  }
  const ms = to - from;
  if (ms < 1000) {
    return "under a second";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)} second${seconds === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.round(minutes / 60);
  return `${String(hours)} hour${hours === 1 ? "" : "s"}`;
}

/**
 * "Try 2", or nothing.
 *
 * The retry story is the reason this feature was asked for, and it is told by
 * *two spans side by side* rather than by a counter on one: the try that failed
 * stays on the page beside the one that worked. This label is only what
 * distinguishes them.
 */
export function describeAttempt(attempt: unknown): string | null {
  if (typeof attempt !== "number" || !Number.isFinite(attempt) || attempt < 2) {
    return null;
  }
  return `Try ${String(Math.round(attempt))}`;
}

/**
 * What the agent said cost, with the words that keep it honest.
 *
 * DASH computes no price and this is not a provider's charge —
 * `docs/telemetry-contract-v1.md` is explicit and `lib/ai/ask.ts` holds the one
 * place a provider-stated figure exists. So the sentence attributes the number
 * to the agent every time it is drawn, rather than in a footnote a reader may
 * not reach.
 */
export function describeSpanUsage(usage: {
  tokens_in?: number;
  tokens_out?: number;
  cost_usd?: number;
} | null): string | null {
  if (usage === null) {
    return null;
  }
  const parts: string[] = [];
  if (typeof usage.cost_usd === "number") {
    parts.push(`about $${usage.cost_usd.toFixed(4)}`);
  }
  const tokens =
    (typeof usage.tokens_in === "number" ? usage.tokens_in : 0) +
    (typeof usage.tokens_out === "number" ? usage.tokens_out : 0);
  if (tokens > 0) {
    parts.push(`${String(tokens)} words of model input and output`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `The agent's own figure: ${parts.join(", ")}.`;
}

/** How many spans the store refused, and why that matters to the reader. */
export function describeDroppedSpans(dropped: number): string | null {
  if (dropped <= 0) {
    return null;
  }
  return (
    `This run recorded more steps than DASH keeps, so ${String(dropped)} ` +
    `${dropped === 1 ? "is" : "are"} missing from the list below.`
  );
}

/**
 * Every sentence this module can produce, for the plain-language sweep.
 *
 * Composed from values rather than written out, so a branch added without being
 * added here is one the check never sees — the shape `everyGlanceSentence`
 * established and `everyCurationSentence` repeats.
 *
 * The unfinished, orphan and dropped branches are all included because each is a
 * sentence no ordinary run reaches: one needs an agent that died mid-operation,
 * one needs a lost parent, one needs two thousand spans.
 */
export function everyRunTraceSentence(): string[] {
  const sentences: string[] = [
    RUN_TRACE_TITLE,
    RUN_TRACE_LEDE,
    RUN_TRACE_EMPTY,
    RUN_TRACE_EMPTY_WHY,
    TRACE_UNFINISHED,
    TRACE_NEVER_FINISHED,
    TRACE_ORPHAN_TITLE,
    TRACE_ORPHAN_WHY,
  ];

  for (const kind of ["run", "step", "source_fetch", "broker", "browser", "artifact", "custom"]) {
    sentences.push(describeSpanKind(kind));
  }
  for (const status of ["ok", "error", "cancelled", "unknown"]) {
    sentences.push(describeSpanOutcome(status, true));
    sentences.push(describeSpanOutcome(status, false));
  }

  const started = "2026-09-07T10:00:00.000Z";
  for (const ended of [
    "2026-09-07T10:00:00.400Z",
    "2026-09-07T10:00:01.000Z",
    "2026-09-07T10:00:09.000Z",
    "2026-09-07T10:01:30.000Z",
    "2026-09-07T11:30:00.000Z",
  ]) {
    const duration = describeSpanDuration(started, ended);
    if (duration !== null) {
      sentences.push(duration);
    }
  }

  for (const attempt of [2, 3]) {
    const label = describeAttempt(attempt);
    if (label !== null) {
      sentences.push(label);
    }
  }

  for (const usage of [
    { cost_usd: 0.0041 },
    { tokens_in: 1420, tokens_out: 310 },
    { cost_usd: 0.0041, tokens_in: 1420, tokens_out: 310 },
  ]) {
    const line = describeSpanUsage(usage);
    if (line !== null) {
      sentences.push(line);
    }
  }

  for (const dropped of [1, 12]) {
    const line = describeDroppedSpans(dropped);
    if (line !== null) {
      sentences.push(line);
    }
  }

  return sentences;
}
