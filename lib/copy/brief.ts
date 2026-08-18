/**
 * The words around a written brief (MAR-674, ADR 0025).
 *
 * A brief is the most model-authored thing DASH has ever put on a screen: every
 * heading and every paragraph in it was written by a provider's model out of
 * material an agent scraped off the open web. Everything in *this* file is
 * DASH's own, and the split is the point — the document says what it says, and
 * the sentences here say whose it is and what DASH could and could not check
 * about it.
 *
 * Two rules the whole file follows:
 *
 * 1. **Attribute, never endorse.** A paragraph's numbers are checkable and its
 *    claims are not. `readBrief` guarantees that no link crossed from the model,
 *    so a fabricated claim cannot carry one — but it can still name a real
 *    item's number. So the wording is *written from*, never *supported by*, and
 *    never *sources*.
 * 2. **A missing digest is not a fault.** The two artifacts travel as separate
 *    messages on one channel, so a brief arriving first is ordinary. Only a
 *    genuine disagreement gets a worried sentence.
 */

import type { BriefCitations } from "../brief/citations";
import type { Recovery } from "./recovery";

/**
 * The heading over the document itself.
 *
 * There isn't one, and that is deliberate. `CURATED_HEADING` exists because a
 * grouping sits *above* a list and needs to say what it is; a brief is the whole
 * card, under the agent's own title, and a heading between the title and the
 * first section would be DASH captioning a document it did not write.
 */

/**
 * Who wrote this, said once and on the surface rather than behind a note.
 *
 * `describeCuratedBy`'s reason, and it is stronger here: a grouping is a
 * model's reading of a list a person can still see underneath. A brief is prose
 * with no list beside it, on its own card, and a reader who does not know a
 * model wrote it has been misled by omission.
 *
 * The model name is the agent's report of what the provider said answered —
 * which may not be what was asked for, because a router is entitled to route.
 * `null` when the artifact carried none, and the sentence still names the
 * author as a model rather than going quiet.
 */
export function describeBriefAuthor(model: string | undefined): string {
  return model === undefined || model.length === 0
    ? "Written by a model from what this agent collected. DASH did not check the claims in it."
    : `Written by ${model}, from what this agent collected. DASH did not check the claims in it.`;
}

/**
 * The label before the items a paragraph was written from.
 *
 * *Written from*, and the words were chosen against two tempting alternatives.
 * "Sources" is wrong because these are rows the agent collected, not the
 * provenance of the sentence. "Supported by" is worse: it is DASH asserting the
 * paragraph is true, which is exactly what DASH cannot check — the model chose
 * these numbers and nothing verified that the sentence follows from them.
 */
export const BRIEF_CITED_LABEL = "Written from";

/**
 * What a paragraph with no numbers on it says.
 *
 * Shown rather than left blank, on `app/_components/digest.tsx`'s rule for an
 * uncited item: the tempting rendering drops it so the document looks clean,
 * and that is precisely how a grounded verdict becomes theatre. A reader
 * skimming a brief should be able to see which sentences the model declined to
 * attach to anything.
 */
export const BRIEF_UNCITED_LABEL = "The model did not say what this was written from";

/**
 * What DASH says when it cannot stand behind the numbers in a brief.
 *
 * Null when the citations are sound, which is the ordinary case and needs no
 * sentence at all.
 *
 * The two branches are genuinely different situations and are worded that way.
 * `describeBrokerRefusal`'s rule applies: a reader sent to the wrong
 * explanation has been sent nowhere.
 */
export function describeBriefCitations(citations: BriefCitations): Recovery | null {
  if (citations.state === "matched") {
    return null;
  }

  if (citations.state === "digest_missing") {
    return {
      headline: "The list this was written from is not here",
      // Not worded as an error, because it is not one. Two artifacts travel as
      // separate messages and either may arrive first.
      meaning:
        "This agent's briefing arrived, and the roundup it was written from has not. " +
        "The briefing is shown in full; the items it points at are not on this page yet.",
      next_action: "If the run is still going, the roundup should appear when it finishes.",
      // Nothing for the reader to do: the other half either arrives or it
      // does not, and offering them a button would be inventing one.
      actor: "elsewhere",
    };
  }

  // The one that matters. A wrong citation is a real link under a claim it does
  // not support, so DASH withholds every one of them rather than showing the
  // subset that happens to land — see `resolveBriefCitations`.
  return {
    headline: "This briefing does not match the roundup on this page",
    meaning:
      citations.found_count === null
        ? "The briefing says it was written from a different list than the one DASH is holding."
        : `The briefing says it was written from ${describeItemCount(citations.expected_count)}, ` +
          `and the roundup here has ${describeItemCount(citations.found_count)}. ` +
          "DASH cannot tell which item each paragraph meant, so it is showing none of them.",
    next_action: "The briefing is still shown in full. Run the agent again to get a matching pair.",
    // A run is a press this person can make, so this one names them.
    actor: "user",
  };
}

/** `n items`, and `1 item` — the one place this file counts anything. */
function describeItemCount(count: number): string {
  return count === 1 ? "1 item" : `${String(count)} items`;
}
