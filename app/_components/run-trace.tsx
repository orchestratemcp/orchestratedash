"use client";

import type { ReactNode } from "react";

import {
  RUN_TRACE_EMPTY,
  RUN_TRACE_EMPTY_WHY,
  RUN_TRACE_LEDE,
  RUN_TRACE_TITLE,
  TRACE_NEVER_FINISHED,
  TRACE_ORPHAN_TITLE,
  TRACE_ORPHAN_WHY,
  describeAttempt,
  describeDroppedSpans,
  describeSpanDuration,
  describeSpanKind,
  describeSpanOutcome,
  describeSpanUsage,
} from "../../lib/copy/run-trace";
import { spanNeverFinished, type RunTraceView, type TraceNode } from "../../lib/views/run-trace";

/**
 * The run's operations, as a tree (MAR-889).
 *
 * ## What a reader is meant to take from it
 *
 * Which step failed, and which one worked on the second try. That is the whole
 * question the flat event list below it could not answer, and everything drawn
 * here is in service of it: the outcome word comes first on each row, a failed
 * operation carries its own message rather than sending the reader to the log,
 * and a retry sits beside the try that failed instead of replacing it.
 *
 * ## What it is careful not to say
 *
 * That anything was *right*. `lib/copy/run-trace.ts` holds the argument and the
 * words; the thing this component contributes is not undoing them with colour. A
 * finished operation gets a neutral chip, never the emerald reserved for a live,
 * healthy thing — a column of green ticks reads as "this run was correct", which
 * DASH has no way to know. `.chip-ok` is the vocabulary the run detail page
 * already uses for "ran", which is the same claim.
 *
 * ## Every gap is drawn
 *
 * A span whose parent never arrived appears under its own heading rather than
 * being promoted to the top; an operation that never reported an ending says so;
 * a truncated trace says how much is missing; and a run with no spans says it
 * has no trace instead of showing an empty box. `lib/views/run-trace.ts` decides
 * all four and this draws what it decided.
 *
 * ## Ids are behind the disclosure
 *
 * A span id is a UUID an agent minted and it is in nobody's primary copy. It is
 * in a `<details>` per operation, because the one person who needs it is
 * somebody comparing this page to an agent's own log, and they will look.
 */
export function RunTraceSection({ trace }: { trace: RunTraceView }): ReactNode {
  const dropped = describeDroppedSpans(trace.dropped);

  return (
    <div className="section run-trace">
      <h2>{RUN_TRACE_TITLE}</h2>
      <p className="muted wrap">{RUN_TRACE_LEDE}</p>

      {trace.total === 0 ? (
        <div className="empty">
          <p>{RUN_TRACE_EMPTY}</p>
          <p className="muted wrap">{RUN_TRACE_EMPTY_WHY}</p>
        </div>
      ) : (
        <>
          {dropped === null ? null : (
            <p className="run-trace-note wrap" role="status">
              {dropped}
            </p>
          )}
          <TraceList nodes={trace.roots} runIsOver={trace.run_is_over} />
          {trace.orphans.length === 0 ? null : (
            <div className="run-trace-orphans">
              <h3>{TRACE_ORPHAN_TITLE}</h3>
              <p className="muted wrap">{TRACE_ORPHAN_WHY}</p>
              <TraceList nodes={trace.orphans} runIsOver={trace.run_is_over} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One level of the tree.
 *
 * Nested `<ol>`s rather than a flattened list with an indent class: the nesting
 * *is* the information, and a screen reader announcing "list, 3 items" inside
 * "list, 4 items" conveys it without needing to see the indentation. The depth
 * the builder computed is still carried, as a CSS custom property, so the visual
 * indent does not depend on how deeply the markup happens to nest.
 */
function TraceList({
  nodes,
  runIsOver,
}: {
  nodes: readonly TraceNode[];
  runIsOver: boolean;
}): ReactNode {
  if (nodes.length === 0) {
    return null;
  }
  return (
    <ol className="run-trace-list">
      {nodes.map((node) => (
        <li key={node.span.span_id}>
          <TraceRow node={node} runIsOver={runIsOver} />
          <TraceList nodes={node.children} runIsOver={runIsOver} />
        </li>
      ))}
    </ol>
  );
}

function TraceRow({ node, runIsOver }: { node: TraceNode; runIsOver: boolean }): ReactNode {
  const span = node.span;
  const outcome = describeSpanOutcome(span.status, runIsOver);
  const duration = describeSpanDuration(span.started_at, span.ended_at ?? null);
  const attempt = describeAttempt(span.attributes?.["attempt"]);
  const usage = describeSpanUsage(span.usage ?? null);
  const message = typeof span.error?.message === "string" ? span.error.message : null;
  const code = typeof span.error?.code === "string" ? span.error.code : null;

  return (
    <article
      className={span.status === "error" ? "run-trace-row is-failed" : "run-trace-row"}
      style={{ "--trace-depth": String(node.depth) } as Record<string, string>}
    >
      <div className="run-trace-head">
        <h3 className="run-trace-name wrap">{span.name}</h3>
        <span className={outcomeChip(span.status)}>{outcome}</span>
        {attempt === null ? null : <span className="chip chip-muted">{attempt}</span>}
      </div>

      <p className="run-trace-meta muted wrap">
        {describeSpanKind(span.kind)}
        {duration === null ? null : <> &middot; {duration}</>}
      </p>

      {/* The message the operation failed with, on the operation. This is the
          line the whole section exists to put in front of somebody: without it
          a failed step is a red chip and a trip to the log. */}
      {span.status === "error" && (message !== null || code !== null) ? (
        <p className="run-trace-error wrap">{message ?? code}</p>
      ) : null}

      {spanNeverFinished(span, runIsOver) ? (
        <p className="run-trace-error wrap">{TRACE_NEVER_FINISHED}</p>
      ) : null}

      {usage === null ? null : <p className="run-trace-usage muted wrap">{usage}</p>}

      {/* The identifiers, where a person who wants them will look and nobody
          else has to read them. See the component docblock. */}
      <details className="run-trace-ids">
        <summary>Technical detail</summary>
        <dl className="facts">
          <div>
            <dt>Operation</dt>
            <dd>
              <code>{span.span_id}</code>
            </dd>
          </div>
          {span.parent_span_id === null ? null : (
            <div>
              <dt>Inside</dt>
              <dd>
                <code>{span.parent_span_id}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>Started</dt>
            <dd>{span.started_at}</dd>
          </div>
          {span.ended_at === null || span.ended_at === undefined ? null : (
            <div>
              <dt>Ended</dt>
              <dd>{span.ended_at}</dd>
            </div>
          )}
          {Object.entries(span.attributes ?? {}).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd className="wrap">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );
}

/**
 * The chip class for an outcome.
 *
 * `chip-ok` for a finished operation and never anything greener: this page
 * already uses it for "ran", which is the same claim — the step happened — and
 * the emerald `app/tokens.css` reserves is for a live, healthy thing. A run that
 * finished is neither live nor known to be healthy.
 */
function outcomeChip(status: string): string {
  if (status === "error") {
    return "chip chip-warn";
  }
  if (status === "ok") {
    return "chip chip-ok";
  }
  return "chip chip-muted";
}
