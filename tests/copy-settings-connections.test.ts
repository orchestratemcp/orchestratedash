/**
 * The Connections page's roll-up sentence (MAR-877).
 *
 * MAR-467's per-agent notice is unchanged and `tests/connection-card-render.test.tsx`
 * still drives it. What is checked here is the line that replaced the *stack*
 * of them: that it carries both numbers, that each number has its own singular,
 * and that the caveat every one of those notices repeated is still said.
 */

import { describe, expect, it } from "vitest";

import {
  LAPSES_ARE_NOT_DECISIONS,
  authorizationHeading,
  describeAgentLapseCount,
  describeLapseSummary,
  everySettingsConnectionsSentence,
} from "../lib/copy/settings-connections";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("the roll-up line", () => {
  it("carries both numbers, because they answer different questions", () => {
    /*
     * One agent with four gaps and four agents with one each are different
     * situations. A single count reads identically for both, which is how a
     * summary comes to be true and useless at the same time.
     */
    expect(describeLapseSummary(4, 1)).toContain("4 periods");
    expect(describeLapseSummary(4, 1)).toContain("one agent");
    expect(describeLapseSummary(4, 4)).toContain("4 periods");
    expect(describeLapseSummary(4, 4)).toContain("4 agents");
  });

  it("has a singular for each number", () => {
    expect(describeLapseSummary(1, 1)).toBe("DASH cannot account for 1 period for one agent.");
    expect(describeLapseSummary(1, 3)).toContain("1 period across 3 agents");
    expect(describeAgentLapseCount(1)).toBe("1 period");
    expect(describeAgentLapseCount(2)).toBe("2 periods");
  });

  it("says nothing at all when there is nothing to say", () => {
    // The page renders no disclosure on the empty string. An "everything is
    // accounted for" line would be a page reassuring somebody about something
    // they had not asked about.
    expect(describeLapseSummary(0, 0)).toBe("");
    expect(describeLapseSummary(0, 2)).toBe("");
    expect(describeLapseSummary(2, 0)).toBe("");
  });

  it("keeps the caveat that these are not decisions", () => {
    /*
     * It was under every one of the five per-agent blocks and it is one fact
     * about all of them. Losing it while merging them would turn a list of
     * things DASH could not observe into a list of things DASH decided, which
     * is exactly what ADR 0005 keeps the two shapes apart to prevent.
     */
    expect(LAPSES_ARE_NOT_DECISIONS).toContain("not decisions");
    expect(LAPSES_ARE_NOT_DECISIONS).toContain("not in a position to answer");
  });
});

describe("the heading over the consequences", () => {
  it("names the act that is about to happen, not the page it is on", () => {
    // A sign-in and a typed key are different acts, and the fold that holds
    // what either one will mean says which one it is talking about.
    expect(authorizationHeading(true)).toBe("Before you sign in");
    expect(authorizationHeading(false)).toBe("Before you add this key");
  });
});

it("is plain language throughout", () => {
  expectPlainLanguage(everySettingsConnectionsSentence());
});

it("enumerates every sentence the module can produce", () => {
  const enumerated = new Set(everySettingsConnectionsSentence());
  for (const sentence of [
    LAPSES_ARE_NOT_DECISIONS,
    authorizationHeading(true),
    authorizationHeading(false),
    describeLapseSummary(1, 1),
    describeLapseSummary(2, 5),
    describeAgentLapseCount(1),
    describeAgentLapseCount(2),
  ]) {
    expect(enumerated.has(sentence), sentence).toBe(true);
  }
  expect(enumerated.has("")).toBe(false);
});
