/**
 * Whether a brief is talking about the list DASH is holding (MAR-674, ADR 0025
 * amendment 1).
 *
 * ## Why this module exists at all
 *
 * Henrik reopened decision 2 and split the output in two: *"One RAW and one
 * curated. Don't mix them."* The raw roundup stays a `digest`; the written
 * document is a `brief`. That is the right shape to read, and it costs exactly
 * one thing — a brief's paragraphs cite items by **position into another
 * artifact's array**, and two separate records guarantee nothing about being
 * the same list in the same order.
 *
 * The first design avoided the join. This one checks it, which is what the rest
 * of this codebase does with a claim it cannot take on trust: `sources_fetched`
 * is the same move for a digest's own citations, and `analyzeGrounding` is the
 * check over it.
 *
 * ## What a mismatch does, and why it is the interesting branch
 *
 * **It draws no citations at all.** Not the ones that happen to be in range,
 * not a "best effort" subset. A wrong citation is a real link sitting under a
 * claim it does not support — precisely the misattribution `readBrief`'s
 * index-only output exists to make impossible, and reintroducing it through a
 * bad join would be losing the whole property at the last step.
 *
 * ## Where this may be imported from
 *
 * **Node only.** `node:crypto` is here, so a value import of anything in this
 * file from a component would drag it into the renderer bundle and the packaged
 * app would stop hydrating — the defect `tests/client-bundle.test.ts` was
 * written for, after MAR-498 shipped it and every page drew its background
 * colour and nothing else. `lib/views/build.ts` is the caller, on the footing
 * `analyzeGrounding` already has, and the *verdict* crosses to the page as
 * data. What a component needs is in `./citations`, which imports nothing but
 * types.
 */

import { createHash } from "node:crypto";

import type { ArtifactItem, BriefArtifact, DigestArtifact } from "../contracts";
import type { BriefCitations } from "./citations";

/**
 * The bytes an item contributes to its list's fingerprint.
 *
 * **Identity fields only, and this is a decision rather than an economy.** What
 * is being guarded against is *a different list* — a brief written from
 * yesterday's run, or from a digest revised underneath it. It is not mutation
 * of an item's prose. Hashing `summary` would mean a re-truncation, a parser
 * fix like MAR-670's, or a stray whitespace change silently withdrawing every
 * citation from a brief that is perfectly correct — and a check that fails on
 * correct data is a check people learn to ignore.
 *
 * `JSON.stringify` of a fixed-order tuple rather than a delimiter join: a
 * headline containing whatever separator we picked would otherwise let two
 * different lists hash the same, and escaping is the one thing JSON is certain
 * to get right.
 *
 * Absent is `null` rather than `""`, so an item with no `item_url` and an item
 * whose `item_url` is empty are not the same row.
 */
function itemIdentity(item: ArtifactItem): [string, string | null, string | null] {
  return [item.headline, item.source_url ?? null, item.item_url ?? null];
}

/**
 * The canonical rendering of a digest's items, in order.
 *
 * Exported because it is the half that must be **mirrored** in the agent kit
 * rather than transcribed. ADR 0025 amendment 1 records the cost of getting
 * that wrong precisely: a drift between the two ends turns every correct brief
 * into an uncited one, which fails silently and looks like a model that forgot
 * to cite.
 *
 * Order is part of the identity, deliberately. A brief citing "item 4" means
 * the fourth row of the list it was handed, so a reordering makes every number
 * point somewhere else — which is exactly the case this exists to catch.
 */
export function canonicaliseItems(items: readonly ArtifactItem[]): string {
  return JSON.stringify(items.map(itemIdentity));
}

/** SHA-256 of the canonical rendering, lowercase hex — the schema's `items_digest`. */
export function fingerprintItems(items: readonly ArtifactItem[]): string {
  return createHash("sha256").update(canonicaliseItems(items), "utf8").digest("hex");
}

/**
 * Resolve one brief against the artifacts DASH holds for its run.
 *
 * The digest is looked up by the id the brief names, **and its run is checked
 * too**. `derived_from.run_id` is carried separately from `artifact_id` for
 * this: an agent could write a brief from a previous run's digest, and DASH
 * should be able to say so rather than join across runs in silence. A digest
 * whose run does not match is treated as not found, because it is not the
 * document this brief claims to be about.
 *
 * `item_count` is checked before the hash and is not redundant with it. Both
 * failures are a `mismatch`, but only the count can be turned into a sentence
 * somebody can act on — *written from 60 items, and this digest has 58* — where
 * a hash disagreement says only that something differs.
 */
export function resolveBriefCitations(
  brief: BriefArtifact,
  digests: readonly DigestArtifact[],
): BriefCitations {
  const { artifact_id, run_id, item_count, items_digest } = brief.derived_from;

  const digest = digests.find(
    (candidate) => candidate.artifact_id === artifact_id && candidate.run_id === run_id,
  );

  if (digest === undefined) {
    return { state: "digest_missing", items: [], expected_count: item_count, found_count: null };
  }

  const found = digest.items.length;
  if (found !== item_count || fingerprintItems(digest.items) !== items_digest) {
    return { state: "mismatch", items: [], expected_count: item_count, found_count: found };
  }

  return { state: "matched", items: digest.items, expected_count: item_count, found_count: found };
}
