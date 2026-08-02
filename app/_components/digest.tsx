import type { ReactNode } from "react";

import type { GroundingAnalysis } from "../../lib/analyze";
import { describeDigestGaps, describeSourceFailure } from "../../lib/copy/recovery";
import type { DigestArtifact, DraftArtifact } from "../../lib/contracts";

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
  artifact: DigestArtifact;
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
function SourceList({ artifact }: { artifact: DigestArtifact }): ReactNode {
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
 * A reply an agent wrote, held locally (MAR-458).
 *
 * ## The sentence at the top is the whole component
 *
 * "DASH is holding this. Nothing has been sent and nothing has been saved to
 * your mail." Everything else here is presentation; that line is the honesty
 * requirement, and it is rendered before the draft rather than under it because
 * a person scanning this needs to know what it is *not* before they read what it
 * says.
 *
 * It is true by construction rather than by promise. ADR 0002's first slice
 * gives the broker `gmail.search` and `gmail.message.read` and nothing else —
 * no send operation and no provider-side draft creation — so there is no code
 * path from this artifact to the user's Gmail account. `PROJECT_STATE.md` records
 * the failure this avoids: `network: read` is "a declaration DASH renders, not a
 * boundary DASH enforces", and every surface has to say which it is. This one is
 * the enforced kind, and says so plainly rather than leaving the user to guess.
 *
 * ## Why the body is plain text in a `pre`
 *
 * The draft is composed from message content, which ADR 0002 invariant 7 calls
 * untrusted data. React escapes it either way; a `pre` also stops a reply whose
 * body is one 20,000-character line from stretching the page, and keeps the
 * agent's own line breaks — which are part of what the user is reviewing.
 */
export function Draft({ artifact }: { artifact: DraftArtifact }): ReactNode {
  const { draft } = artifact;
  const recipients = draft.to ?? [];
  const sources = draft.sources ?? [];

  return (
    <section className="section" aria-labelledby="draft-heading">
      <div className="section-heading">
        <h2 id="draft-heading">{artifact.title}</h2>
        <span
          className="chip chip-ok"
          title="DASH has no operation that could send this or save it to your mail"
        >
          held here only
        </span>
      </div>

      <div className="notice" role="status">
        <p>
          <strong>DASH is holding this reply. Nothing has been sent.</strong>
        </p>
        <p>
          It has not been saved to your mail either. The agent can read the messages you
          approved and write a reply here; it has no way to send one or to put one in your
          drafts folder.
        </p>
      </div>

      <dl className="draft-headers">
        <dt>To</dt>
        <dd>{recipients.length === 0 ? <span className="muted">Not addressed</span> : recipients.join(", ")}</dd>
        <dt>Subject</dt>
        <dd>{draft.subject}</dd>
      </dl>

      <pre className="draft-body wrap">{draft.body}</pre>

      {sources.length === 0 ? null : (
        <details className="digest-sources">
          <summary>Messages it read to write this ({sources.length})</summary>
          <ul>
            {sources.map((source) => (
              <li key={source.message_id}>
                <strong>{source.subject ?? "No subject"}</strong>
                {source.from === undefined ? null : <span className="muted"> · {source.from}</span>}
              </li>
            ))}
          </ul>
          {/* The agent's own account of what it read. The broker's audit trail
              is the independent record, and it is on the Connections page
              rather than duplicated here — one place to check a claim is worth
              more than two that can disagree. */}
          <p className="muted">
            This is the agent&apos;s own account. What DASH actually let it read is on the
            Connections page.
          </p>
        </details>
      )}
    </section>
  );
}

/**
 * Render whatever a run produced, by kind (MAR-458).
 *
 * One component both pages call, rather than a `kind` ternary repeated at each
 * call site. The reason is the same one that made `RunArtifact` a union: adding
 * a third kind should be a compile error in exactly one place, and a page that
 * forgot to handle it should not silently render nothing.
 *
 * `grounding` is only ever a digest's, which is why it is passed through rather
 * than looked up here — `lib/views/build.ts` already refuses to grade a draft.
 */
export function RunOutput({
  artifact,
  grounding,
}: {
  artifact: DigestArtifact | DraftArtifact;
  grounding: GroundingAnalysis | null;
}): ReactNode {
  switch (artifact.kind) {
    case "digest":
      return <Digest artifact={artifact} grounding={grounding} />;
    case "draft":
      return <Draft artifact={artifact} />;
    default: {
      const unreachable: never = artifact;
      throw new Error(`Unhandled artifact kind: ${JSON.stringify(unreachable)}`);
    }
  }
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
