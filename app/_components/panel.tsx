import type { ReactNode } from "react";

import { OUTPUTS_PANEL_COPY } from "../../lib/copy/artifacts";
import {
  PANEL_ALREADY_SHOWN,
  PANEL_CELL_ABSENT,
  PANEL_COPY,
  PANEL_EMPTY_DISCLOSURE,
  PANEL_METRIC_EMPTY,
  PANEL_SOURCES_COPY,
  type PanelCard,
  type PanelEmptyState,
} from "../../lib/copy/panel";
import {
  canPreview,
  type ArtifactCardView,
  type ArtifactShownAs,
} from "../../lib/views/artifacts";
import type {
  PanelMetricsView,
  PanelNoteView,
  PanelOutputsView,
  PanelReportView,
  PanelSectionView,
  PanelTableView,
  PanelView,
} from "../../lib/views/panel";
import type { DigestArtifact } from "../../lib/contracts";
import { BriefBody, DigestBody, DraftBody } from "./digest";
import { LinkOut } from "./link-out";
import { OutputHistory } from "./output-history";

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
export function AgentPanel({
  view,
  alreadyShown,
}: {
  view: PanelView;
  /**
   * What the surface above this one has already put on the screen, and how
   * (MAR-668, widened by MAR-875).
   *
   * A prop rather than a field on `PanelView`, and the reason is that this is
   * not a fact about the panel. Which artifact is on the stage depends on the
   * address — `?output=…` — which `lib/views/build.ts` does not read and must
   * not: a view builder that took the query string would be answering a
   * question about the browser. The page knows, through `resolveOpenCard`, and
   * hands the answer down.
   *
   * It became a map when the brief arrived. `resolveDrawnLineage` explains the
   * two values in full; the short version is that an artifact whose body is on
   * the stage and an artifact the thing on the stage was *written from* are
   * both "already shown" and want opposite treatment from this region — one has
   * had its rows drawn and the other has not.
   *
   * Absent means nothing above has been drawn, which is the run detail page's
   * situation and every test that renders this component on its own. The
   * default is therefore "draw everything", so a caller that forgets is a
   * caller that gets today's behaviour rather than a silently emptied panel.
   */
  alreadyShown?: PanelShown;
}): ReactNode {
  /*
   * Absence renders nothing. Not an empty frame, not a "this agent declared no
   * panel" placeholder — the rule `task_inputs` shipped with, restated because
   * the other reading is available and wrong: an agent that declared no panel is
   * not an agent that gets a default one.
   */
  if (view.kind === "none") {
    return null;
  }

  const shown = alreadyShown ?? EMPTY;

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
          <PanelSections sections={view.sections} shown={shown} />
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
 * The author's sections, minus the ones that would draw the run again
 * (MAR-875).
 *
 * ## The rule, in one sentence
 *
 * A section every one of whose artifacts is already on the screen renders
 * **nothing**, and the first of them is replaced by one `Sources (n)`
 * disclosure holding the rows those sections would have drawn.
 *
 * ## Why the position of the first one is kept
 *
 * The obvious placement — Sources at the top, or at the bottom — was rejected
 * for the reason ADR 0008 gives about the whole region: the ordering is the
 * author's, and the collapsed thing is *their* section, in their layout. So the
 * disclosure appears exactly where the first yielding section was, and the
 * sections that survive keep their places around it.
 *
 * ## Why a section that yields draws nothing at all
 *
 * MAR-668 left a two-line pointer in place of the body, which was right when
 * there was one of them. On the proof scout there are three — a `report` bound
 * to the digest, an `outputs` list over the same role and a thirty-row `table`
 * of the same rows — and three pointers saying the same thing about the same
 * list is the shape MAR-646 spent a packet deleting from this page. The pointer
 * survives for the case it was written for: an `outputs` section holding a mix,
 * where the reader would otherwise meet a list that silently skips an entry.
 */
function PanelSections({
  sections,
  shown,
}: {
  sections: readonly PanelSectionView[];
  shown: PanelShown;
}): ReactNode {
  const sources = collectSources(sections, shown);
  let placed = false;

  return (
    <>
      {sections.map((section) => {
        if (!sectionYields(section, shown)) {
          return <PanelSection key={String(section.at)} section={section} shown={shown} />;
        }
        if (sources === null || placed) {
          /* Nothing to say and nowhere to say it. A yielding section with no
             rows behind it — a `report` bound to a brief the stage already drew
             — leaves no trace, which is design point 4 of MAR-875 exactly:
             an empty already-shown section renders nothing, not a pointer. */
          return null;
        }
        placed = true;
        return <SourcesDisclosure key={String(section.at)} sources={sources} />;
      })}
    </>
  );
}

/**
 * Whether the stage above has already drawn everything this section would.
 *
 * Four answers and each is about a different shape of binding. `metrics` and
 * `note` are never in it: a metric is a number read *out of* an artifact rather
 * than a second drawing of it, and a note is the author's own words.
 *
 * The `outputs` case is `every` rather than `some` on purpose. A section that
 * lists an agent's whole history is not made redundant by one of its entries
 * being on screen — the reader wants the rest — so it yields only when there is
 * genuinely nothing left in it.
 */
function sectionYields(section: PanelSectionView, shown: PanelShown): boolean {
  switch (section.kind) {
    case "report":
      return section.card !== null && shown.has(section.card.reference.artifact_id);
    case "outputs":
      return (
        section.cards.length > 0 &&
        section.cards.every((card) => shown.has(card.reference.artifact_id))
      );
    case "table":
      /*
       * `empty === null` is exactly "this table drew rows" — `buildTable` sets
       * one from the other. A table that drew nothing was never a second copy
       * of anything, and its stated empty state is a fact about the *shape* of
       * the agent's output rather than about the duplication: "the latest
       * output for this table is not a list of rows" is the sentence a person
       * building an agent needs, and it survives the artifact being on screen.
       */
      return (
        section.empty === null &&
        section.source_artifact_id !== null &&
        shown.has(section.source_artifact_id)
      );
    case "metrics":
    case "note":
      return false;
  }
}

/**
 * The rows the yielding sections would have drawn, as at most two readings of
 * one list.
 *
 * `list` comes from the first yielding section that resolves a **digest the
 * stage did not draw** — one the stage's own card was written *from*. That
 * qualification is the whole difference between the two readings being useful
 * and one of them being the defect again: when the digest itself is the open
 * card, every one of its rows is already on the screen two hundred pixels
 * above, and a "Read them as a list" behind a disclosure would be MAR-875's own
 * complaint wearing the shape of its fix. When a brief is the open card the
 * rows are on the screen nowhere at all, and this is the only place a citation
 * mark has to point at.
 *
 * A brief has prose and a draft has a message; neither is a collected list, so
 * a panel whose only yielding section resolves one of those contributes nothing
 * here.
 *
 * `table` comes from the first yielding `table` section that actually resolved
 * rows, whichever way its artifact reached the screen. The author declared its
 * columns and DASH draws exactly those — a grid read across is a reading a flat
 * list genuinely cannot give, which is `TableSection`'s own argument, so it is
 * kept rather than deleted and put one press away.
 */
interface PanelSources {
  count: number;
  items: DigestArtifact["items"] | null;
  table: PanelTableView | null;
}

function collectSources(
  sections: readonly PanelSectionView[],
  shown: PanelShown,
): PanelSources | null {
  let items: DigestArtifact["items"] | null = null;
  let table: PanelTableView | null = null;

  for (const section of sections) {
    if (!sectionYields(section, shown)) {
      continue;
    }
    if (items === null) {
      for (const card of cardsOf(section)) {
        const { artifact } = card;
        if (
          artifact.kind === "digest" &&
          shown.get(card.reference.artifact_id) === "source"
        ) {
          items = artifact.items;
          break;
        }
      }
    }
    if (table === null && section.kind === "table" && section.empty === null) {
      table = section;
    }
  }

  if (items === null && table === null) {
    return null;
  }
  return { count: items === null ? (table?.rows.length ?? 0) : items.length, items, table };
}

/** The artifact cards one section holds, in the order it would draw them. */
function cardsOf(section: PanelSectionView): readonly ArtifactCardView[] {
  if (section.kind === "report") {
    return section.card === null ? [] : [section.card];
  }
  return section.kind === "outputs" ? section.cards : [];
}

/**
 * One closed disclosure holding the run's collected rows, in DASH's words
 * (MAR-875).
 *
 * ## Two `<details>`, and never a switch
 *
 * List and table are two readings of one list, and the obvious control for that
 * is a pair of buttons or a segmented switch. ADR 0008 forbids both inside this
 * region and is right to: a control in a box somebody else frames is the one
 * affordance that could be made to look like it belonged to DASH when it did
 * not. Two nested disclosures cost one extra press and are keyboard-reachable,
 * announce their own state and remember nothing — which is the whole of what
 * amendment 1 admits.
 *
 * The list ships **open** inside the closed outer disclosure, and that is not a
 * contradiction: opening `Sources` should show the sources. What stays closed
 * is the author's table, which is the heavier of the two readings and the one
 * MAR-491's containment rule exists for.
 */
function SourcesDisclosure({ sources }: { sources: PanelSources }): ReactNode {
  return (
    <article className="agent-panel-sources">
      <details className="card-more agent-panel-sources-disclosure">
        <summary>{PANEL_SOURCES_COPY.summary(sources.count)}</summary>
        {/* Why this is collapsed at all, said once and above both readings. */}
        <p className="muted wrap">{PANEL_SOURCES_COPY.meaning}</p>

        {sources.items === null ? null : (
          <details className="card-more agent-panel-sources-view" open>
            <summary>{PANEL_SOURCES_COPY.list_summary}</summary>
            {/*
              An ordered list, and the numbers are load-bearing rather than
              decorative: a brief's paragraphs cite these rows as `[1]`, `[2]`
              and so on, and the number a reader is chasing is this list's own
              position. `digest-items` is deliberately NOT the class — that
              selector is how DASH's own card is found on this page, by the
              installed smoke and by the capture harness alike, and a second
              list wearing it would make both of them answer about this
              disclosure instead.
            */}
            <ol className="agent-panel-sources-items">
              {sources.items.map((item, index) => (
                <li key={`${item.headline}:${String(index)}`}>
                  {/* The headline is the link text and the address is the row's
                      own `item_url` — the agent's collected value, never
                      anything a model wrote. `DigestItem`'s rule. */}
                  {item.item_url === undefined ? (
                    <span className="wrap">{item.headline}</span>
                  ) : (
                    <LinkOut href={item.item_url}>{item.headline}</LinkOut>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}

        {sources.table === null ? null : (
          <details className="card-more agent-panel-sources-view">
            <summary>{PANEL_SOURCES_COPY.table_summary}</summary>
            <TableSection section={sources.table} />
          </details>
        )}
      </details>
    </article>
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
function PanelSection({
  section,
  shown,
}: {
  section: PanelSectionView;
  shown: PanelShown;
}): ReactNode {
  return (
    <article className="agent-panel-section">
      {/* The author's own label, and never the section's id. */}
      <h3>{section.label}</h3>
      <SectionBody section={section} shown={shown} />
    </article>
  );
}

function SectionBody({
  section,
  shown,
}: {
  section: PanelSectionView;
  shown: PanelShown;
}): ReactNode {
  switch (section.kind) {
    case "report":
      return <ReportSection section={section} shown={shown} />;
    case "outputs":
      return <OutputsSection section={section} shown={shown} />;
    case "table":
      /* MAR-668 stopped at the two section types that draw an artifact *body*,
         on the reading that a table of the same digest's headlines is a
         different presentation of the same record rather than a second copy of
         it. MAR-875 is Henrik reading the screen that reasoning produced: the
         same thirty headlines under the paragraphs, again as a list, again as
         thirty rows. So the yielding decision moved up to `PanelSections`,
         where it can see every section at once and collapse them into one
         `Sources` disclosure — and this component draws a table that is still
         the author's own presentation of something nothing else has shown. */
      return <TableSection section={section} />;
    case "metrics":
      return <MetricsSection section={section} />;
    case "note":
      return <NoteSection section={section} />;
  }
}

/**
 * What the stage has drawn, keyed by artifact id (MAR-875).
 *
 * The alias exists so the ten signatures below say the same thing and change
 * together. `ArtifactShownAs` and the reasoning behind the two values live in
 * `lib/views/artifacts.ts`, next to the function that produces one.
 */
type PanelShown = ReadonlyMap<string, ArtifactShownAs>;

/** No caller passed a map, so nothing above has been drawn. */
const EMPTY: PanelShown = new Map<string, ArtifactShownAs>();

/**
 * The newest output of one role, with its receipt.
 *
 * Henrik's "custom output/report area", and for the sample agent it is one
 * section bound to the digest. The card is the same shape the Outputs area
 * draws, because it is built from the same `ArtifactCardView` — a role label, a
 * purpose, the two-clock receipt, and the thing itself when DASH knows how to
 * lay it out.
 */
function ReportSection({
  section,
  shown,
}: {
  section: PanelReportView;
  shown: PanelShown;
}): ReactNode {
  if (section.card === null) {
    return <StatedEmpty empty={section.empty} />;
  }
  return <PanelArtifactCard card={section.card} shown={shown} />;
}

/**
 * Every output of a role, capped by the author.
 *
 * A card list rather than a table, which is MAR-491's finding applied where it
 * was found: every table in DASH became a 1425px horizontal scroller at 375px
 * wide, and a list of records is exactly the population that happened to.
 */
function OutputsSection({
  section,
  shown,
}: {
  section: PanelOutputsView;
  shown: PanelShown;
}): ReactNode {
  if (section.cards.length === 0) {
    return <StatedEmpty empty={section.empty} />;
  }
  return (
    <>
      <OutputHistory
        cards={section.cards}
        collapsed
        renderCard={(card) => <PanelArtifactCard card={card} shown={shown} />}
      />
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
function PanelArtifactCard({
  card,
  shown,
}: {
  card: ArtifactCardView;
  shown: PanelShown;
}): ReactNode {
  const { artifact, role, receipt, recovery } = card;
  /*
   * MAR-668. The body yields when the stage above has already drawn this exact
   * artifact, and only the body.
   *
   * The identity of the thing stays — role, title, when — so the author's
   * section still says *what* it is presenting and where it sits in their
   * layout. What goes is the second copy of a briefing the reader scrolled past
   * a moment ago, and the receipt with it: a two-clock provenance record under
   * a pointer is paperwork about a card that is not here.
   */
  const elsewhere = shown.has(card.reference.artifact_id);

  if (elsewhere) {
    /*
     * Two lines and no card, which the screenshot decided rather than the
     * reasoning.
     *
     * The first draft kept the card's shape — a bordered box with the role, the
     * title and the date stacked inside it — and the capture of the real
     * two-section panel showed why that is wrong: the scout declares a `report`
     * *and* an `outputs` section over the same role, so the page drew two
     * identical four-line boxes two hundred pixels apart. Not three briefings
     * any more, but the same echo at a smaller size, which is the shape MAR-646
     * spent a packet removing from this page.
     *
     * A pointer should look like a pointer. The title and the moment share a
     * line, DASH's sentence sits under it, and there is no border, because
     * there is no card here — the card is at the top of the page.
     */
    return (
      <article className="output-card is-elsewhere">
        <p className="agent-panel-output-title">
          <span className="eyebrow">{role.label}</span>
          <span className="value">{artifact.title}</span>
          <span className="output-when muted">{receipt.stated_at}</span>
        </p>
        {/* DASH's fixed sentence, naming DASH's own heading. See
            `PANEL_ALREADY_SHOWN` for why it is allowed inside this region. */}
        <p className="muted wrap">{PANEL_ALREADY_SHOWN}</p>
      </article>
    );
  }

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
    case "brief":
      /* MAR-674, and this case is the two-renderers trap in the act.
         `app/_components/outputs.tsx` gained the same branch in the same change,
         and a build that added it there alone would leave the author's own panel
         drawing a brief as "Show what arrived" while DASH's card drew the
         document — one defect, two files, and only a photograph with both in
         frame has ever caught it. */
      /* MAR-863. The verdict, on the author's panel too — the record is
         shared and the control is not. See `AdjudicationReceipt`. */
      return (
        <BriefBody
          artifact={card.artifact}
          citations={card.citations}
          adjudications={card.adjudications}
        />
      );
    default:
      // Unreachable through the union and deliberately not a throw: the schema
      // and the renderer are two authorities that can disagree across a version,
      // and a page a person is reading must not crash on the day they do.
      return null;
  }
}

/**
 * A section with nothing behind it yet, said rather than left blank.
 *
 * ADR 0008 amendment 1 admits this one read-only disclosure inside the
 * author's region. The distinction is visible, not merely structural: its
 * fixed summary names DASH as the speaker. Neither the summary nor the body
 * accepts an author string, and opening it only reveals prose â€” it submits no
 * command, changes no record, navigates nowhere and is not remembered.
 *
 * The headline stays outside and visible because the three empty-table cases
 * are different facts. A shared panel-level sentence would make "not produced",
 * "not rows" and "no readable rows" look like one absence, which is exactly
 * what `PanelEmptyKind` was introduced to prevent.
 */
function StatedEmpty({ empty }: { empty: PanelEmptyState }): ReactNode {
  return (
    <div className="empty agent-panel-empty">
      <p>
        <strong>{empty.headline}</strong>
      </p>
      <details className="card-more agent-panel-empty-disclosure">
        <summary>{PANEL_EMPTY_DISCLOSURE}</summary>
        <p>{empty.meaning}</p>
      </details>
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
