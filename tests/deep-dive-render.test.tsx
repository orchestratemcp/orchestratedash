/**
 * The deep dive, drawn (MAR-691).
 *
 * `deep_dive.text` reached DASH on the digest artifact and nothing drew it —
 * see `docs/research/mar-689-agent-output-quality.md` §D1. This is the render
 * test for the fix, on the same terms `tests/curated-digest.test.tsx` checks
 * `curation` on: rendered markup, not the copy module alone, because a
 * component that dropped a field or leaked a link would still pass a test that
 * only exercised `lib/copy/deep-dive.ts`.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DigestBody } from "../app/_components/digest";
import { DEEP_DIVE_HEADING, describeDeepDiveAuthor } from "../lib/copy/deep-dive";
import type { DigestArtifact } from "../lib/contracts";

const AGENT = "competitor-scout";

function digest(deepDive?: DigestArtifact["deep_dive"]): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: AGENT,
    run_id: "run-mar691",
    artifact_id: "digest-mar691",
    title: "Competitor watch for 18 August",
    generated_at: "2026-08-18T08:00:00.000Z",
    items: [
      {
        headline: "A rival shipped a pricing change",
        source_name: "Rival blog",
        item_url: "https://example.invalid/pricing",
      },
    ],
    deep_dive: deepDive,
  };
}

/** React-escaped entities turned back into the characters they stand for. */
function render(artifact: DigestArtifact): string {
  return renderToStaticMarkup(<DigestBody artifact={artifact} grounding={null} />)
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

describe("a deep dive a model wrote", () => {
  const written = digest({
    state: "written",
    model: "openai/gpt-5-mini",
    text: "Item 1 reports a pricing change. Buyers are asking about downgrade paths.",
  });

  it("draws the heading and the text", () => {
    const html = render(written);
    expect(html).toContain(DEEP_DIVE_HEADING);
    expect(html).toContain(
      "Item 1 reports a pricing change. Buyers are asking about downgrade paths.",
    );
  });

  it("says a model wrote it, and names the model when the agent reported one", () => {
    const html = render(written);
    expect(html).toContain("Written by a language model");
    expect(html).toContain("openai/gpt-5-mini");
    expect(html).toContain(describeDeepDiveAuthor("openai/gpt-5-mini"));
  });

  it("says a model wrote it even with no model named", () => {
    const html = render(
      digest({ state: "written", text: "A closer look with no reported model." }),
    );
    expect(html).toContain("Written by a language model");
    expect(html).toContain(describeDeepDiveAuthor(undefined));
  });

  it("carries no link, even when the model's own text contains an address", () => {
    // The citation-integrity property this exists to protect: the text is
    // rendered as a paragraph, never as markup and never through
    // `dangerouslySetInnerHTML`, so a URL in the model's own words stays
    // inert text rather than becoming a clickable anchor it never earned.
    const html = render(
      digest({
        state: "written",
        text: "See https://not-a-real-source.example for more, item 1 says so.",
      }),
    );
    expect(html).toContain("https://not-a-real-source.example");
    expect(html).not.toContain('href="https://not-a-real-source.example"');
  });

  it("puts the deep dive above the item it discusses", () => {
    const html = render(written);
    expect(html.indexOf(DEEP_DIVE_HEADING)).toBeLessThan(
      html.indexOf("A rival shipped a pricing change"),
    );
  });

  it("does not put the model's words in the document outline", () => {
    // Same rule `Curation`'s group label keeps: untrusted text must not become
    // a heading a person could navigate the page by.
    const html = render(written);
    expect(html).not.toMatch(/<h[1-6][^>]*>Item 1 reports a pricing change/);
  });

  it("draws no control anywhere, because it renders inside the panel", () => {
    // ADR 0008 bars any control from the declarative panel region, and
    // `DigestBody` is one of the components that renders there.
    expect(render(written)).not.toContain("<button");
  });
});

describe("a deep dive that was not written", () => {
  it("draws nothing at all — most runs have nothing to say here", () => {
    const html = render(
      digest({ state: "not_written", reason: "nothing_picked" }),
    );
    expect(html).not.toContain(DEEP_DIVE_HEADING);
    expect(html).toContain("A rival shipped a pricing change");
  });

  it("still keeps `state` apart from absence, so a future surface can tell them apart", () => {
    for (const reason of [
      "nothing_picked",
      "nothing_found",
      "no_model_connection",
      "not_connected",
      "no_model_chosen",
      "needs_a_person",
      "unreadable",
      "refused",
    ] as const) {
      const html = render(digest({ state: "not_written", reason }));
      expect(html, reason).not.toContain(DEEP_DIVE_HEADING);
    }
  });
});

describe("a digest with no deep dive at all", () => {
  it("draws nothing, the same as a digest written before the feature existed", () => {
    const html = render(digest(undefined));
    expect(html).not.toContain(DEEP_DIVE_HEADING);
    expect(html).not.toContain("Written by a language model");
    expect(html).toContain("A rival shipped a pricing change");
  });
});
