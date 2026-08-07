/**
 * What a record card shows before you ask it for more (MAR-491).
 *
 * The issue is a measurement — a nine-column table 1425px wide inside a 341px
 * scroller — and the fix that landed for it turned the table into cards without
 * cutting anything, so the nine columns became nine stacked rows and the
 * sideways scroll became a downward one. What is asserted here is the cut: what
 * stays on the face of a card, what goes behind the disclosure, and the two
 * structural promises that make hiding it honest.
 *
 * The two promises are the ones a screenshot cannot check and a future refactor
 * could quietly break:
 *
 * 1. **The disclosure is not a breakpoint.** No `@media` rule may mention it.
 *    A card that hid facts only when narrow would be two interfaces, and the
 *    one a person learns on a laptop is not the one they get when they make the
 *    window small.
 * 2. **Density is not what hides them.** MAR-491 names this trap in its own
 *    words: `data-density="compact"` may not hide anything, so whatever hides
 *    facts has to be a control the user can see and press.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TechnicalDetails } from "../app/_components/record-card";
import { describeRunCount } from "../app/page";
import { describeRunStart } from "../app/runs/page";
import { RECORD_CARD_COPY } from "../lib/copy/record-card";
import { expectPlainLanguage } from "./helpers/plain-language";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The stylesheet with its comments removed, which is what the rules below scan.
 *
 * Not fussiness. `app/globals.css` is a heavily commented file, and this repo's
 * comments quote the selectors and declarations they are about — a paragraph
 * explaining why `[data-fleet-strip="hidden"]` uses `display: none` mentions
 * `[data-density]` two lines earlier, and a scan over the raw text reads the
 * prose between them as a rule body and fails. It did: the check below went red
 * on a comment the first time these two branches were put together.
 *
 * `scripts/brand-rules.mjs` strips comments before every one of its scans for
 * exactly this reason. Same one-liner, same reason.
 */
const globals = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

describe("the disclosure", () => {
  it("renders a native details, closed, with the label as its summary", () => {
    const markup = renderToStaticMarkup(
      <TechnicalDetails>
        <p>hidden until asked for</p>
      </TechnicalDetails>,
    );
    expect(markup).toContain("<details");
    expect(markup).toContain(`<summary title="${RECORD_CARD_COPY.description}">`);
    expect(markup).toContain(RECORD_CARD_COPY.summary);
    // Closed by default — the calm default is the design, and an `open`
    // attribute here would make every card start as the thing this replaces.
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("hidden until asked for");
  });

  it("names what is inside rather than describing the control", () => {
    /*
     * "More" and "Show all" describe the button. Somebody who does not want
     * technical details can only decide not to open this if the label says that
     * is what is in it — which is the whole of what makes hiding them honest.
     */
    expect(RECORD_CARD_COPY.summary.toLowerCase()).toContain("details");
    for (const vague of ["more", "show all", "expand", "advanced"]) {
      expect(RECORD_CARD_COPY.summary.toLowerCase()).not.toBe(vague);
    }
    expectPlainLanguage([RECORD_CARD_COPY.summary, RECORD_CARD_COPY.description]);
  });

  it("is the same control at every width", () => {
    /*
     * The structural half of the decision. A `.card-more` rule inside an
     * `@media` block would mean the card hides facts only when narrow, and a
     * person who learned the interface on a laptop would meet a different one
     * on a resize. Scanning the stylesheet is the only way to assert it.
     */
    const media = globals.split(/@media/).slice(1);
    const offenders = media
      .map((block) => block.slice(0, block.indexOf("\n}\n") + 3))
      .filter((block) => /\.card-more\b|\.card-meta\b/.test(block));
    expect(offenders).toEqual([]);
  });

  it("is never what the density opt-in does", () => {
    /*
     * MAR-491's own warning, pinned. `tests/tokens.test.ts` holds
     * `[data-density="compact"]` to declaring nothing but `--density-*`
     * properties; this holds the other end, so a rule that hid a card's facts
     * from a density attribute would fail here even if it lived in
     * `globals.css` rather than in the token block.
     */
    const densityRules = [...globals.matchAll(/\[data-density[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
    for (const body of densityRules) {
      expect(body).not.toMatch(/display\s*:\s*none/);
      expect(body).not.toMatch(/visibility\s*:\s*hidden/);
    }
  });
});

describe("what stays on the face of a card", () => {
  it("says how often an agent has worked, as a sentence", () => {
    // `0` under a `Runs` label is a fact a person has to assemble. "1 runs" is
    // the smallest possible way for a surface to look unfinished.
    expect(describeRunCount(0)).toBe("Not run yet");
    expect(describeRunCount(1)).toBe("Run once");
    expect(describeRunCount(34)).toBe("Run 34 times");
    // A count DASH could not read is not a run that happened.
    expect(describeRunCount(-1)).toBe("Not run yet");
  });

  it("says when a run started, without the instant it is stored as", () => {
    const readable = describeRunStart("2026-08-06T20:09:04.029Z");
    expect(readable).not.toBe("2026-08-06T20:09:04.029Z");
    expect(readable).not.toContain("T");
    expect(readable).not.toContain("Z");
    expect(readable.length).toBeGreaterThan(0);
  });

  it("hands back a timestamp it cannot read, unchanged", () => {
    /*
     * A run whose `started_at` is malformed is a real thing DASH stores, and
     * "Unknown" would hide the one clue about what went wrong. The card is
     * scannable for the ninety-nine runs whose timestamps parse; the hundredth
     * shows what it actually has.
     */
    expect(describeRunStart("not a time")).toBe("not a time");
    expect(describeRunStart("")).toBe("");
  });

  it("keeps the run's own identifier reachable rather than removing it", () => {
    /*
     * The heading stopped being a UUID because nobody scans a list by one. It
     * did not stop existing: it is how somebody reports a problem, and a card
     * that dropped it would have traded one failure for a worse one. This is
     * asserted against the page's source because the id's *place* is the
     * decision — inside the disclosure, under a label, as a value.
     */
    const runs = readFileSync(path.join(repoRoot, "app", "runs", "page.tsx"), "utf8");
    const disclosure = runs.slice(runs.indexOf("<TechnicalDetails>"));
    expect(disclosure).toContain("run.run_id");
    const heading = runs.slice(runs.indexOf("<h3>"), runs.indexOf("</h3>"));
    expect(heading).toContain("describeRunStart");
    // The id is still the link's *destination* — `runDetailHref` needs it — and
    // is no longer the link's text. That distinction is the change.
    expect(heading).toContain("runDetailHref(run.agent, run.run_id)");
    expect(heading).not.toContain("{run.run_id}");
  });
});
