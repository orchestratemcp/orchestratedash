/**
 * The "Give it to …" button and its consequence sentence, in their own words
 * (MAR-883).
 *
 * The defect: Settings → Connections and the AI tab's own fleet card both drew
 * this button by interpolating the waiting agent's *id* straight into the
 * label — `GIVE IT TO MEETING-ASSISTANT` — because the button was built before
 * `lib/views/agent-labels.ts` gave a display name a suffix a person could read.
 * `describeFleetReach`'s "Connecting Gmail connects it for …" sentence, drawn
 * directly above that same button, had the identical defect for the identical
 * reason. `shareLabel` and `describeFleetReach` are the two functions fixed
 * here, and both now go through the one disambiguation source
 * `lib/views/agent-labels.ts` owns, so a name collision reads the same suffix
 * wherever a person meets it on this card.
 */

import { describe, expect, it } from "vitest";

import type { CredentialTarget } from "../lib/connection-credentials";
import {
  describeFleetReach,
  everyFleetReachSentence,
  everyShareLabelSentence,
  shareLabel,
  type FleetReach,
} from "../lib/fleet/grants";
import type { FleetConnector } from "../lib/fleet/catalogue";
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

describe("the consequence sentence before a fleet connect", () => {
  const connector = { service: "Gmail" } as FleetConnector;

  it("names an agent by title, not by the folder id it travels as", () => {
    const reach: FleetReach = {
      materializes: [
        { agent_id: "meeting-assistant", target: {} as CredentialTarget, title: "Meeting Assistant" },
      ],
      skipped: [],
    };
    const sentence = describeFleetReach(connector, reach) ?? "";
    expect(sentence).toContain("Meeting Assistant");
    expect(sentence).not.toContain("meeting-assistant");
  });

  it("tells two same-named agents apart by folder, not id", () => {
    const reach: FleetReach = {
      materializes: [
        {
          agent_id: "meeting-assistant-2",
          target: {} as CredentialTarget,
          title: "Meeting Assistant",
        },
        { agent_id: "standup-notes", target: {} as CredentialTarget, title: "Meeting Assistant" },
      ],
      skipped: [],
    };
    const sentence = describeFleetReach(connector, reach) ?? "";
    expect(sentence).toContain("Meeting Assistant — Meeting assistant 2");
    expect(sentence).toContain("Meeting Assistant — Standup notes");
  });

  it("falls back to the id when a caller has no title to give", () => {
    // `lib/fleet/actions.ts`'s own candidates carry no title source, so this
    // stays the sentence's behaviour before MAR-883 for exactly that caller —
    // an explicit fallback, not a silent regression the next reader has to
    // rediscover.
    const reach: FleetReach = {
      materializes: [{ agent_id: "news-scout", target: {} as CredentialTarget }],
      skipped: [],
    };
    expect(describeFleetReach(connector, reach)).toContain("news-scout");
  });
});

describe("the copy sweep", () => {
  it("has no raw identifier in anything shareLabel can say", () => {
    expectPlainLanguage(everyShareLabelSentence());
  });

  it("has no raw identifier in anything describeFleetReach can say when titled", () => {
    expectPlainLanguage(everyFleetReachSentence());
  });
});
