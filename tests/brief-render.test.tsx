/**
 * A brief, rendered — in both renderers (MAR-674, ADR 0025 amendment 1).
 *
 * `tests/brief-citations.test.ts` holds the join and the verdict. This file
 * covers the two things only a render can answer, and the second is the reason
 * it exists at all:
 *
 * 1. that a paragraph's link comes from **DASH's collected row** and never from
 *    the model's text, and that a withheld citation is actually withheld;
 * 2. that **both** `app/_components/outputs.tsx` and `app/_components/panel.tsx`
 *    draw it. A new artifact kind means each file gets its own `case`, and a
 *    build that added one and not the other would leave the author's own panel
 *    showing "Show what arrived" beside DASH's card showing the document. That
 *    is one defect in two files, and it has only ever been caught by looking.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OutputsPanel } from "../app/_components/outputs";
import { AgentPanel } from "../app/_components/panel";
import { BRIEF_CITED_LABEL, BRIEF_UNCITED_LABEL } from "../lib/copy/brief";
import { resolveBriefCitations } from "../lib/brief/fingerprint";
import { fingerprintItems } from "../lib/brief/fingerprint";
import { buildArtifactCards } from "../lib/views/artifacts";
import { buildPanelView } from "../lib/views/panel";
import type { BriefArtifact, DigestArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";

const AGENT = "scout";
const RUN = "run-brief-1";

const ITEMS = [
  {
    headline: "Providers cut prices",
    source_name: "Feed A",
    source_url: "https://feed.test/a",
    item_url: "https://news.test/prices",
  },
  {
    headline: "Nobody shipped supervision",
    source_name: "Feed B",
    source_url: "https://feed.test/b",
    item_url: "https://news.test/supervision",
  },
];

const DIGEST: DigestArtifact = {
  artifact_version: 1,
  kind: "digest",
  agent: AGENT,
  run_id: RUN,
  artifact_id: "digest-1",
  title: "Everything it collected",
  generated_at: "2026-08-18T09:00:00.000Z",
  sources_fetched: [
    { source_name: "Feed A", source_url: "https://feed.test/a", status: "ok", item_count: 1 },
    { source_name: "Feed B", source_url: "https://feed.test/b", status: "ok", item_count: 1 },
  ],
  items: ITEMS,
};

const BRIEF: BriefArtifact = {
  artifact_version: 2,
  kind: "brief",
  agent: AGENT,
  run_id: RUN,
  artifact_id: "brief-1",
  title: "What the week adds up to",
  generated_at: "2026-08-18T09:01:00.000Z",
  document: {
    model: "some-provider/some-model",
    sections: [
      {
        heading: "Prices came down",
        paragraphs: [
          { body: "Two providers cut their rates this week.", items: [0] },
          { body: "A quiet observation the model attached to nothing." },
        ],
      },
      {
        heading: "Supervision is still missing",
        paragraphs: [{ body: "Every release was about execution.", items: [1] }],
      },
    ],
  },
  derived_from: {
    artifact_id: "digest-1",
    run_id: RUN,
    item_count: ITEMS.length,
    items_digest: fingerprintItems(ITEMS),
  },
};

function record(artifact: DigestArtifact | BriefArtifact): RunArtifactRecord {
  return {
    artifact,
    received_at: "2026-08-18T09:02:00.000Z",
    stored_bytes: 2048,
  } as RunArtifactRecord;
}

/** The cards DASH's own Outputs area would build, with the join resolved. */
function cards(digests: DigestArtifact[] = [DIGEST]) {
  return buildArtifactCards([record(BRIEF), record(DIGEST)], undefined, (entry) =>
    entry.artifact.kind === "brief"
      ? resolveBriefCitations(entry.artifact, digests)
      : null,
  );
}

function decode(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function outputsHtml(digests: DigestArtifact[] = [DIGEST]): string {
  return decode(
    renderToStaticMarkup(<OutputsPanel cards={cards(digests)} grounding={null} />),
  );
}

/**
 * The brief's card alone.
 *
 * The first draft of the withholding tests asserted over the whole panel and
 * failed, correctly: the digest card on the same page carries those links
 * legitimately, so "this address is absent from the page" was never the claim
 * worth making. What matters is that the address is absent **from the brief** —
 * that no paragraph offers a citation DASH could not check.
 */
function briefOnlyHtml(digests: DigestArtifact[]): string {
  const briefCard = cards(digests).filter((card) => card.artifact.kind === "brief");
  return decode(
    renderToStaticMarkup(<OutputsPanel cards={briefCard} grounding={null} />),
  );
}

describe("the brief on DASH's own card", () => {
  it("draws the document in order, as text", () => {
    const html = outputsHtml();
    expect(html).toContain("Prices came down");
    expect(html).toContain("Two providers cut their rates this week.");
    expect(html).toContain("Supervision is still missing");
    expect(html.indexOf("Prices came down")).toBeLessThan(
      html.indexOf("Supervision is still missing"),
    );
  });

  it("says a model wrote it, and names the model the agent reported", () => {
    // Before the prose rather than under it: a reader who reaches the
    // attribution after the document has already read the document as DASH's.
    const html = outputsHtml();
    expect(html).toContain("some-provider/some-model");
    expect(html).toContain("DASH did not check the claims in it");
    expect(html.indexOf("some-provider/some-model")).toBeLessThan(
      html.indexOf("Two providers cut their rates this week."),
    );
  });

  it("links a cited paragraph to the row DASH collected, not to model text", () => {
    const html = outputsHtml();
    expect(html).toContain(BRIEF_CITED_LABEL);
    // The address comes from the digest item's own `item_url`. Nothing in
    // `document` carries one — `readBrief` drops any paragraph that does.
    expect(html).toContain('href="https://news.test/prices"');
    expect(html).toContain('href="https://news.test/supervision"');
    // The headline is the link text; a bare address is never printed.
    expect(html).toContain(">Providers cut prices</a>");
  });

  it("marks a paragraph the model attached to nothing", () => {
    // Kept and marked rather than dropped: a brief whose unattributed sentences
    // look like its attributed ones reads as fully grounded when it is not.
    const html = outputsHtml();
    expect(html).toContain("A quiet observation the model attached to nothing.");
    expect(html).toContain(BRIEF_UNCITED_LABEL);
  });
});

describe("when the join is not sound", () => {
  /** The same brief against a digest that is a different list of the same length. */
  const reordered: DigestArtifact = { ...DIGEST, items: [ITEMS[1]!, ITEMS[0]!] };

  it("withholds every citation and says why", () => {
    const html = briefOnlyHtml([reordered]);
    expect(html).toContain("does not match the roundup on this page");
    // Not one link from the item list, including the ones that would have been
    // in range. A wrong citation is a real link under a claim it does not
    // support, which is worse than none.
    expect(html).not.toContain(BRIEF_CITED_LABEL);
    expect(html).not.toContain('href="https://news.test/prices"');
  });

  it("does not blame the model for a citation DASH withheld", () => {
    // Under a mismatch every paragraph would otherwise wear the uncited label,
    // which reads as the model's failure when it is DASH's refusal to guess.
    const html = briefOnlyHtml([reordered]);
    expect(html).not.toContain(BRIEF_UNCITED_LABEL);
  });

  it("still shows the whole document", () => {
    // The document is what the run produced. Withholding the citations is not a
    // reason to withhold the writing.
    const html = briefOnlyHtml([reordered]);
    expect(html).toContain("Two providers cut their rates this week.");
    expect(html).toContain("Every release was about execution.");
  });

  it("treats a digest that has not arrived as ordinary, not as a fault", () => {
    const html = briefOnlyHtml([]);
    expect(html).toContain("is not here");
    expect(html).toContain("should appear when it finishes");
    expect(html).toContain("Two providers cut their rates this week.");
  });
});

describe("the author's own panel", () => {
  /**
   * The two-renderers trap, held open.
   *
   * `panel.tsx` has its own `switch` on the artifact kind, so adding the brief
   * to `outputs.tsx` alone would leave this surface drawing the developer
   * disclosure instead of the document. Nothing about the type system catches
   * that: both switches have non-throwing defaults, deliberately, so a page
   * cannot crash on a version skew.
   */
  const MANIFEST = {
    agent: { name: AGENT },
    agent_dom: {
      panel: {
        panel_version: 1,
        sections: [
          { id: "latest_brief", type: "report", label: "Latest briefing", artifact_role: "brief" },
        ],
      },
    },
  };

  it("draws the document rather than the record it arrived as", () => {
    const view = buildPanelView(MANIFEST, {
      artifacts: [record(BRIEF), record(DIGEST)],
      facts: { run_count: 1, last_run_at: "2026-08-18T09:02:00.000Z", last_run_status: "completed" },
      resolveCitations: (entry) =>
        entry.artifact.kind === "brief" ? resolveBriefCitations(entry.artifact, [DIGEST]) : null,
    });

    if (view.kind !== "declared") {
      throw new Error(`the fixture did not resolve to a declared panel: ${view.kind}`);
    }

    // `alreadyShown` deliberately empty: MAR-668 has this region yield its body
    // when DASH's own card drew the same artifact above it, and a fixture that
    // passed the id would be testing the yield rather than the renderer.
    const html = decode(renderToStaticMarkup(<AgentPanel view={view} alreadyShown={new Set()} />));
    expect(html).toContain("Two providers cut their rates this week.");
    expect(html).toContain('href="https://news.test/prices"');
  });
});
