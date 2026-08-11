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

import type { RunArtifact } from "../contracts";
import type { RunArtifactRecord } from "../store";
import {
  describeArtifactAvailability,
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
): ArtifactCardView[] {
  return records.map((record) => {
    const { artifact } = record;
    const availability = resolveAvailability(record);

    return {
      artifact,
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
