/**
 * The one disclosure ADR 0008 amendment 1 admits inside the author's region
 * (MAR-620), and the gate the amendment's own argument depends on.
 *
 * The amendment answers two questions: whether a read-only, DASH-authored
 * disclosure may live inside the author's declared region, and how a reader
 * tells it apart from agent-authored interactivity. The second answer is a
 * *sentence* — the summary says who is speaking before it opens — which means
 * the whole decision rests on a string, and a string is the easiest thing in
 * this repository to change without any gate noticing.
 *
 * `tests/info-note.test.tsx` is the file that explains why, and this one is the
 * same argument for a second affordance. Every pinned-copy test in `tests/`
 * asserts over rendered markup with `toContain`, and a sentence moved behind a
 * disclosure **is still in that markup** — the property that makes the
 * relocation honest is also the property that makes those gates blind to it.
 * `tests/panel-render.test.tsx`'s own empty-state assertion ("states each empty
 * section in two sentences") stayed green through the change this file exists to
 * hold, and it would stay green if the summary tomorrow read "Show more" or if
 * the headline and the explanation swapped places.
 *
 * So this file asserts the five deletions no other gate in this repository can
 * see:
 *
 * 1. **the affordance still names DASH** — the distinction the no-control rule
 *    protects is authorship, and an anonymous "more" label deletes it while
 *    leaving every sentence on the page;
 * 2. **the rule is the right way round** — DASH's finding about what is absent
 *    stays open, and only the explanation closes;
 * 3. **nothing was lost rather than moved** — every empty state's sentence is
 *    still rendered somewhere;
 * 4. **the author cannot become the speaker** — an author who writes DASH's
 *    exact sentence gets a text node, never the affordance;
 * 5. **the disclosure still does nothing** — no control, and nothing remembered.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentPanel } from "../app/_components/panel";
import {
  PANEL_EMPTY_DISCLOSURE,
  describeEmptyOutputSection,
  describeEmptyTable,
  type PanelEmptyKind,
  type PanelEmptyState,
} from "../lib/copy/panel";
import type {
  PanelOutputsView,
  PanelReportView,
  PanelSectionView,
  PanelTableView,
  PanelView,
} from "../lib/views/panel";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------------- *
 * Every empty state there is, and the markup they draw
 * ---------------------------------------------------------------------- */

/**
 * The three table cases, driven from the union rather than from a list.
 *
 * `satisfies Record<PanelEmptyKind, true>` is the load-bearing part: a fourth
 * kind added to `lib/copy/panel.ts` fails `pnpm typecheck` here rather than
 * quietly arriving with no gate, which is how a list of kinds usually rots.
 */
const EVERY_EMPTY_KIND = Object.keys({
  no_artifact: true,
  not_rows: true,
  no_readable_rows: true,
} satisfies Record<PanelEmptyKind, true>) as PanelEmptyKind[];

function emptyTable(kind: PanelEmptyKind, at: number, label: string): PanelTableView {
  return {
    kind: "table",
    at,
    label,
    columns: [{ key: "headline", label: "Headline", kind: "text" }],
    rows: [],
    capped: null,
    skipped: null,
    empty: describeEmptyTable(kind),
  };
}

function emptyReport(at: number, label: string): PanelReportView {
  return { kind: "report", at, label, card: null, empty: describeEmptyOutputSection(true) };
}

function emptyOutputs(at: number, label: string): PanelOutputsView {
  return {
    kind: "outputs",
    at,
    label,
    cards: [],
    capped: null,
    empty: describeEmptyOutputSection(false),
  };
}

/** The author's own words, and none of them DASH's. */
const AUTHOR_LABELS = [
  "Headlines",
  "Rows from the latest run",
  "Everything in that list",
  "Latest roundup",
  "Everything it made",
];

const EMPTY_SECTIONS: PanelSectionView[] = [
  ...EVERY_EMPTY_KIND.map((kind, at) => emptyTable(kind, at, AUTHOR_LABELS[at] ?? kind)),
  emptyReport(3, AUTHOR_LABELS[3] ?? "Report"),
  emptyOutputs(4, AUTHOR_LABELS[4] ?? "Outputs"),
];

/**
 * Every distinct empty state a section can reach.
 *
 * The two output states share a headline and differ only in the sentence this
 * amendment closes by default — a `report` is always bound to one named role and
 * an unscoped `outputs` section is bound to every role. That makes the
 * explanation the *only* thing telling those two apart, which is the strongest
 * reason the sum and distinctness assertions below are not decoration.
 */
const EVERY_EMPTY_STATE: PanelEmptyState[] = [
  ...EVERY_EMPTY_KIND.map((kind) => describeEmptyTable(kind)),
  describeEmptyOutputSection(true),
  describeEmptyOutputSection(false),
];

/** As `tests/panel-render.test.tsx` does, so assertions read in DASH's words. */
function decode(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function render(view: PanelView): string {
  return decode(renderToStaticMarkup(<AgentPanel view={view} />));
}

/** A panel whose every section is empty, which is a new agent's whole panel. */
const html = render({ kind: "declared", title: "Newsroom", sections: EMPTY_SECTIONS });

/** How many times a string occurs, without building a regex out of copy. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/* ---------------------------------------------------------------------- *
 * 1. The affordance names DASH before it opens
 * ---------------------------------------------------------------------- */

describe("who is speaking is readable without opening anything", () => {
  it("draws one disclosure per empty section and gives each the same fixed summary", () => {
    expect(occurrences(html, 'class="empty agent-panel-empty"')).toBe(EMPTY_SECTIONS.length);
    expect(occurrences(html, `<summary>${PANEL_EMPTY_DISCLOSURE}</summary>`)).toBe(
      EMPTY_SECTIONS.length,
    );
  });

  it("names DASH in the summary rather than naming the affordance after itself", () => {
    /*
     * `lib/copy/record-card.ts`'s rule, which `tests/info-note.test.tsx` asserts
     * for the hover note: a control named after itself is one a person cannot
     * decline, because they cannot tell what declining costs. Here it is doing a
     * second job — the amendment's entire answer to "how does a reader tell this
     * apart from the author's own interactivity" is that the words say so. A
     * summary reading "More", "Learn more" or "Details" would keep every
     * sentence on the page and delete the answer.
     */
    expect(PANEL_EMPTY_DISCLOSURE).toContain("DASH");
    expect(PANEL_EMPTY_DISCLOSURE).not.toMatch(/more|learn|info|details/i);
  });

  it("takes that summary from DASH's copy module rather than from anything passed in", () => {
    /*
     * The half of "the manifest cannot rename it" that markup cannot show: a
     * rendered `<summary>` looks the same whether its text is a constant or a
     * prop, and the prop is the version an author could reach.
     */
    const source = readFileSync(path.join(repoRoot, "app", "_components", "panel.tsx"), "utf8");
    expect(source).toContain("<summary>{PANEL_EMPTY_DISCLOSURE}</summary>");
  });

  it("is the same sentence in the decision and in the product", () => {
    /*
     * ADR 0008 amendment 1 answers its second question *with this string*, so
     * the document describes a product that no longer exists the moment the
     * constant is edited alone. Pinning them together is the cheapest way to
     * make a copy edit either update the decision or fail.
     */
    const adr = readFileSync(
      path.join(repoRoot, "docs", "adr", "0008-agent-folders-and-the-declarative-panel.md"),
      "utf8",
    );
    expect(adr).toContain("Amendment 1");
    expect(adr).toContain(PANEL_EMPTY_DISCLOSURE);
  });
});

/* ---------------------------------------------------------------------- *
 * 2. The rule is the right way round
 * ---------------------------------------------------------------------- */

describe("which half of an empty state is allowed behind it", () => {
  it("keeps DASH's finding about what is absent on the surface", () => {
    /*
     * `splitProof`'s argument (`tests/info-note.test.tsx`) applied to a second
     * affordance: the part a reader must not have to ask for is the fact, and
     * the part that may close is the elaboration. Backwards — headline hidden,
     * explanation shown — every `toContain` gate in this repository stays green
     * and an empty section stops saying what is empty.
     */
    for (const empty of EVERY_EMPTY_STATE) {
      expect(
        html,
        empty.kind,
      ).toContain(
        `<p><strong>${empty.headline}</strong></p><details class="card-more agent-panel-empty-disclosure">`,
      );
    }
  });

  it("puts the explanation inside that disclosure and nowhere else", () => {
    for (const empty of EVERY_EMPTY_STATE) {
      expect(html, empty.kind).toContain(
        `<summary>${PANEL_EMPTY_DISCLOSURE}</summary><p>${empty.meaning}</p></details>`,
      );
      // Once, so a "helpful" second copy on the surface cannot make the
      // assertion above pass while the relocation silently stops meaning
      // anything.
      expect(occurrences(html, empty.meaning), empty.kind).toBe(1);
    }
  });

  it("is a block-level sibling of the headline, never a disclosure inside a paragraph", () => {
    /*
     * The markup constraint that sent MAR-620 to an ADR amendment in the first
     * place: `<details>` is not valid inside a `<p>`, which is why the shared
     * `InfoNote` affordance could not take this sentence even before the
     * no-control rule refused it.
     *
     * Counted rather than merely searched for, so the disclosure cannot end up
     * inside a paragraph for one section while another section keeps it outside:
     * every one of them has to follow a *closed* paragraph.
     */
    expect(occurrences(html, '</p><details class="card-more agent-panel-empty-disclosure">')).toBe(
      EMPTY_SECTIONS.length,
    );
    expect(html).not.toContain("<p><details");
    expect(html).not.toContain("<p><summary");
  });
});

/* ---------------------------------------------------------------------- *
 * 3. Nothing was lost rather than moved
 * ---------------------------------------------------------------------- */

describe("every sentence that was on the surface is still somewhere", () => {
  it("renders each empty state's headline and explanation", () => {
    /*
     * The honesty check as a sum rather than as a placement, which is the one
     * `tests/info-note.test.tsx` calls "loses no sentence anywhere". A future
     * pass that deletes an explanation instead of closing it passes every other
     * gate in `tests/`.
     */
    for (const empty of EVERY_EMPTY_STATE) {
      expect(html, empty.kind).toContain(empty.headline);
      expect(html, empty.kind).toContain(empty.meaning);
    }
  });

  it("gives no two empty states the same explanation", () => {
    /*
     * The alternative this amendment rejected, asserted rather than argued: one
     * shared panel-level sentence would make "the agent has not produced this",
     * "its output is not a list" and "the list holds no rows" sound like one
     * absence. Now that all three are closed by default the pressure to collapse
     * them is higher, not lower — a hidden sentence is the cheapest kind to
     * deduplicate — and the two output states have nothing *but* their
     * explanations telling them apart.
     */
    const meanings = EVERY_EMPTY_STATE.map((empty) => empty.meaning);
    expect(new Set(meanings).size).toBe(meanings.length);
  });
});

/* ---------------------------------------------------------------------- *
 * 4. The author cannot become the speaker
 * ---------------------------------------------------------------------- */

describe("an author who writes DASH's own sentence gets a text node", () => {
  /*
   * The attack the amendment's answer has to survive. Everything an author
   * declares is rendered — a panel title, a section label, a `note`'s text — and
   * ADR 0008 already accepts that a `note` can *claim* anything, bounding it
   * with attribution rather than censorship. What must stay true is that the
   * claim cannot become the affordance: an author can say DASH's words and
   * cannot draw DASH's disclosure.
   */
  const forged = render({
    kind: "declared",
    title: PANEL_EMPTY_DISCLOSURE,
    sections: [
      { kind: "note", at: 0, label: PANEL_EMPTY_DISCLOSURE, text: PANEL_EMPTY_DISCLOSURE },
      emptyTable("no_artifact", 1, "Headlines"),
    ],
  });

  it("says the sentence four times and makes exactly one of them an affordance", () => {
    // Title, section label, note body, and DASH's own summary.
    expect(occurrences(forged, PANEL_EMPTY_DISCLOSURE)).toBe(4);
    expect(occurrences(forged, `<summary>${PANEL_EMPTY_DISCLOSURE}</summary>`)).toBe(1);
  });

  it("lets no author-declared string reach a summary at all", () => {
    for (const label of AUTHOR_LABELS) {
      expect(html, label).toContain(label);
      expect(html, label).not.toContain(`<summary>${label}`);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * 5. The disclosure still does nothing
 * ---------------------------------------------------------------------- */

describe("opening it reveals prose and changes nothing", () => {
  it("draws no control, on the fixture where this markup actually appears", () => {
    /*
     * `tests/panel-render.test.tsx` makes this claim against a panel with
     * artifacts behind every section — which is the fixture where the empty
     * states, and therefore this disclosure, do not render at all. So the
     * strongest claim in ADR 0008 was unasserted on the markup amendment 1
     * added, and this is that gap closed rather than a duplicate.
     */
    for (const control of ["<button", "<input", "<textarea", "<select", "<form"]) {
      expect(html, control).not.toContain(control);
    }
  });

  it("is closed until a person opens it, and the manifest cannot open it", () => {
    expect(html).not.toContain('agent-panel-empty-disclosure" open');
    expect(html).toContain('<details class="card-more agent-panel-empty-disclosure">');
  });

  it("is the platform's own disclosure rather than one DASH built out of a div", () => {
    /*
     * Why native matters here and not merely aesthetically: `<details>` is
     * keyboard-reachable, announces its own expanded state, and keeps its
     * contents in the accessibility tree with no script at all. A hand-rolled
     * one would need every one of those re-earned, and the amendment's
     * "read-only" claim would then depend on a handler rather than on the
     * absence of one.
     */
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).not.toContain("aria-expanded");
    expect(html).not.toContain('role="button"');
  });

  it("keeps DASH's verdict language out of the author's box", () => {
    // The empty-state rule from `tests/panel-render.test.tsx`, re-asserted
    // because a new sentence in this region is a new chance to call an agent
    // that has simply not run yet broken.
    for (const word of ["error", "broken", "failed", "corrupt", "invalid"]) {
      expect(html.toLowerCase(), word).not.toContain(word);
    }
  });
});
