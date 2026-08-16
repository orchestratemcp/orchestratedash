/**
 * Every sentence the browser surface can produce, swept (MAR-628, ADR 0019).
 *
 * `tests/evidence-copy.test.ts`'s shape: the cases are derived from the unions
 * rather than from a list somebody maintains, so a refusal added without being
 * described is still seen here rather than shipping as an empty string or a
 * crash on a page.
 *
 * The two claims this file exists to keep out are ADR 0019's, and they are
 * asserted as absences: no sentence may say an agent could only reach the
 * declared addresses, and no sentence may say Stop undid anything.
 */

import { describe, expect, it } from "vitest";

import { describeReach } from "../lib/browser/origins";
import type { BrowserRefusal } from "../lib/browser/protocol";
import type { BrowserEndReason } from "../lib/browser/session";
import {
  browserNotice,
  describeBlocked,
  describeBrowserRefusal,
  describeEnd,
  describeEphemeralSession,
  describeStop,
} from "../lib/copy/browser";

/**
 * Every refusal, by value.
 *
 * Written out rather than derived, because a union has no runtime members —
 * and the `satisfies` below is what makes the list exhaustive at compile time,
 * so adding a refusal without adding it here is a type error rather than a
 * quietly unswept case.
 */
const EVERY_REFUSAL = [
  "unknown_operation",
  "browser_not_declared",
  "origin_not_allowed",
  "revoked",
  "no_session",
  "invalid_input",
  "duplicate_request",
  "rate_limited",
  "page_unavailable",
  "browser_error",
] as const satisfies readonly BrowserRefusal[];

const EVERY_END = [
  "stopped_by_person",
  "closed_by_agent",
  "run_ended",
] as const satisfies readonly BrowserEndReason[];

/** Every sentence this module can produce, in one array. */
function everySentence(): string[] {
  const notice = browserNotice();
  const stop = describeStop();
  return [
    notice.headline,
    notice.meaning,
    stop.label,
    stop.meaning,
    describeEphemeralSession(),
    describeBlocked(0),
    describeBlocked(1),
    describeBlocked(7),
    describeReach(1),
    describeReach(3),
    ...EVERY_END.map(describeEnd),
    ...EVERY_REFUSAL.map(describeBrowserRefusal),
  ];
}

describe("every sentence is a sentence", () => {
  it("is present, non-empty and ends with a full stop", () => {
    for (const sentence of everySentence()) {
      expect(sentence.length).toBeGreaterThan(0);
      // The label is the one exception: it is a button, not a sentence.
      if (sentence === describeStop().label || sentence === browserNotice().headline) {
        continue;
      }
      expect(sentence.endsWith(".")).toBe(true);
    }
  });

  it("names no operation id, refusal code or session id", () => {
    // `lib/copy/identifiers.ts`'s rule. `describeOperation` in
    // `lib/views/browser.ts` deliberately echoes an unknown operation id, and
    // that is a different function in a different file for exactly this reason:
    // there the identifier is the finding.
    for (const sentence of everySentence()) {
      for (const forbidden of [
        "browser.open",
        "browser.read",
        "origin_not_allowed",
        "needs_a_person",
        "bs-",
        "WebContentsView",
        "CDP",
      ]) {
        expect(sentence).not.toContain(forbidden);
      }
    }
  });
});

describe("the two claims ADR 0019 forbids", () => {
  it("never says the agent could only reach the declared addresses", () => {
    for (const sentence of everySentence()) {
      expect(sentence.toLowerCase()).not.toContain("could only visit");
      expect(sentence.toLowerCase()).not.toContain("only reach these");
    }
    // And the notice says the true thing instead, in as many words.
    expect(browserNotice().meaning).toContain("by means DASH cannot see");
  });

  it("never says Stop undid anything, and says the opposite where it matters", () => {
    for (const sentence of everySentence()) {
      expect(sentence.toLowerCase()).not.toContain("undo");
      expect(sentence.toLowerCase()).not.toContain("cancels the request");
    }
    // The second half of the Stop sentence is the load-bearing one: copy that
    // stopped at the first would be selling a person an undo they did not get.
    expect(describeStop().meaning).toContain("cannot take that back");
  });

  it("says the trail is DASH's own record and not the website's", () => {
    expect(browserNotice().meaning).toContain("what DASH asked its own browser to do");
    expect(browserNotice().meaning).toContain("not a record of what those websites did");
  });

  it("keeps the notice standing rather than making it a fault report", () => {
    // `EvidenceNotice`'s rule: a permanent honest caveat must not be a thing
    // that appears when something goes wrong.
    expect(browserNotice().standing).toBe(true);
  });
});

describe("refusals that are limits do not read as alarms", () => {
  it("says an origin refusal is a limit somebody set", () => {
    expect(describeBrowserRefusal("origin_not_allowed")).toContain("not one this run was set up for");
  });

  it("owns DASH's own bug rather than blaming the agent", () => {
    expect(describeBrowserRefusal("browser_error")).toContain("DASH's fault, not the agent's");
  });

  it("attributes a page's own blocked requests to the page, not to the agent", () => {
    // A publisher's advertising network must not end up on an agent's conduct
    // record. See `BlockedRequestRow` for why the row shape says this too.
    expect(describeBlocked(3)).toContain("The page itself tried");
    expect(describeBlocked(3)).toContain("The agent did not ask for these");
  });

  it("says nothing alarming when a page asked for nothing outside the list", () => {
    expect(describeBlocked(0)).toContain("Every request the page made");
  });
});

describe("the promise made before a run", () => {
  it("says the session is empty, thrown away, and never typed into", () => {
    const sentence = describeEphemeralSession();
    expect(sentence).toContain("starts empty");
    expect(sentence).toContain("thrown away when the run ends");
    expect(sentence).toContain("does not type anything into a page");
  });
});
