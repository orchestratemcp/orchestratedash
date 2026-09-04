/**
 * What a brief is judged against (MAR-863, ADR 0033).
 *
 * Three clauses, frozen here, and the reason they are constants rather than
 * something a page or an agent supplies is `ASK_SYSTEM_PROMPT`'s exactly: **the
 * terms decide the verdict.** A field an author, a manifest or a URL could fill
 * would be a field that decides what a judge is asked, on a document that
 * becomes public and permanent. `lib/broker/operations.ts` bounds every one of
 * them again at the door anyway, which is the second reading of the same rule.
 *
 * ## They are the spike's, unchanged, and that matters
 *
 * These are the terms `orchestratemcp/brief-acceptance` actually ran ten
 * judgements against on Studionet. Rewriting them here to read more nicely would
 * throw away the only evidence anybody has about how this judge behaves — the
 * `transcripts/` in that repository are measurements of *these* sentences, and a
 * paraphrase would make them measurements of nothing.
 *
 * ## Where each clause is checkable, and the finding that moved one
 *
 * Studionet run 1 rejected an **honest** brief, and the judge was right to. The
 * criterion it failed asked the *prose* to state what the run set aside and
 * which sources did not answer — and DASH draws that honesty layer itself,
 * outside the brief, because those are DASH's records and not the model's
 * (ADR 0025). So the criterion was asking the deliverable to do something the
 * product deliberately does elsewhere.
 *
 * The requirement was real and was not dropped. It moved to
 * `EVIDENCE_REQUIREMENTS`, where it is checked against the fetch receipts the
 * payload actually ships — which is why `buildAdjudicationPayload` carries
 * `sources_fetched` including the sources that failed.
 *
 * That is the shape of every honest fix to a set of terms: move the clause to
 * where the evidence for it is, or delete it. Rewording it so a model passes is
 * how a judge stops meaning anything.
 *
 * Pure, no imports.
 */

/**
 * What the client asked for, in the words a person would use.
 *
 * The first thing in the case file, and the frame for everything after it: a
 * judge reading only the acceptance criteria would be grading a document against
 * a checklist with no idea what it was for.
 */
export const COMMISSION_ASKED =
  "Watch the public sources for this agent's subject and write up what changed, so a reader " +
  "can see what is being said without reading every thread. Group the material by subject " +
  "rather than by source.";

/**
 * What makes the writing acceptable.
 *
 * About the *document* — its coverage, its shape, and whether it overstates. Not
 * about citations, which are the evidence requirements' job. Keeping the two
 * apart is what lets a verdict say which of the two failed, which is the
 * difference between `REJECTED` and `INSUFFICIENT_EVIDENCE`.
 */
export const ACCEPTANCE_CRITERIA =
  "Organised by subject, with a heading per subject rather than one section per source. " +
  "Written as continuous prose a person can read, not a list of headlines. Says what is being " +
  "claimed and by whom, without overstating it.";

/**
 * What makes the writing supported.
 *
 * Three sentences, and the third is the one that moved here from the criteria —
 * see the note at the top. It is checkable exactly because
 * `buildAdjudicationPayload` ships `sources_fetched` whole, failures included.
 */
export const EVIDENCE_REQUIREMENTS =
  "Every paragraph must cite at least one evidence item by index, and every cited index must " +
  "resolve to an item in the EVIDENCE list. Every fact, number, name and date in a paragraph " +
  "must appear in the evidence that paragraph cites. The deliverable must ship the run's fetch " +
  "receipts, including the sources that did not answer.";

/** The three clauses, as one value, for the caller that sends all three. */
export interface CommissionTerms {
  asked: string;
  acceptance_criteria: string;
  evidence_requirements: string;
}

/** The terms DASH judges every brief against. There is one set and this is it. */
export function commissionTerms(): CommissionTerms {
  return {
    asked: COMMISSION_ASKED,
    acceptance_criteria: ACCEPTANCE_CRITERIA,
    evidence_requirements: EVIDENCE_REQUIREMENTS,
  };
}
