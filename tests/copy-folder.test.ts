/**
 * Every word DASH says about an edited folder (MAR-584).
 *
 * ## Why this file enumerates rather than samples
 *
 * A copy gate only sees the fields a fixture populates. `lib/copy/folder.ts` has
 * five cards, ten change-line builders and three server states, and a test that
 * scanned "a representative few" would be green on the day somebody added a
 * filename to the eleventh. So this walks the exported objects themselves —
 * `Object.values`, `Object.entries` — which means a new constant is covered the
 * moment it exists rather than the moment somebody remembers to add it here.
 *
 * ## And why the claims are asserted, not just the vocabulary
 *
 * Plain language is the floor. The sentences in this module also make promises
 * about what DASH did and did not do, and two of them were wrong when first
 * written: `FOLDER_CHANGED` claimed DASH was still running the approved version
 * (it is not — the runner's working directory is that folder and nothing
 * verifies it), and `FOLDER_NO_BASELINE` is one careless edit away from saying
 * "nothing has changed" over an agent DASH has never looked at. Both have a
 * test below naming the sentence that must not come back.
 */

import { describe, expect, it } from "vitest";

import {
  FOLDER_CHANGED,
  FOLDER_CHANGE_LINES,
  FOLDER_CHECK_COPY,
  FOLDER_INVALID,
  FOLDER_NO_BASELINE,
  FOLDER_UNCHANGED,
  FOLDER_UNREADABLE,
  SENT_SERVERS_HEADING,
  describeSentServer,
  namedList,
} from "../lib/copy/folder";
import { expectPlainLanguage } from "./helpers/plain-language";

const CARDS = {
  FOLDER_UNCHANGED,
  FOLDER_NO_BASELINE,
  FOLDER_UNREADABLE,
  FOLDER_INVALID,
  FOLDER_CHANGED,
};

describe("the cards", () => {
  it("are plain language, every field of every one", () => {
    for (const [name, card] of Object.entries(CARDS)) {
      expectPlainLanguage([card.headline, card.meaning, card.next_action ?? ""], {
        // Nothing is exempted. If a card ever needs an allowance, it belongs
        // here in the diff with a name beside it — see `IdentifierScanOptions`
        // on why exemptions live at the call site.
      });
      expect(card.headline, name).not.toBe("");
      expect(card.meaning, name).not.toBe("");
    }
  });

  it("never promises that the approved program is what is running", () => {
    /*
     * The sentence this replaced said "DASH is still running the version you
     * approved", and it was false. An agent's working directory is the folder an
     * editor just changed and nothing verifies its contents before spawning, so
     * changed instructions run at the next run whether or not anybody accepted
     * them. What DASH controls is its own description, and that is what the card
     * claims.
     *
     * Asserted as the absence of the false claim *and* the presence of the true
     * one, because a card that simply said less would pass the first half.
     */
    const said = `${FOLDER_CHANGED.headline} ${FOLDER_CHANGED.meaning}`;
    expect(said).not.toMatch(/still running the version you approved/i);
    expect(said).toMatch(/take effect the next time it runs/i);
  });

  it("does not let a missing record read as a clean bill of health", () => {
    // DASH has not found the folder unchanged. It has found that it never wrote
    // down what unchanged would mean, and those are different sentences.
    const said = `${FOLDER_NO_BASELINE.headline} ${FOLDER_NO_BASELINE.meaning}`;
    expect(said).not.toMatch(/nothing has changed|unchanged|up to date/i);
    expect(said).toMatch(/cannot tell/i);
  });

  it("tells a person their agent is untouched when an edit is refused", () => {
    // The question somebody has the moment they see a validator error is
    // whether their agent still works. It is answered in the card, not left to
    // be inferred from the absence of an accept button.
    expect(FOLDER_INVALID.meaning).toMatch(/has not accepted/i);
    expect(FOLDER_INVALID.meaning).toMatch(/still the version you approved/i);
  });
});

describe("the controls", () => {
  it("are plain language, every string", () => {
    expectPlainLanguage(Object.values(FOLDER_CHECK_COPY));
  });

  it("says out loud that DASH is not watching the folder", () => {
    /*
     * The one fact a person cannot see and would otherwise assume the other way
     * round. An app that quietly looks every few seconds and an app that looks
     * when asked are indistinguishable on screen until the moment it matters,
     * and this is the sentence that separates them.
     */
    expect(FOLDER_CHECK_COPY.detail).toMatch(/does not watch/i);
  });

  it("says what accepting is for, now that the program runs either way", () => {
    // Once `FOLDER_CHANGED` admits the edited program runs regardless, "accept"
    // needs a reason. It is that DASH's description comes into line with the
    // folder — so this page describes the agent that actually runs.
    expect(FOLDER_CHECK_COPY.adopt_detail).toMatch(/into line with the folder/i);
    // And it still names what survives, which is what people actually fear
    // losing.
    expect(FOLDER_CHECK_COPY.adopt_detail).toMatch(/produced/);
  });
});

describe("the change lines", () => {
  /**
   * Every builder, exercised with values a real comparison would supply, keyed
   * by the name it is exported under.
   *
   * Keyed rather than listed, so the coverage assertion below compares *names*
   * and not a count. A count would be satisfied by exercising one line twice
   * and the new one never — which is precisely the failure a coverage guard is
   * supposed to catch.
   */
  const cases: Record<keyof typeof FOLDER_CHANGE_LINES, string[]> = {
    sourcesAdded: [
      FOLDER_CHANGE_LINES.sourcesAdded(["Ars Technica", "The Verge"]),
      FOLDER_CHANGE_LINES.sourcesAdded(["Ars Technica"]),
    ],
    sourcesRemoved: [FOLDER_CHANGE_LINES.sourcesRemoved(["Hacker News", "arXiv"])],
    sourcesUnreadable: [FOLDER_CHANGE_LINES.sourcesUnreadable],
    scheduleAdded: [FOLDER_CHANGE_LINES.scheduleAdded(3600)],
    scheduleRemoved: [FOLDER_CHANGE_LINES.scheduleRemoved],
    scheduleChanged: [FOLDER_CHANGE_LINES.scheduleChanged(86_400)],
    scheduleUnclear: [FOLDER_CHANGE_LINES.scheduleUnclear],
    goalChanged: [FOLDER_CHANGE_LINES.goalChanged],
    nameChanged: [FOLDER_CHANGE_LINES.nameChanged("AI News Scout", "News Scout")],
    permissionsChanged: [FOLDER_CHANGE_LINES.permissionsChanged],
    connectionsChanged: [FOLDER_CHANGE_LINES.connectionsChanged],
    programChanged: [FOLDER_CHANGE_LINES.programChanged(1), FOLDER_CHANGE_LINES.programChanged(4)],
    programMissing: [FOLDER_CHANGE_LINES.programMissing(1), FOLDER_CHANGE_LINES.programMissing(3)],
  };
  const rendered = Object.values(cases).flat();

  it("covers every builder the module exports", () => {
    // A new line added to `FOLDER_CHANGE_LINES` without a case above fails
    // here — named, so whoever added it knows what to write — rather than
    // quietly going unscanned by every assertion below.
    expect(Object.keys(cases).sort()).toEqual(Object.keys(FOLDER_CHANGE_LINES).sort());
  });

  it("are plain language", () => {
    expectPlainLanguage(rendered);
  });

  it("never names a file", () => {
    /*
     * `lib/copy/identifiers.ts` would catch `sources.json` and `agent.mjs`, and
     * this asserts the positive form of the same rule: the sentences describe
     * what the files are *for*. A person who asked an AI to watch two more news
     * sites is owed "it reads two more sources", not a filename they never
     * typed.
     */
    for (const line of rendered) {
      expect(line, line).not.toMatch(/\.(json|mjs|cjs|js|ts)\b/);
    }
  });

  it("counts in words rather than leaving a bare number under a label", () => {
    expect(FOLDER_CHANGE_LINES.programChanged(1)).toContain("1 file");
    expect(FOLDER_CHANGE_LINES.programChanged(4)).toContain("4 files");
    // "1 files have changed" is the smallest possible way for a surface to look
    // unfinished, so the verb agrees too.
    expect(FOLDER_CHANGE_LINES.programChanged(1)).toContain("has changed");
    expect(FOLDER_CHANGE_LINES.programChanged(4)).toContain("have changed");
    expect(FOLDER_CHANGE_LINES.programMissing(1)).toContain("is no longer there");
    expect(FOLDER_CHANGE_LINES.programMissing(2)).toContain("are no longer there");
  });
});

describe("naming a list of things", () => {
  it("reads like a person saying it", () => {
    expect(namedList([])).toBe("");
    expect(namedList(["A"])).toBe("A");
    expect(namedList(["A", "B"])).toBe("A and B");
    expect(namedList(["A", "B", "C"])).toBe("A, B and C");
  });

  it("says how many it did not name", () => {
    expect(namedList(["A", "B", "C", "D"])).toBe("A, B, C and 1 other");
    expect(namedList(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 others");
  });
});

describe("what DASH may say about a server (ADR 0010)", () => {
  const states = [
    describeSentServer({
      server: "marketing box",
      sentOn: "7 August",
      comparable: true,
      behind: true,
    }),
    describeSentServer({
      server: "marketing box",
      sentOn: "7 August",
      comparable: true,
      behind: false,
    }),
    describeSentServer({
      server: "marketing box",
      sentOn: null,
      comparable: false,
      behind: false,
    }),
  ];

  it("is plain language in all three states", () => {
    expectPlainLanguage([
      SENT_SERVERS_HEADING,
      ...states.flatMap((card) => [card.headline, card.meaning, card.next_action ?? ""]),
    ]);
  });

  it("never claims the agent is running there", () => {
    /*
     * ADR 0010's whole bound, asserted rather than trusted to review. DASH sent
     * bytes once; the machine may since have been rebuilt, the agent stopped, or
     * the host handed to somebody else. Every one of these phrasings is a claim
     * about a remote machine DASH has not asked, and the ADR names them.
     */
    for (const card of states) {
      const said = `${card.headline} ${card.meaning}`;
      expect(said, said).not.toMatch(/is running|running on|is deployed|is live/i);
    }
  });

  it("says in every state that DASH has not asked the server", () => {
    // Never omitted, including in the reassuring state — which is the one where
    // dropping it would be most tempting and most misleading.
    for (const card of states) {
      expect(card.meaning, card.meaning).toMatch(/has not asked/i);
    }
  });

  it("puts the date in the sentence, and drops it rather than printing a raw one", () => {
    expect(states[0]?.headline).toContain("on 7 August");
    expect(states[2]?.headline).toBe("DASH sent this agent to marketing box.");
  });

  it("says it cannot tell, rather than guessing either way, with no record", () => {
    const said = `${states[2]?.headline ?? ""} ${states[2]?.meaning ?? ""}`;
    expect(said).toMatch(/cannot tell/i);
    expect(said).not.toMatch(/is not what this agent is|still is/i);
  });
});
