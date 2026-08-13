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
     */
    for (const rule of viewRules) {
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

  it("keeps MAR-590's container-relative floor on the grid", () => {
    /*
     * The sideways-scroll fix MAR-590 shipped: a track minimum that is a plain
     * length does not consult the container, and at 375px a flat 19rem forced a
     * track 24px wider than the space it had. The floor is now the card's own
     * `--fleet-card` width wrapped in `min(..., 100%)`, same job.
     */
    expect(globals).toContain("min(var(--fleet-card), 100%)");
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
