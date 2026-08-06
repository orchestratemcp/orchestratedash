/**
 * The window's own colours and geometry, decided once and shared by three
 * processes that cannot import each other's stylesheets.
 *
 * MAR-440 asks for "one background colour shared by the title bar, the window
 * `backgroundColor`, and the splash, so there is no seam and no flash". That is
 * a single requirement with three consumers in two languages:
 *
 * - Electron main sets `BrowserWindow.backgroundColor` and the Windows
 *   `titleBarOverlay` colours, in Node, before any stylesheet exists;
 * - the splash window paints itself, with no preload and no bundle;
 * - the renderer paints everything below the title bar, from `app/tokens.css`.
 *
 * A colour written down three times is a colour that will be right in two
 * places. So it is written here, and `tests/chrome.test.ts` asserts that
 * `app/tokens.css` still agrees with this module by reading the stylesheet —
 * which is the only direction that check can run, since CSS cannot import TS.
 *
 * Everything in this file is pure and I/O-free, for the reason
 * `lib/shell/window.ts` gives: a posture that lives at a `new BrowserWindow(...)`
 * call site is one careless edit from being wrong with nobody noticing.
 */

/**
 * The app's base surface, per theme.
 *
 * This is `--surface-0` in `app/tokens.css`, and it is the colour of the first
 * frame Electron paints — before the renderer has loaded, before the splash has
 * painted, and behind the window while it resizes. Electron's default is white,
 * which is the flash MAR-436 exists to remove.
 */
export const SURFACE_0 = Object.freeze({
  dark: "#0b0e14",
  light: "#ffffff",
});

/** Title bar foreground and hover, for the native window controls Windows draws. */
export const TITLE_BAR_SYMBOLS = Object.freeze({
  dark: "#9aa5b8",
  light: "#5a6474",
});

export type ThemeName = keyof typeof SURFACE_0;

/**
 * How tall the title bar is, in CSS pixels.
 *
 * Windows draws its own minimise/maximise/close buttons into the overlay at
 * this height, so this number is simultaneously a layout constant for our bar
 * and a request to the operating system. They cannot be allowed to differ: a
 * shorter overlay leaves our bar's bottom edge clickable-through, and a taller
 * one puts the close button over page content.
 *
 * 40 rather than Windows' native 32 because the bar carries a control and a
 * surface name, not just a title, and 32 leaves a 15px label with 8px of air.
 */
export const TITLE_BAR_HEIGHT = 40;

/**
 * The Windows `titleBarOverlay` options for a theme.
 *
 * `symbolColor` and not `color`-only: the overlay's background must be the same
 * surface as everything else, and its glyphs must be legible against it. Windows
 * picks neither for us once `titleBarStyle` is `hidden`.
 */
export function titleBarOverlay(theme: ThemeName): {
  color: string;
  symbolColor: string;
  height: number;
} {
  return {
    color: SURFACE_0[theme],
    symbolColor: TITLE_BAR_SYMBOLS[theme],
    height: TITLE_BAR_HEIGHT,
  };
}

/**
 * Which theme to paint, given what the OS says and what the user chose.
 *
 * The user's choice wins when they made one, and the OS decides otherwise. This
 * is the same rule `app/tokens.css` implements with `color-scheme` and
 * `light-dark()`; it exists twice because main has to answer it before any CSS
 * is parsed, and stating it as a function is what lets a test check the two
 * answers agree.
 */
export function resolveTheme(
  osPrefersDark: boolean,
  chosen: ThemeName | null,
): ThemeName {
  return chosen ?? (osPrefersDark ? "dark" : "light");
}

/**
 * `titleBarStyle` for a platform.
 *
 * macOS is deferred (MAR-440 says so) but not ignored: `hiddenInset` is the
 * value that leaves the traffic lights where macOS users expect them while
 * still giving us the bar, and choosing it here means the deferral is a layout
 * question rather than a second code path to write later.
 *
 * Linux gets `hidden` with no overlay — it has no `titleBarOverlay` support, so
 * the window controls must be ours there. That platform is not shipped and the
 * value is recorded rather than exercised.
 */
export function titleBarStyle(platform: NodeJS.Platform): "hidden" | "hiddenInset" {
  return platform === "darwin" ? "hiddenInset" : "hidden";
}

/**
 * Whether this platform draws its own window controls into our bar.
 *
 * The custom bar has to reserve horizontal space for them, and on which side
 * depends on the platform: macOS puts its traffic lights at the left, Windows
 * puts minimise/maximise/close at the right. A bar laid out for one is unusable
 * on the other, so the layout asks this rather than assuming.
 */
export function windowControlsSide(platform: NodeJS.Platform): "left" | "right" {
  return platform === "darwin" ? "left" : "right";
}
