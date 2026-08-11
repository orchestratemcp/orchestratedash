/**
 * Every word DASH says on the Add agent page (MAR-598).
 *
 * ## Why this enumerates, and why it populates
 *
 * `tests/copy-folder.test.ts` walks the exported objects rather than sampling
 * them, so a constant added tomorrow is covered the moment it exists. This does
 * the same, and adds the lesson that cost a session: **a copy gate only sees the
 * fields a fixture populates.** Every combination of `replaced` and `startable`
 * is built below, because each one composes a different sentence, and a fixture
 * that exercised only the ordinary one would leave the rest unscanned and green.
 * The same reason `NOT_READ` exists: those two cards are reachable only by a
 * folder DASH stops on before it has read a plan, which no happy-path fixture
 * ever produces.
 *
 * ## And why the claims are asserted, not just the vocabulary
 *
 * Plain language is the floor. These sentences also make promises, and two of
 * them are the whole point of the issue: that DASH took a **copy** and did not
 * take the person's folder, and that it says **where** the copy went. Both have
 * a test below naming the sentence that must not disappear.
 *
 * The third is the one that would be most tempting to soften. An agent added
 * here is stored and **not running** — the part of DASH that supervises agents
 * reads its list when DASH opens — so `WILL_START` says when, and a test holds
 * it against every phrasing that would imply it is running now.
 */

import { describe, expect, it } from "vitest";

import {
  CANNOT_START,
  CHOOSE_FOLDER_COPY,
  FOLDER_ALREADY_IN_DASH,
  FOLDER_CANNOT_BE_STORED,
  FOLDER_DECLINED,
  FOLDER_NOT_AN_AGENT,
  WILL_START,
  describeFolderAdded,
  describeFolderNotRead,
  describeFolderNotStored,
  type AddAgentCard,
} from "../lib/copy/add-agent";
import { describeFolderTooBig } from "../lib/folder-import";
import { expectPlainLanguage } from "./helpers/plain-language";

/**
 * A real destination, in the shape a Windows install actually produces.
 *
 * Passed through `allow` at every call site below rather than exempted by a rule
 * in the scanner, which is `IdentifierScanOptions`' whole design: the caller
 * takes responsibility for the string, and the exemption shows up in the diff.
 * A folder DASH chose on the user's behalf is content for the same reason a
 * folder the user chose is.
 */
const DESTINATION = "C:\\Users\\sam\\AppData\\Roaming\\orchestratedash\\agents\\ai-news-scout";

const STATIC_CARDS = {
  FOLDER_NOT_AN_AGENT,
  FOLDER_ALREADY_IN_DASH,
  FOLDER_CANNOT_BE_STORED,
  FOLDER_DECLINED,
};

/**
 * Every shape `describeFolderAdded` can produce.
 *
 * Keyed rather than listed so the coverage assertion compares *names*: a count
 * would be satisfied by building one variant twice and the new one never, which
 * is precisely the failure a coverage guard exists to catch.
 */
const RECEIPTS: Record<string, AddAgentCard> = {
  copied_new_startable: describeFolderAdded({
    display_name: "AI News Scout",
    destination: DESTINATION,
    replaced: false,
    startable: true,
  }),
  copied_new_plan_only: describeFolderAdded({
    display_name: "AI News Scout",
    destination: DESTINATION,
    replaced: false,
    startable: false,
  }),
  copied_replacing: describeFolderAdded({
    display_name: "AI News Scout",
    destination: DESTINATION,
    replaced: true,
    startable: true,
  }),
};

const FAILURES = {
  locked: describeFolderNotStored(
    "That agent is running and is holding its own files open. Stop it, then choose the folder again.",
  ),
  unwritable: describeFolderNotStored("DASH could not write its copy."),
};

/** The two ways DASH stops before it has read a plan at all. */
const NOT_READ = {
  unreadable: describeFolderNotRead("DASH could not read that folder."),
  too_big: describeFolderNotRead(describeFolderTooBig("files")),
  too_heavy: describeFolderNotRead(describeFolderTooBig("bytes")),
};

function fieldsOf(card: AddAgentCard): string[] {
  return [card.headline, card.meaning, card.next_action ?? ""];
}

describe("the page's own strings", () => {
  it("are plain language, every one", () => {
    expectPlainLanguage(Object.values(CHOOSE_FOLDER_COPY));
  });

  it("leads with choosing a folder rather than with a command", () => {
    /*
     * The issue in one assertion. Henrik's complaint was that the page spoke
     * terminal to a person holding a mouse, and the fix is not "the commands are
     * still there, lower down" — it is that the first thing the page says is
     * about a folder. A lede that drifted back to naming a tool would pass every
     * other test in this file.
     */
    expect(CHOOSE_FOLDER_COPY.action).toBe("Choose a folder");
    expect(CHOOSE_FOLDER_COPY.lede).toMatch(/folder/i);
    expect(CHOOSE_FOLDER_COPY.lede).not.toMatch(/command|terminal|install|npm|npx/i);
  });

  it("says the chooser is the computer's own, and that nothing happens before you agree", () => {
    // The two facts a person cannot see. An app that quietly read a folder and
    // an app that asked are indistinguishable on screen until it matters, which
    // is `FOLDER_CHECK_COPY.detail`'s argument applied one door along.
    expect(CHOOSE_FOLDER_COPY.detail).toMatch(/your computer's own/i);
    expect(CHOOSE_FOLDER_COPY.detail).toMatch(/nothing is added until you say yes/i);
  });

  it("labels the scaffold path by who it is for", () => {
    // A disclosure that said "Advanced" would make a novice wonder what they are
    // missing. A question answers itself for the person who is not building an
    // agent from scratch, which is nearly everybody standing here.
    expect(CHOOSE_FOLDER_COPY.scaffold_summary).toBe("Building an agent from scratch?");
  });
});

describe("the cards", () => {
  it("are plain language, every field of every one", () => {
    for (const [name, card] of Object.entries(STATIC_CARDS)) {
      expectPlainLanguage(fieldsOf(card));
      expect(card.headline, name).not.toBe("");
      expect(card.meaning, name).not.toBe("");
    }
    for (const [name, card] of Object.entries({ ...RECEIPTS, ...FAILURES, ...NOT_READ })) {
      // The destination is content, not vocabulary — see `DESTINATION` above.
      expectPlainLanguage(fieldsOf(card), { allow: [DESTINATION] });
      expect(card.headline, name).not.toBe("");
    }
  });

  it("does not head an oversized folder as though its agent were missing", () => {
    /*
     * The distinction that is not pedantry. DASH stopping before it read a plan
     * is neither "this is not an agent" nor "the plan is wrong" — and heading a
     * folder that is simply too large with "there is no agent in that folder"
     * would send somebody hunting for a missing file in a folder whose agent is
     * present and perfectly fine.
     */
    for (const card of Object.values(NOT_READ)) {
      expect(card.headline, card.headline).not.toMatch(/no agent|not an agent/i);
      expect(card.meaning, card.meaning).toMatch(/nothing was copied and nothing was added/i);
    }
    expect(NOT_READ.too_big.meaning).toMatch(/folder of a single agent/i);
  });

  it("tells a person their own folder is untouched, in every refusal", () => {
    /*
     * The fear this page exists to answer. Somebody who has just pointed DASH at
     * a folder and been refused wants to know whether their folder survived, and
     * the answer is in the card rather than left to be inferred from the absence
     * of a success message.
     */
    for (const card of [FOLDER_NOT_AN_AGENT, FOLDER_CANNOT_BE_STORED]) {
      expect(card.meaning, card.meaning).toMatch(/exactly as you left it/i);
    }
    expect(FOLDER_DECLINED.meaning).toMatch(/nothing was copied/i);
    expect(FOLDER_ALREADY_IN_DASH.meaning).toMatch(/nothing was copied/i);
    for (const card of Object.values(FAILURES)) {
      expect(card.meaning, card.meaning).toMatch(/your own folder was not changed/i);
    }
  });

  it("sends a person to the door that exists, rather than refusing twice", () => {
    // Picking DASH's own copy is not a mistake — it is the folder
    // `FOLDER_CHECK_COPY.reveal_detail` sends people to. The card names the
    // affordance that already handles it instead of leaving them stuck.
    expect(FOLDER_ALREADY_IN_DASH.next_action).toMatch(/check for changes/i);
  });
});

describe("the receipt", () => {
  it("covers every shape the builder can produce", () => {
    // A branch added to `describeFolderAdded` without a fixture above goes
    // unscanned by every assertion in this file. Named here so whoever adds one
    // knows what to write.
    expect(Object.keys(RECEIPTS).sort()).toEqual([
      "copied_new_plan_only",
      "copied_new_startable",
      "copied_replacing",
    ]);
  });

  it("says where DASH put its copy", () => {
    /*
     * The issue is explicit: *copy, not move — say where it went.* DASH keeps
     * its copy inside the user's own profile, at a path nobody finds by guessing,
     * and a receipt that said "added" and stopped would leave a person with two
     * folders and no idea which one DASH runs.
     */
    for (const [name, card] of Object.entries(RECEIPTS)) {
      expect(card.meaning, name).toContain(DESTINATION);
    }
  });

  it("says a copy was taken, and never that the folder was moved", () => {
    const copied = RECEIPTS["copied_new_startable"] as AddAgentCard;
    expect(copied.meaning).toMatch(/took its own copy/i);
    expect(copied.meaning).toMatch(/not moved, changed or deleted/i);
    for (const card of Object.values(RECEIPTS)) {
      expect(card.meaning, card.meaning).not.toMatch(/\bmoved (it|your|the folder)\b/i);
    }
  });

  it("has no branch claiming nothing was copied, because it cannot be reached", () => {
    /*
     * A folder that was already inside DASH's keeping never gets here — it is
     * refused one step earlier with `FOLDER_ALREADY_IN_DASH`. So every receipt
     * this builder produces describes a copy that really happened, and a "nothing
     * was copied" branch would be a sentence nothing can produce sitting in the
     * module every surface reads as the list of things DASH can say.
     */
    for (const card of Object.values(RECEIPTS)) {
      expect(card.meaning, card.meaning).toMatch(/took its own copy/i);
      expect(card.meaning, card.meaning).not.toMatch(/nothing was copied/i);
    }
  });

  it("names the folder to edit, which is DASH's copy and not the person's", () => {
    // The step that makes the copy make sense. Without it, somebody edits their
    // own folder for a week and wonders why DASH never changes.
    for (const card of Object.values(RECEIPTS)) {
      expect(card.next_action, card.next_action ?? "").toMatch(/do not reach DASH/i);
      expect(card.next_action, card.next_action ?? "").toMatch(/check for changes/i);
    }
  });
});

describe("when the agent actually runs", () => {
  it("never says it is running now", () => {
    /*
     * The claim that would be false. Adding an agent does not make the part of
     * DASH that supervises agents re-read its list, so an agent added here is
     * stored, complete and not started — and a receipt implying otherwise would
     * send somebody to a page to watch for activity that is not coming.
     *
     * Asserted as the absence of the false claim *and* the presence of the true
     * one, because a sentence that simply said less would pass the first half.
     */
    expect(WILL_START).not.toMatch(/is running|it is now running|started it|has started/i);
    expect(WILL_START).toMatch(/next time you open DASH/i);
    const startable = RECEIPTS["copied_new_startable"] as AddAgentCard;
    expect(startable.meaning).toContain(WILL_START);
  });

  it("says what DASH can still do with an agent it cannot start", () => {
    // Not an apology and not a failure: holding a plan DASH cannot run is what
    // importing a plan has always meant.
    expect(CANNOT_START).toMatch(/shows what this agent plans to do/i);
    const planOnly = RECEIPTS["copied_new_plan_only"] as AddAgentCard;
    expect(planOnly.meaning).toContain(CANNOT_START);
    expect(planOnly.meaning).not.toContain(WILL_START);
  });
});
