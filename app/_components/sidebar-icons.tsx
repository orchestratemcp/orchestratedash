import type { ReactNode } from "react";

/**
 * Pixel iconography for the sidebar (MAR-546).
 *
 * Drawn here as inline SVG rects on a 12×12 grid rather than vendored as PNGs,
 * and the difference from the O's is the point: the cast is *artwork*, audited
 * byte-for-byte against orchestrateweb's manifest, while these are *glyphs* —
 * shapes whose whole job is to survive `currentColor` so the active link can
 * paint its icon in `--accent-contrast` and a hover can paint it in `--text`.
 * A PNG cannot change colour, and one PNG per destination per theme per state
 * is a sprite sheet nobody audits.
 *
 * There were seven and there are four (MAR-592): the four setup destinations
 * became tabs on Settings, which is one row with one glyph.
 *
 * `shape-rendering="crispEdges"` is `image-rendering: pixelated` for vector
 * squares: every rect sits on whole grid units, so the glyphs scale exactly the
 * way the cast does — whole multiples only, hard edges, no anti-aliasing fog.
 *
 * Every icon is `aria-hidden`: the accessible name is the link's label, which
 * is visible at full width and visually hidden in the rail. An icon that spoke
 * would say every destination twice.
 */

/** x, y, width, height on the 12×12 grid. */
type Px = readonly [number, number, number, number];

const GLYPHS: Readonly<Record<string, readonly Px[]>> = {
  /* The fleet: four agents in a grid. */
  "/": [
    [1, 1, 4, 4],
    [7, 1, 4, 4],
    [1, 7, 4, 4],
    [7, 7, 4, 4],
  ],
  /* An item dropping into an open tray. */
  "/work": [
    [5, 1, 2, 3],
    [4, 3, 4, 1],
    [1, 6, 1, 4],
    [10, 6, 1, 4],
    [1, 9, 10, 1],
  ],
  /* A play glyph, stepped: the thing a run does. */
  "/runs": [
    [3, 2, 2, 8],
    [5, 3, 2, 6],
    [7, 4, 2, 4],
    [9, 5, 1, 2],
  ],
  /*
   * A gear: a square ring and four teeth (MAR-592).
   *
   * It replaces four glyphs — the bridge, the rack, the bell and the plus —
   * because it replaces four sidebar rows. The ring is drawn as four bars
   * rather than one block so the hole in the middle is real: these are filled
   * rects with no stroke and no even-odd fill, so a "hollow" shape is one that
   * was never drawn over.
   */
  "/settings": [
    [5, 1, 2, 2],
    [5, 9, 2, 2],
    [1, 5, 2, 2],
    [9, 5, 2, 2],
    [3, 3, 6, 2],
    [3, 7, 6, 2],
    [3, 5, 2, 2],
    [7, 5, 2, 2],
  ],
};

export function hasSurfaceIcon(href: string): boolean {
  return href in GLYPHS;
}

export function SurfaceIcon({ href }: { href: string }): ReactNode {
  const rects = GLYPHS[href];
  if (rects === undefined) {
    /*
     * A destination without a glyph renders no icon rather than a wrong one.
     * In the rail that would be an unlabelled blank, so `tests/sidebar.test.tsx`
     * asserts every entry in SURFACES has a glyph — this branch is for the
     * moment between adding a surface and drawing it, and the test makes that
     * moment fail loudly instead of shipping.
     */
    return null;
  }
  return (
    <svg
      className="sidebar-icon"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {rects.map(([x, y, w, h]) => (
        <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}
