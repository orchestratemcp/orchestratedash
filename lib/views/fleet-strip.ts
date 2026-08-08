/**
 * The bottom-edge fleet strip's two decisions, as pure functions (MAR-503).
 *
 * The strip itself is `app/_components/fleet-strip.tsx`. What lives here is
 * everything about it that can be wrong without a browser: whether it is shown,
 * and how many of the O's fit before the rest become a number.
 *
 * ## What the strip is, restated for MAR-544
 *
 * This header said **"presence, not telemetry"** and argued that a character
 * invented into motion from a single frame would be motion pretending to be
 * state. Henrik overrode the conclusion on 2026-08-07 — the fleet should be
 * alive, its health readable as behaviour — and MAR-544 keeps the argument's
 * premise while reversing its verdict: the O's now move, and *only* as a pure
 * function of real signals. `lib/views/fleet-motion.ts` is that function and
 * carries the full rule; the single vendored frames are still the only
 * artwork, and what animates is the box they are drawn in, on `--motion-*`
 * tokens.
 *
 * What survives unchanged: no meaning colour ever reaches the row —
 * `app/tokens.css` reserves emerald for live and healthy things, and a
 * behaviour is legible without a colour — and the caption states the same
 * facts in words, so the motion is never the only copy of them.
 */

/** Whether the strip is drawn. Two states, and there should stay two. */
export const FLEET_STRIP_SETTINGS = ["shown", "hidden"] as const;

export type FleetStripSetting = (typeof FLEET_STRIP_SETTINGS)[number];

/**
 * Shown by default, and the default is a decision.
 *
 * The strip is calm, static content that answers "who is in here?" before a
 * novice has learned the word "fleet" — the one question a first-run DASH can
 * answer with a picture. `lib/views/density.ts` defaults the other way for the
 * opposite reason: compact is a preference somebody develops, and this is
 * something somebody arrives needing.
 */
export const DEFAULT_FLEET_STRIP: FleetStripSetting = "shown";

/**
 * Where the preference is kept, and why it is not in the store.
 *
 * Verbatim the argument `lib/views/density.ts` makes: SQLite is for things DASH
 * may later have to account for, and whether somebody likes a row of characters
 * along the bottom of their window has no audit consequence. Same bucket, same
 * host-agnostic reason it works in both the packaged renderer and a browser tab.
 */
export const FLEET_STRIP_STORAGE_KEY = "dash.fleetStrip";

/** The attribute `app/globals.css` switches on. */
export const FLEET_STRIP_ATTRIBUTE = "data-fleet-strip";

/**
 * Read a stored value back, refusing anything that is not one of ours.
 *
 * Same shape and same reason as `parseDensity`: `localStorage` is a string
 * bucket a user can edit, the value ends up in an attribute selector, and a
 * stale entry should fall back to the default rather than silently disabling
 * the rule that depends on it.
 */
export function parseFleetStripSetting(value: unknown): FleetStripSetting {
  return FLEET_STRIP_SETTINGS.includes(value as FleetStripSetting)
    ? (value as FleetStripSetting)
    : DEFAULT_FLEET_STRIP;
}

/** The other one. */
export function nextFleetStripSetting(current: FleetStripSetting): FleetStripSetting {
  return current === "shown" ? "hidden" : "shown";
}

export interface FleetStripCopy {
  /** The control's accessible name — what pressing it gives you. */
  label: string;
  /**
   * What the control shows on screen.
   *
   * Shorter than `label` in one direction only, and the asymmetry is the
   * point. A visible "Hide" beside a row of characters is unambiguous because
   * the characters are right there; a visible "Show" beside an empty bar names
   * nothing at all, so the off state spends the words. Both keep `label` as
   * their accessible name, so nothing is shorter for a screen reader than it is
   * for an eye.
   */
  visible: string;
  /** What it means, for the `title` and for anyone who wants the sentence. */
  description: string;
}

/**
 * What the toggle says, per current setting.
 *
 * Written as "what pressing this gives you" rather than "what you have now",
 * for the reason `describeDensity` gives: a toggle labelled with its current
 * state is the oldest ambiguity in interface design and the user cannot resolve
 * it by looking.
 */
export function describeFleetStrip(current: FleetStripSetting): FleetStripCopy {
  return current === "shown"
    ? {
        label: "Hide your agents from the bottom edge",
        visible: "Hide",
        description: "The row of characters goes away. Nothing about your agents changes.",
      }
    : {
        label: "Show your agents along the bottom edge",
        visible: "Show your agents",
        description: "Your agents stand along the bottom of the window again.",
      };
}

/**
 * One rendered sprite, plus the air beside it.
 *
 * 50 is the source size and the only size this strip draws — the whole-number
 * rule means the alternative to fitting is fewer characters, never smaller
 * ones, which is the constraint that forces the overflow count below to exist.
 */
export const FLEET_STRIP_SLOT = 50 + 12;

/**
 * How many characters fit, and how many become a number.
 *
 * **Shrinking is not on the table**, which is what makes this a real decision
 * rather than a CSS property. `image-rendering: pixelated` upscales by nearest
 * neighbour, so a "just slightly smaller" sprite lands some source pixels on
 * one screen pixel and some on none: the character stops being pixel art and
 * starts looking like a rendering fault. So a narrow window shows fewer of the
 * O's and says how many it is not showing.
 *
 * The overflow count occupies a slot of its own, and the arithmetic accounts
 * for it: a strip with room for five and six agents shows four and "+2", never
 * five and a "+1" pushed off the edge it was drawn to prevent.
 *
 * Never fewer than one. At a width where nothing fits, one character and a
 * count is still an answer to "who is in here?"; an empty rule with a number
 * beside it is not.
 */
export function fleetStripSlots(
  available: number,
  total: number,
): { shown: number; overflow: number } {
  if (total <= 0) {
    return { shown: 0, overflow: 0 };
  }
  const fits = Math.max(1, Math.floor(available / FLEET_STRIP_SLOT));
  if (fits >= total) {
    return { shown: total, overflow: 0 };
  }
  // One slot goes to the count itself, and `Math.max` keeps the degenerate
  // narrow case — room for exactly one thing — showing a character rather than
  // only the number of characters it is not showing.
  const shown = Math.max(1, fits - 1);
  return { shown, overflow: total - shown };
}

/**
 * How the strip describes itself when nothing is hovered or focused.
 *
 * A count rather than a list, and in DASH's own plain-language register: the
 * names are already on the characters' own controls, and repeating them here
 * would be the same fact twice with the second copy free to be wrong about the
 * order.
 */
export function describeFleetCount(total: number, overflow: number): string {
  const agents = total === 1 ? "1 agent" : `${String(total)} agents`;
  return overflow > 0 ? `${agents} · ${String(overflow)} not shown` : agents;
}
