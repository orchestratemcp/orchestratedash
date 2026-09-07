/**
 * What the AI tab says around the cards it already had (MAR-877, UX-3).
 *
 * ## Why a module and not three strings in the page
 *
 * The AI tab's own sentences — the default's headline, a key's purpose, a
 * standing's chip, the recovery for a credential DASH cannot read — are all
 * composed in `lib/ai/model-choice.ts`, `lib/copy/fleet-standing.ts` and
 * `lib/ai/refresh.ts`, and arrive on the view already worded. MAR-877 does not
 * change a word of any of them: it changes **which of them a person meets
 * first**.
 *
 * That rearrangement needs a small number of new sentences of its own — the
 * label on a disclosure, the line that says a key is in trouble, the line that
 * says agents are waiting — and a page that wrote them inline would be the one
 * surface on this tab whose copy the plain-language gate never reads. So they
 * live here, with `everySettingsAiSentence` beneath them, the shape
 * `everyFleetStandingSentence` and `everyCurationSentence` established.
 *
 * ## The two states this tab now has
 *
 * **No key.** One question, asked once: which provider. The three cards that
 * used to stack their consequences on top of each other are one chooser and one
 * card, and nothing about repair, routing or defaults is drawn at all — there is
 * nothing yet to route, default or repair, and a page that led with recovery was
 * answering a question nobody on a fresh DASH has.
 *
 * **A key.** One line saying what is in force, and everything else folded: the
 * level rows and the key cards under *Advanced routing*, the repair control
 * under *Troubleshoot*. Both open themselves when there is a reason — no
 * default chosen yet, an agent waiting for a key DASH already holds, a key DASH
 * cannot read — so the fold never hides a thing a person has to do.
 */

/** The heading a DASH with no model key opens on. */
export const AI_FIRST_KEY_HEADLINE = "Connect a model provider";

/**
 * What that card is for, in the person's terms.
 *
 * Deliberately says nothing about which provider is better. DASH ranks no
 * model and no vendor — `describeLevelModels` makes the same point one section
 * down — so this says what the key is for and leaves the choosing to the card
 * below, which is where each provider's own consequences are already written.
 */
export const AI_FIRST_KEY_DETAIL =
  "An agent thinks with a model, and a model comes from a service you hold a key with. " +
  "Pick one below and DASH will tell you what it can do with that key before you hand it over.";

/** The label on the chooser itself. */
export const AI_FIRST_KEY_LABEL = "Which service";

/** The fold holding the level rows and the keys. */
export const AI_ADVANCED_SUMMARY = "Advanced routing";

/** The fold holding the repair control. */
export const AI_TROUBLESHOOT_SUMMARY = "Troubleshoot";

/** The press that opens *Advanced routing* from the summary line. */
export const AI_CHANGE_LABEL = "Change";

/**
 * A key DASH holds and cannot read, counted (MAR-676's finding, summarised).
 *
 * The card's own three-part explanation is unchanged and still under the chip
 * that says it. This is the one line above the fold that says there is
 * something to open, because a disclosure labelled *Troubleshoot* with nothing
 * beside it is a fold a person in trouble has no reason to press.
 */
export function describeAiTrouble(count: number): string {
  if (count <= 0) {
    return "";
  }
  return count === 1
    ? "There is 1 key DASH holds and cannot read right now."
    : `There are ${String(count)} keys DASH holds and cannot read right now.`;
}

/**
 * Agents that would work if somebody pressed the button under the fold.
 *
 * ADR 0013's third moment: a key was connected, an agent arrived afterwards,
 * and giving it the consent DASH already holds is a deliberate press rather
 * than something DASH does quietly. That press lives on the provider's own card
 * and MAR-874 and MAR-878 both depend on it being findable, so this line says
 * it is there and the fold above it opens itself while it is.
 */
export function describeAiWaiting(count: number): string {
  if (count <= 0) {
    return "";
  }
  return count === 1
    ? "1 agent is waiting to be given a key DASH already holds."
    : `${String(count)} agents are waiting to be given a key DASH already holds.`;
}

/**
 * Every sentence this module can produce, for the plain-language check.
 *
 * Counts are enumerated at nought, one and several rather than at one value,
 * because the singular and the plural are different sentences and a gate that
 * only ever read one of them would be half a gate.
 */
export function everySettingsAiSentence(): string[] {
  const sentences = [
    AI_FIRST_KEY_HEADLINE,
    AI_FIRST_KEY_DETAIL,
    AI_FIRST_KEY_LABEL,
    AI_ADVANCED_SUMMARY,
    AI_TROUBLESHOOT_SUMMARY,
    AI_CHANGE_LABEL,
  ];
  for (const count of [0, 1, 2, 7]) {
    sentences.push(describeAiTrouble(count), describeAiWaiting(count));
  }
  return sentences.filter((sentence) => sentence !== "");
}
