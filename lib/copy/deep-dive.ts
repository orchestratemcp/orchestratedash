/**
 * What DASH says about a deep dive a model wrote (MAR-691).
 *
 * The rule `lib/copy/curation.ts` keeps: a sentence composed in a component is
 * a sentence a copy sweep does not see. `DigestBody` draws fields; this module
 * writes the words.
 *
 * Deliberately smaller than `curation.ts`. A digest is curated on every run
 * that tries one; a deep dive is opportunistic — on the sample agent it is
 * scoped to one thing chosen on a previous run, so most runs have nothing to
 * say here. `not_written` is not surfaced, for the reason `curation`'s absent
 * case already draws nothing: a sentence about a feature a run has not reached
 * yet would be noise on every digest that has not reached it either, and
 * `DigestArtifact.deep_dive` keeps absent and `not_written` apart so a future
 * surface can still tell the two claims apart if it ever needs to.
 */

/** The heading over a model's closer look. Not "Analysis" — that would claim DASH did it. */
export const DEEP_DIVE_HEADING = "A closer look";

/**
 * Who wrote this, on the surface — the same placement `describeCuratedBy`
 * uses and for the same reason: it is decision-changing (a reader has to know
 * this is the model's writing, not the agent's own words or DASH's), so it
 * stays on the surface rather than behind a note. `DigestBody` renders inside
 * the declarative panel as much as it renders in the workspace, and ADR 0008
 * bars any control from that region — so, as with `describeCuratedBy`, there
 * is nowhere behind a note for this sentence to go even if it were mechanism
 * rather than a decision-changing fact.
 */
export function describeDeepDiveAuthor(model: string | undefined): string {
  const who =
    model === undefined
      ? "Written by a language model, not by DASH or by the agent's own words."
      : `Written by a language model — the provider says it was ${model}.`;
  return `${who} It carries no link of its own; the items on this page are the record of what this run actually read.`;
}
