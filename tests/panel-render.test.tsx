/**
 * The declarative panel, rendered (MAR-554, ADR 0008 slice 3).
 *
 * `tests/panel-view.test.ts` holds the bindings and the copy. This holds the
 * four things that are properties of the *output of the renderer* and cannot be
 * checked any other way:
 *
 * 1. all five components draw, and each draws something different;
 * 2. nothing inside the region can be mistaken for a DASH verdict or a control;
 * 3. no raw identifier reaches the surface — not behind a disclosure, at all;
 * 4. the markup is the same in both themes and both densities.
 *
 * The fourth needs saying, because "render tests in both themes" sounds like it
 * needs a browser and does not. Theme and density in DASH are one attribute on
 * `<html>` re-declaring custom properties (`app/tokens.css`), and the product
 * rule MAR-420 shipped is that **neither may change what is on the page**. So
 * the render assertion is that the markup is byte-identical across all four
 * combinations, which is the strongest thing a static render can say and is
 * exactly the regression worth catching. What the two themes *look like* is a
 * question for a photograph, and MAR-554's screenshots are that.
 *
 * The stylesheet is read directly for the half of theming a render cannot see:
 * every colour in the panel's own block has to be a token, because a token is
 * what carries a value for both themes. A hardcoded hex would render identically
 * here and be wrong in one of the two palettes.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentPanel } from "../app/_components/panel";
import { OUTPUTS_PANEL_COPY } from "../lib/copy/artifacts";
import {
  PANEL_CELL_ABSENT,
  PANEL_COPY,
  PANEL_METRIC_EMPTY,
  PANEL_NEWER_VERSION,
  PANEL_UNREADABLE,
} from "../lib/copy/panel";
import { PANEL_SECTION_TYPES_V1 } from "../lib/panel-spec";
import { buildPanelView, type PanelDashFacts, type PanelView } from "../lib/views/panel";
import type { DigestArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------------------------------------------- *
 * Fixtures — every technical name here is one the surface must never print
 * ---------------------------------------------------------------------- */

const AGENT = "ai-agent-news";
const RUN_ID = "run-mar554-render";
const DIGEST_ID = "digest-2026-08-05";
const SECTION_IDS = ["latest_digest", "every_output", "headline_rows", "at_a_glance", "author_note"];
const METRIC_IDS = ["headline_count", "times_run"];
const COLUMN_KEYS = ["headline", "score", "published_at"];

const digest = {
  artifact_version: 1,
  kind: "digest",
  agent: AGENT,
  run_id: RUN_ID,
  artifact_id: DIGEST_ID,
  title: "AI agent news for 5 August",
  generated_at: "2026-08-05T21:14:02.000Z",
  headline_count: 3,
  sources_fetched: [
    {
      source_name: "Hacker News",
      source_url: "https://hn.algolia.com/api/v1/search",
      status: "ok",
      item_count: 2,
    },
  ],
  items: [
    { headline: "A supervisor for long-running agents lands in beta", score: 91 },
    { headline: "Second thing that happened", published_at: "2026-08-05T09:00:00.000Z" },
  ],
} as unknown as DigestArtifact;

/** The markup of the one table section, which is the part this slice owns. */
function tableRegionOf(html: string): string {
  const from = html.indexOf('<div class="agent-panel-table-wrap">');
  const to = html.indexOf("</table>", from);
  expect(from, "no table was rendered").toBeGreaterThan(-1);
  return html.slice(from, to);
}

const records: RunArtifactRecord[] = [
  { artifact: digest, received_at: "2026-08-05T21:14:08.412Z", stored_bytes: 4210 },
];

const FACTS: PanelDashFacts = {
  run_count: 12,
  last_run_at: "2026-08-05T21:14:02.000Z",
  last_run_status: "completed",
};

/** One panel that exercises every component in the vocabulary. */
const EVERY_SECTION = [
  { id: SECTION_IDS[0], type: "report", label: "Latest roundup", artifact_role: "digest" },
  { id: SECTION_IDS[1], type: "outputs", label: "Everything it made", artifact_role: "digest" },
  {
    id: SECTION_IDS[2],
    type: "table",
    label: "Headlines",
    source_role: "digest",
    columns: [
      { key: COLUMN_KEYS[0], label: "Headline", kind: "text" },
      { key: COLUMN_KEYS[1], label: "Score", kind: "number" },
      { key: COLUMN_KEYS[2], label: "Published", kind: "timestamp" },
    ],
  },
  {
    id: SECTION_IDS[3],
    type: "metrics",
    label: "At a glance",
    items: [
      {
        id: METRIC_IDS[0],
        label: "Headlines gathered",
        source: { kind: "artifact_field", artifact_role: "digest", field: "headline_count" },
      },
      { id: METRIC_IDS[1], label: "Times run", source: { kind: "dash_fact", fact: "run_count" } },
    ],
  },
  {
    id: SECTION_IDS[4],
    type: "note",
    label: "About this agent",
    text: "It only runs when you ask it to. Nothing happens on a timer.",
  },
];

function manifest(panel: unknown): unknown {
  return { agent: { name: AGENT }, agent_dom: { panel } };
}

function view(
  sections: unknown[],
  artifacts: readonly RunArtifactRecord[] = records,
  title = "Newsroom",
): PanelView {
  return buildPanelView(manifest({ panel_version: 1, title, sections }), {
    artifacts,
    facts: FACTS,
  });
}

/**
 * Undo React's entity escaping so an assertion can be written in the words the
 * copy module holds. The same helper `tests/outputs-render.test.tsx` carries,
 * for the same reason: `DASH&#x27;s` is correct output and a miserable thing to
 * write a test against.
 */
function decode(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function render(panel: PanelView): string {
  return decode(renderToStaticMarkup(<AgentPanel view={panel} />));
}

/* ---------------------------------------------------------------------- *
 * The region
 * ---------------------------------------------------------------------- */

describe("one attributed region", () => {
  const html = render(view(EVERY_SECTION));

  it("draws nothing at all for an agent that declared no panel", () => {
    // Not an empty frame and not a placeholder — the whole component returns
    // null, so the workspace has nothing to lay out.
    expect(render({ kind: "none" })).toBe("");
  });

  it("frames the author's title with DASH's own words", () => {
    expect(html).toContain(PANEL_COPY.eyebrow);
    expect(html).toContain("Newsroom");
    expect(html).toContain(PANEL_COPY.attribution);
  });

  it("says what is inside the box and what is deliberately outside it", () => {
    /*
     * The sentence the whole security argument rests on. ADR 0008 bounds what a
     * panel can *do* with a closed vocabulary and bounds what a `note` can
     * *claim* with attribution — this is the attribution, and a surface that
     * dropped it would leave an author's copy sitting in DASH's page with
     * nothing marking whose it is.
     */
    expect(PANEL_COPY.attribution).toContain("the author declared");
    expect(PANEL_COPY.attribution).toContain("outside it");
  });

  it("names its own heading for anything that reads structure", () => {
    expect(html).toContain('aria-labelledby="agent-panel-heading"');
    expect(html).toContain('id="agent-panel-heading"');
  });
});

/* ---------------------------------------------------------------------- *
 * The five components
 * ---------------------------------------------------------------------- */

describe("all five components draw", () => {
  const html = render(view(EVERY_SECTION));

  it("renders one section per declaration, in the author's order", () => {
    expect(html.match(/class="agent-panel-section"/g)).toHaveLength(
      PANEL_SECTION_TYPES_V1.length,
    );
    const labels = ["Latest roundup", "Everything it made", "Headlines", "At a glance", "About this agent"];
    let at = -1;
    for (const label of labels) {
      const next = html.indexOf(label, at + 1);
      expect(next, label).toBeGreaterThan(at);
      at = next;
    }
  });

  it("draws a report through the artifact-card and digest machinery", () => {
    expect(html).toContain("output-card");
    // The role, not the kind — and the receipt, not just the body.
    expect(html).toContain("Summary");
    expect(html).toContain(OUTPUTS_PANEL_COPY.receipt.stated_at);
    expect(html).toContain(OUTPUTS_PANEL_COPY.receipt.received_at);
    expect(html).toContain("A supervisor for long-running agents lands in beta");
  });

  /**
   * MAR-576, in the region whose whole purpose is "what did the scout find?".
   *
   * This file renders its own artifact card rather than reusing the Outputs
   * area's, so fixing the ordering there fixed nothing here — and nothing said
   * so. What said so was a screenshot of the packaged renderer after the
   * re-import: the author's box drew "Made by / The agent's own time / Reached
   * DASH / Size stored" above the headlines, which is the exact defect this
   * issue was filed on, surviving one renderer down.
   */
  it("puts the report's own body above its provenance receipt", () => {
    const headline = "A supervisor for long-running agents lands in beta";
    expect(html.indexOf(headline)).toBeLessThan(
      html.indexOf(OUTPUTS_PANEL_COPY.receipt.agent),
    );
  });

  it("draws a table, inside a box that scrolls rather than a page that does", () => {
    /*
     * MAR-491's finding is that a table in DASH becomes a 1425px scroller in a
     * 341px window. The containment is the answer, and the wrapper is where it
     * lives — `tests/panel-render.test.tsx` can see the wrapper is there and the
     * 375px screenshots are what show it working.
     */
    expect(html).toContain('class="agent-panel-table-wrap"');
    expect(html).toContain('<th scope="col">Headline</th>');
    expect(html).toContain("<td>91</td>");
  });

  it("marks an absent cell rather than leaving it blank", () => {
    // A blank cell and a cell a reader skipped look identical.
    expect(html).toContain(`aria-label="${PANEL_CELL_ABSENT}"`);
  });

  it("puts an attribution beside every single metric", () => {
    expect(html).toContain("Headlines gathered");
    expect(html).toContain("Times run");
    expect(html).toContain("The agent’s report");
    expect(html).toContain("DASH’s record");
    // One per metric, never one per section: the distinction is per value.
    expect(html.match(/agent-panel-attribution-mark/g)).toHaveLength(METRIC_IDS.length);
  });

  it("carries the author's note through as their words", () => {
    expect(html).toContain("It only runs when you ask it to.");
    expect(html).toContain("agent-panel-note");
  });
});

/**
 * MAR-691. `deep_dive.text` reached DASH on the digest artifact and nothing
 * drew it, in this renderer any more than in the Output stage's. `panel.tsx`
 * draws its own artifact card rather than reusing `outputs.tsx`'s — MAR-576's
 * own note above records what fixing only one renderer once cost — so this is
 * checked here separately from `tests/outputs-render.test.tsx`, both reaching
 * the same `DigestBody` that `tests/deep-dive-render.test.tsx` covers alone.
 */
describe("the deep dive, on the declarative panel", () => {
  const digestWithDeepDive = {
    ...digest,
    artifact_id: "digest-mar691-panel",
    deep_dive: {
      state: "written",
      model: "openai/gpt-5-mini",
      text: "A closer look the sample agent wrote, from items already above.",
    },
  } as unknown as DigestArtifact;

  const html = render(
    view(
      [EVERY_SECTION[0]],
      [{ artifact: digestWithDeepDive, received_at: "2026-08-18T08:00:05.000Z", stored_bytes: 512 }],
    ),
  );

  it("draws the deep dive's text through the report section", () => {
    expect(html).toContain("A closer look the sample agent wrote, from items already above.");
    expect(html).toContain("Written by a language model");
  });
});

describe("the panel's output history", () => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const older = new Date(today);
  older.setDate(older.getDate() - 3);

  const history = [
    {
      artifact: {
        ...digest,
        artifact_id: "latest",
        title: "Latest roundup",
        generated_at: today.toISOString(),
      },
      received_at: today.toISOString(),
      stored_bytes: 4210,
    },
    {
      artifact: {
        ...digest,
        artifact_id: "yesterday",
        title: "Previous roundup",
        generated_at: yesterday.toISOString(),
      },
      received_at: yesterday.toISOString(),
      stored_bytes: 4210,
    },
    {
      artifact: {
        ...digest,
        artifact_id: "older",
        title: "Older roundup",
        generated_at: older.toISOString(),
      },
      received_at: older.toISOString(),
      stored_bytes: 4210,
    },
  ] satisfies RunArtifactRecord[];
  const html = render(
    view(
      [{ id: "history", type: "outputs", label: "Everything it made", artifact_role: "digest" }],
      history,
    ),
  );

  it("keeps the newest card open and collapses both older cards", () => {
    expect(html.indexOf("Latest roundup")).toBeLessThan(html.indexOf("output-history-entry"));
    expect(html.match(/class="output-history-entry"/g)).toHaveLength(2);
    expect(html).toContain(">Yesterday</span>");
    expect(html).not.toMatch(/<details class="output-history-entry" open/);
  });

  it("keeps the panel renderer's full cards inside those disclosures", () => {
    expect(html).toContain("Previous roundup");
    expect(html).toContain("Older roundup");
    expect(html.match(/class="output-card/g)).toHaveLength(3);
    expect(html).not.toContain(OUTPUTS_PANEL_COPY.download);
  });
});

/* ---------------------------------------------------------------------- *
 * Empty states
 * ---------------------------------------------------------------------- */

describe("a section with nothing behind it says so", () => {
  // The same panel, against an agent that has produced nothing at all.
  const html = render(view(EVERY_SECTION, []));

  it("still draws every section rather than hiding the empty ones", () => {
    /*
     * A panel that shed its empty sections would leave a reader unable to tell
     * "the agent has not made this yet" from "DASH is not showing me what it
     * made", which are very different things to learn about an agent you are
     * deciding to trust.
     */
    expect(html.match(/class="agent-panel-section"/g)).toHaveLength(
      PANEL_SECTION_TYPES_V1.length,
    );
  });

  it("states each empty section in two sentences, not as a blank", () => {
    expect(html.match(/class="empty agent-panel-empty"/g)).toHaveLength(3);
    expect(html).toContain("Nothing has arrived for this section yet.");
    expect(html).toContain("This table has no rows yet.");
  });

  it("says a metric is not reported rather than drawing an empty slot", () => {
    const noFacts = render(
      buildPanelView(manifest({ panel_version: 1, sections: [EVERY_SECTION[3]] }), {
        artifacts: [],
        facts: { run_count: 0, last_run_at: null, last_run_status: null },
      }),
    );
    expect(noFacts).toContain(PANEL_METRIC_EMPTY);
    // The attribution survives an absent value: whose fact it *would* be is
    // still a fact about the metric.
    expect(noFacts).toContain("DASH’s record");
  });

  it("does not draw an absence in the type a value gets", () => {
    /*
     * A screenshot finding rather than a measurement one. Both states used the
     * same class, so "Not reported yet" rendered at the display step and an
     * agent that had never run had three metrics shouting their own emptiness
     * louder than the one real number beside them.
     */
    const noFacts = render(
      buildPanelView(manifest({ panel_version: 1, sections: [EVERY_SECTION[3]] }), {
        artifacts: [],
        facts: { run_count: 0, last_run_at: null, last_run_status: null },
      }),
    );
    expect(noFacts).toContain("agent-panel-metric-absent");
    // The value's own face belongs to values. One metric here has a real one
    // (`run_count` is 0, which is a number DASH observed), so the class must
    // still appear exactly once.
    expect(noFacts.match(/agent-panel-metric-value/g)).toHaveLength(1);
  });

  it("never reports an unproduced output to the user as damage", () => {
    for (const word of ["error", "broken", "failed", "corrupt", "invalid"]) {
      expect(html.toLowerCase(), word).not.toContain(word);
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The two stated cards
 * ---------------------------------------------------------------------- */

describe("a panel this DASH cannot draw", () => {
  const skew = render(
    buildPanelView(
      manifest({
        panel_version: 9,
        title: "Fleet control",
        sections: [
          { id: "orbit", type: "orbit_map", label: "Orbit map" },
          { id: "beam", type: "beam", label: "Beam" },
        ],
      }),
      { artifacts: records, facts: FACTS },
    ),
  );

  it("is one stated card and nothing else", () => {
    expect(skew).toContain(PANEL_NEWER_VERSION.headline);
    expect(skew).toContain(PANEL_NEWER_VERSION.meaning);
    // Never partially: not one section, not one heading from the declaration.
    expect(skew).not.toContain("agent-panel-section");
    expect(skew).not.toContain("Orbit map");
    expect(skew).not.toContain("Beam");
  });

  it("keeps the author's title and the region's frame", () => {
    // The box is still theirs and still says so — what is missing is only the
    // part DASH cannot draw.
    expect(skew).toContain("Fleet control");
    expect(skew).toContain(PANEL_COPY.eyebrow);
  });

  it("draws the damage card for a declaration DASH cannot read", () => {
    const damaged = render(
      buildPanelView(manifest({ panel_version: 1, sections: [{ id: "x", type: "reprot" }] }), {
        artifacts: records,
        facts: FACTS,
      }),
    );
    expect(damaged).toContain(PANEL_UNREADABLE.headline);
    expect(damaged).toContain(PANEL_UNREADABLE.next_action ?? "");
    // The typed errors are technical register and stay off a guided surface.
    expect(damaged).not.toContain("unknown_section_type");
    expect(damaged).not.toContain("reprot");
  });
});

/* ---------------------------------------------------------------------- *
 * Nothing inside can be mistaken for DASH
 * ---------------------------------------------------------------------- */

describe("the panel asks the user for nothing", () => {
  const html = render(view(EVERY_SECTION));

  it("draws no control of any kind", () => {
    /*
     * ADR 0008: "The vocabulary contains no component that asks the user for
     * anything — no button, no toggle, no input — and that absence is the
     * strongest claim in this ADR." Asserted over the markup, because the claim
     * is about what reaches a screen rather than about what the schema allows.
     *
     * **`<details>` is deliberately not in this list, and it took MAR-576 an
     * attempt to add it to find out why.** A disclosure is already inside this
     * region and always has been: `DigestBody` draws `Where this came from` for
     * any digest carrying `sources_fetched`, on every surface, since MAR-434.
     * It arrives the same way a digest item's source link does — from the
     * *artifact*, not from the panel vocabulary — which is the honest
     * qualification `app/_components/panel.tsx`'s header already records about
     * links. Adding `<details>` here asserts something untrue of the shipped
     * product, and the assertion fails on a fixture whose digest names a source.
     *
     * What the list names is the set that can *submit or change something* —
     * and that is the set both `tests/panel-spec.test.ts` and installed check
     * 6o count, so the three agree.
     */
    for (const control of ["<button", "<input", "<textarea", "<select", "<form"]) {
      expect(html, control).not.toContain(control);
    }
  });

  it("does not repeat DASH's own save control inside somebody else's box", () => {
    expect(html).not.toContain(OUTPUTS_PANEL_COPY.download);
  });

  it("adds no link of its own", () => {
    /*
     * The honest form of the claim. No section type takes a URL, so the panel
     * contributes none — and this fixture's digest items carry no source link,
     * so a link appearing here would have come from the panel rather than from
     * the artifact. A digest that *does* carry one draws it exactly as the run
     * detail page already does; that is the artifact contract's link, not this
     * vocabulary's.
     */
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("href=");
  });

  it("carries no grounding chip, because a verdict is DASH's and renders outside", () => {
    expect(html).not.toContain("chip-warn");
    expect(html).not.toContain("no source given");
  });
});

describe("no raw identifier reaches this surface", () => {
  const html = render(view(EVERY_SECTION));

  it("prints no section id, metric id or column key", () => {
    /*
     * Stronger than MAR-434's rule for the Outputs area, which allows them
     * behind a developer disclosure. Here there is no disclosure and no id on
     * the view model to print — the values are still reachable on the run detail
     * page, where a disclosure already exists and is already tested.
     */
    for (const identifier of [...SECTION_IDS, ...METRIC_IDS, ...COLUMN_KEYS]) {
      expect(html, identifier).not.toContain(identifier);
    }
  });

  it("prints no artifact id and no run id", () => {
    for (const identifier of [DIGEST_ID, RUN_ID]) {
      expect(html, identifier).not.toContain(identifier);
    }
  });

  it("prints no artifact kind, because a role is what a person reads", () => {
    expect(html).not.toContain(">digest<");
    expect(html).toContain("Summary");
  });

  it("words a moment rather than shipping the machine's spelling of one", () => {
    /*
     * MAR-533. The `timestamp` column is the author telling DASH the value is a
     * moment, which is the licence DASH needs to say it in its own words.
     *
     * **Widened from the table region to the whole panel (MAR-548).** This
     * assertion used to read only `tableRegionOf(html)`, and the scoping was a
     * finding rather than a convenience: written against the whole panel it
     * failed on a string this component does not produce, because
     * `DigestBody` printed a digest item's `published_at` straight into its
     * source line. That was MAR-533's own defect surviving in a file MAR-554
     * did not own; MAR-571 fixed it, and this is the widening that issue's exit
     * clause named. The same fixture item now has to survive being drawn twice
     * — once as a table cell, once inside the report section's digest body —
     * and a regression in *either* renderer fails here.
     */
    expect(html).not.toContain("2026-08-05T09:00:00.000Z");
    expect(html).toContain("August 2026 at");
    // Still checked in the table specifically, so the widening cannot be
    // satisfied by the digest body alone if the cell ever stops rendering.
    expect(tableRegionOf(html)).toContain("August 2026 at");
  });
});

/* ---------------------------------------------------------------------- *
 * Both themes, both densities
 * ---------------------------------------------------------------------- */

describe("theme and density change nothing on the page", () => {
  /*
   * MAR-420's product rule: a compact DASH shows the same facts in less space,
   * never fewer facts, and a theme is a palette rather than a layout. Both are
   * one attribute on `<html>`, so the assertion is that the panel's markup does
   * not vary — there is nowhere for a hidden section to be decided.
   */
  const combinations = [
    { theme: "light", density: "comfortable" },
    { theme: "light", density: "compact" },
    { theme: "dark", density: "comfortable" },
    { theme: "dark", density: "compact" },
  ] as const;

  it("renders byte-identical markup in all four combinations", () => {
    const rendered = combinations.map(({ theme, density }) =>
      decode(
        renderToStaticMarkup(
          <div data-density={density} data-theme={theme}>
            <AgentPanel view={view(EVERY_SECTION)} />
          </div>,
        ),
      ).replace(/^<div[^>]*>/, ""),
    );
    for (const markup of rendered) {
      expect(markup).toBe(rendered[0]);
    }
    // The premise: a comparison of four empty strings would pass too.
    expect(rendered[0]?.length ?? 0).toBeGreaterThan(2000);
  });

  it("is not read by the component at all", () => {
    // `tests/density.test.ts` scans every component for this; asserted here too
    // because the panel is the surface most likely to be tempted by a "compact
    // table" that quietly drops a column.
    const source = readFileSync(path.join(repoRoot, "app", "_components", "panel.tsx"), "utf8");
    expect(source).not.toContain("parseDensity");
    expect(source).not.toContain("data-density");
    expect(source).not.toContain("data-theme");
  });
});

describe("the panel's stylesheet carries both themes", () => {
  const css = readFileSync(path.join(repoRoot, "app", "globals.css"), "utf8");
  const block = css.slice(css.indexOf("The declarative panel (MAR-554"));
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, "");

  it("finds the block", () => {
    // A slice that missed would make every assertion below pass vacuously.
    expect(block).toContain(".agent-panel {");
    expect(rules).toContain(".agent-panel-table-wrap");
  });

  it("names a token for every colour rather than a literal", () => {
    /*
     * The half of theming a static render cannot see. `app/tokens.css` declares
     * each token once with a value for each theme through `light-dark()`, so a
     * hardcoded hex renders identically in a test and is wrong in one of the two
     * palettes on a real screen.
     */
    const hex = rules.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex).toEqual([]);
    expect(rules).toContain("var(--surface-2)");
    expect(rules).toContain("var(--text-faint)");
  });

  it("keeps the corners square, which is the shape language", () => {
    // Bit-Command: no border radii on any component. `--radius-sm` is 0 and is
    // the seam where a rounded exception would have to be argued for.
    for (const radius of rules.match(/border-radius:\s*([^;]+);/g) ?? []) {
      expect(radius).toContain("var(--radius-");
    }
  });

  it("spends only the 4px grid and the density tokens on space", () => {
    const lengths = rules.match(/(?:padding|margin|gap)[^:]*:\s*([^;]+);/g) ?? [];
    expect(lengths.length).toBeGreaterThan(5);
    for (const declaration of lengths) {
      const value = declaration.slice(declaration.indexOf(":") + 1);
      for (const literal of value.match(/(?<![\w-])\d+(?:\.\d+)?(px|rem)\b/g) ?? []) {
        // `0` needs no unit and anything else must be a token, so any literal
        // length here is a value that escaped the scale.
        expect(literal, declaration).toBe("0px");
      }
    }
  });

  it("contains the table's overflow inside its own box", () => {
    // The page must not scroll sideways because a panel table is wide.
    expect(rules).toMatch(/\.agent-panel-table-wrap\s*\{[^}]*overflow-x:\s*auto/);
    expect(rules).toMatch(/\.agent-panel-table-wrap\s*\{[^}]*contain:\s*inline-size/);
  });
});
