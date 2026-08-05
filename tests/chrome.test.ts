/**
 * The window's chrome and the startup window (MAR-440, MAR-436).
 *
 * Two properties are worth a test here, and neither is about a render.
 *
 * 1. **One colour, three consumers.** `lib/shell/chrome.ts` is read by Electron
 *    main and by the splash; `app/tokens.css` is read by the renderer. They
 *    cannot import each other, so nothing but a test can hold them together —
 *    and a seam between the title bar and the page is precisely what MAR-440
 *    exists to remove.
 * 2. **The splash is a guided-path surface.** It carries product copy in front
 *    of a novice at the worst possible moment, so the plain-language rule
 *    applies to it exactly as it applies to a dialog.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SURFACE_0,
  TITLE_BAR_HEIGHT,
  TITLE_BAR_SYMBOLS,
  resolveTheme,
  titleBarOverlay,
  titleBarStyle,
  windowControlsSide,
} from "../lib/shell/chrome";
import { STARTUP_STEPS, describeStartupFailure, splashCopy } from "../lib/shell/splash";
import { describeRawIdentifiers, rawIdentifiersIn } from "../lib/copy/identifiers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = readFileSync(path.join(repoRoot, "app", "tokens.css"), "utf8");

/**
 * Pull both sides of a `light-dark(a, b)` declaration out of the stylesheet.
 *
 * Reading the CSS rather than importing it, because CSS is not importable from
 * a test and a build step that made it so would be a third thing to keep in
 * sync. The regex is deliberately narrow: it matches the exact shape the token
 * file uses, so reformatting that file into some other shape fails here loudly
 * instead of silently matching nothing and passing.
 */
function lightDarkToken(name: string): { light: string; dark: string } {
  const match = new RegExp(`--${name}:\\s*light-dark\\(([^,]+),\\s*([^)]+)\\)`).exec(tokens);
  if (match === null) {
    throw new Error(`app/tokens.css has no light-dark() declaration for --${name}`);
  }
  return { light: (match[1] as string).trim(), dark: (match[2] as string).trim() };
}

describe("the app surface colour is one value, not three", () => {
  it("matches --surface-0 in app/tokens.css", () => {
    // The load-bearing assertion of MAR-440's "no colour seam". The window's
    // `backgroundColor`, the Windows title bar overlay and the splash all come
    // from `SURFACE_0`; everything below the title bar comes from the token.
    expect(lightDarkToken("surface-0")).toEqual({
      light: SURFACE_0.light,
      dark: SURFACE_0.dark,
    });
  });

  it("matches --text-muted for the caption glyphs", () => {
    // The window controls are drawn by Windows in a colour we hand it. Letting
    // it drift from the muted text beside it is how a title bar ends up with
    // two greys in it.
    expect(lightDarkToken("text-muted")).toEqual({
      light: TITLE_BAR_SYMBOLS.light,
      dark: TITLE_BAR_SYMBOLS.dark,
    });
  });

  it("agrees with the renderer about how tall the bar is", () => {
    // Windows draws its caption buttons at the height the overlay declares, and
    // the renderer lays its bar out at the height the token declares. A
    // disagreement puts the close button over page content or leaves a strip of
    // window that cannot be clicked.
    const declared = /--titlebar-height:\s*(\d+)px/.exec(tokens);
    expect(declared?.[1]).toBe(String(TITLE_BAR_HEIGHT));
    expect(titleBarOverlay("dark").height).toBe(TITLE_BAR_HEIGHT);
  });

  it("gives the overlay a background and a symbol colour, per theme", () => {
    expect(titleBarOverlay("dark")).toEqual({
      color: SURFACE_0.dark,
      symbolColor: TITLE_BAR_SYMBOLS.dark,
      height: TITLE_BAR_HEIGHT,
    });
    expect(titleBarOverlay("light").color).toBe(SURFACE_0.light);
  });
});

describe("resolveTheme", () => {
  it("follows the operating system when the user has not chosen", () => {
    expect(resolveTheme(true, null)).toBe("dark");
    expect(resolveTheme(false, null)).toBe("light");
  });

  it("lets the user's choice win over the operating system", () => {
    // The same rule `app/tokens.css` implements with `[data-theme]`. It exists
    // twice because main must answer it before any CSS is parsed; stating it as
    // a function is what makes "the two answers agree" checkable at all.
    expect(resolveTheme(true, "light")).toBe("light");
    expect(resolveTheme(false, "dark")).toBe("dark");
  });
});

describe("platform chrome", () => {
  it("keeps the traffic lights inset on macOS and hides the caption elsewhere", () => {
    expect(titleBarStyle("darwin")).toBe("hiddenInset");
    expect(titleBarStyle("win32")).toBe("hidden");
    expect(titleBarStyle("linux")).toBe("hidden");
  });

  it("knows which side the window controls sit on", () => {
    // A bar laid out for one platform is unusable on the other, which is why
    // this is a value the layout asks for rather than an assumption it makes.
    expect(windowControlsSide("darwin")).toBe("left");
    expect(windowControlsSide("win32")).toBe("right");
  });
});

describe("the splash says what is happening", () => {
  it("names every step of startup, in order, with no duplicates", () => {
    const ids = STARTUP_STEPS.map((step) => step.id);
    expect(ids).toEqual(["store", "vault", "rules", "screens", "runner", "window"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a failure with a next action for every step", () => {
    // The requirement MAR-436 is actually about: "a spinner that never resolves
    // is the failure mode this issue exists to prevent, not the one it should
    // introduce". A step with no failure copy is a step that can hang.
    for (const step of STARTUP_STEPS) {
      const recovery = describeStartupFailure(step.id);
      expect(recovery.headline.length, step.id).toBeGreaterThan(0);
      expect(recovery.meaning.length, step.id).toBeGreaterThan(0);
      expect(recovery.next_action.length, step.id).toBeGreaterThan(0);
    }
  });

  it("never blames the user for a failed launch", () => {
    // Every one of these is about an install, a file DASH shipped, or a
    // permission DASH needed. Somebody who double-clicked an icon has done
    // nothing, and `actor` is what stops the copy implying otherwise.
    for (const step of STARTUP_STEPS) {
      expect(describeStartupFailure(step.id).actor, step.id).toBe("dash");
    }
  });

  it("puts no raw identifier in front of a novice", () => {
    /*
     * The point of the whole module.
     *
     * `assertContractsLocation` throwing must not put "assertContractsLocation"
     * on screen, and the way that is guaranteed is that the thrown error never
     * reaches this window at all — the copy is written here, and this is what
     * holds it to the same rule every other guided-path surface passes.
     */
    for (const line of splashCopy()) {
      const findings = rawIdentifiersIn(line);
      expect(findings, `${line} — ${describeRawIdentifiers(findings)}`).toEqual([]);
    }
  });
});
