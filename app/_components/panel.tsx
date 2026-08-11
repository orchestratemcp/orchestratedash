import type { ReactNode } from "react";

import { OUTPUTS_PANEL_COPY } from "../../lib/copy/artifacts";
import {
  PANEL_CELL_ABSENT,
  PANEL_COPY,
  PANEL_METRIC_EMPTY,
  type PanelCard,
  type PanelEmptyState,
} from "../../lib/copy/panel";
import { canPreview, type ArtifactCardView } from "../../lib/views/artifacts";
import type {
  PanelMetricsView,
  PanelNoteView,
  PanelOutputsView,
  PanelReportView,
  PanelSectionView,
  PanelTableView,
  PanelView,
} from "../../lib/views/panel";
import { DigestBody, DraftBody } from "./digest";

/**
 * The panel an agent's author declared, drawn by DASH's own components
 * (MAR-554, ADR 0008 slice 3).
 *
 * The whole of this file is a `switch` over a closed union and five small
 * renderers, and that is the feature rather than an implementation detail. ADR
 * 0008's security argument is that a panel is *data over a closed vocabulary*:
 * "what a panel can make DASH draw is one closed union, checkable by reading
 * `$defs.panelSectionV1`". This file is the other half of that sentence — what
 * the union actually draws is checkable by reading one function.
 *
 * ## The absences are the argument
 *
 * There is no `dangerouslySetInnerHTML` here and there is nowhere for one to go:
 * every author string arrives as a text node through JSX, which escapes. There
 * is no URL, no path, no image and no agent name anywhere in the vocabulary, so
 * no component below takes one. And **there is no control**: no button, no
 * toggle, no input, no form. That is the strongest claim in ADR 0008 and it is
 * worth naming what it cost — the Outputs area's "Save a copy" button is
 * deliberately *not* repeated inside a panel `outputs` section, even though it
 * is DASH's own control and would be handy. A box the author frames is the one
 * place a control could be made to look like it belonged to something it does
 * not, and the workspace's own Outputs area offers the same action three inches
 * away.
 *
 * One honest qualification, because the claim is worth stating exactly: a
 * digest's *own* items can carry a source link, and `DigestBody` draws it here
 * as it already draws it on the run detail page and in the Outputs area. That
 * link is the artifact contract's, not the panel vocabulary's — no section type
 * takes a URL, and `tests/panel-render.test.tsx` pins the difference by
 * rendering a digest with no links and finding none.
 *
 * ## One attributed region, and nothing inside it wears DASH's voice
 *
 * Everything the panel draws sits inside a single `<section>` whose eyebrow and
 * attribution sentence are DASH's copy (`lib/copy/panel.ts`). DASH's verdicts —
 * grounding, compliance, permission receipts — render outside it, which is why
 * `grounding` is passed as `null` to every digest below rather than threaded
 * through: a grounding chip is DASH grading an agent's work, and inside the
 * author's own box it would read as the author's own badge.
 *
 * ## No raw identifier reaches this surface at all
 *
 * Not "only behind a disclosure", which is the rule `app/_components/outputs.tsx`
 * lives by — **none**. `PanelSectionView` does not carry a section id,
 * `PanelMetricView` does not carry a metric id, and no card here renders the
 * developer disclosure that holds an artifact's internal names. Those values are
 * still reachable, on the run detail page and in the workspace's Outputs area,
 * where a developer disclosure already exists and is already tested. A second
 * copy of them inside a box somebody else framed buys nothing and is one more
 * place for `lib/copy/identifiers.ts`'s rule to spring a leak.
 *
 * ## Heading levels, and why an output's title is not one
 *
 * The region is an `h2` and each section's author-declared label is an `h3`. An
 * artifact's own title is rendered as a value rather than as a heading, so a
 * digest's item headings — `h3`, from `DigestBody`, unchanged since MAR-434 —
 * sit at the level below their section rather than jumping back up a level from
 * an `h4` card. The navigable structure of the panel is the author's sections,
 * which is what a person moving by heading is looking for; the cards under one
 * are records in an ordered list, and the list is what says so.
 */
export function AgentPanel({ view }: { view: PanelView }): ReactNode {
  /*
   * Absence renders nothing. Not an empty frame, not a "this agent declared no
   * panel" placeholder — the rule `task_inputs` shipped with, restated because
   * the other reading is available and wrong: an agent that declared no panel is
   * not an agent that gets a default one.
   */
  if (view.kind === "none") {
    return null;
  }

  return (
    <section className="section agent-panel" aria-labelledby="agent-panel-heading">
      <div className="agent-panel-head">
        {/* DASH's words, always. This is what marks the box as somebody else's. */}
        <p className="eyebrow">{PANEL_COPY.eyebrow}</p>
        {/* The author's title, or DASH's own when they declared none. */}
        <h2 id="agent-panel-heading">{view.title}</h2>
        <p className="muted wrap agent-panel-attribution">{PANEL_COPY.attribution}</p>
      </div>

      {view.kind === "declared" ? (
        <div className="agent-panel-sections">
          {view.sections.map((section) => (
            <PanelSection key={String(section.at)} section={section} />
          ))}
        </div>
      ) : (
        /*
         * One stated card and nothing else, for both the newer-version and the
         * unreadable case. `PanelView` carries no sections for either, so this
         * branch has nothing to iterate even if a later edit wanted it to —
         * which is ADR 0008's "never partially" holding structurally rather than
         * by this component remembering.
         */
        <StatedCard card={view.card} />
      )}
    </section>
  );
}

/**
 * The five components, and the one place a sixth would break the build.
 *
 * `PanelSectionView` is discriminated by `kind`, so adding a section type to
 * `PANEL_SECTION_TYPES_V1` without adding a branch here is a type error at this
 * switch rather than a section that silently renders nothing. That is the
 * `HOST_VERBS` discipline applied to a renderer: widening what agent-authored
 * data can make DASH draw has to be a change somebody defends in one place.
 */
function PanelSection({ section }: { section: PanelSectionView }): ReactNode {
  return (
    <article className="agent-panel-section">
      {/* The author's own label, and never the section's id. */}
      <h3>{section.label}</h3>
      <SectionBody section={section} />
    </article>
  );
}

function SectionBody({ section }: { section: PanelSectionView }): ReactNode {
  switch (section.kind) {
    case "report":
      return <ReportSection section={section} />;
    case "outputs":
      return <OutputsSection section={section} />;
    case "table":
      return <TableSection section={section} />;
    case "metrics":
      return <MetricsSection section={section} />;
    case "note":
      return <NoteSection section={section} />;
  }
}

/**
 * The newest output of one role, with its receipt.
 *
 * Henrik's "custom output/report area", and for the sample agent it is one
 * section bound to the digest. The card is the same shape the Outputs area
 * draws, because it is built from the same `ArtifactCardView` — a role label, a
 * purpose, the two-clock receipt, and the thing itself when DASH knows how to
 * lay it out.
 */
function ReportSection({ section }: { section: PanelReportView }): ReactNode {
  if (section.card === null) {
    return <StatedEmpty empty={section.empty} />;
  }
  return <PanelArtifactCard card={section.card} />;
}

/**
 * Every output of a role, capped by the author.
 *
 * A card list rather than a table, which is MAR-491's finding applied where it
 * was found: every table in DASH became a 1425px horizontal scroller at 375px
 * wide, and a list of records is exactly the population that happened to.
 */
function OutputsSection({ section }: { section: PanelOutputsView }): ReactNode {
  if (section.cards.length === 0) {
    return <StatedEmpty empty={section.empty} />;
  }
  return (
    <>
      <ol className="output-list">
        {section.cards.map((card, index) => (
          <li key={`${card.artifact.title}:${String(index)}`}>
            <PanelArtifactCard card={card} />
          </li>
        ))}
      </ol>
      {/* The author's own display choice, said rather than left to be noticed. */}
      {section.capped === null ? null : <p className="muted">{section.capped}</p>}
    </>
  );
}

/**
 * The one table in DASH, and why it is allowed to be one.
 *
 * MAR-491's rule — every list of *records* is a card list — is about populations
 * DASH does not control the shape of: an agent's name, a correlation id, a
 * plan's detail sentence, in columns whose widths are arithmetic that always
 * loses at 375px. A panel table is a different population. The author declared
 * at most eight columns and named each one, the values are theirs, and the thing
 * they asked for is a grid of small values read across — which a card list
 * genuinely cannot show.
 *
 * So it is a real `<table>`, and the 375px problem is answered where MAR-491
 * says it must be: **inside its own box**. The wrapper scrolls horizontally and
 * the page does not, which is the same treatment `.public-key` and
 * `.output-developer pre` already get for content DASH cannot re-flow. The
 * screenshots at 375px are what hold this to it.
 */
function TableSection({ section }: { section: PanelTableView }): ReactNode {
  return (
    <>
      {/* `empty` is null exactly when there are rows — `buildTable` sets one
          from the other, so this is the three empty cases deciding the branch
          rather than the branch deciding for itself. */}
      {section.empty !== null ? (
        <StatedEmpty empty={section.empty} />
      ) : (
        <div className="agent-panel-table-wrap">
          <table className="agent-panel-table">
            <thead>
              <tr>
                {section.columns.map((column, index) => (
                  /* The author's `label`, never the column's `key`. */
                  <th key={String(index)} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((cells, row) => (
                <tr key={String(row)}>
                  {cells.map((cell, column) => (
                    <td key={String(column)}>
                      {cell.text === null ? (
                        /*
                         * Absent, and said. A value that was not the kind the
                         * author declared is not coerced into one — ADR 0008 —
                         * and a cell left genuinely blank would be
                         * indistinguishable from a cell a reader skipped.
                         */
                        <span aria-label={PANEL_CELL_ABSENT} className="agent-panel-absent">
                          —
                        </span>
                      ) : (
                        cell.text
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Both counts, because a silent cap reads as a complete record. */}
      {section.capped === null ? null : <p className="muted">{section.capped}</p>}
      {section.skipped === null ? null : <p className="muted">{section.skipped}</p>}
    </>
  );
}

/**
 * Labelled values, each carrying where it came from.
 *
 * The attribution line is not decoration and is not droppable. An artifact field
 * is *the agent's report* and a DASH fact is *DASH's record*; the two can
 * produce the identical string and are not the same claim, and ADR 0008 is
 * explicit that collapsing them "would let an agent's own number wear DASH's
 * voice". It is rendered inside each value's own `<dd>` so that a stylesheet
 * cannot hide it without hiding the number too.
 */
function MetricsSection({ section }: { section: PanelMetricsView }): ReactNode {
  return (
    <dl className="agent-panel-metrics">
      {section.items.map((item, index) => (
        <div className="agent-panel-metric" key={String(index)}>
          {/* The author's label. Never the metric's id. */}
          <dt>{item.label}</dt>
          <dd>
            {/*
              An absence does not wear the value's face.

              This was one class until the screenshots were read: rendering the
              empty state through `agent-panel-metric-value` drew "Not reported
              yet" at the display step, so on an agent that had never run, three
              metrics shouted their own emptiness in type twice the size of the
              one real number beside them. Stating an empty state is required;
              making it the loudest thing on the card inverts what the surface is
              for. Same argument as the table's absent cell, which is faint for
              the same reason.
            */}
            {item.value === null ? (
              <span className="agent-panel-metric-absent">{PANEL_METRIC_EMPTY}</span>
            ) : (
              <span className="value agent-panel-metric-value">{item.value}</span>
            )}
            <span className="eyebrow agent-panel-attribution-mark">{item.attribution}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The author's own words, with the standing the manifest's `goal` has.
 *
 * Rendered as a text node and bounded by the schema at 400 characters. An author
 * can still say something untrue here — "everything is fine" above a failing run
 * — and ADR 0008's answer is attribution rather than censorship: this block sits
 * inside a region DASH has already labelled as theirs, and nothing in the
 * vocabulary can draw a verdict, a permission card or a control that would let
 * it pass for DASH's own.
 */
function NoteSection({ section }: { section: PanelNoteView }): ReactNode {
  return <p className="wrap agent-panel-note">{section.text}</p>;
}

/**
 * One output, as the Outputs area draws it, minus the two things that do not
 * belong inside somebody else's box.
 *
 * Gone: the "Save a copy" control (no controls in the panel, see above) and the
 * developer disclosure (no raw identifiers on this surface at all). Kept: the
 * role, the purpose, the recovery when the thing is not here, the two-clock
 * receipt, and the body — because those are what make an output a thing a person
 * owns rather than a filename, which was MAR-434's whole argument.
 */
function PanelArtifactCard({ card }: { card: ArtifactCardView }): ReactNode {
  const { artifact, role, receipt, recovery } = card;

  return (
    <article className={recovery === null ? "output-card" : "output-card is-unavailable"}>
      <div className="output-identity">
        <p className="eyebrow">{role.label}</p>
        {/*
          A value, not a heading — see this file's header. The display name gets
          the monospace face and the vocabulary around it does not, which is
          MAR-420's rule and the reason the role label above is in the interface
          font.
        */}
        <p className="value agent-panel-output-title">{artifact.title}</p>
        {/*
          MAR-609. The twin of the line `app/_components/outputs.tsx` grew in
          the same change, and this renderer needed it *first*.

          An `outputs` section is built from `artifactRecordsForAgent` — the
          agent's whole history — so this box has been capable of drawing
          Monday's digest above Tuesday's, with the same role label and the same
          title on both, since MAR-548. Nothing on the card said which was which;
          the moment was in the receipt at the foot, below the entire body of
          each digest, where no one comparing two cards would ever line them up.

          Not a link to the run, unlike the Outputs area's card. This is the
          author's region and DASH's navigation chrome does not go inside it —
          the same rule that keeps "Save a copy" and the developer disclosure
          out. The fact is what was missing; the link is DASH's own affordance
          and belongs on DASH's own surface.
        */}
        <p className="output-when muted">{receipt.stated_at}</p>
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

      {/* MAR-576. The output before the paperwork about it, on the same rule
          `app/_components/outputs.tsx` now follows — and the rule matters more
          here than there, because this region exists to answer "what did the
          scout find?" and this card is the answer.

          Found by looking rather than by reasoning: the Outputs area was fixed
          first, and the packaged-renderer screenshot of a re-imported agent
          showed the receipt still sitting above the headlines *inside the
          author's box*, because this file draws its own card. One defect, two
          renderers, and only the photograph had both in frame. */}
      <PanelArtifactBody card={card} />

      {/* Both clocks, labelled as whose each one is. A single "Created" would
          quietly promote the agent's claim into DASH's record.

          **Moved below the body, and deliberately not folded behind a
          disclosure the way the Outputs area now folds it.** Not because a
          `<details>` would be a control — `DigestBody` already draws one here
          for a digest's sources, and it reaches this region the same way a
          digest item's link does, from the artifact rather than from the
          vocabulary. It is that the fold buys nothing here. The Outputs area
          needs it because a "Save a copy" button and a developer disclosure are
          competing for the same footer; this card has neither, so moving the
          receipt below the body is the whole of the fix, and the region keeps
          one less piece of chrome that an author's box does not need. */}
      <dl className="facts output-receipt">
        <div>
          <dt>{OUTPUTS_PANEL_COPY.receipt.agent}</dt>
          <dd className="value">{receipt.agent}</dd>
        </div>
        <div>
          <dt>{OUTPUTS_PANEL_COPY.receipt.stated_at}</dt>
          <dd className="value">{receipt.stated_at}</dd>
        </div>
        <div>
          <dt>{OUTPUTS_PANEL_COPY.receipt.received_at}</dt>
          <dd className="value">{receipt.received_at}</dd>
        </div>
        <div>
          <dt>{OUTPUTS_PANEL_COPY.receipt.size}</dt>
          <dd className="value">{receipt.size}</dd>
        </div>
      </dl>
    </article>
  );
}

/**
 * The output itself, or nothing — and never an apology in an empty frame.
 *
 * `grounding` is `null` at both call sites and that is the decision rather than
 * an oversight: a grounding chip is DASH grading the agent's work, and DASH's
 * findings render outside the author's region. The workspace's own Outputs area
 * carries the chip on the same artifact.
 *
 * A format DASH does not know renders no body here at all, where the Outputs
 * area offers "Show what arrived". That disclosure exists to hand a developer
 * the record as it came, which is the same reason the developer reference
 * exists — and both belong on DASH's surfaces rather than inside a box the
 * author frames. The role's own purpose sentence has already said DASH cannot
 * lay this one out.
 */
function PanelArtifactBody({ card }: { card: ArtifactCardView }): ReactNode {
  if (!canPreview(card)) {
    return null;
  }
  switch (card.artifact.kind) {
    case "digest":
      return <DigestBody artifact={card.artifact} grounding={null} />;
    case "draft":
      return <DraftBody artifact={card.artifact} />;
    default:
      // Unreachable through the union and deliberately not a throw: the schema
      // and the renderer are two authorities that can disagree across a version,
      // and a page a person is reading must not crash on the day they do.
      return null;
  }
}

/** A section with nothing behind it yet, said rather than left blank. */
function StatedEmpty({ empty }: { empty: PanelEmptyState }): ReactNode {
  return (
    <div className="empty agent-panel-empty">
      <p>
        <strong>{empty.headline}</strong>
      </p>
      <p>{empty.meaning}</p>
    </div>
  );
}

/** The whole render for a panel DASH will not draw. */
function StatedCard({ card }: { card: PanelCard }): ReactNode {
  return (
    <div className="notice agent-panel-card" role="status">
      <p>
        <strong>{card.headline}</strong>
      </p>
      <p>{card.meaning}</p>
      {card.next_action === null ? null : <p className="next-action">{card.next_action}</p>}
    </div>
  );
}
