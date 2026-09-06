/**
 * Which reading of the author's panel goes with the selected run (MAR-875).
 *
 * ## Why this is its own module and not a function in `lib/views/panel.ts`
 *
 * A bundle boundary, and the same one `lib/brief/citations.ts` is split off for.
 * `lib/views/panel.ts` value-imports `resolvePanel` from `lib/panel-spec.ts`,
 * which reads the JSON schemas off disk — so the moment a `"use client"` page
 * imports anything from it for its *value*, `node:fs` is in the renderer bundle
 * and the packaged app stops hydrating: every page paints its background and
 * nothing else, with no error on screen. That is MAR-498's defect and
 * `tests/client-bundle.test.ts` is the gate that caught this one on its first
 * run rather than in a screenshot.
 *
 * So the shape stays in `lib/views/panel.ts`, where it is built, and the one
 * function the *page* needs lives here with nothing but type imports. It is the
 * arrangement `lib/deploy/receipt.ts` already models.
 *
 * ## Why the page needs a function at all
 *
 * Because the alternative is the page deciding it inline, and a second place
 * that knows how `by_run` is keyed is a second place to get the fallback wrong
 * — `resolveOpenCard`'s own note in `lib/views/artifacts.ts` makes the argument
 * about a two-line function for exactly this reason.
 */

import type { PanelView } from "./panel";

/**
 * The panel as it describes one run, or the standing one.
 *
 * ## The mixing this exists to stop
 *
 * The panel binds against the agent's whole history and reads the newest
 * artifact of each role, which is right for a standing account of an agent and
 * wrong the moment the surface above it is showing one selected run. Pressing
 * Sunday's briefing in the rail changed DASH's own card and left the author's
 * box describing Tuesday: its collected list, its table and its numbers all
 * belonged to a run the reader was not looking at, and looked exactly like the
 * one they were.
 *
 * Three of the four `PanelView` cases have no sections at all, and a stated
 * card about a version DASH cannot draw says the same thing whichever run is
 * open — so they come back untouched, by identity.
 *
 * A run with no entry falls back to the agent-wide sections rather than to an
 * empty panel. That is `resolveOpenCard`'s rule one layer along: a selection
 * that has outlived its records should land on what DASH does hold rather than
 * on a box with nothing in it.
 */
export function panelForRun(view: PanelView, runId: string | null): PanelView {
  if (view.kind !== "declared" || runId === null) {
    return view;
  }
  const sections = view.by_run[runId];
  return sections === undefined ? view : { ...view, sections };
}
