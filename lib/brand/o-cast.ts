/**
 * The O's — the brand cast, as DASH holds it (MAR-500, MAR-435 Phase 2).
 *
 * Eleven 50×50 pixel characters shared with SITE. The pixels live in
 * `public/o/1x/*.png`, the audit record beside this file in `o-cast.json`, and
 * this module is the typed view the code compiles against. `scripts/brand-check.mjs`
 * holds the three in agreement and fails `pnpm verify` when they drift.
 *
 * ## The rule that outranks the rest
 *
 * **A costume is recognition, never status, permission or capability.** A wizard
 * is a hat, not a power. No state in DASH may be readable only from a character,
 * and no character may be chosen by one — which is why `oFor` takes a seed and
 * not a condition, and why the brand check refuses a `name={…}` expression that
 * looks like it came from a status.
 *
 * ## Why the files are vendored rather than referenced
 *
 * DASH renders with no network and no sibling checkout, so the PNGs are copied
 * into this repository rather than resolved from orchestrateweb. A copy drifts;
 * the manifest's per-file sha256 is what keeps this one honest. A character that
 * changes on one side and not the other fails the check on the side that did not
 * change, which is the direction that matters — the stale copy is the one nobody
 * is looking at.
 *
 * ## Pure by construction
 *
 * No `node:fs`, no store, no React. `lib/db.ts` needs `oFor` to assign a
 * character at agent creation and a rendered component needs `O_NAMES`; a module
 * either of those could not import would have to be two modules.
 * `tests/client-bundle.test.ts` is the rule this obeys.
 */

/**
 * The cast, in its canonical order.
 *
 * **The order is load-bearing**: `oFor` indexes into `O_FLEET`, so reordering
 * this array re-costumes every agent whose character has not yet been
 * persisted, and silently disagrees with SITE for every one that has. Append
 * only, and only alongside a new audited PNG.
 *
 * Twelve since MAR-615: the original eleven fleet costumes plus the chief,
 * appended last so `O_FLEET`'s indices — and therefore every existing `oFor()`
 * assignment — are unchanged by his arrival.
 */
export const O_NAMES = [
  "ninja",
  "nerd",
  "cowboy",
  "wizard",
  "knight",
  "king",
  "chef",
  "viking",
  "medic",
  "explorer",
  "robot",
  "chief",
] as const;

export type OName = (typeof O_NAMES)[number];

/**
 * The eleven fleet costumes — what `oFor` deals from and what an avatar
 * picker offers (MAR-615).
 *
 * The chief is audited cast but not fleet: it is the orchestrator's own
 * character, the one the spotlight band names, and no ordinary agent wears
 * it — no picker may offer it, and no `oFor()` seed may land on it. Excluding
 * it here rather than filtering call sites means that rule holds by
 * construction rather than by every caller remembering it.
 */
export const O_FLEET = O_NAMES.filter((name): name is Exclude<OName, "chief"> => name !== "chief");

/**
 * The rendered sizes DASH offers, in whole multiples of the 50px source.
 *
 * 50 is a card; 100 is a portrait; 200 is the fleet's character-select tile
 * (MAR-587). Nothing between them, because `image-rendering: pixelated` upscales
 * by nearest neighbour: at 120px some source pixels land on two screen pixels
 * and some on three, and on a 50px shape that unevenness is the difference
 * between pixel art and a mistake.
 *
 * 150 arrived at MAR-669: Henrik's fleet-card anatomy pass asks for a bigger
 * portrait in Grid, whose column floor (`app/globals.css`'s 9rem) cannot take
 * 200 without reopening MAR-639's four-column fight but has room for a
 * modestly larger sprite than 100. A size is here because a surface draws at
 * it, which is the same argument `OAvatarProps.size` makes for having no
 * default: an unused size is a number chosen by whoever widened this union
 * for a surface that did not exist yet — this one exists now
 * (`app/_components/fleet-card.tsx`'s `portraitSize`).
 *
 * SITE's `OSize` also offers 25 — an exact half-step for its wordmark, where a
 * 50px character would tower over a 16px nav. DASH has no wordmark and no
 * surface that small, so the brand check enforces the literal rule
 * (`% 50 === 0`) rather than SITE's looser one. Widening this union is a
 * one-line diff, which is the point: it becomes a decision a reviewer sees.
 */
export type OSize = 50 | 100 | 150 | 200;

/**
 * The character for a given seed.
 *
 * Byte-identical to SITE's `oFor` in `apps/web/components/brand/OSprite.tsx`,
 * deliberately: the same agent must wear the same costume in both products on
 * day one, and two hash functions that agree today are two hash functions that
 * will disagree eventually.
 *
 * **This is the default assignment, not the assignment.** DASH persists the
 * answer at agent creation (`lib/store.ts`) and never recomputes it, because
 * MAR-435 asks for an avatar identifier independent of the agent's name and
 * runtime state — and a function of the name is not independent of the name.
 * Calling this on a render path would quietly reintroduce that dependency.
 *
 * Eleven or more agents reuse costumes. That is the documented fallback rather
 * than a defect: recognition degrades gracefully, and nothing in DASH depends on
 * a character being unique.
 *
 * Indexes `O_FLEET`, not `O_NAMES`, since MAR-615 — the chief joining the cast
 * must not reshuffle a single existing assignment, which indexing the full
 * twelve would have done for every agent whose hash landed past "explorer".
 */
export function oFor(seed: string): OName {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return O_FLEET[hash % O_FLEET.length];
}

/**
 * Whether a string names a character in the cast.
 *
 * The store reads a `TEXT` column, so what comes back is a string and not an
 * `OName`. A row holding a character this build no longer ships is a real
 * possibility — a downgrade, a hand-edited store — and the honest answer there
 * is to fall back to the seed rather than to render a broken image.
 */
export function isOName(value: unknown): value is OName {
  return typeof value === "string" && (O_NAMES as readonly string[]).includes(value);
}
