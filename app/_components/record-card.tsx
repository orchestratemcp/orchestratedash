import type { ReactNode } from "react";

import { RECORD_CARD_COPY } from "../../lib/copy/record-card";

/**
 * The half of a record card a person has to ask for (MAR-491).
 *
 * One component, used by every list of records, so the affordance is in the
 * same place with the same word on every surface. `lib/copy/record-card.ts`
 * carries the argument for the word and for the cut being by usefulness rather
 * than by width.
 *
 * ## A native `<details>`, and nothing around it
 *
 * No state, no animation, no icon of our own. The element already gives a
 * keyboard-reachable control with the right role, the right announcement and a
 * disclosure triangle every operating system draws in its own way — and it
 * works before hydration, which matters in a static export whose first frame is
 * a build artefact.
 *
 * It is deliberately **not** remembered. A disclosure that reopened itself on
 * the next visit would be a preference nobody set, on a surface where the calm
 * default is the design; and one that remembered per card would be a table of
 * open cards in `localStorage` describing agents that may no longer exist.
 */
export function TechnicalDetails({ children }: { children: ReactNode }): ReactNode {
  return (
    <details className="card-more">
      <summary title={RECORD_CARD_COPY.description}>{RECORD_CARD_COPY.summary}</summary>
      {children}
    </details>
  );
}
