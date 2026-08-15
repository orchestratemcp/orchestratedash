/**
 * Light, dark, or whatever the computer says (MAR-642).
 *
 * ## What was there before
 *
 * `app/tokens.css` has carried a full light palette since MAR-528 — every token
 * declared once as `light-dark(light, dark)`, resolved by one `color-scheme` —
 * and the two `:root[data-theme]` rules that override it have been at the bottom
 * of that file the whole time, written for a control that did not exist. The
 * Preferences page said so out loud:
 *
 * > DASH follows your operating system's light or dark setting. There is no
 * > separate switch in DASH yet.
 *
 * A paragraph apologising for a missing control, above a palette that was ready
 * for it. This module is the control's half.
 *
 * ## Three options, not a switch
 *
 * **System is the default and stays first**, because it is the answer that is
 * right for most people and the one DASH has always given. Light and dark are
 * overrides — a person who works at night on a machine that never leaves light
 * mode, or the reverse — and neither is more correct than the other, which is
 * why this is a radio group rather than a toggle with a bulb on it.
 *
 * The default writes **no attribute at all**, so `color-scheme: light dark` on
 * `:root` goes on following the operating system and there is exactly one
 * selector for it. That is `lib/views/density.ts`' rule and it means "the user
 * has not chosen" and "the user chose system" are one state DASH never has to
 * tell apart.
 *
 * ## Why the preference is not in the store
 *
 * Verbatim the argument `lib/views/density.ts`, `lib/views/fleet-strip.ts` and
 * `lib/views/fleet-view.ts` all make: SQLite is where DASH keeps things it may
 * later have to account for — agents, runs, audit rows, grants. Which palette
 * somebody prefers is not one of those and has no audit consequence.
 *
 * ## The one thing this setting has that the other three do not
 *
 * **A native half.** The Electron window's `backgroundColor`, the Windows title
 * bar overlay and the splash are all chosen in Node from
 * `nativeTheme.shouldUseDarkColors` (`lib/shell/chrome.ts`), before a stylesheet
 * exists. A theme that only reached CSS would give somebody who chose dark on a
 * light machine a white title bar over a navy app — which is the seam MAR-436
 * removed and this would put back.
 *
 * So the choice also crosses to main, through `shell.theme`, where it becomes
 * `nativeTheme.themeSource`. `resolveTheme` in `lib/shell/chrome.ts` has taken a
 * `chosen` argument since it was written and main has passed `null` to it ever
 * since; setting `themeSource` means `shouldUseDarkColors` already answers for
 * the choice, so that `null` stays correct rather than becoming a lie.
 *
 * Pure — no store, no Electron, no DOM. `app/_components/theme-toggle.tsx` is
 * the control and the pre-paint script.
 */

/** System first, because it is the default and the default is a decision. */
export const THEMES = ["system", "light", "dark"] as const;

export type ThemeSetting = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeSetting = "system";

/**
 * Where the preference is kept.
 *
 * The packaged renderer's own scheme is registered `standard` and `secure`
 * (`electron/renderer-host.ts`), so it has a real origin and a real
 * `localStorage`; the developer path is loopback, which has one too. Same code
 * in both hosts, which is MAR-432's rule.
 */
export const THEME_STORAGE_KEY = "dash.theme";

/**
 * The attribute `app/tokens.css` switches on.
 *
 * Already there, at the bottom of that file, since MAR-528. This module did not
 * invent the contract; it supplies the only thing that was missing, which is
 * something that writes it.
 */
export const THEME_ATTRIBUTE = "data-theme";

/**
 * Read a stored value back, refusing anything that is not one of ours.
 *
 * `parseDensity`'s shape and reason: `localStorage` is a string bucket a user
 * can edit, the value ends up in an attribute selector, and a stale or
 * hand-edited entry should fall back to following the computer rather than
 * silently pinning a palette nobody chose.
 */
export function parseTheme(value: unknown): ThemeSetting {
  return THEMES.includes(value as ThemeSetting) ? (value as ThemeSetting) : DEFAULT_THEME;
}

/**
 * The attribute value for a setting, or null when none should be written.
 *
 * Null for `system`, which is the whole of the no-attribute rule in one place:
 * the control, the pre-paint script and any test all ask this rather than each
 * remembering that the default is spelled by absence.
 */
export function themeAttributeValue(setting: ThemeSetting): string | null {
  return setting === "system" ? null : setting;
}

export interface ThemeCopy {
  /** What the option says on screen. One word. */
  label: string;
  /** What the reader gets, for the `title` and the accessible description. */
  description: string;
}

/**
 * What each option says.
 *
 * `describeFleetView`'s wording rule rather than `describeDensity`'s: three
 * options shown side by side with the chosen one marked leave nothing to
 * resolve, so each is named after the thing it *is*. One word each, and the
 * sentence lives on hover.
 *
 * System's description is the only one that has to say something a person could
 * not guess — that it *follows*, so it changes by itself when their computer
 * does. The other two say what they do and, deliberately, do not editorialise
 * about which is easier on the eyes.
 */
export function describeTheme(setting: ThemeSetting): ThemeCopy {
  switch (setting) {
    case "system":
      return {
        label: "System",
        description:
          "Follow this computer's own light or dark setting, and change with it.",
      };
    case "light":
      return { label: "Light", description: "Always light, whatever this computer is set to." };
    case "dark":
      return { label: "Dark", description: "Always dark, whatever this computer is set to." };
  }
}

/**
 * The group's accessible name.
 *
 * A `<fieldset>` needs one, and a radio group needs one more than most: without
 * it a screen reader announces three unlabelled options in a row and the reader
 * has to infer what they are three of.
 */
export const THEME_LEGEND = "How DASH is coloured";

/** Every sentence this module can produce, for the plain-language check. */
export function everyThemeSentence(): string[] {
  return [THEME_LEGEND, ...THEMES.flatMap((one) => [describeTheme(one).label, describeTheme(one).description])];
}
