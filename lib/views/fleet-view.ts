/**
 * How the fleet is laid out, as the reader's decision (MAR-612).
 *
 * Henrik, 2026-08-11, verbatim:
 *
 * > 1. 3 cards in a row. make em bit smaller so we can have some space around
 * > 2. 1 card per row
 * > 3. A carousel type view one card in the middle and two slightly bent cards
 * >    on the sides. under the 3 cards we have the chief.
 *
 * MAR-590 shipped the fleet grid with a fixed track floor, and the complaint
 * behind this issue is that the floor is the *layout's* decision: three agents
 * want big cards, twenty want a list, and one person wants to look at one agent
 * at a time. So the track becomes a setting.
 *
 * ## Why this is a third setting rather than a widening of density
 *
 * `lib/views/density.ts` says what density is allowed to change — **spacing,
 * and that is the whole list** — and states the reason: the moment "compact"
 * starts meaning "fewer columns" it becomes a second interface with a second
 * set of things that can be true on one and false on the other.
 *
 * This setting *is* the columns. Folding it into density would break that rule
 * from the inside, and the two are genuinely independent questions: somebody can
 * want roomy spacing and one card per row, or tight spacing and three across.
 * They compose, which is why the capture matrix below is view × density rather
 * than a list of six named looks.
 *
 * ## What a view is allowed to change
 *
 * **The track the cards are laid on. Nothing a card says.**
 *
 * That is density's rule transplanted, and for density's reason. Every view
 * draws the same `<article>` with the same chips, the same goal, the same
 * hosting line and the same control — `app/_components/fleet-card.tsx` is one
 * component and every view maps it. A view that hid a chip to fit would be the
 * "second interface" density's header refuses, and the person who chose it is
 * the person least likely to be told what they gave up.
 *
 * `spotlight` adds something rather than removing it: the chief, underneath, who
 * says a sentence about the agent in the middle. That is an addition to the
 * page, never a subtraction from a card.
 *
 * ## Why the preference is not in the store
 *
 * Verbatim the argument `lib/views/density.ts` and `lib/views/fleet-strip.ts`
 * both make: SQLite is where DASH keeps things it may later have to account for
 * — agents, runs, audit rows, grants. Which shape somebody likes their fleet in
 * is not one of those, has no audit consequence, and is genuinely per-window.
 */

/** The three layouts. */
export const FLEET_VIEWS = ["grid", "rows", "spotlight"] as const;

export type FleetView = (typeof FLEET_VIEWS)[number];

/**
 * Three across is the default, and the default is a decision.
 *
 * It is what MAR-590 already ships, so nobody's fleet changes shape the day this
 * lands — a settings feature whose first act is to rearrange the page for every
 * existing user has spent its goodwill before anyone has chosen anything. It is
 * also the view that answers "what have I got" for the size of fleet DASH
 * actually has today, which is the question the page's own heading asks.
 */
export const DEFAULT_FLEET_VIEW: FleetView = "grid";

/**
 * Where the preference is kept.
 *
 * The packaged renderer's own scheme is registered `standard` and `secure`
 * (`electron/renderer-host.ts`), so it has a real origin and a real
 * `localStorage`; the developer path is loopback, which has one too. Same code
 * in both hosts, which is MAR-432's rule.
 */
export const FLEET_VIEW_STORAGE_KEY = "dash.fleetView";

/** The attribute `app/globals.css` switches on. */
export const FLEET_VIEW_ATTRIBUTE = "data-fleet-view";

/**
 * Read a stored value back, refusing anything that is not one of ours.
 *
 * Same shape and same reason as `parseDensity` and `parseFleetStripSetting`:
 * `localStorage` is a string bucket a user can edit, the value ends up in an
 * attribute selector, and a stale or hand-edited entry should fall back to the
 * default rather than silently disabling every rule that depends on it.
 */
export function parseFleetView(value: unknown): FleetView {
  return FLEET_VIEWS.includes(value as FleetView) ? (value as FleetView) : DEFAULT_FLEET_VIEW;
}

export interface FleetViewCopy {
  /** What the option says on screen. One word. */
  label: string;
  /** What the reader gets, for the `title` and the accessible description. */
  description: string;
}

/**
 * What each option says.
 *
 * ## Why this is not worded the way `describeDensity` is
 *
 * `describeDensity` deliberately labels its button with *what pressing it gives
 * you* rather than with the state it is in, because a two-state toggle labelled
 * with its current state is the oldest ambiguity in interface design and the
 * user cannot resolve it by looking.
 *
 * This control is three options shown side by side with the chosen one marked,
 * so there is nothing to resolve: the state is visible, and every option can
 * therefore be named after the thing it *is*. Naming these after what pressing
 * them gives you would produce three sentences competing for the same row, which
 * is the wall of text Henrik has complained about on every surface since
 * MAR-570.
 *
 * One word each, and the sentence lives on hover. That is the whole of the
 * standing instruction — one label per control, explanation on hover at most.
 */
export function describeFleetView(view: FleetView): FleetViewCopy {
  switch (view) {
    case "grid":
      return {
        label: "Grid",
        description: "Three cards to a row, with room around them.",
      };
    case "rows":
      return {
        label: "Rows",
        description: "One card to a row, the full width of the page.",
      };
    case "spotlight":
      return {
        label: "Spotlight",
        description:
          "One card in the middle, its neighbours turned beside it, and the chief underneath.",
      };
  }
}

/**
 * What the group of options is called.
 *
 * A `<fieldset>` needs a name and a radio group needs one more than most: the
 * three labels are one word each and mean nothing announced on their own, so
 * this is the sentence that makes "Grid" an answer rather than a noun.
 */
export const FLEET_VIEW_LEGEND = "How your agents are laid out";

/**
 * Where the spotlight lands after a step, wrapping at both ends.
 *
 * Pure, and here rather than in the component, because it is the whole of what
 * the two arrow buttons do and it is the part that can be wrong without a
 * browser: an off-by-one at the end of the fleet is a button that stops working
 * on the last card, which is exactly the defect nobody notices with three
 * agents in the store.
 *
 * It wraps rather than disabling at the ends. A carousel of three whose "next"
 * greys out on the third is a control that spends two thirds of its life
 * looking broken, and there is no meaningful "past the end" here — the fleet is
 * a ring of the same agents however many times you go round it.
 *
 * Refuses an empty fleet and any index outside it by answering 0, so a caller
 * that has just lost the agent it was centred on lands somewhere real.
 */
export function stepSpotlight(current: number, total: number, step: 1 | -1): number {
  if (total <= 0) {
    return 0;
  }
  if (!Number.isInteger(current) || current < 0 || current >= total) {
    return 0;
  }
  return (current + step + total) % total;
}
