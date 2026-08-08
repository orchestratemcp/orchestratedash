import type { ReactNode } from "react";

/**
 * Pixel iconography for the sidebar (MAR-546).
 *
 * Drawn here as inline SVG rects on a 12×12 grid rather than vendored as PNGs,
 * and the difference from the O's is the point: the cast is *artwork*, audited
 * byte-for-byte against orchestrateweb's manifest, while these are *glyphs* —
 * six shapes whose whole job is to survive `currentColor` so the active link
 * can paint its icon in `--accent-contrast` and a hover can paint it in
 * `--text`. A PNG cannot change colour, and six PNGs per theme per state is a
 * sprite sheet nobody audits.
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
  /* Two ends and the bridge between them. */
  "/connections": [
    [1, 4, 4, 4],
    [7, 4, 4, 4],
    [5, 5, 2, 2],
  ],
  /* A rack of two units. */
  "/hosts": [
    [1, 2, 10, 3],
    [1, 7, 10, 3],
  ],
  /* Plus. */
  "/agents/add": [
    [5, 2, 2, 8],
    [2, 5, 8, 2],
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
