/**
 * What a record card shows before you ask it for more (MAR-491).
 *
 * MAR-491 measured a nine-column table scrolling 1425px inside a 341px window
 * and called it unusable. The table became a card list, and the nine columns
 * became nine stacked rows: at 375px one agent fills more than a whole screen,
 * so a person reaches the second agent by scrolling past `Plan source`,
 * `Build target`, `Planned steps` and `Clearance`. The sideways scroll became a
 * downward one. Nothing overflows, and the ceiling is exactly where it was.
 *
 * ## The cut is by usefulness, not by width
 *
 * The issue offers two answers — stack every column below a breakpoint, or keep
 * a subset primary with the rest behind a disclosure — and takes the second,
 * "more honest under the calm-default rule". This module goes one step further
 * than the issue asked and applies it at **every** width, for two reasons.
 *
 * A width-conditional disclosure is two interfaces, and the one a person learns
 * on a laptop is not the one they get when they make the window narrow. And
 * room is not a reason to show something: `Build target: code` answers no
 * question a novice has on a 27-inch monitor either. The concept direction's
 * own fleet card is a character, a name, a status and **one** line of meta.
 *
 * ## What this must never be confused with
 *
 * MAR-491 names the trap in its own words: `data-density="compact"` **may not
 * hide anything**, so whatever hides facts at a narrow width has to be a
 * separate, visible affordance rather than something density does. Getting
 * those two confused would make the density toggle silently lossy on a phone,
 * which is precisely what its copy promises it is not.
 *
 * So this is a `<details>` element — the user's own control, in the same place
 * at every width and every density, remembering nothing and hiding nothing it
 * does not name. `tests/record-card.test.ts` asserts the label says what is
 * inside rather than "more".
 */

export interface RecordCardCopy {
  /** The disclosure's own label. */
  summary: string;
  /**
   * What a person gets by opening it, for the `title` and for anyone who wants
   * the sentence.
   */
  description: string;
}

/**
 * The label on every record card's disclosure.
 *
 * "Technical details" rather than "More" or "Show all", and the difference is
 * the whole of this decision. "More" describes the control; this describes what
 * is behind it, so somebody who does not want technical details can decide not
 * to open it — which is the only thing that makes hiding them honest.
 *
 * One label across every record card on purpose. A page that called it
 * "Technical details" here and "Advanced" there would be two affordances a
 * person has to learn separately for one behaviour.
 */
export const RECORD_CARD_COPY: RecordCardCopy = {
  summary: "Technical details",
  description:
    "The values DASH keeps about this record. Nothing here is needed to use it.",
};
