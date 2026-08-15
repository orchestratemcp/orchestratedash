/**
 * Light, dark, or the computer's (MAR-642).
 *
 * `tests/density.test.ts` is the model for this file and most of its arguments
 * transfer unchanged: the default writes no attribute, a stored value that is
 * not one of ours falls back rather than being written through, and the setting
 * switches on one attribute so no component has to be told.
 *
 * What is new — and what most of this file is about — is the half density does
 * not have. **A theme has a native side.** The Electron window's background,
 * the Windows title bar overlay and the splash are chosen in Node, before a
 * stylesheet exists, from `nativeTheme.shouldUseDarkColors`. A theme that only
 * reached CSS would give somebody who chose dark on a light machine a white
 * title bar over a navy app — the seam MAR-436 removed, put back by a feature
 * that looked complete.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import {
  DEFAULT_THEME,
  THEMES,
  THEME_ATTRIBUTE,
  THEME_LEGEND,
  THEME_STORAGE_KEY,
  describeTheme,
  everyThemeSentence,
  parseTheme,
  themeAttributeValue,
} from "../lib/views/theme";
import { ThemeScript, ThemeToggle } from "../app/_components/theme-toggle";
import { COMMANDS } from "../lib/shell/ipc";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * One repository file, with its line endings normalised.
 *
 * Normalised at the read, which is the rule this repository learned the hard
 * way: a checkout on Windows has CRLF, CI's has LF, and an assertion with a
 * bare `\n` in it is green on one and red on the other for a reason that has
 * nothing to do with what it was checking.
 */
function source(...segments: string[]): string {
  return readFileSync(path.join(repoRoot, ...segments), "utf8").replace(/\r\n/g, "\n");
}

describe("the setting itself", () => {
  it("follows the computer by default", () => {
    // The answer DASH has always given, and the one that is right for most
    // people. A feature whose first act is to repaint the app for every
    // existing user has spent its goodwill before anybody has chosen anything.
    expect(DEFAULT_THEME).toBe("system");
    expect(THEMES[0]).toBe("system");
  });

  it("has three options and no fourth", () => {
    expect(THEMES).toEqual(["system", "light", "dark"]);
  });

  it("writes no attribute for the default", () => {
    /*
     * The whole of the no-attribute rule, in one function. `color-scheme: light
     * dark` on `:root` is what follows the operating system; a `data-theme` of
     * "system" would need a third selector saying the same thing, and two
     * spellings of one state is how they come to disagree.
     */
    expect(themeAttributeValue("system")).toBeNull();
    expect(themeAttributeValue("light")).toBe("light");
    expect(themeAttributeValue("dark")).toBe("dark");
  });

  it("falls back to following the computer for anything else", () => {
    for (const value of ["", "System", "DARK", "auto", null, undefined, 1, {}, ["dark"]]) {
      expect(parseTheme(value), JSON.stringify(value)).toBe(DEFAULT_THEME);
    }
  });
});

describe("the stylesheet was already waiting for this", () => {
  it("switches on the attribute `app/tokens.css` has carried since MAR-528", () => {
    // The control did not invent the contract. Both rules were written for a
    // switch that did not exist, which is why this change is a control and a
    // script rather than a palette.
    expect(THEME_ATTRIBUTE).toBe("data-theme");
    const tokens = source("app", "tokens.css");
    expect(tokens).toContain(`:root[${THEME_ATTRIBUTE}="light"]`);
    expect(tokens).toContain(`:root[${THEME_ATTRIBUTE}="dark"]`);
    // And each sets `color-scheme`, which is what re-resolves every
    // `light-dark()` above it — without that the tokens keep the old palette
    // and only the scrollbars change.
    expect(tokens).toContain("color-scheme: light;");
    expect(tokens).toContain("color-scheme: dark;");
  });
});

describe("the flash, and the four pieces that prevent it", () => {
  it("is applied before the first paint, from the layout", () => {
    /*
     * The renderer is a static export: the first render is a build artefact
     * made on a machine that never met this user. Without the script, somebody
     * who chose light watches a dark DASH paint and invert on every
     * navigation — the most visible instance of the flash the other three
     * scripts exist to prevent, because this one is the palette.
     */
    const layout = source("app", "layout.tsx");
    expect(layout).toContain("<ThemeScript />");
    expect(layout).toContain("suppressHydrationWarning");
  });

  it("compares the stored value against its own literals rather than writing it through", () => {
    // The rule every one of these scripts follows: no value from storage is
    // interpolated into the string, only compared against a literal.
    const html = renderToStaticMarkup(<ThemeScript />);
    expect(html).toContain(JSON.stringify(THEME_STORAGE_KEY));
    expect(html).toContain('v==="light"||v==="dark"');
    // And nothing is written for the default, which is the state a fresh
    // document is already in.
    expect(html).not.toContain('"system"');
  });
});

describe("the native half", () => {
  it("has a command, and it is in the family that draws on this machine's screen", () => {
    /*
     * `shell.*` is the only family whose commands may declare `mutates: false`,
     * and its own note says why: they ask main to draw something and reach no
     * agent, no store and no provider. Colouring a title bar is exactly that.
     */
    const spec = COMMANDS["shell.theme"];
    expect(spec.mutates).toBe(false);
    expect(spec.irreversible).toBe(false);
    expect(spec.payload_keys).toEqual(["theme"]);
    // Absent is `system`, in `model.choose`'s shape: the missing field is the
    // instruction to put it back.
    expect(spec.required_keys).toEqual([]);
  });

  it("narrows whatever a renderer sends to one of three literals", () => {
    // Asserted over the dispatcher's source because the alternative is a live
    // `nativeTheme`, which no test process has. What matters is that the value
    // reaching main is one this file wrote.
    const ipc = source("lib", "shell", "ipc.ts");
    expect(ipc).toContain('asked === "light" || asked === "dark" ? asked : "system"');
  });

  it("is told on every launch, not only when somebody presses the control", () => {
    /*
     * The two halves are persisted in different places: the renderer's is in
     * `localStorage`, which main cannot read, and main's is
     * `nativeTheme.themeSource`, which Electron does not persist. So the
     * correction has to happen on every launch and on every route — somebody
     * who set dark last week and opens DASH on the Agents page never visits
     * Preferences.
     */
    expect(source("app", "layout.tsx")).toContain("<ThemeSync />");
  });

  it("stays silent when the person is on System, so a capture run keeps its theme", () => {
    /*
     * Every capture harness in `electron/` moves the theme with
     * `nativeTheme.themeSource`, deliberately — it is the same signal the
     * operating system sends, so what gets photographed is the real path
     * through `resolveTheme`. A sync that announced "system" on every mount
     * would overwrite the theme the harness had just forced, and every
     * light-mode screenshot in the matrix would come out in whatever theme this
     * machine happened to be in. Nothing would fail; the images would just be
     * wrong, which is the worst way for a gate to break.
     */
    const control = source("app", "_components", "theme-toggle.tsx");
    const sync = control.slice(control.indexOf("export function ThemeSync"));
    expect(sync).toContain("if (attribute === null) {\n      return;\n    }");
  });
});

describe("the control", () => {
  it("draws three real radios with the chosen one marked", () => {
    // A radio group is the one widget where the browser already implements
    // arrow-key movement and a single tab stop. Re-implementing that on buttons
    // is how a control ends up keyboard-reachable in the developer's browser
    // and nowhere else.
    const html = renderToStaticMarkup(<ThemeToggle />);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toContain('value="system"');
    expect(html).toContain('value="light"');
    expect(html).toContain('value="dark"');
    // Server-rendered, so nothing has adopted the document yet and the default
    // is what is marked — which is also what a person with no stored choice
    // sees on their first paint.
    expect(html.match(/checked=""/g)).toHaveLength(1);
  });

  it("names the group for a reader who cannot see the row", () => {
    expect(renderToStaticMarkup(<ThemeToggle />)).toContain(THEME_LEGEND);
  });

  it("names each option after the thing it is", () => {
    // `describeFleetView`'s rule rather than `describeDensity`'s: three options
    // side by side with the chosen one marked leave nothing to resolve, so each
    // is named after what it is and the sentence lives on hover.
    expect(describeTheme("system").label).toBe("System");
    expect(describeTheme("light").label).toBe("Light");
    expect(describeTheme("dark").label).toBe("Dark");
    // System's is the only description that has to say something a person could
    // not guess: that it changes by itself.
    expect(describeTheme("system").description).toContain("change with it");
  });

  it("is plain language on every branch", () => {
    expectPlainLanguage(everyThemeSentence());
  });
});

describe("the page that used to apologise", () => {
  it("no longer says there is no switch", () => {
    // The paragraph this issue names by line number. It was true and it was
    // sitting above a palette that had been ready for a control since MAR-528.
    const page = source("app", "settings", "preferences", "page.tsx");
    expect(page).not.toContain("There is no separate switch in DASH yet");
    expect(page).toContain("<ThemeToggle />");
  });
});
