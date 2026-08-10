/**
 * A refetch trigger for a view that DASH deliberately never polls (MAR-595
 * finding 13).
 *
 * `app/_data/use-view.ts`'s `useView` reads once, on mount, on purpose — see
 * its own header for why continuous polling is the wrong default. That is
 * right for data nothing outside the page changes, and wrong for the Agents
 * list: `npm run open-in-dash` raises a native `dialog.showMessageBox`
 * consent prompt (`electron/handoff-host.ts`) that can add a new agent to the
 * store, and it is not this window doing the adding — there is no click here
 * to hang a refetch off. What there is, once that dialog closes, is the main
 * window regaining OS focus. `window`'s `focus` event is the one moment a
 * change made outside this window's own controls is guaranteed to be visible
 * to it, without turning the page into a poller.
 *
 * A plain function, subscribing to a target rather than to `window` directly,
 * so the subscribe/unsubscribe contract can be checked without a real DOM —
 * this file has no jsdom to run against.
 */
export interface FocusTarget {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
}

/** Subscribes `onFocus` to the target's `focus` event; returns the unsubscribe. */
export function onWindowFocus(target: FocusTarget, onFocus: () => void): () => void {
  target.addEventListener("focus", onFocus);
  return () => {
    target.removeEventListener("focus", onFocus);
  };
}
