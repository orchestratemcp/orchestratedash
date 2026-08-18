/**
 * Whether a brief may cite the digest beside it (MAR-674, ADR 0025 amendment 1).
 *
 * Henrik's split — *"One RAW and one curated. Don't mix them."* — is the right
 * thing to read and costs exactly one property: a brief's numbers index into
 * **another artifact's** array, and two records guarantee nothing about being
 * the same list. This file covers the check that buys the property back.
 *
 * The case that matters most is the last kind below. A wrong citation is a real
 * link sitting under a claim it does not support, which is precisely what
 * `readBrief`'s index-only output exists to make impossible — so a bad join
 * must withhold **every** citation rather than show the ones that happen to
 * land in range.
 */

import { describe, expect, it } from "vitest";

import { citedItems } from "../lib/brief/citations";
import {
  canonicaliseItems,
  fingerprintItems,
  resolveBriefCitations,
} from "../lib/brief/fingerprint";
import type { BriefArtifact, DigestArtifact } from "../lib/contracts";

const RUN = "run-1";

const ITEMS = [
  {
    headline: "Providers cut prices",
    source_url: "https://feed.test/a",
    item_url: "https://news.test/prices",
    summary: "A long body that a parser fix might one day re-truncate.",
  },
  {
    headline: "Nobody shipped supervision",
    source_url: "https://feed.test/b",
    item_url: "https://news.test/supervision",
  },
  { headline: "An item with no link at all" },
];

function digest(overrides: Partial<DigestArtifact> = {}): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: "scout",
    run_id: RUN,
    artifact_id: "digest-1",
    title: "Roundup",
    generated_at: "2026-08-18T09:00:00.000Z",
    items: ITEMS,
    ...overrides,
  };
}

function brief(derived: Partial<BriefArtifact["derived_from"]> = {}): BriefArtifact {
  return {
    artifact_version: 2,
    kind: "brief",
    agent: "scout",
    run_id: RUN,
    artifact_id: "brief-1",
    title: "What it adds up to",
    generated_at: "2026-08-18T09:01:00.000Z",
    document: {
      sections: [
        { heading: "Prices", paragraphs: [{ body: "They fell.", items: [0, 1] }] },
      ],
    },
    derived_from: {
      artifact_id: "digest-1",
      run_id: RUN,
      item_count: ITEMS.length,
      items_digest: fingerprintItems(ITEMS),
      ...derived,
    },
  };
}

describe("the fingerprint", () => {
  it("is stable for the same list and different for a reordered one", () => {
    // Order is part of the identity on purpose: a brief citing "item 4" means
    // the fourth row of the list it was handed, so a reordering makes every
    // number point somewhere else. That is the case this exists to catch.
    expect(fingerprintItems(ITEMS)).toBe(fingerprintItems([...ITEMS]));
    const swapped = [ITEMS[1]!, ITEMS[0]!, ITEMS[2]!];
    expect(fingerprintItems(swapped)).not.toBe(fingerprintItems(ITEMS));
  });

  it("ignores an item's prose, which is the decision this design turns on", () => {
    // What is guarded against is A DIFFERENT LIST, not a mutated one. Hashing
    // `summary` would mean a re-truncation or a parser fix like MAR-670's
    // silently withdrawing every citation from a brief that is perfectly
    // correct — and a check that fails on correct data is one people learn to
    // ignore.
    const retruncated = ITEMS.map((item, index) =>
      index === 0 ? { ...item, summary: "A shorter body." } : item,
    );
    expect(fingerprintItems(retruncated)).toBe(fingerprintItems(ITEMS));
  });

  it("tells an absent link from an empty one", () => {
    const empty = [{ headline: "H", item_url: "" }];
    const absent = [{ headline: "H" }];
    expect(fingerprintItems(empty)).not.toBe(fingerprintItems(absent));
  });

  it("cannot be fooled by a separator inside a headline", () => {
    // The reason the canonical form is JSON rather than a delimiter join: a
    // headline containing whatever separator we picked would otherwise let two
    // different lists hash the same.
    const a = [{ headline: 'a","b' }, { headline: "c" }];
    const b = [{ headline: "a" }, { headline: 'b","c' }];
    expect(canonicaliseItems(a)).not.toBe(canonicaliseItems(b));
    expect(fingerprintItems(a)).not.toBe(fingerprintItems(b));
  });
});

describe("resolving a brief against what DASH holds", () => {
  it("matches the digest it names and hands over its items", () => {
    const resolved = resolveBriefCitations(brief(), [digest()]);
    expect(resolved.state).toBe("matched");
    expect(resolved.items).toHaveLength(3);
    expect(resolved.found_count).toBe(3);
  });

  it("reports a digest that has not arrived, and does not call it a fault", () => {
    // The two artifacts travel as separate messages on one channel, so a brief
    // arriving first is ordinary.
    const resolved = resolveBriefCitations(brief(), []);
    expect(resolved.state).toBe("digest_missing");
    expect(resolved.found_count).toBeNull();
    expect(resolved.items).toEqual([]);
  });

  it("refuses to join across runs, even when the artifact id matches", () => {
    // `derived_from.run_id` is carried separately for exactly this. An agent
    // could write a brief from a previous run's digest, and DASH should be able
    // to say so rather than join in silence.
    const resolved = resolveBriefCitations(brief(), [digest({ run_id: "run-0" })]);
    expect(resolved.state).toBe("digest_missing");
  });

  it("reports a mismatch when the list is a different length", () => {
    const resolved = resolveBriefCitations(brief(), [digest({ items: ITEMS.slice(0, 2) })]);
    expect(resolved.state).toBe("mismatch");
    expect(resolved.expected_count).toBe(3);
    // Both numbers survive, because only the count can become a sentence
    // somebody can act on. A hash disagreement alone says only that something
    // differs.
    expect(resolved.found_count).toBe(2);
  });

  it("reports a mismatch when the list is the same length and a different list", () => {
    const reordered = [ITEMS[1]!, ITEMS[0]!, ITEMS[2]!];
    const resolved = resolveBriefCitations(brief(), [digest({ items: reordered })]);
    expect(resolved.state).toBe("mismatch");
    expect(resolved.found_count).toBe(3);
  });

  it("hands over nothing at all on a mismatch", () => {
    // The whole point. Not the citations that happen to land in range, not a
    // best-effort subset — none. A wrong citation is worse than no citation.
    const resolved = resolveBriefCitations(brief(), [digest({ items: ITEMS.slice(0, 2) })]);
    expect(resolved.items).toEqual([]);
    expect(citedItems([0, 1], resolved)).toEqual([]);
  });
});

describe("what one paragraph cites", () => {
  const matched = resolveBriefCitations(brief(), [digest()]);

  it("turns positions into the digest's own rows", () => {
    const cited = citedItems([0, 2], matched);
    expect(cited.map((item) => item.headline)).toEqual([
      "Providers cut prices",
      "An item with no link at all",
    ]);
  });

  it("does no arithmetic — a position is already zero-based here", () => {
    // The seam. `readBrief` returns the one-based numbers a model wrote; the
    // agent subtracts one and range-checks before writing them into the
    // artifact. By the time they reach this function they are positions, and an
    // off-by-one here would put a real link under the wrong paragraph.
    expect(citedItems([0], matched).map((item) => item.headline)).toEqual([
      "Providers cut prices",
    ]);
  });

  it("drops a position no row has, rather than clamping it", () => {
    // Clamping would move a citation onto a neighbouring item, which is a wrong
    // link rather than a missing one.
    expect(citedItems([99], matched)).toEqual([]);
    expect(citedItems([-1], matched)).toEqual([]);
    expect(citedItems([1.5], matched)).toEqual([]);
    expect(citedItems([0, 99], matched).map((item) => item.headline)).toEqual([
      "Providers cut prices",
    ]);
  });

  it("cites one row once, however often the model named it", () => {
    expect(citedItems([1, 1, 1], matched)).toHaveLength(1);
  });

  it("cites nothing for a paragraph that named nothing", () => {
    expect(citedItems(undefined, matched)).toEqual([]);
    expect(citedItems([], matched)).toEqual([]);
  });
});
