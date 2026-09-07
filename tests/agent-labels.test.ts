/**
 * Telling two identically named agents apart (MAR-877).
 *
 * The defect: Settings → Connections drew two rows under Gmail, both reading
 * **Meeting Assistant**, both NOT CONNECTED, with a control each — and a grant
 * is keyed per agent, so the two presses do different things and nothing on the
 * page said which was which.
 *
 * What is checked here is the rule rather than the rendering: a suffix appears
 * exactly where it distinguishes something, it is words rather than an id, and
 * a list with no collision comes back exactly as it went in.
 */

import { describe, expect, it } from "vitest";

import { agentTitleSuffix, disambiguateAgentTitles } from "../lib/views/agent-labels";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("a list with nothing ambiguous in it", () => {
  it("gives every agent a null suffix", () => {
    /*
     * The ordinary case, and the reason a caller can render this
     * unconditionally: a page with no collision draws exactly what it drew
     * before this function existed.
     */
    const labels = disambiguateAgentTitles([
      { name: "news-scout", title: "News Scout" },
      { name: "meeting-assistant", title: "Meeting Assistant" },
    ]);
    expect(labels.map((one) => one.suffix)).toEqual([null, null]);
  });

  it("is the identity on an empty list", () => {
    expect(disambiguateAgentTitles([])).toEqual([]);
  });

  it("keeps the input order", () => {
    // Callers zip this against their own list by index, so a reordering here
    // would attach one agent's suffix to another agent's row.
    const input = [
      { name: "c-agent", title: "Third" },
      { name: "a-agent", title: "First" },
      { name: "b-agent", title: "Second" },
    ];
    expect(disambiguateAgentTitles(input).map((one) => one.name)).toEqual([
      "c-agent",
      "a-agent",
      "b-agent",
    ]);
  });
});

describe("two agents with one name", () => {
  it("gives both of them the folder that tells them apart", () => {
    const labels = disambiguateAgentTitles([
      { name: "meeting-assistant-2", title: "Meeting Assistant" },
      { name: "standup-notes", title: "Meeting Assistant" },
    ]);
    // Both, not just the second: a suffix on one of a pair reads as a
    // qualification of that one rather than as a distinction between two.
    expect(labels[0]?.suffix).toBe("Meeting assistant 2");
    expect(labels[1]?.suffix).toBe("Standup notes");
  });

  it("leaves a third, unrelated agent alone", () => {
    const labels = disambiguateAgentTitles([
      { name: "meeting-assistant-2", title: "Meeting Assistant" },
      { name: "standup-notes", title: "Meeting Assistant" },
      { name: "news-scout", title: "News Scout" },
    ]);
    expect(labels[2]?.suffix).toBeNull();
  });

  it("treats two spellings of one name as the same name", () => {
    // A collision a person can see is a collision, whatever the capitals do.
    const labels = disambiguateAgentTitles([
      { name: "one-agent", title: "Meeting Assistant" },
      { name: "two-agent", title: "meeting assistant " },
    ]);
    expect(labels[0]?.suffix).not.toBeNull();
    expect(labels[1]?.suffix).not.toBeNull();
  });

  it("leaves one of a pair unqualified when its folder is already its name", () => {
    /*
     * The asymmetric case, and it is deliberate rather than a gap.
     *
     * An agent called *Meeting Assistant* whose folder is `meeting-assistant`
     * has nothing to add — the suffix would be the name again, in different
     * capitals. So it says nothing, its twin says where it came from, and the
     * two rows are still distinguishable, which is the whole requirement. The
     * alternative is drawing "Meeting Assistant — Meeting assistant" to keep
     * the shape symmetrical, and a symmetrical row that says nothing is worse
     * than an uneven pair that does.
     */
    const labels = disambiguateAgentTitles([
      { name: "meeting-assistant", title: "Meeting Assistant" },
      { name: "standup-notes", title: "Meeting Assistant" },
    ]);
    expect(labels[0]?.suffix).toBeNull();
    expect(labels[1]?.suffix).toBe("Standup notes");
  });

  it("says nothing rather than repeating the name it was meant to qualify", () => {
    /*
     * Two agents called *Meeting Assistant* whose folders are both
     * `meeting-assistant` cannot be told apart by anything DASH holds. Drawing
     * "Meeting Assistant — Meeting assistant" twice would claim they can, which
     * is worse than the ambiguity it was trying to resolve.
     */
    const labels = disambiguateAgentTitles([
      { name: "meeting-assistant", title: "Meeting assistant" },
      { name: "meeting-assistant", title: "Meeting assistant" },
    ]);
    expect(labels.map((one) => one.suffix)).toEqual([null, null]);
  });
});

describe("what the suffix is made of", () => {
  it("is words, never the folder spelled the computer's way", () => {
    /*
     * MAR-589's ruling: a display name is the name and an id is a value. The
     * suffix goes in a label, so it goes through `humanizeAgentName` — hyphens
     * become spaces and the first letter is capitalised — and the plain-language
     * gate reads what comes out.
     */
    const labels = disambiguateAgentTitles([
      { name: "support_mail-digest", title: "Digest" },
      { name: "sales-mail-digest", title: "Digest" },
    ]);
    const suffixes = labels.map((one) => one.suffix ?? "");
    expect(suffixes).toEqual(["Support mail digest", "Sales mail digest"]);
    expectPlainLanguage(suffixes);
  });
});

describe("the single-row convenience", () => {
  it("gives one agent the same answer the whole list would", () => {
    // It exists so a component does not build its own index and get the
    // collision rule subtly different from this module's.
    const among = [
      { name: "meeting-assistant-2", title: "Meeting Assistant" },
      { name: "standup-notes", title: "Meeting Assistant" },
      { name: "news-scout", title: "News Scout" },
    ];
    expect(agentTitleSuffix(among[0] as (typeof among)[number], among)).toBe(
      "Meeting assistant 2",
    );
    expect(agentTitleSuffix(among[2] as (typeof among)[number], among)).toBeNull();
  });

  it("is null for an agent that is not in the list at all", () => {
    expect(agentTitleSuffix({ name: "ghost", title: "Ghost" }, [])).toBeNull();
  });
});
