"use client";

import { useRef, useState } from "react";

/**
 * One send at a time — the guard itself, with no React in it (MAR-746).
 *
 * Its own module rather than a corner of `composer.tsx`, because the composer
 * is not the only control that needs it: the work inbox's option buttons are
 * the other half of Henrik's report — *"Same on clicking the button for giving
 * the agent a permission or making a decision. I can press the button five
 * times before it reacts."* — and a guard that lived inside the chat's chrome
 * would have arrived in `app/agents/detail/page.tsx` under a name that lied
 * about what it was for.
 *
 * `useSingleFlight` below is four lines of wiring around this; everything worth
 * testing is here, for `sendsOnEnter`'s reason (`composer.tsx`) and one
 * stronger. The claim is *"N rapid presses produce exactly one command"*, and N
 * presses landing inside one in-flight window is an ordering fact about calls,
 * not about markup — `tests/composer-in-flight.test.tsx` drives it by calling
 * the returned function N times against a promise it controls, which is the
 * only way to state that claim as an assertion rather than as a screenshot.
 *
 * ## Why a ref-shaped closure rather than a piece of React state
 *
 * A `useState` flag is not a guard. It is settled at the *next render*, and the
 * whole premise of MAR-746 is a burst of events arriving faster than a render:
 * on the measured before-run, five Enters dispatched with no gap between them
 * produced five turns, and a state flag would have been read as `false` by all
 * five. The closed-over `busy` below flips on the same tick as the call, so the
 * second caller is refused whether or not React has drawn anything yet. The
 * state flag still exists — it is what disables the field — but it is the
 * *consequence* of this, never the check.
 *
 * `onPendingChange` is called exactly once per state change: true when a run
 * starts, false when it settles, and never for a call that was refused. A
 * refused call must not re-announce pending, or a surface counting announcements
 * would show a spinner per press.
 *
 * Rejections settle the flag like any other outcome. A `run` whose work throws
 * still hands the field back — the alternative is a composer that is dead until
 * the page is reloaded, which is a worse failure than the one being fixed.
 */
export function singleFlight(
  onPendingChange: (pending: boolean) => void,
): (work: () => Promise<unknown>) => boolean {
  let busy = false;
  return (work) => {
    if (busy) {
      return false;
    }
    busy = true;
    onPendingChange(true);
    const settle = (): void => {
      busy = false;
      onPendingChange(false);
    };
    try {
      work().then(settle, settle);
    } catch {
      // A `work` that threw synchronously never returned a promise to settle on.
      settle();
    }
    return true;
  };
}

/**
 * `singleFlight`, wired to a flag React can render (MAR-746).
 *
 * Both composers hold this and pass `pending` straight to `Composer`, so the
 * field's disabled state and the dropped duplicate are one fact rather than two
 * that have to be kept in agreement; the work inbox holds one per card and
 * reads it into the `disabled` its buttons already had. What each caller still
 * owns is what the press *does* — see `composer.tsx`'s own header on why the
 * async work stays per surface.
 *
 * `start` is created once and never replaced: it closes over the guard, so a new
 * one per render would be a new guard per render and no guard at all.
 */
export function useSingleFlight(): {
  pending: boolean;
  start: (work: () => Promise<unknown>) => boolean;
} {
  const [pending, setPending] = useState(false);
  const guard = useRef<((work: () => Promise<unknown>) => boolean) | null>(null);
  if (guard.current === null) {
    // `setPending` is stable for the life of the component, so capturing it here
    // cannot go stale.
    guard.current = singleFlight(setPending);
  }
  return { pending, start: guard.current };
}
