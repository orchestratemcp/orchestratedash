/**
 * The Outputs panel's view model (MAR-434).
 *
 * Pure, and separate from the component for the reason every view model in this
 * directory is: the five availability states each have their own copy and their
 * own next action, and a test that had to mount a React tree to check the
 * quarantined sentence would be a test nobody writes for the fifth state.
 *
 * ## Why availability is resolved by a caller
 *
 * Nothing in DASH can currently tell a moved output from a deleted one, because
 * MAR-457's seam stores the artifact **body** in DASH's own records rather than
 * a reference to a file on disk — so there is no file whose absence could be
 * observed. The thing that would observe it is the runner-owned protected
 * workspace, which MAR-434 names as a separate feature with its own installed
 * proof and which this slice deliberately does not build.
 *
 * So `resolveAvailability` is a parameter with an honest default rather than a
 * lookup against a table that does not exist. Production passes nothing and
 * every output is `available`, which is true. Tests pass a resolver and drive
 * all five states, which is what makes the copy for the other four a tested
 * product feature instead of four strings nobody has ever rendered.
 */

import type { BriefCitations } from "../brief/citations";
import type { RunArtifact } from "../contracts";
import type { Adjudication } from "../genlayer/record";
import type { RunArtifactRecord } from "../store";
import {
  describeArtifactAvailability,
  describeArtifactHistoryDay,
  describeArtifactRole,
  describeReceiptMoment,
  describeRecordSize,
  type ArtifactAvailability,
  type ArtifactRole,
} from "../copy/artifacts";
import type { Recovery } from "../copy/recovery";

/**
 * Where an output came from, as facts a person can check.
 *
 * Both times are here and they are labelled differently on the surface. See
 * `RunArtifactRecord`: one is the agent's claim and one is DASH's record, and
 * collapsing them into "created" would quietly upgrade the first into the
 * second.
 */
export interface ArtifactReceipt {
  /**
   * Who made it.
   *
   * The producing run's **id** stays out of here and remains in
   * `ArtifactReference`, behind the developer disclosure, because it is a raw
   * identifier. *When* it was made is a different question and is answered by
   * `stated_at` below — see the note on that field, which had to change.
   */
  agent: string;
  /**
   * When the agent says it made this.
   *
   * ## Why this is now on the card front and not only in the receipt
   *
   * This struct used to justify omitting the producing run like so: *"this
   * panel only renders on that run's page, so the question is already answered
   * by where the reader is."*
   *
   * That premise was false when it was written and is now false twice.
   * `app/_components/panel.tsx` has drawn cards from
   * `artifactRecordsForAgent` — the agent's whole artifact history, across
   * every run — since MAR-548, so the author's panel could already show
   * Monday's digest and Tuesday's digest as two cards with identical headings
   * and no way to tell which was which. MAR-609 makes DASH's own Outputs area
   * span runs too, which would have shipped the same defect a second time.
   *
   * So both renderers now put this moment in the card heading. It is the one
   * fact that distinguishes two outputs of the same role, and a list where the
   * cards cannot be told apart is not a list.
   */
  stated_at: string;
  /** When DASH stored it. */
  received_at: string;
  /** The stored size, already worded for the value slot. */
  size: string;
}

/**
 * The internal names for one output.
 *
 * Rendered **only** behind the developer disclosure. Kept as its own field
 * rather than read off the artifact at the point of render, so that the one
 * place raw identifiers are allowed to appear is a field a reviewer can grep
 * for — `lib/copy/identifiers.ts` explains why a rule with invisible exceptions
 * is not a rule.
 */
export interface ArtifactReference {
  agent: string;
  run_id: string;
  artifact_id: string;
  kind: string;
}

export interface ArtifactCardView {
  artifact: RunArtifact;
  /**
   * Whether this brief's paragraphs may cite anything, and what they cite
   * (MAR-674, ADR 0025 amendment 1).
   *
   * **Null for every kind but `brief`**, and null on a brief means nobody
   * resolved it — which is why `resolveCitations` below has an honest default
   * rather than a guess. A digest has its own items and needs no join; a draft
   * cites messages rather than items.
   *
   * Computed by the caller for `resolveAvailability`'s reason and one sharper
   * one: the check is a SHA-256, `node:crypto` cannot enter the renderer
   * bundle, and this module is imported by components. The verdict crosses as
   * data, exactly as `GroundingAnalysis` does.
   */
  citations: BriefCitations | null;
  /**
   * Every time this brief was sent for judgement on GenLayer, newest first
   * (MAR-863, ADR 0033).
   *
   * **Empty for every kind but `brief`**, and empty on a brief means nobody has
   * asked for one — which is the ordinary state and draws no receipt at all.
   *
   * A list rather than the newest, because a brief can be judged more than once
   * and the resubmission is not an edge case: roughly one judgement in ten ends
   * with the committee refusing its leader's verdict, which records nothing and
   * whose route out is asking again. A field holding only the newest would
   * report a brief accepted on its third attempt identically to one accepted
   * first time.
   *
   * Computed by the caller on `citations`' reasoning: the answer needs
   * `node:sqlite`, this module is imported by components, and the shapes live in
   * `lib/genlayer/record.ts` precisely so the verdict can cross as data.
   */
  adjudications: readonly Adjudication[];
  /** The short date label used when this card sits in an agent's history. */
  history_day: string;
  role: ArtifactRole;
  availability: ArtifactAvailability;
  /** Null exactly when the output is available. */
  recovery: Recovery | null;
  receipt: ArtifactReceipt;
  reference: ArtifactReference;
}

/**
 * Turn what the store holds into what the panel draws.
 *
 * Order is the store's — newest first — and is not re-sorted here. A run that
 * revised its digest corrected it, and the corrected one belongs at the top;
 * that decision already lives in the query and having two places decide it is
 * how they come to disagree.
 */
export function buildArtifactCards(
  records: readonly RunArtifactRecord[],
  resolveAvailability: (record: RunArtifactRecord) => ArtifactAvailability = () => "available",
  /**
   * The citation verdict for a brief, or null.
   *
   * A parameter with an honest default, on the reasoning `resolveAvailability`
   * already carries: the answer needs a hash of another artifact's items, this
   * module must stay importable by a component, and a default that guessed
   * would put citations on screen that nothing had checked. Null renders as no
   * citations rather than as unchecked ones.
   *
   * Placed before `today` because `today` exists for tests and nothing in
   * production passes it — inserting here keeps every existing call site
   * correct without an `undefined` in the middle of it.
   */
  resolveCitations: (record: RunArtifactRecord) => BriefCitations | null = () => null,
  /**
   * Every judgement asked for against one brief, or none (MAR-863).
   *
   * A third resolver with an honest default, on the two above's terms. The
   * default is an empty list, which renders as *nobody has asked for this to be
   * judged* — the true statement about a DASH that has never pressed the button,
   * and about every surface that did not look.
   */
  resolveAdjudications: (record: RunArtifactRecord) => readonly Adjudication[] = () => [],
  today = new Date(),
): ArtifactCardView[] {
  return records.map((record) => {
    const { artifact } = record;
    const availability = resolveAvailability(record);

    return {
      artifact,
      citations: resolveCitations(record),
      adjudications: resolveAdjudications(record),
      history_day: describeArtifactHistoryDay(artifact.generated_at, today),
      role: describeArtifactRole(artifact.kind),
      availability,
      recovery: describeArtifactAvailability(availability, { title: artifact.title }),
      receipt: {
        agent: artifact.agent,
        // Worded, not stored. See `describeReceiptMoment` — this was the one
        // field in this struct still shipping the machine's spelling of a
        // moment, beside a `size` that has been worded since MAR-434.
        stated_at: describeReceiptMoment(artifact.generated_at),
        received_at: describeReceiptMoment(record.received_at),
        size: describeRecordSize(record.stored_bytes),
      },
      reference: {
        agent: artifact.agent,
        run_id: artifact.run_id,
        artifact_id: artifact.artifact_id,
        kind: artifact.kind,
      },
    };
  });
}

/**
 * Which card a surface with a rail beside it is reading (MAR-646, MAR-668).
 *
 * ## Why a two-line function is worth exporting
 *
 * `OutputsPanel` has resolved this inline since MAR-646, and MAR-668 gave the
 * page a reason to know the same answer: the author's declared panel sits
 * directly under the Output stage's card, and it must not draw the body of the
 * artifact that card is already drawing. Working that out on the page with a
 * second `findIndex` would be two functions deciding what "the open output" is
 * — and the moment they disagree, either the briefing renders twice again or a
 * card DASH did not draw goes silently missing from the author's box.
 *
 * The fallback is the newest and not nothing: a link that has outlived its
 * artifact should land on the page it named rather than on an empty one.
 * Null only when there are no cards at all.
 */
export function resolveOpenCard(
  cards: readonly ArtifactCardView[],
  openId: string | null | undefined,
): ArtifactCardView | null {
  const named =
    openId === undefined || openId === null
      ? -1
      : cards.findIndex((entry) => entry.reference.artifact_id === openId);
  return (named === -1 ? cards[0] : cards[named]) ?? null;
}

/**
 * One run's outputs, kept together (MAR-875).
 *
 * ## What a flat list could not say
 *
 * `buildArtifactCards` returns the agent's whole history newest first, and the
 * rail and the panel's history both drew it as one column of titles. A run that
 * produced a digest *and* a brief written from it therefore appeared as two
 * unrelated entries a day apart in wording — "Everything it collected",
 * "What the week adds up to" — with nothing on the surface saying they were one
 * piece of work. Pressing one and then the other looked like moving between two
 * runs when it was moving inside one.
 *
 * ## Why grouping is the whole of it
 *
 * The order is not touched. Runs come out in the order their first card
 * appeared, which is newest-first because the cards are, and the cards inside a
 * group keep the order they arrived in — the rule `buildArtifactCards`' own note
 * states and the reason it does not re-sort either.
 *
 * `from` is the group's first card's index in the flat list, so a caller that
 * has a rule about position — the rail's accent edge on the newest, the
 * history's one open card — can keep applying it without re-deriving anything.
 */
export interface ArtifactRunGroup {
  run_id: string;
  /** The day of the group's first card, as a person reads it. */
  day: string;
  /** Where this group starts in the flat list it was grouped from. */
  from: number;
  cards: ArtifactCardView[];
}

export function groupCardsByRun(cards: readonly ArtifactCardView[]): ArtifactRunGroup[] {
  const groups: ArtifactRunGroup[] = [];
  const at = new Map<string, ArtifactRunGroup>();
  cards.forEach((card, index) => {
    const runId = card.reference.run_id;
    const held = at.get(runId);
    if (held === undefined) {
      const group: ArtifactRunGroup = {
        run_id: runId,
        day: card.history_day,
        from: index,
        cards: [card],
      };
      at.set(runId, group);
      groups.push(group);
      return;
    }
    held.cards.push(card);
  });
  return groups;
}

/**
 * Everything of the selected run that the stage above has already put on
 * screen (MAR-875).
 *
 * ## Why one id was not enough
 *
 * MAR-668 handed the author's panel a set of one — the artifact the Output
 * stage drew — and that was the whole of what the stage could claim to have
 * shown. ADR 0025's brief broke the claim without changing a line of it: a
 * brief is *written from* a digest, its paragraphs cite that digest's rows by
 * position, and DASH's own card rendered those rows under every paragraph. So
 * the run's collected list was on the screen, in full, thirty headlines at a
 * time — and the panel's `report` section bound to the digest role could not
 * tell, because the digest's own `artifact_id` was not the brief's. Henrik saw
 * the consequence rather than the cause: the same thirty headlines under the
 * paragraphs, again in "The latest digest", again in a thirty-row table.
 *
 * The set is therefore the selected artifact **and the artifact it says it was
 * derived from**. One hop and not a walk: `derived_from` is a declared parent
 * rather than a graph, and a transitive closure over agent-authored ids is a
 * loop waiting for the first agent that names its own artifact as its parent.
 *
 * ## Why the answer is a map and not a set
 *
 * Because the two members are on the screen in two different ways, and the
 * difference decides what the panel should offer instead of them. The selected
 * artifact's **body** is on the stage — every row of a digest, every paragraph
 * of a brief. Its parent is there only as something the result was *written
 * from*: the rows themselves are not on the page at all, which is exactly why
 * the citation marks need a list to point at.
 *
 * A set would collapse those, and the panel would then either offer a list of
 * rows two hundred pixels under the same list (when the digest is the selected
 * card) or withhold the only copy of them (when the brief is). One value per id
 * is the smallest thing that lets one rule cover both.
 *
 * ## What it does not do
 *
 * It looks nothing up. The parent is read off the artifact the caller already
 * holds, so this stays a pure function over one card — importable by a
 * component, testable against a literal, and unable to disagree with
 * `resolveOpenCard` about which card is open, because it is handed the answer.
 *
 * Null in, empty out: a stage with no card has drawn nothing, and the panel's
 * default is then "draw everything", which is the run detail page's situation.
 */
export type ArtifactShownAs =
  /** The stage rendered this artifact itself — its rows, its paragraphs. */
  | "body"
  /** The stage rendered something written from it. Its rows are not on screen. */
  | "source";

export function resolveDrawnLineage(
  card: ArtifactCardView | null,
): Map<string, ArtifactShownAs> {
  const drawn = new Map<string, ArtifactShownAs>();
  if (card === null) {
    return drawn;
  }
  drawn.set(card.reference.artifact_id, "body");
  const { artifact } = card;
  if (artifact.kind === "brief") {
    const parent = artifact.derived_from.artifact_id;
    // Never over the card's own entry: a brief that named itself as its parent
    // is agent-authored nonsense, and "body" is the true answer for it.
    if (parent.length > 0 && !drawn.has(parent)) {
      drawn.set(parent, "source");
    }
  }
  return drawn;
}

/**
 * Whether the thing itself can be shown right now.
 *
 * Two conditions and they are different questions: DASH has to know the shape
 * of it, *and* it has to still be here. A moved digest is perfectly
 * previewable in principle and there is nothing to preview, so a surface that
 * checked only `role.previewable` would render an empty summary under a notice
 * saying the output is gone.
 */
export function canPreview(card: ArtifactCardView): boolean {
  return card.role.previewable && card.availability === "available";
}
