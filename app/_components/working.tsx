"use client";

import type { ReactNode } from "react";

/**
 * The shared "something is happening" affordance (MAR-544).
 *
 * Henrik's ask: when an agent works or thinks, the person should feel the
 * system alive — a present-participle phase line, like a loading screen. The
 * rule that keeps it honest is the issue's own: **never invent a phase the
 * system isn't in.** So `phase` must be plain language for a state the caller
 * actually holds — "Waiting for your decision", read off a runner status a
 * store row carries — and the default is the honest generic "Working…", which
 * claims nothing beyond what the caller already established: that a run is in
 * flight.
 *
 * The pips are the motion half and the words are the disclosure half, the
 * same split the fleet strip makes. Durations ride `--motion-*`, so a person
 * who asked for stillness gets a still line that still says the words.
 *
 * `aria-hidden` on the pips only: the accessible content is the phase text,
 * once. No live region here — the component renders *while* a state holds,
 * rather than announcing changes, and the surfaces that follow a run live
 * (`useLiveView` callers) already carry their own polite region saying when
 * they last read.
 */
export function WorkingLine({ phase = "Working…" }: { phase?: string }): ReactNode {
  return (
    <span className="working-line">
      <span className="working-pips" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {phase}
    </span>
  );
}
