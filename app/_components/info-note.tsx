"use client";

import { useId, type ReactNode } from "react";

import { INFO_NOTE_COPY } from "../../lib/copy/info-note";

/**
 * The half of a sentence a person has to ask for (MAR-614).
 *
 * One component, used by every surface, so the affordance is in the same place
 * with the same word everywhere. `lib/copy/info-note.ts` carries the rule for
 * *what is allowed behind it* — the part of this that is a product decision
 * rather than a control — and it is the file to read before putting anything new
 * here.
 *
 * `TechnicalDetails` in `record-card.tsx` is the block-level version of the same
 * idea: a whole section of values you did not ask for, behind a disclosure of
 * their own. This is the inline one — a single explanation attached to the
 * single word or control it is about, small enough to sit at the end of a line.
 * Neither replaces the other, and a surface that used a `<details>` for one
 * sentence would put a disclosure triangle and a full-width block where a
 * question mark belongs.
 *
 * ## A button and a sibling, and no JavaScript
 *
 * The note opens on hover, on focus and on tap, and it does all three in CSS —
 * `:hover` on the wrapper and `:focus-within` on it, which is what makes the
 * keyboard and the touchscreen work without a handler. `:focus-visible` would
 * have been wrong: a tap gives focus without matching it, so every note in DASH
 * would have been unopenable on the 375px width where hover does not exist.
 *
 * No state, no effect, no listener. It works before hydration, which is not a
 * nicety in a static export whose first frame is a build artefact — it is the
 * difference between an explanation that is there when the window paints and one
 * that arrives a moment later.
 *
 * ## Why the text is in the markup even while it is hidden
 *
 * `aria-describedby` takes its text from the referenced element whether or not
 * that element is visible, so a screen reader announces the explanation as part
 * of the marker without the sighted layout having to carry it. That is the
 * property that makes this honest rather than lossy: the sentence is *relocated*
 * in the layout and *unmoved* in the accessibility tree.
 *
 * It is also why the copy gates keep working. Every pinned-copy test in
 * `tests/` asserts over rendered HTML, and a sentence behind this note is still
 * in that HTML — so a gate that was protecting a disclosure will not notice this
 * pass, and cannot be relied on to. `tests/info-note.test.tsx` is the one that
 * checks the relocation itself.
 *
 * ## Not remembered, on purpose
 *
 * For `record-card.tsx`'s reason. A note that stayed open would be a preference
 * nobody set on a surface whose calm default is the design, and one remembered
 * per note would be a table of open explanations in `localStorage`.
 */
export function InfoNote({
  children,
  label = INFO_NOTE_COPY.label,
}: {
  /** The explanation. One or two sentences — a paragraph belongs in a section. */
  children: ReactNode;
  /**
   * Overrides the marker's accessible name. Almost nothing should: the whole
   * value of one affordance is that it announces itself the same way every
   * time. Provided for the case where two notes sit in one row and "What this
   * means" would be ambiguous about which.
   */
  label?: string;
}): ReactNode {
  const id = useId();
  return (
    <span className="info-note">
      <button
        type="button"
        className="info-note-mark"
        aria-label={label}
        aria-describedby={id}
        /*
         * The native tooltip as well, and deliberately the *label* rather than
         * the explanation. A `title` carrying the whole sentence would race the
         * styled note under the same pointer, and the operating system would
         * win — putting DASH's copy in a font and a colour DASH does not choose.
         */
        title={label}
      >
        {/*
          A question mark rather than an "i", and `aria-hidden` because the
          button's name already says what it is. The glyph is decoration in the
          strict sense: nothing is lost if a font substitutes it.
        */}
        <span aria-hidden="true">?</span>
      </button>
      <span className="info-note-body" id={id} role="note">
        {children}
      </span>
    </span>
  );
}
