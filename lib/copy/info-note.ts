/**
 * What may hide behind a hover, and what may never (MAR-614).
 *
 * Henrik, on the issue: *"Alot of the text are like documentation. And alot of
 * text could be hoover info or something."* He is right, and the dangerous half
 * of being right is that DASH's surfaces are full of sentences that **look** like
 * documentation and are load-bearing — the receipts, the consent consequences
 * and the refusals that ADR 0002 and ADR 0006 put on screen on purpose. A pass
 * that swept prose behind a control by length or by tone would take those with
 * it, and every gate in the repository would stay green while it happened,
 * because the string is still in the DOM.
 *
 * So the cut is not by length, by tone, or by which paragraph looks heaviest.
 * It is one question, asked of every sentence:
 *
 * > **Does this change what the person would decide, right now, on this screen?**
 *
 * If it does, it stays on the surface. If it only explains *how DASH works*, it
 * goes behind the note. A sentence that a person reads once in their life and
 * never needs again is documentation; a sentence that would change whether they
 * press the button is the interface.
 *
 * ## The inversion this produces, which is the point
 *
 * `describeProof` in `lib/connection-card.ts` returns a pair — what DASH *can*
 * prove about a connection and what it *cannot* — and `ConnectorTile` has
 * rendered both, whole, on every tile since MAR-570, with the argument that
 * showing `can` without `cannot` is "the reassurance half of a sentence whose
 * value is the other half".
 *
 * That argument survives this pass and decides its direction. The half that
 * moves is **`can`** — the mechanism, the reassurance, the part that says DASH
 * is being careful. The half that stays is **`cannot`** — the limit, the part
 * that says DASH will not be able to help you. Which is the opposite of what a
 * text pass does if nobody is watching: the frightening sentence is the long
 * one, the long one is the one that looks like documentation, and hiding it
 * makes every screenshot calmer and every user less informed.
 *
 * Showing the limit without the reassurance is strictly safer than the reverse,
 * and the reassurance is one hover away with a label saying it is there. Nothing
 * is deleted anywhere in this pass.
 *
 * ## Why the label is not "More"
 *
 * `lib/copy/record-card.ts` settled this for the record disclosure and the same
 * reasoning binds here: a control named after itself tells you nothing you can
 * decline. "What this means" says what is behind it, so somebody who does not
 * want the explanation can decide not to open it — which is the only thing that
 * makes putting it away honest.
 *
 * One word across every surface, for that module's other reason: a page that
 * called it "What this means" here and "Explain" there would be two affordances
 * a person has to learn separately for one behaviour.
 */

export interface InfoNoteCopy {
  /**
   * The marker's accessible name — what a screen reader announces, and what a
   * pointer user sees as the native tooltip before the note itself opens.
   */
  label: string;
  /**
   * The one-line statement of what this affordance is, for anyone documenting
   * it or writing a test against it.
   */
  description: string;
}

/**
 * The one label on every hover note in DASH.
 *
 * Deliberately a question in the reader's voice rather than an instruction in
 * DASH's. "What this means" is the thing they were about to ask; "Learn more"
 * is a thing DASH would like them to do.
 */
export const INFO_NOTE_COPY: InfoNoteCopy = {
  label: "What this means",
  description:
    "How DASH does this. Nothing here changes what happens when you press the button.",
};

/* ---------------------------------------------------------------------- *
 * The connection proof pair, split
 * ---------------------------------------------------------------------- */

/** The four arrangements `classifyProof` can put a connection in. */
export type ProofKind = "dash_brokered" | "handed_over" | "agent_holds" | "held_elsewhere";

export interface ProofSplit {
  /** What stays on the tile. Never empty. */
  surface: readonly string[];
  /** What moves behind the note. May be empty, and then no note is drawn. */
  note: readonly string[];
}

/**
 * Which half of `describeProof` a connector tile shows, and which half it puts
 * behind the note.
 *
 * `ConnectorTile` has drawn both halves since MAR-570, with the rule that they
 * are "rendered whole" — showing the reassurance without the limit is half a
 * sentence. Four tiles on one page means that pair up to four times, saying the
 * same two things about four different services, which is precisely the
 * documentation Henrik is describing.
 *
 * The split is decided per arrangement rather than by one rule for all four,
 * because two of them are **grammatically coupled** and two are not:
 *
 * - `dash_brokered`'s limit begins *"It cannot see…"*, whose subject is the
 *   sentence before it;
 * - `handed_over`'s begins *"From that moment…"*, which is the moment the
 *   sentence before it describes.
 *
 * Separating either would leave a dangling pronoun on the surface — a sentence
 * that is technically present and actually unreadable, which is worse than
 * either whole option. So those two move as a pair, and the tile shows
 * `describeProof`'s own `label` in their place: a four-word summary that module
 * has carried, unused, since MAR-533.
 *
 * The other two stand alone, and there the split runs the way
 * `lib/copy/info-note.ts`'s header argues it must: the limit stays on the
 * surface and the mechanism moves. Those are the two arrangements where **DASH
 * cannot help you** — it does not hold the sign-in, cannot revoke it and cannot
 * say what was done with it — and that is the single most decision-changing
 * sentence on the page. It is not going behind anything.
 *
 * The label is enough for the coupled pair for a reason that is checked rather
 * than assumed: `connectorChip` already puts the same fact in the tile's status
 * chip, so "DASH does not hold this" is on the surface either way. The label is
 * a second statement of it, not the only one.
 */
export function splitProof(
  kind: ProofKind,
  proof: { label: string; can: string; cannot: string },
): ProofSplit {
  switch (kind) {
    case "dash_brokered":
    case "handed_over":
      return { surface: [proof.label], note: [proof.can, proof.cannot] };
    case "agent_holds":
    case "held_elsewhere":
      return { surface: [proof.cannot], note: [proof.can] };
  }
}

/* ---------------------------------------------------------------------- *
 * The fleet card's glance sentences
 * ---------------------------------------------------------------------- */

/** The five things a glance chip can be about. `lib/copy/glance.ts` writes them. */
export type GlanceKind = "needs_you" | "not_connected" | "overdue" | "new_output" | "all_clear";

/**
 * Which glance sentences a fleet card shows, and which it puts behind the note
 * (MAR-614).
 *
 * Henrik, 2026-08-11, with a screenshot of one card in the rows view:
 *
 * > *"This is a card in the fleet view. Why is it so much text? I dont get it"*
 *
 * The sentence he was looking at is `GLANCE_ALL_CLEAR`'s, and the reason it was
 * the one on his screen is the reason it is the one that moves: **it is the
 * sentence a healthy agent shows.** A fleet of five agents with nothing wrong
 * draws it five times, so the card with the least to say is the card that says
 * the most — which is the whole complaint, stated as a mechanism.
 *
 * ## The line, and why it is not "hide the long ones"
 *
 * This module's header asks one question of every sentence: *does this change
 * what the person would decide, right now, on this screen?* Asked of these five,
 * it splits them cleanly into a demand and an absence:
 *
 * - **`all_clear` is an absence.** Its sentence enumerates the four questions
 *   DASH asked and answered "no" — no new output, nothing to approve, nothing to
 *   connect, no missed run. That is DASH showing its working, and there is by
 *   definition no decision for it to change: the chip's three words *are* the
 *   fact, and nothing follows from them. It is the clearest case in DASH of a
 *   sentence somebody reads once in their life and never needs again.
 * - **The other four are demands.** Each names something waiting on the reader,
 *   and each sentence carries the part the chip cannot:
 *   - `needs_you` says how many things are waiting, and in its expired branch
 *     says the deadline passed and the answer must start again — which is a
 *     *different action* from the one the chip implies. Hiding that would be
 *     hiding a correction.
 *   - `not_connected` carries "which no sign-in will fix — add the agent again
 *     from its own folder". That is the limit, and `splitProof` above already
 *     settled that the limit stays and the mechanism moves. It is the most
 *     decision-changing sentence on the card.
 *   - `overdue` carries the declared interval and the last run DASH saw. The
 *     chip is binary; those two turn it into a judgement, and an agent that
 *     expects to run hourly and last ran in June is a different problem from one
 *     a day late on a weekly schedule.
 *   - `new_output` carries the count, and its `never_looked` branch says
 *     something the chip does not: that nobody has opened this agent at all.
 *
 * So a card at rest gets quieter and a card with something waiting on it does
 * not. That asymmetry is the outcome rather than a shortfall — the cards that
 * keep their prose are the ones somebody actually has to read, and after this
 * pass they are the only ones in the fleet carrying any, which makes them
 * findable at a glance instead of identical to their neighbours.
 *
 * Nothing is deleted. The sentence moves into an `InfoNote`, which keeps it in
 * the markup and in the accessibility tree — see this file's header and
 * `app/_components/info-note.tsx`.
 */
export function splitGlance(
  kind: GlanceKind,
  meaning: string,
): { surface: string | null; note: string | null } {
  return kind === "all_clear" ? { surface: null, note: meaning } : { surface: meaning, note: null };
}
