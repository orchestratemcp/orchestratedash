/**
 * A run's operations, as a tree with its gaps named (MAR-889).
 *
 * ## What this is for
 *
 * `app/runs/detail/page.tsx` already drew a flat `<ol>` of telemetry events, and
 * a flat list cannot answer the question the run inspector exists for: *which
 * step failed, and did the thing that worked afterwards work because it was
 * retried?* Events are a sequence of markers with no nesting and no ends —
 * `step_started` has no `step_completed` that DASH can rely on, and a brokered
 * call leaves no event at all. Spans have both, so this module turns them into
 * the shape a person reads.
 *
 * ## Every gap is drawn, never closed
 *
 * The design constraint is that an incomplete trace must look incomplete. Four
 * ways a trace can be partial, and each has a member rather than a repair:
 *
 * 1. **A span whose parent never arrived** goes under `orphans` and is drawn
 *    apart, not promoted to a root. A silently reparented orphan produces a tree
 *    that looks whole and is wrong, which is worse than one that says a piece is
 *    missing.
 * 2. **A span that never ended** keeps `status: "unknown"` and the view reports
 *    whether the run itself is over, which is what tells "still going" apart
 *    from "died inside this".
 * 3. **Spans the store refused** are counted in `dropped`, from
 *    `run_span_drops`, so a truncated tree says it is truncated.
 * 4. **A run with no spans at all** returns `spans: []` and the page says the
 *    run has no step trace. It never falls back to inferring a tree from the
 *    events, because a tree DASH made up is exactly the thing this feature must
 *    not produce.
 *
 * ## A cycle is a gap too
 *
 * Parentage comes from an agent, which is a separate program of unknown quality,
 * so `a → b → a` is a document DASH can receive. Walking it naively hangs the
 * renderer. The walk below is depth-bounded and visit-marked, and anything it
 * could not place ends up in `orphans` beside the genuinely parentless — the
 * same honest bucket, because from a reader's point of view they are the same
 * fact: DASH cannot say where this belongs.
 *
 * ## Pure
 *
 * No value import from anything that reaches a Node builtin: this is imported by
 * a `"use client"` component and `tests/client-bundle.test.ts` is the gate. The
 * type import from `../contracts` is erased.
 */

import type { RunSpan } from "../contracts";

/** How deep the tree may go before the walk stops descending. */
const MAX_DEPTH = 24;

/** One node of the tree the page draws. */
export interface TraceNode {
  span: RunSpan;
  /** Nested operations, in the order they opened. */
  children: TraceNode[];
  /** How far down this sits, so a renderer can indent without recursion. */
  depth: number;
}

export interface RunTraceView {
  /**
   * The run's own root spans, in the order they opened.
   *
   * Plural because a run *should* have one and DASH does not enforce it. An
   * agent that opened two roots gets two drawn, which is a truthful picture of
   * an odd run and a better one than picking a winner.
   */
  roots: TraceNode[];
  /**
   * Spans naming a parent DASH never received, or sitting in a cycle.
   *
   * Each is a subtree in its own right: an orphan with children keeps them, so
   * the piece that is missing is one link rather than a branch.
   */
  orphans: TraceNode[];
  /** How many spans there are in total, across roots and orphans. */
  total: number;
  /** Spans the per-run cap refused. Zero on every ordinary run. */
  dropped: number;
  /**
   * Whether the run has stopped, which changes what an unfinished span means.
   *
   * Passed in from the run's own events rather than inferred from the spans: a
   * root span with no end is exactly the case where the spans cannot say, and
   * asking them would be asking the unfinished thing whether it finished.
   */
  run_is_over: boolean;
}

/** The empty trace. Not an error, and the ordinary answer for an older agent. */
export function emptyRunTrace(runIsOver: boolean): RunTraceView {
  return { roots: [], orphans: [], total: 0, dropped: 0, run_is_over: runIsOver };
}

/**
 * Build the tree.
 *
 * Two passes and no recursion into untrusted data. The first indexes every span
 * by id and by parent; the second walks down from each root with an explicit
 * stack, marking every span it places. Whatever the walk did not reach is
 * unreachable from any root — an orphan, or a member of a cycle — and is walked
 * again from its own shallowest unplaced member so its children come with it.
 */
export function buildRunTrace(
  spans: readonly RunSpan[],
  options: { dropped?: number; runIsOver: boolean },
): RunTraceView {
  const dropped = options.dropped ?? 0;
  if (spans.length === 0) {
    return { ...emptyRunTrace(options.runIsOver), dropped };
  }

  const byId = new Map<string, RunSpan>();
  for (const span of spans) {
    // First writer wins on a duplicate id. The store's primary key makes this
    // unreachable from SQLite, and this module is also called with a fixture
    // list in tests — where a duplicate would otherwise silently double a
    // subtree, which is the failure this line makes impossible instead of
    // unlikely.
    if (!byId.has(span.span_id)) {
      byId.set(span.span_id, span);
    }
  }

  const childrenOf = new Map<string, RunSpan[]>();
  const rootSpans: RunSpan[] = [];
  const orphanSpans: RunSpan[] = [];

  for (const span of byId.values()) {
    const parent = span.parent_span_id;
    if (parent === null || parent === undefined) {
      rootSpans.push(span);
      continue;
    }
    if (!byId.has(parent)) {
      // Named a parent that never arrived. Kept as written; see the header.
      orphanSpans.push(span);
      continue;
    }
    const siblings = childrenOf.get(parent);
    if (siblings === undefined) {
      childrenOf.set(parent, [span]);
    } else {
      siblings.push(span);
    }
  }

  for (const siblings of childrenOf.values()) {
    siblings.sort(compareByStart);
  }
  rootSpans.sort(compareByStart);
  orphanSpans.sort(compareByStart);

  const placed = new Set<string>();
  const roots = rootSpans.map((span) => grow(span, 0, childrenOf, placed));
  const orphans = orphanSpans.map((span) => grow(span, 0, childrenOf, placed));

  /*
   * Anything still unplaced is in a cycle: every span in it has a parent that
   * exists, so it was never a root and never an orphan, and no root's walk can
   * reach it. It is drawn beside the orphans because it is the same fact to a
   * reader — DASH cannot say where this belongs — and because leaving it out
   * would make the count on the page disagree with the list under it.
   */
  for (const span of byId.values()) {
    if (!placed.has(span.span_id)) {
      orphans.push(grow(span, 0, childrenOf, placed));
    }
  }

  return {
    roots,
    orphans,
    total: countNodes(roots) + countNodes(orphans),
    dropped,
    run_is_over: options.runIsOver,
  };
}

/**
 * One subtree, grown with an explicit depth bound.
 *
 * `placed` is checked before descending as well as marked on arrival, so a cycle
 * terminates on its second visit rather than on the depth bound — the bound is
 * the second guard, for a legitimately deep tree an agent built by accident.
 */
function grow(
  span: RunSpan,
  depth: number,
  childrenOf: Map<string, RunSpan[]>,
  placed: Set<string>,
): TraceNode {
  placed.add(span.span_id);
  const node: TraceNode = { span, children: [], depth };
  if (depth >= MAX_DEPTH) {
    return node;
  }
  for (const child of childrenOf.get(span.span_id) ?? []) {
    if (placed.has(child.span_id)) {
      continue;
    }
    node.children.push(grow(child, depth + 1, childrenOf, placed));
  }
  return node;
}

function countNodes(nodes: readonly TraceNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += 1 + countNodes(node.children);
  }
  return total;
}

/**
 * Order by when the operation opened.
 *
 * Parsed rather than compared as strings, for `lib/views/run-progress.ts`'s
 * reason exactly: the schema says date-time and does not say UTC, so
 * `2026-09-07T15:10:14+02:00` and `2026-09-07T13:10:21.000Z` are both legal and
 * a lexical comparison answers by their hour digits. The span id breaks a tie so
 * two operations opened in the same millisecond draw in a stable order rather
 * than in whatever order the rows came back.
 */
function compareByStart(a: RunSpan, b: RunSpan): number {
  const left = new Date(a.started_at).getTime();
  const right = new Date(b.started_at).getTime();
  if (Number.isNaN(left) || Number.isNaN(right) || left === right) {
    return a.span_id < b.span_id ? -1 : a.span_id > b.span_id ? 1 : 0;
  }
  return left - right;
}

/**
 * Whether this span reported an ending at all.
 *
 * The page draws the two unfinished cases differently and this is what tells
 * them apart. A span with no `ended_at` on a run that is still going is
 * ordinary; the same span on a run that stopped is a thing the agent died
 * inside.
 */
export function spanNeverFinished(span: RunSpan, runIsOver: boolean): boolean {
  return runIsOver && (span.ended_at === null || span.ended_at === undefined);
}
