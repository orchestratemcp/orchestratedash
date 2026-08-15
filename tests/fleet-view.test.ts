/**
 * The fleet's three layouts (MAR-612).
 *
 * The interesting assertions here are the same shape as `tests/density.test.ts`':
 * about what a view is *not* allowed to do. `lib/views/fleet-view.ts` states the
 * rule — a view may change the track the cards are laid on and **nothing a card
 * says** — and the stylesheet assertions at the bottom are what stop that from
 * being a sentence in a comment. A view that hid a chip to fit would be the
 * "second interface" `lib/views/density.ts` refuses, and the person who chose it
 * is the person least likely to be told what they gave up.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_FLEET_VIEW,
  FLEET_VIEWS,
  FLEET_VIEW_ATTRIBUTE,
  FLEET_VIEW_LEGEND,
  FLEET_VIEW_STORAGE_KEY,
  describeFleetView,
  parseFleetView,
  stepSpotlight,
  type FleetView,
} from "../lib/views/fleet-view";
import { DENSITY_ATTRIBUTE, DENSITY_STORAGE_KEY } from "../lib/views/density";
import { FLEET_STRIP_ATTRIBUTE, FLEET_STRIP_STORAGE_KEY } from "../lib/views/fleet-strip";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const globals = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");
const toggleSource = readFileSync(
  path.join(repoRoot, "app", "_components", "fleet-view-toggle.tsx"),
  "utf8",
);
const layoutSource = readFileSync(path.join(repoRoot, "app", "layout.tsx"), "utf8");

describe("the setting", () => {
  it("has exactly the three views Henrik asked for", () => {
    // Three, in the order he numbered them. The order is the order the control
    // draws, so an addition here is a visible change to a row of controls rather
    // than a quiet one.
    expect(FLEET_VIEWS).toEqual(["grid", "rows", "spotlight"]);
  });

  it("defaults to the grid that already shipped", () => {
    /*
     * MAR-590's layout, unchanged for anybody who never touches this. A settings
     * feature whose first act is to rearrange the page for every existing user
     * has spent its goodwill before anybody has chosen anything.
     */
    expect(DEFAULT_FLEET_VIEW).toBe("grid");
  });

  it("refuses a stored value that is not one of ours", () => {
    // `localStorage` is a string bucket a user can edit and the value ends up in
    // an attribute selector. A stale or hand-edited entry falls back rather than
    // silently disabling every rule that depends on it.
    expect(parseFleetView("carousel")).toBe("grid");
    expect(parseFleetView("")).toBe("grid");
    expect(parseFleetView(null)).toBe("grid");
    expect(parseFleetView(undefined)).toBe("grid");
    expect(parseFleetView(3)).toBe("grid");
    expect(parseFleetView({ view: "rows" })).toBe("grid");
  });

  it("reads back every value it can write", () => {
    for (const view of FLEET_VIEWS) {
      expect(parseFleetView(view)).toBe(view);
    }
  });

  it("does not collide with the two settings already in storage", () => {
    /*
     * Three preferences now live in the same bucket and on the same element.
     * A key or an attribute shared with density or the bottom strip would mean
     * one setting quietly overwriting another, which is invisible until somebody
     * changes one and loses the other.
     */
    const keys = [DENSITY_STORAGE_KEY, FLEET_STRIP_STORAGE_KEY, FLEET_VIEW_STORAGE_KEY];
    expect(new Set(keys).size).toBe(keys.length);

    const attributes = [DENSITY_ATTRIBUTE, FLEET_STRIP_ATTRIBUTE, FLEET_VIEW_ATTRIBUTE];
    expect(new Set(attributes).size).toBe(attributes.length);
  });
});

describe("what the control says", () => {
  it("gives every view a one-word label and a sentence", () => {
    for (const view of FLEET_VIEWS) {
      const copy = describeFleetView(view);
      // One word. Henrik's standing complaint is text that reads like
      // documentation, and three competing sentences in a row of controls is the
      // shape that produces it.
      expect(copy.label.trim().split(/\s+/)).toHaveLength(1);
      // The sentence is the hover, and it is a sentence rather than a fragment.
      expect(copy.description.endsWith(".")).toBe(true);
      expect(copy.description.length).toBeGreaterThan(20);
    }
  });

  it("gives the three options distinct labels", () => {
    const labels = FLEET_VIEWS.map((view) => describeFleetView(view).label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("names the group, because one-word options name nothing on their own", () => {
    expect(FLEET_VIEW_LEGEND.length).toBeGreaterThan(0);
    expect(FLEET_VIEW_LEGEND).toMatch(/agents/i);
  });

  it("never says carousel", () => {
    /*
     * Henrik's own word for the third view, and deliberately not the user's.
     * `docs/design-brief.md`'s register is what a person who has never built a
     * web page would say — and "carousel" is a word somebody learns from
     * interfaces rather than from the world. The description says what is on
     * screen instead.
     */
    const copy = FLEET_VIEWS.map((view) => describeFleetView(view));
    const words = [FLEET_VIEW_LEGEND, ...copy.map((one) => `${one.label} ${one.description}`)];
    for (const sentence of words) {
      expect(sentence.toLowerCase()).not.toContain("carousel");
    }
  });
});

describe("stepping the spotlight", () => {
  it("moves one card at a time in both directions", () => {
    expect(stepSpotlight(1, 4, 1)).toBe(2);
    expect(stepSpotlight(1, 4, -1)).toBe(0);
  });

  it("wraps at both ends", () => {
    /*
     * A carousel of three whose "next" greys out on the third spends two thirds
     * of its life looking broken, and there is no meaningful past-the-end here:
     * the fleet is a ring of the same agents however many times you go round it.
     */
    expect(stepSpotlight(3, 4, 1)).toBe(0);
    expect(stepSpotlight(0, 4, -1)).toBe(3);
  });

  it("is a no-op on a fleet of one", () => {
    expect(stepSpotlight(0, 1, 1)).toBe(0);
    expect(stepSpotlight(0, 1, -1)).toBe(0);
  });

  it("lands somewhere real when the fleet has shrunk underneath it", () => {
    /*
     * The agents list is re-read on window focus, so an agent removed while this
     * view was open leaves a centre index pointing past the end. Answering 0 is
     * what stops the arrows from doing nothing for the rest of the session.
     */
    expect(stepSpotlight(9, 3, 1)).toBe(0);
    expect(stepSpotlight(-1, 3, 1)).toBe(0);
    expect(stepSpotlight(1.5, 3, 1)).toBe(0);
    expect(stepSpotlight(0, 0, 1)).toBe(0);
  });
});

describe("the stylesheet", () => {
  /** Every rule whose selector mentions the fleet-view attribute. */
  const viewRules = [...globals.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((rule) => ({ selector: rule[1].trim(), body: rule[2] }))
    .filter((rule) => rule.selector.includes(FLEET_VIEW_ATTRIBUTE));

  it("has rules for the two views that are departures from the default", () => {
    /*
     * Grid carries no attribute — the pre-paint script writes nothing for the
     * default, so `.row-list.fleet-grid` *is* the grid. The other two have to be
     * declared or the setting is a control that changes a string on `<html>` and
     * nothing else.
     */
    for (const view of ["rows", "spotlight"] satisfies FleetView[]) {
      const declared = viewRules.some((rule) => rule.selector.includes(`="${view}"`));
      expect(declared, `no rule for the ${view} view`).toBe(true);
    }
  });

  it("never hides a card's content in a view", () => {
    /*
     * `lib/views/fleet-view.ts`'s rule, enforced rather than asserted — the same
     * move `tests/tokens.test.ts` makes for density's spacing-only rule.
     *
     * A view may lay cards on a different track. It may not answer "this does not
     * fit" with `display: none` on something inside a card, because then the same
     * fleet says different things depending on a setting, and the reader has no
     * way to know which facts their layout costs them.
     *
     * The card's own container is exempt: `[data-fleet-view="rows"] .fleet-card`
     * changes the card's *axis*, which is the track question again.
     *
     * MAR-639's `::-webkit-scrollbar` rule is exempt for the same reason: it
     * hides the spotlight track's own scroll chrome, not a fact about any
     * agent, and `scrollbar-width: none` right beside it in the stylesheet
     * hides the identical thing through a property that has no `display` to
     * catch here at all — a browser-prefix duplicate of a rule this test
     * already allows, not a second kind of hiding.
     */
    for (const rule of viewRules) {
      if (rule.selector.endsWith("::-webkit-scrollbar")) {
        continue;
      }
      if (!/display:\s*none/.test(rule.body)) {
        continue;
      }
      expect(
        rule.selector,
        `${rule.selector} hides something inside a card — a view changes the track, never what a card says`,
      ).toBe("this selector should not exist");
    }
  });

  it("spends motion tokens rather than literal durations", () => {
    /*
     * `app/tokens.css` zeroes every `--motion-*` under
     * `prefers-reduced-motion: reduce`, so stillness needs no per-surface code.
     * A literal here would be a card that keeps travelling for somebody who asked
     * the operating system for it to stop — the rule `scripts/brand-rules.mjs`
     * already enforces on avatar rules, applied to the view that moves.
     */
    for (const rule of viewRules) {
      for (const declaration of rule.body.matchAll(/\b(animation|transition)\s*:([^;]*)/g)) {
        const literals = [...declaration[2].matchAll(/(?<![\w-])\d+(?:\.\d+)?(ms|s)\b/g)];
        expect(
          literals.map((one) => one[0]),
          `${rule.selector} gives a literal ${declaration[1]} duration`,
        ).toEqual([]);
      }
    }
  });

  it("bounds the card at desktop and leaves it free at the narrow widths (MAR-634)", () => {
    /*
     * MAR-630 recorded the tension and MAR-634 resolved it: the 375px repair
     * lets a card keep min-content height, and six cards cannot fit in two
     * thirds of a 1280 window at that height. Both hold only if the bound is
     * width-conditional, so the assertions are (a) there is a bound, (b) it is
     * inside a `min-width` query, and (c) the base rule still says `auto`.
     *
     * The last one is the half that would rot silently. Somebody tidying the
     * bound "up" out of its media query would repair nothing visible at 1280
     * and would put 375px back to the mark-and-hat slivers MAR-630 shipped
     * once already.
     */
    const desktop = /@media \(min-width: 901px\)\s*\{([\s\S]*?)\n\}/.exec(globals);
    expect(desktop, "MAR-634's bound must live in a min-width query").not.toBeNull();
    const block = desktop?.[1] ?? "";

    /*
     * Every bound in the block is floored at `min-content` and capped by a
     * length, and both halves are pinned because both were learned the hard
     * way.
     *
     * The floor is what makes a bound safe to state at all: a track that can
     * never be shorter than the card cannot clip a wrapped name or push the
     * Open button off the bottom edge, at any text size.
     *
     * The cap is a **length**, and the first version of this rule proved why
     * it has to be. It asked for half the pane —
     * `calc((100% - var(--fleet-gap)) / 2)` — and the capture harness reported
     * what the browser actually resolved: `33.3333% - 12px` came back as 63.5px
     * against a 471px pane, because a percentage row on a container whose own
     * height is `100%` of a scroll container resolves against the row's content
     * rather than the container. The grid read as correct by luck; the rows
     * view drew six 64px rows with the sprites hanging out of them. So a
     * percentage anywhere in these tracks is the defect, not the design.
     */
    const tracks = [...block.matchAll(/grid-auto-rows:\s*([^;]+);/g)].map((m) => m[1] ?? "");
    expect(tracks.length, "the desktop block must bound the card").toBeGreaterThan(0);
    for (const track of tracks) {
      expect(
        track.startsWith("minmax(min-content,"),
        `grid-auto-rows: ${track} is not floored at the card's own height`,
      ).toBe(true);
      expect(
        track.includes("%"),
        `grid-auto-rows: ${track} resolves a percentage against the wrong box`,
      ).toBe(false);
    }

    /*
     * MAR-639 removes the rows card's `display: grid` override. It existed to
     * move the Open button beside the band rather than under it — three 145px
     * bands is the only way Rows' three-agents-on-one-screen arithmetic
     * closes, and the button's position was the whole difference. The button
     * is gone, replaced by the whole-card link, so the card is back to the
     * base rule's `flex-direction: column`, which stacks the same two
     * children the same way on one fewer rule.
     */
    expect(block, "the rows card's now-dead grid override must not come back").not.toMatch(
      /\[data-fleet-view="rows"\] \.fleet-card \{[^}]*grid-template-columns/,
    );

    /*
     * Spotlight's count is three across, and three columns want to grow with
     * the viewport now (MAR-639) rather than sit at a fixed 13rem — see that
     * rule's own comment for why a fixed pixel track shrinks at a lower OS
     * UI scale while the pane around it does not.
     */
    expect(block).toMatch(/--fleet-spot:\s*clamp\(14rem, 26vw, 22rem\)/);

    // The narrow widths keep MAR-630's repair, untouched by any of the above.
    expect(globals).toContain("grid-auto-rows: auto");
  });

  it("keeps MAR-590's container-relative floor on the grid", () => {
    /*
     * The sideways-scroll fix MAR-590 shipped: a track minimum that is a plain
     * length does not consult the container, and at 375px a flat 19rem forced a
     * track 24px wider than the space it had. MAR-639 replaces the fixed
     * `--fleet-card` track with a 12.5rem–15rem range so `auto-fill` can grow
     * a fourth (and fifth) column, but the floor still has to give way to the
     * container below it, same job as `min(var(--fleet-card), 100%)` did.
     */
    expect(globals).toContain("min(12.5rem, 100%)");
  });

  it("puts Add agent and the layout control in a right rail, not above the cards", () => {
    /*
     * The agents page is the left sidebar, the cards, and a right column of
     * actions — the same three-column window the rest of DASH already is, with
     * the fleet's own controls in the unused right edge. A rule that hid the
     * rail with `display: none` at the 900px collapse would remove both
     * controls at the width they are hardest to reach any other way.
     */
    expect(globals).toMatch(/\.fleet-rail\s*\{/);
    expect(globals).toContain("grid-template-columns: minmax(0, 1fr) var(--sidebar-width)");
    const collapse = /\.fleet-rail\s*\{[^}]*order:\s*-1/.exec(globals);
    expect(collapse, "the narrow rail must stay on screen as a strip").not.toBeNull();
    expect(collapse?.[0]).not.toContain("display: none");
  });
});

describe("the pre-paint script", () => {
  it("is rendered by the layout, beside the two that already were", () => {
    // Without it, somebody who chose Spotlight watches a grid assemble and
    // re-lay itself on every navigation — the packaged renderer is a static
    // export whose first render was built on a machine that never met them.
    expect(layoutSource).toContain("<FleetViewScript />");
  });

  it("compares the stored value against literals and never writes it through", () => {
    /*
     * `DensityScript`'s safety property, restated because this script is the
     * first of the three with more than one value to recognise. The string is
     * ours end to end: the stored value reaches `setAttribute` only after
     * matching one of our own literals, so a hand-edited entry cannot put an
     * arbitrary string into an attribute selector.
     */
    const script = /const script = \[([\s\S]*?)\]\.join\(""\);/.exec(toggleSource);
    expect(script).not.toBeNull();
    const body = script?.[1] ?? "";
    expect(body).toContain('v==="rows"||v==="spotlight"');
    // The default writes nothing, which is why grid is absent from the test.
    expect(body).not.toContain('"grid"');
  });
});
