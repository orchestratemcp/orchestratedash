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
   * Who made it. The producing *run* is deliberately absent: this panel only
   * renders on that run's page, so the question is already answered by where
   * the reader is, and a field that exists is a field a later renderer will
   * print. The id stays in `ArtifactReference`, behind the disclosure.
   */
  agent: string;
  /** When the agent says it made this. */
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
