/**
 * The density opt-in (MAR-420).
 *
 * The interesting assertions here are about what density is *not* allowed to
 * do. `tests/tokens.test.ts` already holds the stylesheet to declaring nothing
 * but `--density-*` in the compact block; this holds the module and its copy.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DENSITIES,
  DEFAULT_DENSITY,
  DENSITY_ATTRIBUTE,
  DENSITY_STORAGE_KEY,
  describeDensity,
  nextDensity,
  parseDensity,
} from "../lib/views/density";
import { describeRawIdentifiers, rawIdentifiersIn } from "../lib/copy/identifiers";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("density is calm by default", () => {
  it("defaults to comfortable", () => {
    // MAR-423's rule, and the one thing in this module that is a product
    // decision rather than a mechanism: a novice with three agents does not
    // have a density problem, and the person who does can say so.
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });

  it("has exactly two settings", () => {
    // A toggle, not a slider. Three densities is three layouts to keep
    // consistent and a middle one nobody can describe.
    expect(DENSITIES).toEqual(["comfortable", "compact"]);
  });

  it("toggles between them and back", () => {
    expect(nextDensity("comfortable")).toBe("compact");
    expect(nextDensity(nextDensity("comfortable"))).toBe("comfortable");
  });
});

describe("parseDensity", () => {
  it("accepts the two real values", () => {
    expect(parseDensity("comfortable")).toBe("comfortable");
    expect(parseDensity("compact")).toBe("compact");
  });

  it("falls back to the default for anything else", () => {
    /*
     * `localStorage` is a string bucket the user can edit and the value lands
     * in an attribute selector. The risk is not execution — an attribute value
     * cannot run — it is that a stale or hand-edited entry silently disables
     * every density rule with nothing on screen to explain it.
     */
    for (const value of ["", "cosy", "COMPACT", null, undefined, 3, {}, ["compact"]]) {
      expect(parseDensity(value), JSON.stringify(value)).toBe(DEFAULT_DENSITY);
    }
  });
});

describe("the control's copy", () => {
  it("says what pressing it will do, not what is currently true", () => {
    // A toggle labelled with its current state is the oldest ambiguity in
    // interface design, and the user cannot resolve it by looking.
    expect(describeDensity("comfortable").label).toBe("Fit more on screen");
    expect(describeDensity("compact").label).toBe("Give things more room");
  });

  it("promises that nothing is hidden, in both directions", () => {
    // The honest half. Somebody choosing a denser table deserves to know it is
    // only a table that changed — and somebody choosing a roomier one deserves
    // to know they were not missing anything.
    expect(describeDensity("comfortable").description).toContain("Nothing is hidden");
    expect(describeDensity("compact").description).toContain("Nothing is added");
  });

  it("is plain language", () => {
    for (const density of DENSITIES) {
      const copy = describeDensity(density);
      for (const line of [copy.label, copy.description]) {
        const findings = rawIdentifiersIn(line);
        expect(findings, `${line} — ${describeRawIdentifiers(findings)}`).toEqual([]);
      }
    }
  });
});

describe("density never changes what is on the page", () => {
  /*
   * The load-bearing test of this whole feature.
   *
   * The failure it exists to prevent is a "compact" mode that quietly drops a
   * column — because the person who chose it is the person least likely to be
   * told what they gave up, and DASH's entire argument is that it does not hide
   * things from the person supervising an agent.
   *
   * Asserted as a source property: no component may read the density and branch
   * on it, so there is nowhere for a hidden column to be decided. The one file
   * that legitimately reads it is the control itself, which uses it to label a
   * button.
   */
  it("is read by nothing but the control that sets it", () => {
    const componentsDir = path.join(repoRoot, "app", "_components");
    const readers: string[] = [];
    const components = readdirSync(componentsDir).filter((name) => name.endsWith(".tsx"));
    expect(components.length, "no components found — the scan would pass vacuously").toBeGreaterThan(
      0,
    );
    for (const name of components) {
      if (name === "density-toggle.tsx") {
        continue;
      }
      const source = readFileSync(path.join(componentsDir, name), "utf8");
      if (source.includes("density") || source.includes("Density")) {
        // Importing the control is fine; reading the *value* is not.
        const usesValue = /parseDensity|nextDensity|describeDensity|DENSITY_STORAGE_KEY/.test(
          source,
        );
        if (usesValue) {
          readers.push(name);
        }
      }
    }
    expect(readers, "only density-toggle.tsx may read the density value").toEqual([]);
  });

  it("switches on one attribute, so no page needs to be told", () => {
    // One attribute on `<html>` re-declares four custom properties and restyles
    // everything. That is what makes "no component knows" achievable rather
    // than merely intended.
    expect(DENSITY_ATTRIBUTE).toBe("data-density");
    const tokens = readFileSync(path.join(repoRoot, "app", "tokens.css"), "utf8");
    expect(tokens).toContain(`[${DENSITY_ATTRIBUTE}="compact"]`);
  });

  it("keeps its preference out of the store", () => {
    // SQLite is for things DASH may have to account for. How airy somebody
    // likes their tables is not one, and putting it there would mean a
    // migration, a read entry and a command for a value whose worst failure is
    // a roomy table for one session.
    expect(DENSITY_STORAGE_KEY).toBe("dash.density");
  });
});
