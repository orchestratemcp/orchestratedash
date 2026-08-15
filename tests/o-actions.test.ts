/**
 * The fleet's idle loops, as a contract rather than as a picture (MAR-587
 * Phase B).
 *
 * A screenshot cannot show motion. That is stated plainly in the state packet
 * rather than worked around, and it is why this file exists: everything about
 * the loop that a still frame could not settle — that the duration is a token
 * and therefore zero under reduced motion, that the frame count reaches the
 * stylesheet from the manifest instead of being typed into it twice, that the
 * animation stops when nobody is looking, and that MAR-586's chips were left
 * exactly where they were — is settled here, in CI, on every run.
 *
 * The rules about *pixels* live in `tests/brand-check.test.ts`; these are the
 * rules about the loop the pixels are played at.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { O_ACTIONS, O_ACTION_FRAMES, actionFor, oActionSrc } from "../lib/brand/o-actions";
import { O_NAMES } from "../lib/brand/o-cast";
import { WINDOW_VISIBILITY_ATTRIBUTE } from "../app/_components/window-visibility";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts: string[]): string => readFileSync(path.join(repoRoot, ...parts), "utf8");

const tokens = read("app", "tokens.css");
const globals = read("app", "globals.css");
const fleetPage = read("app", "page.tsx");
/**
 * The card, and the list that lays it out.
 *
 * Both were the body of `app/page.tsx` until MAR-612 split them out so three
 * views could draw one card. The assertions below moved with the markup rather
 * than being relaxed: what they hold is where the portrait sits relative to the
 * chips, and what `action` is allowed to be, and neither became less true for
 * living in its own file.
 */
const fleetCard = read("app", "_components", "fleet-card.tsx");
const fleetList = read("app", "_components", "fleet-list.tsx");
const layout = read("app", "layout.tsx");

/** The stylesheet with its prose removed — a design comment is not a rule. */
const rules = globals.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the loop rides a token, so stillness costs no per-surface code", () => {
  it("declares --motion-idle in both halves of the reduced-motion switch", () => {
    const reduce = /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/.exec(tokens)?.[0] ?? "";
    const moving = /@media not \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/.exec(tokens)?.[0] ?? "";
    expect(reduce).toContain("--motion-idle: 0ms");
    expect(moving).toContain("--motion-idle: 1800ms");
  });

  it("is its own token rather than a second use of --motion-beckon", () => {
    // They carry the same number today and mean opposite things: beckon is the
    // rhythm of "a decision is waiting on you", which exists to be tuned until
    // it reads from across the room. Sharing one would let that tuning re-time
    // every costume in the fleet, or stop the tuning happening because it would.
    expect(tokens).toContain("--motion-beckon: 1800ms");
    expect(rules).toMatch(/\.o-avatar\.is-action\s*\{[^}]*var\(--motion-idle\)/);
    expect(rules).not.toMatch(/\.o-avatar\.is-action\s*\{[^}]*var\(--motion-beckon\)/);
  });

  it("gives the sprite no literal duration anywhere", () => {
    // `checkAvatarCss` fails this for real; asserted here too because it is the
    // single line that decides whether somebody who asked for stillness gets it.
    const action = /\.o-avatar\.is-action\s*\{([^}]*)\}/.exec(rules)?.[1] ?? "";
    expect(action).not.toMatch(/\d+m?s\b/);
  });
});

describe("the frame count reaches the stylesheet from the manifest", () => {
  it("steps and sizes by var(--o-frames) rather than by a number typed twice", () => {
    const action = /\.o-avatar\.is-action\s*\{([^}]*)\}/.exec(rules)?.[1] ?? "";
    expect(action).toContain("steps(var(--o-frames))");
    expect(action).toContain("calc(var(--o-size) * var(--o-frames))");
    const frames = /@keyframes o-action\s*\{[\s\S]*?\n\}/.exec(rules)?.[0] ?? "";
    expect(frames).toContain("background-position: 0 0");
    expect(frames).toContain("calc(var(--o-size) * var(--o-frames) * -1)");
  });

  it("agrees with the audited sheets", () => {
    const manifest = JSON.parse(read("lib", "brand", "o-actions.json")) as {
      frameCount: number;
      sheets: Record<string, { frameCount: number; file: string }>;
    };
    expect(O_ACTION_FRAMES).toBe(manifest.frameCount);
    for (const action of O_ACTIONS) {
      expect(manifest.sheets[action.key]?.frameCount).toBe(O_ACTION_FRAMES);
      // The path the renderer asks for is the path the manifest recorded.
      expect(oActionSrc(action)).toBe(`/${String(manifest.sheets[action.key]?.file)}`);
    }
  });
});

describe("nothing moves while nobody is looking", () => {
  it("pauses every loop under the attribute the layout's listener writes", () => {
    expect(rules).toMatch(
      /:root\[data-window="hidden"\] \.o-avatar\.is-action\s*\{[^}]*animation-play-state:\s*paused/,
    );
    expect(WINDOW_VISIBILITY_ATTRIBUTE).toBe("data-window");
  });

  it("reads visibility once, in the layout, rather than once per sprite", () => {
    // A fleet of twelve agents would otherwise register twelve listeners for one
    // document-wide fact, and the count would grow with somebody's fleet.
    expect(layout).toContain("<WindowVisibility />");
    expect(fleetPage).not.toContain("visibilitychange");
    // The card is where a per-sprite listener would now be written, so it is
    // held to the same rule the page was.
    expect(fleetCard).not.toContain("visibilitychange");
    const component = read("app", "_components", "window-visibility.tsx");
    expect(component).toContain('document.addEventListener("visibilitychange"');
    expect(component).toContain('document.removeEventListener("visibilitychange"');
  });
});

describe("the fleet asks for the loop, and asks for nothing else", () => {
  it("draws the character-select tile at a whole multiple of the source", () => {
    expect(fleetCard).toContain("<OAvatar name={agent.avatar} size={100} action />");
  });

  it("decides to animate in the source, never from the agent", () => {
    // `checkCostume` fails an expression here for real. This is the same claim
    // read from the other end: whatever else this file learns about an agent,
    // none of it reaches the avatar.
    const usages = [...fleetCard.matchAll(/<OAvatar[^>]*>/g)].map((match) => match[0]);
    expect(usages.length).toBeGreaterThan(0);
    for (const usage of usages) {
      expect(usage).not.toMatch(/action=\{(?!true\}|false\})/);
    }
  });

  it("leaves MAR-586's chips off the costume", () => {
    // The chips carried every fact on the card. They left with the prose so
    // two rows of three portraits can fill the pane; the chief quotes the
    // most pressing one rather than drawing the row again.
    expect(fleetCard).not.toContain("<GlanceChips");
    /*
     * MAR-639 tints the portrait's class by status, so the attribute is now a
     * `tone === null ? "fleet-portrait" : …` expression rather than one
     * literal string — the class name itself still has to appear in it
     * either way.
     */
    const portrait = fleetCard.indexOf('"fleet-portrait"');
    expect(portrait).toBeGreaterThan(-1);
    expect(rules).not.toMatch(/\.glance[^{}]*\{[^}]*--o-/);
  });

  it("keeps the portrait above the chips in every view MAR-612 added", () => {
    /*
     * The card is one portrait. What could still undo MAR-586 is a *view*
     * reordering glance against the costume, so this is the same claim read
     * from the stylesheet: nothing anywhere assigns `order` to the chips.
     */
    expect(rules).not.toMatch(/\[data-fleet-view[^{}]*\.glance[^{}]*\{[^}]*order:/);
  });

  it("orders the fleet by nothing this issue touched", () => {
    // "Three of eleven characters animate" must never become "the animated ones
    // come first", which would make DASH's asset library look like a ranking.
    for (const source of [fleetPage, fleetCard, fleetList]) {
      expect(source).not.toContain("actionFor");
      expect(source).not.toContain("O_ACTIONS");
      expect(source).not.toMatch(/\.sort\(/);
    }
  });
});

describe("every character in the cast has its own vendored action (MAR-615)", () => {
  it("answers an action, and its own action, for all twelve", () => {
    // Three of eleven at MAR-587, then the rest at MAR-615 — the library
    // caught up to the cast rather than the cast catching up to the library.
    const animated = O_NAMES.filter((name) => actionFor(name) !== null);
    expect(animated).toEqual([...O_NAMES]);
    for (const name of animated) {
      expect(actionFor(name)?.character).toBe(name);
    }
  });

  it("still answers null for a character this build does not ship", () => {
    // A character with no sheet is a character with no sheet, and that path
    // has no real case left to exercise it — every name in `O_NAMES` has one
    // now — but `OAvatar` still calls this on whatever a damaged store row or
    // a future downgrade could hand it, so the fallback stays covered
    // structurally rather than by a live gap in the cast.
    expect(actionFor("pirate" as unknown as (typeof O_NAMES)[number])).toBeNull();
  });
});
