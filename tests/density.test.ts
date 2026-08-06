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

/**
 * A file's source with its comments removed.
 *
 * The hydration assertions below are about what a file *renders*, and the thing
 * they guard is heavily commented — necessarily so, since the defect they exist
 * to prevent was a comment that contradicted the running app. Both assertions
 * failed on their first run against prose: `/<html\b[^>]*>/` matched a
 * backticked `<html>` in a comment, and the file that only *describes*
 * `suppressHydrationWarning` was counted as carrying it.
 *
 * Stripping comments first is the whole fix. Nothing in `app/` has a `//` inside
 * a string literal, so the line-comment rule is safe here — and if that ever
 * changed, both assertions would go red rather than quiet, because each names
 * the thing it failed to find.
 */
function renderedSource(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

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

  it("does not make React fight the pre-paint script", () => {
    /*
     * MAR-492. MAR-420 shipped asserting that `suppressHydrationWarning` was
     * unnecessary "because this touches `<html>`'s attribute, not any element
     * React rendered". `app/layout.tsx` renders `<html>`, so React hydrates it,
     * and every load with compact chosen logged a mismatch the comment said
     * could not happen.
     *
     * This is the half of that fix nothing else would catch. The symptom is a
     * console message: no test reads the console, and the smoke does not open a
     * page with a stored preference, so the defect was invisible to every gate
     * this repository has.
     */
    // The premise of the assertion below, scoped to `DensityScript` rather than
    // the whole file — the click handler writes the same attribute, but it runs
    // long after hydration and is not what makes the suppression necessary. If
    // the *pre-paint* script stops writing to `<html>`, the suppression is
    // about the wrong element and somebody should come and re-read why.
    const control = renderedSource(
      path.join(repoRoot, "app", "_components", "density-toggle.tsx"),
    );
    const declaredAt = control.indexOf("export function DensityScript");
    expect(
      declaredAt,
      "app/_components/density-toggle.tsx no longer exports DensityScript",
    ).toBeGreaterThanOrEqual(0);
    expect(
      control.slice(declaredAt),
      "the pre-paint script no longer writes to <html>",
    ).toContain("document.documentElement.setAttribute");

    const layout = renderedSource(path.join(repoRoot, "app", "layout.tsx"));
    const opening = /<html\b[^>]*>/.exec(layout);
    expect(opening, "app/layout.tsx no longer renders <html>").not.toBeNull();
    expect(
      opening?.[0],
      "the density script sets data-density on <html> before React hydrates it",
    ).toContain("suppressHydrationWarning");
  });

  it("suppresses hydration warnings on exactly one element", () => {
    /*
     * The flag turns off a real check, so its blast radius should be one
     * element and one reason. Spreading it is how a genuine mismatch somewhere
     * else — a locale-formatted date, a timestamp, a value read from a store
     * that moved — stops being reported to the only person who could notice.
     */
    const appDir = path.join(repoRoot, "app");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return walk(full);
        }
        return entry.name.endsWith(".tsx") ? [full] : [];
      });
    const files = walk(appDir);
    expect(files.length, "no components found — the scan would pass vacuously").toBeGreaterThan(0);
    const carriers = files
      .filter((file) => renderedSource(file).includes("suppressHydrationWarning"))
      .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"));
    expect(carriers).toEqual(["app/layout.tsx"]);
  });

  it("keeps its preference out of the store", () => {
    // SQLite is for things DASH may have to account for. How airy somebody
    // likes their tables is not one, and putting it there would mean a
    // migration, a read entry and a command for a value whose worst failure is
    // a roomy table for one session.
    expect(DENSITY_STORAGE_KEY).toBe("dash.density");
  });
});
