"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import {
  DEFAULT_THEME,
  THEMES,
  THEME_ATTRIBUTE,
  THEME_LEGEND,
  THEME_STORAGE_KEY,
  describeTheme,
  parseTheme,
  themeAttributeValue,
  type ThemeSetting,
} from "../../lib/views/theme";

/**
 * Light, dark or system, as a control (MAR-642).
 *
 * `FleetViewToggle`'s shape, deliberately: three options, real
 * `<input type="radio">` elements, the glyph decorative and the word the
 * accessible name. A radio group is the one widget where the browser already
 * implements arrow-key movement and a single tab stop, and re-implementing that
 * on buttons is how a control ends up keyboard-reachable in the developer's
 * browser and nowhere else.
 *
 * ## The two halves, and why both are needed
 *
 * 1. **The attribute**, written to `<html>`. `app/tokens.css` has had
 *    `:root[data-theme="light"]` and `:root[data-theme="dark"]` at the bottom
 *    since MAR-528; each sets `color-scheme`, which is what re-resolves every
 *    `light-dark()` token in the file — and also what tells the browser to draw
 *    scrollbars and form controls in the matching theme.
 * 2. **The message to main**, through `shell.theme`. The window's background,
 *    the Windows title bar overlay and the splash are chosen in Node before a
 *    stylesheet exists. Without this half, somebody who chose dark on a light
 *    machine gets a white title bar over a navy app.
 *
 * The second half is fire-and-forget: a refusal — an older shell with no such
 * command, or a browser tab with no bridge at all — changes nothing about the
 * half that worked, which is the whole page they are looking at. It is
 * `DensityToggle`'s argument about storage applied to a second seam.
 *
 * ## The flash, and the script that prevents it
 *
 * The renderer is a static export: this component's first render is a build
 * artefact made on a machine that has never met the user. `ThemeScript` below
 * runs before the body renders, so somebody who chose light does not watch a
 * dark DASH paint and then invert. Same problem, same fix and same accepted
 * duplication as `DensityScript`, `FleetStripScript` and `FleetViewScript`.
 */
export function ThemeToggle(): ReactNode {
  const [theme, setThemeState] = useState<ThemeSetting>(DEFAULT_THEME);

  /*
   * Adopt whatever the pre-paint script already applied rather than re-reading
   * storage — `DensityToggle`'s rule. The document is the source of truth for
   * the current theme precisely because the script got there first, and a second
   * read is a second chance to disagree with the frame the user is looking at.
   */
  useEffect(() => {
    const attribute = document.documentElement.getAttribute(THEME_ATTRIBUTE);
    setThemeState(attribute === null ? "system" : parseTheme(attribute));
  }, []);

  const choose = (next: ThemeSetting): void => {
    const value = themeAttributeValue(next);
    if (value === null) {
      // The default writes no attribute at all, so `color-scheme: light dark`
      // on `:root` goes back to following the computer. Removing rather than
      // writing "system" keeps one selector for one state.
      document.documentElement.removeAttribute(THEME_ATTRIBUTE);
    } else {
      document.documentElement.setAttribute(THEME_ATTRIBUTE, value);
    }
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /*
       * Storage can be unavailable — a locked-down profile, a quota, a user who
       * cleared it mid-session. The theme still changes for this window, which
       * is what was just asked for; it simply will not be there next time.
       * Failing the press over it would take away the half that worked.
       */
    }
    // The native half, called straight on the bridge the way `UiScaleControl`
    // calls its own: this is a look-setting whose command is fire-and-forget,
    // and a wrapper in `app/_data/source.ts` would be a refusal sentence with
    // nowhere to be read. Nothing is awaited and nothing is reported — a shell
    // that cannot do this still has the whole page in the right palette, and a
    // notice about a title bar would be DASH describing its own plumbing at
    // somebody who just pressed a radio button.
    void window.dashShell?.setTheme?.(next);
  };

  return (
    <fieldset className="theme-toggle">
      {/*
        Off the screen rather than gone, on the `.visually-hidden` recipe
        `FleetViewToggle` uses for its own legend and for its reason: a
        `<fieldset>` needs an accessible name, and a sighted reader gets that
        identity from the section heading directly above it.
      */}
      <legend className="visually-hidden">{THEME_LEGEND}</legend>
      <div className="theme-options">
        {THEMES.map((option) => {
          const copy = describeTheme(option);
          return (
            <label className="theme-option" key={option} title={copy.description} data-theme-option={option}>
              <input
                type="radio"
                name="dash-theme"
                value={option}
                checked={theme === option}
                onChange={() => {
                  choose(option);
                }}
              />
              <ThemeGlyph setting={option} />
              <span>{copy.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A picture of what each option does, on the 12×12 grid the sidebar's icons use.
 *
 * A full circle for light, the same circle with its right half filled for dark,
 * and a circle split down the middle for system — which is the one glyph that
 * has to say "both, decided elsewhere". `DensityToggle` makes the argument: a
 * picture of the thing is the only kind of icon that works without a legend.
 */
function ThemeGlyph({ setting }: { setting: ThemeSetting }): ReactNode {
  return (
    <svg
      className="theme-glyph"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1" />
      {/* The right half, filled. Solid for dark, half-strength for system —
          which is the one option that has to picture "either of these, decided
          somewhere else" rather than a palette of its own. */}
      {setting === "light" ? null : (
        <path
          d="M6 1.5 A4.5 4.5 0 0 1 6 10.5 Z"
          fill="currentColor"
          opacity={setting === "system" ? 0.45 : 1}
        />
      )}
    </svg>
  );
}

/**
 * Set the theme before the first paint.
 *
 * Rendered into the document by `app/layout.tsx`. The string is ours end to end
 * — no value from storage is interpolated into it, only compared against a
 * literal — and it writes an attribute rather than markup. `DensityScript`
 * states the rest of the argument, including why
 * `<html suppressHydrationWarning>` in `app/layout.tsx` is what keeps React
 * quiet about an attribute the build-time markup never had.
 *
 * Nothing is written for `system`, which is both the default and the state a
 * fresh document is already in.
 */
export function ThemeScript(): ReactNode {
  const script = [
    "(function(){try{",
    `var v=window.localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});`,
    `if(v==="light"||v==="dark"){document.documentElement.setAttribute(${JSON.stringify(THEME_ATTRIBUTE)},v);}`,
    "}catch(e){}})()",
  ].join("");
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}

/**
 * Tell main which theme this window is in, once, on every launch (MAR-642).
 *
 * Renders nothing. It exists because the two halves of this setting are
 * persisted in different places: the renderer's half is in `localStorage`, which
 * main cannot read, and main's half is `nativeTheme.themeSource`, which Electron
 * does not persist. So the window is created in the operating system's theme and
 * corrected as soon as the renderer paints.
 *
 * The consequence is stated rather than hidden: somebody who chose an override
 * sees the title bar in their computer's theme for the moment before first
 * paint. That is a smaller wrong than the alternatives — a second copy of the
 * setting in the store, which `lib/views/theme.ts` argues against, or a native
 * chrome that stays wrong for the whole session.
 *
 * In `app/layout.tsx` rather than beside the control, because the correction is
 * needed on every route: a person who set dark last week and opens DASH on the
 * Agents page never visits Preferences.
 *
 * ## It says nothing when there is nothing to say, and that is load-bearing
 *
 * No attribute means the person is on System, which is what `themeSource`
 * already is on a fresh process — so the message would be a no-op. It is
 * skipped anyway, and not as an optimisation:
 *
 * **every capture harness in `electron/` moves the theme with
 * `nativeTheme.themeSource`**, deliberately, because that is the same signal
 * the operating system sends and photographing it exercises the real path
 * through `resolveTheme` and `app/tokens.css`. A sync that announced "system"
 * on every mount would overwrite the theme the harness had just forced, and
 * every light-mode screenshot in the matrix would quietly come out in whatever
 * theme the machine was in. Speaking only for a real override leaves that
 * mechanism exactly as it was.
 *
 * Pressing the control still sends `system` — that is a person changing their
 * mind mid-session, and main has to hear it.
 */
export function ThemeSync(): ReactNode {
  useEffect(() => {
    const attribute = document.documentElement.getAttribute(THEME_ATTRIBUTE);
    if (attribute === null) {
      return;
    }
    void window.dashShell?.setTheme?.(parseTheme(attribute));
  }, []);
  return null;
}
