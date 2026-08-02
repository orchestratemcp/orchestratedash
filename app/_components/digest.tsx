import type { ReactNode } from "react";

import type { GroundingAnalysis } from "../../lib/analyze";
import { describeDigestGaps, describeSourceFailure } from "../../lib/copy/recovery";
import type { RunArtifact } from "../../lib/contracts";

/**
 * A digest, with where each item came from (MAR-457).
 *
 * ## Uncited items are shown, not hidden
 *
 * The tempting rendering drops an item with no source, so the digest looks
 * clean. That is precisely how a grounded verdict becomes theatre: the run
 * scores well by concealing the evidence against it, and the user reads a
 * shorter digest with no idea anything was removed. An uncited item is marked
 * and kept.
 *
 * ## Links are named, never printed
 *
 * The link text is the headline. A bare address is unreadable, tells a person
 * nothing about where they are going, and — see `lib/copy/identifiers.ts` — is
 * the shape of thing the plain-language rule exists to keep out of the guided
 * path. The source's *name* is what the user recognises; its address is what
 * the anchor carries.
 */

export function Digest({
  artifact,
  grounding,
}: {
  artifact: RunArtifact;
  grounding: GroundingAnalysis | null;
}): ReactNode {
  const uncited = new Set(grounding?.uncited ?? []);
  const unsupported = new Set((grounding?.unsupported ?? []).map((entry) => entry.headline));
  const gap = describeDigestGaps(artifact.sources_fetched ?? []);

  return (
    <section className="section" aria-labelledby="digest-heading">
      <div className="section-heading">
        <h2 id="digest-heading">{artifact.title}</h2>
        <GroundingChip grounding={grounding} />
      </div>

      {gap === null ? null : (
        <div className="notice notice-err" role="status">
          <p>
            <strong>{gap.headline}</strong>
          </p>
          <p>{gap.meaning}</p>
          <p>{gap.next_action}</p>
        </div>
      )}

      {artifact.items.length === 0 ? (
        /* Not an error, and not worded as one. A run that read its sources and
           found nothing new did its job. */
        <p className="muted">Nothing new was found this time.</p>
      ) : (
        <ol className="digest-items">
          {artifact.items.map((item, index) => (
            <li key={`${item.headline}:${String(index)}`}>
              <h3>
                {item.item_url === undefined ? (
                  item.headline
                ) : (
                  <a href={item.item_url} rel="noreferrer noopener" target="_blank">
                    {item.headline}
                  </a>
                )}
              </h3>
              {item.summary === undefined ? null : <p className="wrap">{item.summary}</p>}
              <p className="muted">
                {item.source_name ?? "Source not named"}
                {item.published_at === undefined ? "" : ` · ${item.published_at}`}
                {uncited.has(item.headline) ? (
                  <>
                    {" · "}
                    <span className="chip chip-warn">no source given</span>
                  </>
                ) : unsupported.has(item.headline) ? (
                  <>
                    {" · "}
                    <span
                      className="chip chip-warn"
                      title="This item names a source that this run did not report reading"
                    >
                      source not read in this run
                    </span>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ol>
      )}

      <SourceList artifact={artifact} />
    </section>
  );
}

/**
 * Where the digest came from, and what did not work.
 *
 * Every source is listed, including the ones that worked. A list that showed
 * only failures would answer "what went wrong" while leaving "what did this
 * actually read" unanswered — and the second question is the one a person
 * checking a digest they are about to rely on is really asking.
 */
function SourceList({ artifact }: { artifact: RunArtifact }): ReactNode {
  const sources = artifact.sources_fetched ?? [];
  if (sources.length === 0) {
    return null;
  }

  return (
    <details className="digest-sources">
      <summary>Where this came from ({sources.length})</summary>
      <ul>
        {sources.map((source) => {
          const recovery = describeSourceFailure(source);
          return (
            <li key={source.source_url}>
              <strong>{source.source_name}</strong>
              {source.item_count === undefined ? null : (
                <span className="muted">
                  {" "}
                  · {source.item_count} item{source.item_count === 1 ? "" : "s"}
                </span>
              )}
              {recovery === null ? null : (
                <div className={source.status === "empty" ? "notice" : "notice notice-err"}>
                  <p>
                    <strong>{recovery.headline}</strong>
                  </p>
                  <p>{recovery.meaning}</p>
                  <p>{recovery.next_action}</p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * The grounding verdict, as its own chip.
 *
 * Rendered beside the digest rather than beside the plan-vs-actual chips, and
 * never merged with them. See `lib/analyze.ts`: `compliant` means the run
 * honoured its safety contract, and a missing citation must not be able to
 * dilute what that word means.
 *
 * `unverifiable` is worded as an absence of evidence rather than as a fault,
 * because that is what it is — the artifact never said what it read, so DASH
 * has nothing to check and says so instead of guessing.
 */
export function GroundingChip({
  grounding,
}: {
  grounding: GroundingAnalysis | null;
}): ReactNode {
  if (grounding === null) {
    return null;
  }

  if (grounding.verdict === "unverifiable") {
    return (
      <span
        className="chip chip-muted"
        title="This digest did not say which sources it read, so DASH cannot check its citations"
      >
        sources not stated
      </span>
    );
  }

  if (grounding.verdict === "grounded") {
    return (
      <span
        className="chip chip-ok"
        title="Every item names a source this run reported reading. DASH checks the digest against its own report, not against the web."
      >
        every item sourced
      </span>
    );
  }

  const missing = grounding.uncited.length + grounding.unsupported.length;
  return (
    <span
      className="chip chip-warn"
      title="Some items do not name a source this run reported reading"
    >
      {missing} of {grounding.items_total} unsourced
    </span>
  );
}
