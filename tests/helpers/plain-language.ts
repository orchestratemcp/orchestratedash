/**
 * The guided-path copy assertion, in one place.
 *
 * MAR-423's acceptance criterion — *"No raw identifier appears anywhere in the
 * guided path. Verified by a test over the rendered copy, not by inspection."* —
 * is only worth as much as the number of surfaces that actually run it. So the
 * assertion lives here and every guided-path test calls it, rather than each
 * test file carrying its own approximation of the rule.
 *
 * The rule itself is `lib/copy/identifiers.ts`. This is the vitest wrapper that
 * turns its findings into a failure a person can act on.
 */

import { expect } from "vitest";

import {
  describeRawIdentifiers,
  rawIdentifiersIn,
  type IdentifierScanOptions,
} from "../../lib/copy/identifiers";

/**
 * Assert that everything a user would read on this surface is plain language.
 *
 * `parts` is every string the surface renders — pass them all, not a joined
 * summary, so the failure names the field as well as the word.
 */
export function expectPlainLanguage(
  parts: readonly string[],
  options: IdentifierScanOptions = {},
): void {
  const findings = parts.flatMap((part) => rawIdentifiersIn(part, options));
  expect(
    describeRawIdentifiers(findings),
    "guided-path copy must contain no raw identifiers — see docs/design-brief.md",
  ).toBe("no raw identifiers");
}
