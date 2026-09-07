/**
 * The "Give it to …" button's own words (MAR-883).
 *
 * The defect: Settings → Connections and the AI tab's own fleet card both drew
 * this button by interpolating the waiting agent's *id* straight into the
 * label — `GIVE IT TO MEETING-ASSISTANT` — because the button was built before
 * `lib/views/agent-labels.ts` gave a display name a suffix a person could read.
 * `shareLabel` is the one function both surfaces now call, so there is exactly
 * one place a novice test can be run against and exactly one place the
 * disambiguation rule has to agree with `lib/views/agent-labels.ts`'s own.
 */

import { describe, expect, it } from "vitest";

import { everyShareLabelSentence, shareLabel } from "../lib/fleet/grants";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("nobody waiting", () => {
  it("draws no button at all", () => {
    // Matches both callers' own rule: a control that would do nothing is not
    // drawn, so the label function says so with null rather than an empty
    // string a caller might render as a blank button.
    expect(shareLabel([], [])).toBeNull();
    expect(shareLabel([], [{ name: "news-scout", title: "News Scout" }])).toBeNull();
  });
});

describe("one agent waiting", () => {
  it("names it by title, not by the folder id it travels as", () => {
    // The defect, closed: `waiting` carries `["meeting-assistant"]` because
    // that is what the `share` command addresses, and the id must never reach
    // the button's own words.
    const label = shareLabel(
      ["meeting-assistant"],
      [{ name: "meeting-assistant", title: "Meeting Assistant" }],
    );
    expect(label).toBe("Give it to Meeting Assistant");
    expect(label).not.toContain("meeting-assistant");
  });

  it("adds the same folder suffix the per-agent list gives a name collision", () => {
    // Two agents on one card both called Meeting Assistant. Only one is
    // waiting, and the card still owes a person the same distinction the
    // per-agent list beside the button already draws.
    const label = shareLabel(
      ["meeting-assistant-2"],
      [
        { name: "meeting-assistant-2", title: "Meeting Assistant" },
        { name: "standup-notes", title: "Meeting Assistant" },
      ],
    );
    expect(label).toBe("Give it to Meeting Assistant — Meeting assistant 2");
  });

  it("says nothing extra when the waiting agent's name is unique on the card", () => {
    const label = shareLabel(
      ["meeting-assistant"],
      [
        { name: "meeting-assistant", title: "Meeting Assistant" },
        { name: "news-scout", title: "News Scout" },
      ],
    );
    expect(label).toBe("Give it to Meeting Assistant");
  });
});

describe("more than one agent waiting", () => {
  it("counts rather than lists, and still never an id", () => {
    // This half never leaked an id — the count was always the word — and it
    // stays a count: naming every waiting agent on a button is a different
    // packet's decision, not this one's.
    const label = shareLabel(["news-scout", "invoice-reviewer"], []);
    expect(label).toBe("Give it to 2 waiting agents");
  });
});

describe("the copy sweep", () => {
  it("has no raw identifier in anything this module can say", () => {
    expectPlainLanguage(everyShareLabelSentence());
  });
});
