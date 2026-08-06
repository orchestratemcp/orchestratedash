/**
 * How much air the interface uses (MAR-420).
 *
 * The Modern Command Center design system asks for a dense view of the fleet.
 * MAR-423's calm-default rule says a novice's first DASH must not look like a
 * trading terminal. Both are right about different people, and the resolution
 * this repository already chose — recorded in the state-of-the-project review as
 * *"the calm-default / density-opt-in decision"* — is that calm is the default
 * and density is a thing you ask for.
 *
 * ## What density is allowed to change
 *
 * **Spacing. That is the whole list.**
 *
 * Not the type scale, not the palette, not the border weights, and above all not
 * the content. A compact DASH shows the same facts in less room. The moment
 * "compact" starts meaning "fewer columns" it becomes a second interface with a
 * second set of things that can be true on one and false on the other, and the
 * person who chose it is the person least likely to be told what they gave up.
 *
 * That rule is enforced in two places rather than asserted here: the
 * `[data-density="compact"]` block in `app/tokens.css` may declare nothing but
 * `--density-*` properties and may spend nothing but steps from the spacing
 * scale, and `tests/tokens.test.ts` fails if either stops being true.
 *
 * ## Why the preference is not in the store
 *
 * SQLite is where DASH keeps things it may later have to *account for* — agents,
 * runs, audit rows, grants. How airy somebody likes their tables is not one of
 * those, has no audit consequence, and is genuinely per-window rather than
 * per-user. Putting it in the store would mean a schema change, a migration, a
 * read channel entry and a command, for a value whose worst failure is that a
 * table looks roomy for one session.
 */

/** Comfortable is the default, and the default is a decision. */
export const DENSITIES = ["comfortable", "compact"] as const;

export type Density = (typeof DENSITIES)[number];

export const DEFAULT_DENSITY: Density = "comfortable";

/**
 * Where the preference is kept.
 *
 * The packaged renderer's own scheme is registered `standard` and `secure`
 * (`electron/renderer-host.ts`), so it has a real origin and therefore a real
 * `localStorage`. The developer path is loopback, which has one too. So the same
 * code works in both hosts, which is MAR-432's rule: one renderer, and any
 * difference between the two hosts should be in where data comes from and
 * nowhere else.
 */
export const DENSITY_STORAGE_KEY = "dash.density";

/** The attribute `app/tokens.css` switches on. */
export const DENSITY_ATTRIBUTE = "data-density";

/**
 * Read a stored value back, refusing anything that is not one of ours.
 *
 * `localStorage` is a string bucket a user can edit, and the value ends up in an
 * attribute selector. An unrecognised value falls back to the default rather
 * than being written through — which is not really about safety (an attribute
 * value cannot execute) so much as about a stale or hand-edited entry silently
 * disabling every density rule with nothing to show for it.
 */
export function parseDensity(value: unknown): Density {
  return DENSITIES.includes(value as Density) ? (value as Density) : DEFAULT_DENSITY;
}

/** The other one. A toggle rather than a select: there are two, and there should stay two. */
export function nextDensity(current: Density): Density {
  return current === "comfortable" ? "compact" : "comfortable";
}

export interface DensityCopy {
  /** The control's accessible name — what it does, not what it is. */
  label: string;
  /** What the user gets if they press it. */
  description: string;
}

/**
 * What the control says, per current setting.
 *
 * Written as "what pressing this gives you" rather than "what you have now",
 * because a toggle labelled with its current state is the oldest ambiguity in
 * interface design and the user cannot resolve it by looking.
 *
 * The second sentence is the honest half and is the reason this is copy rather
 * than an icon: somebody choosing a denser table deserves to know it is only a
 * table that changed. Nothing is hidden, so the copy says nothing is hidden.
 */
export function describeDensity(current: Density): DensityCopy {
  return current === "comfortable"
    ? {
        label: "Fit more on screen",
        description: "Rows and cards get closer together. Nothing is hidden.",
      }
    : {
        label: "Give things more room",
        description: "Rows and cards spread out again. Nothing is added.",
      };
}
