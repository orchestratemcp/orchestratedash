/**
 * The AI tab's own words (MAR-877).
 *
 * `lib/ai/model-choice.ts` composes what the setting *is* and this module
 * composes only what MAR-877 added around it — the label on a fold, the line
 * that says a key is in trouble, the line that says agents are waiting. Those
 * are the sentences the plain-language gate would never have seen if the page
 * had written them inline, which is the whole reason they are in a module.
 *
 * The counted sentences are asserted at both ends: a count of nought is silence
 * rather than "0 agents are waiting", and the singular is a different sentence
 * from the plural rather than "1 agents".
 */

import { describe, expect, it } from "vitest";

import {
  AI_ADVANCED_SUMMARY,
  AI_CHANGE_LABEL,
  AI_FIRST_KEY_HEADLINE,
  AI_TROUBLESHOOT_SUMMARY,
  describeAiTrouble,
  describeAiWaiting,
  everySettingsAiSentence,
} from "../lib/copy/settings-ai";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("the folds and the chooser", () => {
  it("names each one in words a person could act on", () => {
    // Uppercase is applied by the stylesheet, so the strings themselves stay
    // sentence case — `buttons force uppercase globally` is a rendering fact and
    // not something a copy module should pre-empt.
    expect(AI_FIRST_KEY_HEADLINE).toBe("Connect a model provider");
    expect(AI_ADVANCED_SUMMARY).toBe("Advanced routing");
    expect(AI_TROUBLESHOOT_SUMMARY).toBe("Troubleshoot");
    expect(AI_CHANGE_LABEL).toBe("Change");
  });
});

describe("the two counted lines", () => {
  it("says nothing at all when the count is nought", () => {
    /*
     * The empty string is the contract, and the page renders nothing on it. A
     * line reading "0 agents are waiting" is a page reassuring somebody about a
     * thing they had not asked about — the same call `BrokerLapseNotice` makes
     * about its own empty list.
     */
    expect(describeAiTrouble(0)).toBe("");
    expect(describeAiWaiting(0)).toBe("");
    expect(describeAiTrouble(-1)).toBe("");
    expect(describeAiWaiting(-1)).toBe("");
  });

  it("has a singular that is not the plural with a 1 in it", () => {
    expect(describeAiTrouble(1)).toContain("There is 1 key");
    expect(describeAiTrouble(2)).toContain("There are 2 keys");
    expect(describeAiWaiting(1)).toContain("1 agent is waiting");
    expect(describeAiWaiting(3)).toContain("3 agents are waiting");
  });

  it("says what is wrong without saying what DASH did about it", () => {
    // The card under the fold owns the three-part explanation and the recovery.
    // This line's only job is to give somebody a reason to open the fold, and a
    // second opinion about the cause here is how two surfaces come to disagree.
    expect(describeAiTrouble(1)).toContain("cannot read");
    expect(describeAiWaiting(1)).toContain("already holds");
  });
});

it("is plain language throughout", () => {
  expectPlainLanguage(everySettingsAiSentence());
});

it("enumerates every sentence the module can produce", () => {
  // The enumerator is the gate's whole surface: a sentence this module can say
  // and the enumerator cannot is one no copy gate will ever read.
  const enumerated = new Set(everySettingsAiSentence());
  for (const sentence of [
    AI_FIRST_KEY_HEADLINE,
    AI_ADVANCED_SUMMARY,
    AI_TROUBLESHOOT_SUMMARY,
    AI_CHANGE_LABEL,
    describeAiTrouble(1),
    describeAiTrouble(2),
    describeAiWaiting(1),
    describeAiWaiting(2),
  ]) {
    expect(enumerated.has(sentence), sentence).toBe(true);
  }
  // And nothing empty reaches the gate, which would pass vacuously.
  expect(enumerated.has("")).toBe(false);
});
