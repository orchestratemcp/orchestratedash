/**
 * The two things this page configures, named apart (MAR-877, UX-3).
 *
 * ## What was wrong with one page holding both
 *
 * Nothing, and that was MAR-743's call for a reason a person still agrees with:
 * somebody who set up alerts and later wants to *talk* to the chief comes back
 * to the page where Discord already was. What went wrong is narrower. The two
 * halves take **different credentials**, have **different revocation**, and
 * reach **different channels** — and the page ran them together, with the
 * credential-replacement press first in each row, so the loudest control on a
 * page about being told things was *Replace the bot token*.
 *
 * So the halves keep their page and get an explicit label each, and each one
 * reads the same way: one line of state, one thing to do, and everything that
 * replaces, pauses or ends the arrangement one press away under **Manage**.
 * Nothing moves between the halves and no credential, revocation or channel
 * semantic changes — `lib/notify/settings.ts` and `lib/chief/discord.ts` still
 * own every sentence about what either one does.
 *
 * ## Why Manage and not a settings icon
 *
 * Stop posting, Stop listening and Forget the bot are the presses a person
 * reaches for when something is going wrong, and they must be findable while it
 * is. One word, one press, always in the same place on both halves — never a
 * second fold, never a menu, and never further from the state line than the
 * primary action is.
 */

/** The alerts half: DASH posting into a channel. */
export const ALERTS_SECTION_HEADING = "Alerts DASH sends you";

/** The chief half: a person typing back. */
export const CHIEF_SECTION_HEADING = "Talk to the chief in Discord";

/**
 * The fold on both halves.
 *
 * The same word on both, deliberately: the two halves hold different presses —
 * one replaces an address, the other replaces a token and can be paused — and a
 * person learning where the dangerous ones live should have to learn it once.
 */
export const MANAGE_SUMMARY = "Manage";

/**
 * What is under the fold, said on the fold.
 *
 * A disclosure whose label is a verb tells somebody what pressing it does and
 * nothing about whether they want to. These two lines say what is inside, so
 * that the person who came to stop something can see from the outside that
 * stopping it is in there.
 */
export const ALERTS_MANAGE_DETAIL =
  "Replace the address DASH posts to, or stop it posting altogether.";

export const CHIEF_MANAGE_DETAIL =
  "Replace the bot token, pause the chief listening, or forget the bot entirely.";

/** Every sentence this module can produce, for the plain-language check. */
export function everySettingsNotificationsSentence(): string[] {
  return [
    ALERTS_SECTION_HEADING,
    CHIEF_SECTION_HEADING,
    MANAGE_SUMMARY,
    ALERTS_MANAGE_DETAIL,
    CHIEF_MANAGE_DETAIL,
  ];
}
