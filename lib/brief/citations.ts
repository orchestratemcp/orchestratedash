/**
 * What a brief's paragraphs may point at, and the verdict on whether they may
 * point at anything (MAR-674, ADR 0025 amendment 1).
 *
 * ## Why this is a separate file from `fingerprint.ts`
 *
 * The split is a bundle boundary, not a tidiness preference. Computing the
 * verdict needs `node:crypto`; *drawing* it needs only the answer. A component
 * value-importing anything that reaches a Node builtin drags it into the
 * renderer bundle and the packaged app stops hydrating — every page paints its
 * background and nothing else, with no error on screen. That is MAR-498's
 * defect and `tests/client-bundle.test.ts` is the gate that now catches it.
 *
 * So: this module has **no imports but types**, and `citedItems` is safe to call
 * from a component. `lib/brief/fingerprint.ts` does the hashing, is Node-only,
 * and is reached from `lib/views/build.ts` alone — exactly the arrangement
 * `analyzeGrounding` already has.
 */

import type { ArtifactItem } from "../contracts";

/**
 * Whether the brief on screen can be cited against the digest on screen.
 *
 * Three members and no fourth. A partial match is not a state: it is a
 * `mismatch`, because "some of these numbers still land somewhere" is not a
 * reason to believe any of them.
 */
export type BriefCitationState =
  /** The digest is here and is the list this brief was written from. */
  | "matched"
  /**
   * DASH does not hold that digest. **Not a fault**, and the copy must not read
   * as one: the two artifacts travel as separate messages on one channel, so a
   * brief arriving first is ordinary, and a run whose digest was rejected at
   * ingest leaves a brief with nothing to point at.
   */
  | "digest_missing"
  /** The digest is here and is a different list. Citations are withheld. */
  | "mismatch";

export interface BriefCitations {
  state: BriefCitationState;
  /**
   * The list a paragraph's numbers index into — the digest's own `items`, and
   * **empty unless `state` is `matched`**. Empty rather than optional so a
   * renderer that forgot to branch draws no citation rather than an
   * out-of-range one.
   */
  items: readonly ArtifactItem[];
  /** How long the brief says that list was. The agent's claim. */
  expected_count: number;
  /** How long it actually is, or null when DASH has no digest to measure. */
  found_count: number | null;
}

/**
 * The items one paragraph cites, or an empty list.
 *
 * The **zero-based** side of the seam, and it does no arithmetic at all.
 * `readBrief` returns the numbers a model wrote, one-based; the agent subtracts
 * one and range-checks against its own list before writing them into the
 * artifact. By the time they reach here they are positions.
 *
 * Anything that does not name a row is dropped rather than clamped. Clamping
 * would move a citation onto a neighbouring item, which is a **wrong link**
 * rather than a missing one — the failure this whole design exists to prevent,
 * and the reason `state !== "matched"` returns nothing rather than trying.
 */
export function citedItems(
  positions: readonly number[] | undefined,
  citations: BriefCitations,
): readonly ArtifactItem[] {
  return citedEntries(positions, citations).map((entry) => entry.item);
}

/**
 * One cited row **and where it sits in the list** (MAR-875).
 *
 * `citedItems` above is this function with the position thrown away, and the
 * position is the thing MAR-875 needed: a paragraph now renders `[3]` rather
 * than the whole headline, and the only reading of `3` that is worth anything
 * is *the third row of the list this run collected*. A number counted per
 * paragraph would mean a different source in every paragraph, which is worse
 * than no number at all — it looks like a reference and is not one.
 *
 * So the number on the page is `position + 1`, and the one-based-ness is done
 * **at the point of render** rather than here. This module stays the
 * zero-based side of the seam that `citedItems`' own note describes, and the
 * `+ 1` sits beside the `[` and `]` that make it a citation mark.
 *
 * Nothing else changes: the same drop-rather-than-clamp rule, the same refusal
 * to hand anything over unless the join is `matched`, the same de-duplication
 * of a row a model named twice.
 */
export function citedEntries(
  positions: readonly number[] | undefined,
  citations: BriefCitations,
): readonly { position: number; item: ArtifactItem }[] {
  if (positions === undefined || citations.state !== "matched") {
    return [];
  }
  const seen = new Set<number>();
  const cited: { position: number; item: ArtifactItem }[] = [];
  for (const position of positions) {
    if (!Number.isInteger(position) || seen.has(position)) {
      continue;
    }
    const item = citations.items[position];
    if (item === undefined) {
      continue;
    }
    seen.add(position);
    cited.push({ position, item });
  }
  return cited;
}
