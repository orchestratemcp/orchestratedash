/**
 * The design system's colour tokens, measured rather than eyeballed.
 *
 * MAR-420's acceptance says "contrast passes at the stated palette", and the
 * five design issues share one palette, so this is the one place it can be
 * checked for all of them.
 *
 * ## Why this test exists in this shape
 *
 * The first `--text-faint` written for this pass was chosen by eye and measured
 * 3.67:1 in light and 4.21:1 in dark — under the floor in both, and *worse in
 * light than in dark*, which is the tell that nothing had been measured. Two
 * hex values that look obviously fine are how every palette acquires the one
 * pair nobody can read, and no amount of care at the keyboard substitutes for
 * the arithmetic.
 *
 * So the arithmetic lives here, and a token that drops under the floor fails
 * `pnpm verify` rather than shipping to somebody with a cheap monitor in a
 * bright room.
 *
 * ## Why the floor is `--surface-2` and not the page background
 *
 * Because that is the worst case. Faint text sits inside a card, which sits on
 * a panel: a value measured against `--surface-0` is measured against the
 * lightest (or darkest) thing it will ever touch, which is the one place it
 * cannot fail. Checking every text token against every surface it can legally
 * be drawn on is only a few more lines and is the difference between a check
 * and a reassurance.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokens = readFileSync(path.join(repoRoot, "app", "tokens.css"), "utf8");

type Theme = "light" | "dark";

/** Both halves of every `--name: light-dark(a, b)` in the stylesheet. */
function palette(): Map<string, Record<Theme, string>> {
  const found = new Map<string, Record<Theme, string>>();
  const pattern = /--([\w-]+):\s*light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tokens)) !== null) {
    found.set(match[1] as string, { light: match[2] as string, dark: match[3] as string });
  }
  return found;
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/** WCAG AA for body text. Every text token clears this on every surface. */
const AA_NORMAL = 4.5;
/** WCAG AA for a non-text boundary — the focus ring and the active bar. */
const AA_NON_TEXT = 3;

const SURFACES = ["surface-0", "surface-1", "surface-2", "surface-3"] as const;
const TEXT_TOKENS = ["text", "text-muted", "text-faint", "accent", "ok", "warn", "err"] as const;

describe("every colour token is declared once, for both themes", () => {
  const colours = palette();

  it("declares every surface and every text colour", () => {
    // A token that stopped being a `light-dark()` — because somebody split it
    // into two rules — would silently drop out of every check below. This is
    // what stops a palette regression from looking like a passing test run.
    for (const name of [...SURFACES, ...TEXT_TOKENS, "focus", "line", "line-strong"]) {
      expect(colours.has(name), `--${name} must be a light-dark() declaration`).toBe(true);
    }
  });
});

describe("contrast", () => {
  const colours = palette();
  const themes: Theme[] = ["light", "dark"];

  /*
   * The load-bearing loop. Every text colour against every surface it can be
   * drawn on, in both themes: 7 × 4 × 2 = 56 pairs, and the failure names the
   * exact one rather than "contrast is bad somewhere".
   */
  for (const theme of themes) {
    for (const token of TEXT_TOKENS) {
      for (const surface of SURFACES) {
        it(`${theme}: --${token} on --${surface} passes AA`, () => {
          const fg = colours.get(token)?.[theme];
          const bg = colours.get(surface)?.[theme];
          expect(fg, token).toBeDefined();
          expect(bg, surface).toBeDefined();
          const ratio = contrast(fg as string, bg as string);
          expect(
            Number(ratio.toFixed(2)),
            `--${token} (${String(fg)}) on --${surface} (${String(bg)}) in ${theme}`,
          ).toBeGreaterThanOrEqual(AA_NORMAL);
        });
      }
    }
  }

  it("the focus ring is visible against every surface", () => {
    // A ring is not text, so 3:1 is the right floor — but it is the one thing a
    // keyboard user has, and `--focus` is deliberately not `--accent` precisely
    // so that it stays visible on the primary button.
    for (const theme of themes) {
      for (const surface of SURFACES) {
        const ratio = contrast(
          colours.get("focus")?.[theme] as string,
          colours.get(surface)?.[theme] as string,
        );
        expect(Number(ratio.toFixed(2)), `--focus on --${surface} in ${theme}`).toBeGreaterThanOrEqual(
          AA_NON_TEXT,
        );
      }
    }
  });

  it("the primary button's own label is readable on its own fill", () => {
    /*
     * This used to hardcode `#ffffff` and measure it at the non-text floor, and
     * MAR-528 broke both halves of that on purpose.
     *
     * Bit-Command's primary button is *solid electric blue with black text*
     * (`DESIGN.md`, "Buttons"), so `--accent-contrast` is a `light-dark()` pair
     * rather than white — white on #4cd6ff measures 1.70:1, and a test asserting
     * white would have failed correctly and been "fixed" by dimming the accent
     * away from the palette.
     *
     * The floor moved from 3:1 to 4.5:1 because a button's label is text. It was
     * the non-text floor for no reason anybody wrote down, and a primary button
     * is the one control every guided path ends at.
     */
    for (const theme of themes) {
      const label = colours.get("accent-contrast")?.[theme];
      expect(label, `--accent-contrast must be a light-dark() declaration`).toBeDefined();
      const ratio = contrast(label as string, colours.get("accent")?.[theme] as string);
      expect(Number(ratio.toFixed(2)), `accent button text in ${theme}`).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    }
  });

  it("no rounded corner survives the sharp shape language", () => {
    /*
     * MAR-528. `DESIGN.md`, "Shapes": *do not use border-radii on any
     * component.* The radius tokens are kept as the place an exception would
     * have to be declared and argued for, so the assertion is on their values
     * rather than on their absence — and `--radius-pill` is gone entirely,
     * because a token whose name says pill and whose value says square is the
     * silent disagreement `app/tokens.css` exists to prevent.
     */
    /*
     * Comments stripped first, which MAR-491 already paid to learn on this
     * repository's other stylesheet scanner: the paragraph in `app/tokens.css`
     * explaining *why* `--radius-pill` was deleted contains the token's name,
     * and a check that reads the raw file fails on its own explanation.
     */
    const declarations = tokens.replace(/\/\*[\s\S]*?\*\//g, "");
    const radii = [...declarations.matchAll(/--radius-([\w-]+):\s*([^;]+);/g)];
    expect(radii.length).toBeGreaterThan(0);
    for (const [, name, value] of radii) {
      expect((value as string).trim(), `--radius-${String(name)}`).toBe("0px");
    }
    expect(declarations).not.toMatch(/--radius-pill/);
  });
});

describe("the density opt-in changes spacing and nothing else", () => {
  /*
   * The calm-default rule, made structural.
   *
   * A compact DASH must be the same layout with less air — never a different
   * layout, a smaller typeface, or (the one that actually matters) fewer facts.
   * The block is small enough to assert wholesale: if somebody adds a font size
   * or a colour to it, this fails and they have to argue for it in review
   * rather than in a stylesheet nobody re-reads.
   */
  const block = /\[data-density="compact"\]\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? "";

  it("has a compact block at all", () => {
    expect(block.trim().length).toBeGreaterThan(0);
  });

  it("declares only --density-* properties", () => {
    const declared = [...block.matchAll(/--([\w-]+)\s*:/g)].map((match) => match[1] as string);
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(name, `--${name} is not a density token`).toMatch(/^density-/);
    }
  });

  it("spends only values from the spacing scale", () => {
    // A compact mode with its own magic numbers is a second spacing system.
    for (const value of [...block.matchAll(/:\s*([^;]+);/g)].map((m) => (m[1] as string).trim())) {
      expect(value, `${value} is not a --space-* step`).toMatch(/^var\(--space-\d\)$/);
    }
  });
});
