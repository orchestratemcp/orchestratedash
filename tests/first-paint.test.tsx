/**
 * "The first page never left its loading state", made checkable.
 *
 * Three things have to hold for `pnpm shell:check` and smoke proof `1f` to mean
 * anything, and they fail in different places, so they are asserted separately:
 *
 * 1. the rule reads an observation correctly (`lib/shell/first-paint.ts`);
 * 2. the **product** actually emits the attribute the rule looks for — if
 *    `ViewLoading` stopped stamping it, both checks would go permanently and
 *    silently green, which is the worst failure a check can have;
 * 3. every page that reads a view uses that component rather than a loading
 *    placeholder of its own, because "the first page" is whichever page the
 *    window happens to open on.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewFailed, ViewLoading } from "../app/_components/view-state";
import {
  FIRST_PAINT_PROBE,
  VIEW_STATE_ATTRIBUTE,
  judgeFirstPaint,
  readFirstPaint,
} from "../lib/shell/first-paint";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const settled = { url: "dash-app://ui/", loading: 0, failed: 0, headings: 3 };

describe("reading one observation", () => {
  it("calls a page with no loading placeholder ready", () => {
    expect(readFirstPaint(settled)).toBe("ready");
  });

  it("calls a page still showing a placeholder stuck, however much else is on screen", () => {
    // The frozen shell had every heading the server delivered. Content is not
    // the signal; the placeholder is.
    expect(readFirstPaint({ ...settled, loading: 1, headings: 12 })).toBe("stuck");
  });

  it("keeps a rendered failure apart from both", () => {
    expect(readFirstPaint({ ...settled, failed: 1 })).toBe("failed");
  });

  it("prefers stuck over failed while a refresh is still in flight", () => {
    // A page can show the previous read's recovery while the next read runs.
    // Calling that settled would let the check pass on a moving window.
    expect(readFirstPaint({ ...settled, loading: 1, failed: 1 })).toBe("stuck");
  });
});

describe("the verdict", () => {
  it("passes a page that left the loading state", () => {
    expect(judgeFirstPaint(settled, 400).ok).toBe(true);
  });

  it("fails a stuck page and says the renderer's JavaScript did not run", () => {
    const verdict = judgeFirstPaint({ ...settled, loading: 1 }, 20_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.outcome).toBe("stuck");
    expect(verdict.detail).toContain("did not run");
  });

  /**
   * MAR-473's requirement, in the smallest possible form: a window that never
   * loaded and a window that loaded and froze must not produce the same line.
   */
  it("distinguishes a window that never loaded from one that froze", () => {
    expect(judgeFirstPaint(null, 60_000).outcome).toBe("never_loaded");
    expect(judgeFirstPaint(null, 60_000).detail).not.toBe(
      judgeFirstPaint({ ...settled, loading: 1 }, 60_000).detail,
    );
  });

  it("fails a rendered failure without pretending to explain it", () => {
    const verdict = judgeFirstPaint({ ...settled, failed: 1 }, 900);
    expect(verdict.ok).toBe(false);
    expect(verdict.outcome).toBe("failed");
  });
});

/**
 * The link between the rule and the product.
 *
 * Without this, `lib/shell/first-paint.ts` could be perfect and both checks
 * could be testing an attribute nothing renders.
 */
describe("the product carries the marker", () => {
  it("stamps the loading state", () => {
    const markup = renderToStaticMarkup(ViewLoading({ what: "your agents" }));
    expect(markup).toContain(`${VIEW_STATE_ATTRIBUTE}="loading"`);
  });

  it("stamps the failure state distinctly", () => {
    const markup = renderToStaticMarkup(
      ViewFailed({
        recovery: {
          headline: "DASH could not read its own records.",
          meaning: "The list on this page is not what is stored.",
          next_action: "Restart DASH.",
          actor: "dash",
        },
      }),
    );
    expect(markup).toContain(`${VIEW_STATE_ATTRIBUTE}="failed"`);
  });

  it("is the same attribute the probe selects on", () => {
    expect(FIRST_PAINT_PROBE).toContain(`[${VIEW_STATE_ATTRIBUTE}="loading"]`);
    expect(FIRST_PAINT_PROBE).toContain(`[${VIEW_STATE_ATTRIBUTE}="failed"]`);
  });
});

/**
 * "The first page" is whichever page the window opens on, and a page that rolled
 * its own placeholder would be invisible to the check while looking identical on
 * screen. So the requirement is structural: read a view, use the component.
 *
 * ## The two exceptions, named rather than implied
 *
 * `lib/copy/identifiers.ts` makes the argument that a rule with invisible
 * exceptions is not a rule, so both are listed here with the reason they are
 * not pages of the app window at all. Main opens each in a window of its own,
 * neither is ever what `electron .` loads, and neither is reachable by
 * navigating from the first page.
 *
 * `approval-popup` additionally renders `null` while loading **on purpose** —
 * main hides that window whenever nothing is pending, so a placeholder there
 * would be a frameless box appearing for a moment and saying nothing. Its own
 * comment makes that argument, and adding a marked loading state to satisfy this
 * test would change the product to suit the check.
 */
describe("every page that reads a view uses the marked loading state", () => {
  /** Windows main opens itself. Never the app window's first page. */
  const OTHER_WINDOWS = ["app/approval-popup/page.tsx", "app/credential-prompt/page.tsx"];

  /**
   * Chrome that reads a view and is silent until it has something to draw
   * (MAR-503).
   *
   * A different exemption from `OTHER_WINDOWS` above, and it is listed
   * separately rather than folded in because the reason is different and a
   * shared list would let one reason cover a file the other was written for.
   *
   * The rule this test enforces is about the *page*: whatever the window opens
   * on must say it is loading rather than showing a blank frame. The fleet
   * strip is not what the window opens on — it renders beside every page, under
   * the one that is already saying so. A placeholder there would be a second
   * loading state on the same frame, and one that appears and vanishes along
   * the bottom edge of a page that is itself busy loading. It renders nothing,
   * its band collapses, and the page above it does the announcing.
   *
   * Same shape of argument as `approval-popup`'s: rendering null is the
   * product decision, and satisfying this check with a placeholder would change
   * the product to suit the check.
   */
  const SILENT_CHROME = ["app/_components/fleet-strip.tsx"];

  const EXEMPT = [...OTHER_WINDOWS, ...SILENT_CHROME];

  function pages(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "api") {
          continue;
        }
        found.push(...pages(full));
      } else if (entry.endsWith(".tsx")) {
        found.push(full);
      }
    }
    return found;
  }

  it("holds for all of them", () => {
    const offenders: string[] = [];
    for (const file of pages(path.join(repoRoot, "app"))) {
      const relative = path.relative(repoRoot, file).split(path.sep).join("/");
      if (EXEMPT.includes(relative)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      const reads = /\buse(?:Live)?View\s*\(/.test(source);
      if (reads && !source.includes("ViewLoading")) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The exemption list has to stay honest too. A file that stops existing, or
   * is renamed, would otherwise leave a permanent hole nobody notices.
   */
  it("exempts only files that exist", () => {
    for (const relative of EXEMPT) {
      expect(() => statSync(path.join(repoRoot, relative))).not.toThrow();
    }
  });
});
