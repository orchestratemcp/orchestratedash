"use client";

import { useEffect, type ReactNode } from "react";

/**
 * The document tells the stylesheet when nobody is looking (MAR-587).
 *
 * MAR-587's motion clause has three parts, and this is the one CSS cannot state
 * on its own: the idle loops must **pause when the window is hidden**. There is
 * no media query for that — `prefers-reduced-motion` is a preference, not a
 * fact about the window — so one listener writes a fact onto `<html>` and
 * `app/globals.css` reads it.
 *
 * ## Why it is here rather than in the avatar
 *
 * A fleet of twelve agents draws twelve sprites. Subscribing per sprite would
 * be twelve listeners for one document-wide fact, all recomputing the same
 * answer, and the count would grow with somebody's fleet. Visibility is a
 * property of the window; it is read once, in the layout, for everything in it.
 *
 * ## Why it writes an attribute rather than holding React state
 *
 * The alternative is a context every animated component subscribes to, which
 * re-renders each of them twice per alt-tab to change a class React would then
 * have to reconcile. An attribute on the root element changes what the
 * compositor is doing without React being involved at all — the same reason
 * `DensityScript` and `FleetStripScript` write attributes rather than state.
 *
 * ## What this does not claim
 *
 * "Hidden" is `document.visibilityState`, which covers a minimised window, a
 * background tab, and — on Windows, where Chromium tracks occlusion — a window
 * another window is fully covering. A window that is merely unfocused, or
 * partly covered, is still visible and its fleet keeps moving; that is correct
 * rather than a gap, because somebody can see it.
 *
 * There is no pre-paint script for this, unlike density: a window that has just
 * painted its first frame is by definition not hidden, so there is no stored
 * preference to restore and nothing to flash.
 */
export const WINDOW_VISIBILITY_ATTRIBUTE = "data-window";

export function WindowVisibility(): ReactNode {
  useEffect(() => {
    const apply = (): void => {
      const root = document.documentElement;
      if (document.visibilityState === "hidden") {
        root.setAttribute(WINDOW_VISIBILITY_ATTRIBUTE, "hidden");
      } else {
        root.removeAttribute(WINDOW_VISIBILITY_ATTRIBUTE);
      }
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      /*
       * Cleared on unmount, which only happens in a test or a fast refresh.
       * Leaving "hidden" behind there would still every loop in a document
       * nobody could un-hide, since the listener that would clear it is gone.
       */
      document.documentElement.removeAttribute(WINDOW_VISIBILITY_ATTRIBUTE);
    };
  }, []);

  return null;
}
