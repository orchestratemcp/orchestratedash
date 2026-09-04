/**
 * The mirror, pinned (MAR-862, ADR 0032 decision 6).
 *
 * `template/brief-fingerprint.mjs` is the agent's half of a function DASH holds
 * the other half of in `lib/brief/fingerprint.ts`. It has to be a mirror rather
 * than an import: the template is a dependency-free `.mjs` an author owns and
 * edits, and it cannot reach into this repository.
 *
 * ADR 0025 amendment 1 records what an unpinned mirror costs, and the cost is
 * why this file exists: *a drift between the two ends turns every correct brief
 * into an uncited one*. It fails silently. On screen it looks like a model that
 * forgot to cite its sources, so nobody goes looking at a hash function.
 *
 * These cases are chosen for the ways two implementations of "hash a list"
 * usually diverge: the separator, the absent value, the order.
 */

import { describe, expect, it } from "vitest";

import { canonicaliseItems, fingerprintItems } from "../../../lib/brief/fingerprint";
import type { ArtifactItem } from "../../../lib/contracts";

const template = (await import("../template/brief-fingerprint.mjs")) as {
  canonicaliseItems: (items: readonly ArtifactItem[]) => string;
  fingerprintItems: (items: readonly ArtifactItem[]) => string;
};

const CASES: Record<string, ArtifactItem[]> = {
  "an empty list": [],
  "one plain item": [{ headline: "A thing happened" }],
  "an item with both addresses": [
    {
      headline: "A thing happened",
      source_url: "https://example.test/feed",
      item_url: "https://example.test/1",
      summary: "Ignored by the fingerprint, on purpose.",
      source_name: "Example",
      published_at: "2026-09-04T00:00:00.000Z",
    },
  ],
  "an item whose address is the empty string": [{ headline: "Edge", source_url: "" }],
  // The separator case. Two lists that a delimiter-joined implementation would
  // hash identically, and which JSON keeps apart.
  "headlines containing separators": [
    { headline: 'a","b' },
    { headline: "c" },
  ],
  "several items in order": [
    { headline: "first", item_url: "https://example.test/1" },
    { headline: "second" },
    { headline: "third", source_url: "https://example.test/feed" },
  ],
};

describe("the agent template's fingerprint mirrors DASH's", () => {
  for (const [name, items] of Object.entries(CASES)) {
    it(`agrees on the canonical rendering of ${name}`, () => {
      expect(template.canonicaliseItems(items)).toBe(canonicaliseItems(items));
    });

    it(`agrees on the hash of ${name}`, () => {
      expect(template.fingerprintItems(items)).toBe(fingerprintItems(items));
    });
  }

  it("keeps order part of the identity, on both sides", () => {
    const forward: ArtifactItem[] = [{ headline: "a" }, { headline: "b" }];
    const backward: ArtifactItem[] = [{ headline: "b" }, { headline: "a" }];

    expect(fingerprintItems(forward)).not.toBe(fingerprintItems(backward));
    expect(template.fingerprintItems(forward)).not.toBe(template.fingerprintItems(backward));
  });

  it("keeps an absent address and an empty one apart, on both sides", () => {
    const absent: ArtifactItem[] = [{ headline: "a" }];
    const empty: ArtifactItem[] = [{ headline: "a", source_url: "" }];

    expect(fingerprintItems(absent)).not.toBe(fingerprintItems(empty));
    expect(template.fingerprintItems(absent)).toBe(fingerprintItems(absent));
    expect(template.fingerprintItems(empty)).toBe(fingerprintItems(empty));
  });

  it("produces the lowercase hex the contract's pattern requires", () => {
    expect(template.fingerprintItems([{ headline: "a" }])).toMatch(/^[0-9a-f]{64}$/);
  });
});
