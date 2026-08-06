import type { ReactNode } from "react";

import type { GroundingAnalysis } from "../../lib/analyze";
import { OUTPUTS_PANEL_COPY as COPY } from "../../lib/copy/artifacts";
import { canPreview, type ArtifactCardView } from "../../lib/views/artifacts";
import { DigestBody, DraftBody, DraftPlacementChip, GroundingChip } from "./digest";

/**
 * Everything a run produced (MAR-434).
 *
 * ## Why this replaced a single call to `RunOutput`
 *
 * The run detail page rendered `view.artifacts[0]` and nothing else. That is
 * fine for a run with one output and silently wrong for a run with two: the
 * store keeps every artifact a run sent, the page showed the newest, and
 * nothing on screen said a second one existed. An agent that writes a digest
 * *and* a reply had half its work invisible.
 *
 * ## A card list, not a table
 *
 * MAR-491 records that every table in DASH becomes a 1425px horizontal
 * scroller at 375px wide, and a table of outputs would inherit that on the day
 * it shipped. Cards reflow. The receipt inside each card is a description list
 * rather than a row, for the same reason.
 *
 * ## What is on the guided path here, and what is not
 *
 * Role labels, purposes, receipt labels and every recovery sentence are guided
 * copy and are asserted against `lib/copy/identifiers.ts` in
 * `tests/outputs-panel.test.ts`. The developer disclosure at the foot of each
 * card is the one place raw identifiers are allowed, which is the whole reason
 * it is a disclosure — `lib/views/artifacts.ts` keeps them in a named field so
 * that the exception is greppable rather than scattered.
 *
 * Note what the receipt does *not* carry: the run's own id. This panel only
 * ever renders on that run's page, so "which run made this" is answered by
 * where the reader already is, and printing the id would put an opaque string
 * in a monospace slot on a surface a normal person is meant to read.
 */
export function OutputsPanel({
  cards,
  grounding,
}: {
  cards: readonly ArtifactCardView[];
  grounding: GroundingAnalysis | null;
}): ReactNode {
  return (
    <section className="section" aria-labelledby="outputs-heading">
      <div className="section-heading">
        <h2 id="outputs-heading">{COPY.heading}</h2>
      </div>

      {cards.length === 0 ? (
        /* Said rather than left blank. A panel that disappears when a run
           produced nothing leaves the reader unable to tell "nothing was made"
           from "DASH is not showing me what was made", and those are very
           different things to learn about an agent you are deciding to trust. */
        <p className="muted">{COPY.empty}</p>
      ) : (
        <ol className="output-list">
          {cards.map((card, index) => (
            <li key={`${card.reference.artifact_id}:${String(index)}`}>
              <OutputCard
                card={card}
                /* Only the newest digest is graded, which is the rule
                   `lib/views/build.ts` already applies when it computes the
                   verdict. Hanging that chip on an older artifact would report
                   a score against text this card is not showing.

                   The kind is compared directly rather than through
                   `isDigestArtifact`. That helper lives in `lib/contracts.ts`,
                   which reads the JSON schemas off disk, and importing it as a
                   *value* into a `"use client"` tree drags `node:fs` into the
                   browser bundle and 500s the page. Types from that module
                   erase and are safe; functions from it are not. */
                grounding={index === 0 && card.artifact.kind === "digest" ? grounding : null}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function OutputCard({
  card,
  grounding,
}: {
  card: ArtifactCardView;
  grounding: GroundingAnalysis | null;
}): ReactNode {
  const { artifact, role, receipt, recovery, reference } = card;

  return (
    <article className={recovery === null ? "output-card" : "output-card is-unavailable"}>
      <div className="section-heading">
        <div className="output-identity">
          <p className="eyebrow">{role.label}</p>
          {/* The display name gets the monospace face; the vocabulary around
              it does not. MAR-420's rule, and the reason the role label above
              is set in the interface font. */}
          <h3 className="value">{artifact.title}</h3>
        </div>
        <div className="output-chips">
          {artifact.kind === "draft" ? <DraftPlacementChip artifact={artifact} /> : null}
          <GroundingChip grounding={grounding} />
        </div>
      </div>

      <p className="muted">{role.purpose}</p>

      {recovery === null ? null : (
        <div className="notice notice-err" role="status">
          <p>
            <strong>{recovery.headline}</strong>
          </p>
          <p>{recovery.meaning}</p>
          <p className="next-action">{recovery.next_action}</p>
        </div>
      )}

      {/* The receipt is rendered in every density and in every availability
          state. A compact DASH shows the same facts in less space — an output
          that is missing still has a provenance a person needs in order to
          work out what happened to it. */}
      <dl className="facts output-receipt">
        <div>
          <dt>{COPY.receipt.agent}</dt>
          <dd className="value">{receipt.agent}</dd>
        </div>
        <div>
          <dt>{COPY.receipt.stated_at}</dt>
          <dd className="value">{receipt.stated_at}</dd>
        </div>
        <div>
          <dt>{COPY.receipt.received_at}</dt>
          <dd className="value">{receipt.received_at}</dd>
        </div>
        <div>
          <dt>{COPY.receipt.size}</dt>
          <dd className="value">{receipt.size}</dd>
        </div>
      </dl>

      <OutputContent card={card} grounding={grounding} />

      <details className="output-developer">
        <summary>{COPY.developer_summary}</summary>
        {/* The only place in this panel where DASH's internal names are shown.
            They are values a developer pastes into a bug report, which is why
            they are here at all and why they are behind a disclosure. */}
        <dl className="facts">
          <div>
            <dt>Agent</dt>
            <dd className="value">{reference.agent}</dd>
          </div>
          <div>
            <dt>Run</dt>
            <dd className="value">{reference.run_id}</dd>
          </div>
          <div>
            <dt>Artifact</dt>
            <dd className="value">{reference.artifact_id}</dd>
          </div>
          <div>
            <dt>Kind</dt>
            <dd className="value">{reference.kind}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

/**
 * The output itself, or an honest account of why it is not shown.
 *
 * Three branches, and the third is the one worth having. A format DASH does not
 * know is **not** an error and does not render as one: the record arrived
 * intact, DASH is keeping it, and the only missing thing is this build's
 * ability to lay it out. Offering the record as it came is a truthful answer;
 * an empty preview pane with an apology in it would tell the user their output
 * is broken when it is not.
 */
function OutputContent({
  card,
  grounding,
}: {
  card: ArtifactCardView;
  grounding: GroundingAnalysis | null;
}): ReactNode {
  const { artifact } = card;

  if (!canPreview(card)) {
    if (card.availability !== "available") {
      // Nothing to show and the recovery above has already said why. A second
      // explanation here would be the same sentence twice.
      return null;
    }
    return (
      <details className="output-developer">
        <summary>{COPY.reveal}</summary>
        <pre className="wrap">{JSON.stringify(artifact, null, 2)}</pre>
      </details>
    );
  }

  switch (artifact.kind) {
    case "digest":
      return <DigestBody artifact={artifact} grounding={grounding} />;
    case "draft":
      return <DraftBody artifact={artifact} />;
    default:
      // Unreachable through the union, and deliberately not a throw. The kinds
      // are validated against a JSON schema at the boundary and narrowed by a
      // union in the renderer, and those are two authorities that can disagree
      // across a version. A page a user is reading must not crash on the day
      // they do; `canPreview` already routed every unknown kind above.
      return null;
  }
}
