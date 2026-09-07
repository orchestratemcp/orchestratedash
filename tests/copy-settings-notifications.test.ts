/**
 * The two headings and the fold on the Discord page (MAR-877).
 *
 * `lib/notify/settings.ts` and `lib/chief/discord.ts` still own every sentence
 * about what either arrangement does, and neither is touched. What is checked
 * here is the small amount of copy that names them apart — because a page
 * holding two credentials, two revocations and two channels under one title is
 * how *Replace the bot token* ended up being the loudest control on a page
 * about being told things.
 */

import { describe, expect, it } from "vitest";

import {
  ALERTS_MANAGE_DETAIL,
  ALERTS_SECTION_HEADING,
  CHIEF_MANAGE_DETAIL,
  CHIEF_SECTION_HEADING,
  MANAGE_SUMMARY,
  everySettingsNotificationsSentence,
} from "../lib/copy/settings-notifications";
import { expectPlainLanguage } from "./helpers/plain-language";

describe("the two halves are named apart", () => {
  it("says which direction each one runs in", () => {
    /*
     * The distinction a person needs is not "webhook versus bot": it is whether
     * DASH is talking or they are. Both headings are written from that side, so
     * neither name requires knowing which Discord feature is underneath.
     */
    expect(ALERTS_SECTION_HEADING).toBe("Alerts DASH sends you");
    expect(CHIEF_SECTION_HEADING).toBe("Talk to the chief in Discord");
    expect(ALERTS_SECTION_HEADING).not.toBe(CHIEF_SECTION_HEADING);
  });
});

describe("Manage", () => {
  it("is the same word on both halves", () => {
    // The two halves hold different presses, and a person learning where the
    // dangerous ones live should have to learn it once.
    expect(MANAGE_SUMMARY).toBe("Manage");
  });

  it("says what is inside it, on the outside", () => {
    /*
     * The point of the fold is that a credential replacement is not the first
     * control on the page — not that stopping something becomes hard to find.
     * So each detail line names the ending press explicitly, and somebody who
     * came to stop something can see from the outside that stopping it is in
     * there.
     */
    expect(ALERTS_MANAGE_DETAIL).toContain("stop it posting");
    expect(CHIEF_MANAGE_DETAIL).toContain("forget the bot");
    expect(CHIEF_MANAGE_DETAIL).toContain("pause");
  });
});

it("is plain language throughout", () => {
  expectPlainLanguage(everySettingsNotificationsSentence());
});

it("enumerates every sentence the module can produce", () => {
  const enumerated = new Set(everySettingsNotificationsSentence());
  for (const sentence of [
    ALERTS_SECTION_HEADING,
    CHIEF_SECTION_HEADING,
    MANAGE_SUMMARY,
    ALERTS_MANAGE_DETAIL,
    CHIEF_MANAGE_DETAIL,
  ]) {
    expect(enumerated.has(sentence), sentence).toBe(true);
  }
});
