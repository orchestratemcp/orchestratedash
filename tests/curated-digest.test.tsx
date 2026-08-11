/**
 * A digest a model grouped, rendered, and every sentence DASH says about one
 * (MAR-619).
 *
 * Two things that can only be checked here, and one that could have been
 * checked in a copy test and is checked against the *rendered* markup on
 * purpose:
 *
 * 1. **No item is lost.** The grouping is a reading of the items, not a
 *    replacement for them, so an item no group claimed is still on screen —
 *    the same rule `DigestBody` keeps for an uncited item, and the same failure
 *    it is guarding against: a digest that looks tidier because something was
 *    quietly dropped.
 * 2. **A model's words are not the document outline.** Group titles are
 *    untrusted text, so they must not be headings — a person navigating by
 *    heading would be navigating through whatever a provider returned.
 * 3. **The refusals are plain language.** Asserted over the rendered surface
 *    rather than over the copy module alone, because a component printing an
 *    id beside a clean sentence is exactly the defect MAR-423 calls "verified
 *    by inspection".
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DigestBody } from "../app/_components/digest";
import {
  CURATED_HEADING,
  CURATED_REMAINDER_HEADING,
  CURATION_REFUSALS,
  describeNotCurated,
  describeRunSpend,
  everyCurationSentence,
} from "../lib/copy/curation";
import type { CurationRefusal, DigestArtifact } from "../lib/contracts";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "ai-news-scout";
const TITLE = "AI News Scout";

function digest(curation?: DigestArtifact["curation"]): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: AGENT,
    run_id: "run-mar619",
    artifact_id: "digest-mar619",
    title: "News from 3 sources",
    generated_at: "2026-08-11T08:00:00.000Z",
    items: [
      {
        headline: "A lab shipped a smaller model",
        source_name: "Hacker News",
        item_url: "https://example.invalid/one",
      },
      {
        headline: "A round closed at a supervision startup",
        source_name: "Reuters",
        item_url: "https://example.invalid/two",
      },
      {
        headline: "An unrelated thing happened",
        source_name: "Breaking Defense",
        item_url: "https://example.invalid/three",
      },
    ],
    curation,
  };
}

/**
 * The rendered markup, with HTML entities turned back into the characters they
 * stand for.
 *
 * React escapes an apostrophe to `&#x27;`, so a sentence like *"Pick a model on
 * AI News Scout's page"* does not appear in the markup as written. Asserting on
 * the escaped form would make every one of these tests a test of React's
 * escaping; asserting on the unescaped form keeps them tests of DASH's copy.
 */
function render(artifact: DigestArtifact): string {
  return renderToStaticMarkup(
    <DigestBody artifact={artifact} agent={TITLE} grounding={null} service="OpenRouter" />,
  )
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");
}

/* ---------------------------------------------------------------------- *
 * A digest a model grouped
 * ---------------------------------------------------------------------- */

describe("a curated digest", () => {
  const curated = digest({
    state: "curated",
    overview: "Two threads today: a model release and a funding round.",
    model: "openai/gpt-5-mini",
    groups: [
      {
        label: "New models",
        summary: "One lab shipped something smaller.",
        items: [0],
      },
      { label: "Money", summary: "One round closed.", items: [1] },
    ],
  });

  it("draws the grouping and keeps every item's own link", () => {
    const html = render(curated);
    expect(html).toContain(CURATED_HEADING);
    expect(html).toContain("Two threads today");
    expect(html).toContain("New models");
    expect(html).toContain("One lab shipped something smaller.");
    // The whole request in one assertion: every item keeps the link to where it
    // came from, inside a group as much as outside one.
    expect(html).toContain('href="https://example.invalid/one"');
    expect(html).toContain('href="https://example.invalid/two"');
  });

  it("shows the item no group claimed, under DASH's own heading", () => {
    const html = render(curated);
    // The third item is in no group. It is still here, and it is introduced —
    // a remainder with no heading would read as a second, unexplained digest.
    expect(html).toContain("An unrelated thing happened");
    expect(html).toContain('href="https://example.invalid/three"');
    expect(html).toContain(CURATED_REMAINDER_HEADING);
  });

  it("draws no remainder heading when the grouping covered everything", () => {
    const html = render(
      digest({
        state: "curated",
        groups: [{ label: "Everything", items: [0, 1, 2] }],
      }),
    );
    expect(html).not.toContain(CURATED_REMAINDER_HEADING);
    expect(html).toContain("An unrelated thing happened");
  });

  it("never draws an item twice", () => {
    const html = render(curated);
    // Once inside its group and nowhere else. A component that drew the flat
    // list underneath the grouping would double every headline on the page.
    expect(html.split("A lab shipped a smaller model")).toHaveLength(2);
  });

  it("does not put a model's words in the document outline", () => {
    const html = render(curated);
    // The group's label is not a heading of any level. `DigestItem`'s own `h3`
    // is, and stays where MAR-434 put it.
    expect(html).not.toMatch(/<h[1-6][^>]*>New models/);
    expect(html).toMatch(/<h3>[^<]*A lab shipped a smaller model|<h3><a [^>]*>A lab shipped/);
  });

  it("says who wrote the grouping, on the surface", () => {
    const html = render(curated);
    // Decision-changing, so it is on the surface: it tells a reader how much of
    // what they are looking at DASH is standing behind.
    expect(html).toContain("A model grouped these");
    expect(html).toContain("openai/gpt-5-mini");
    expect(html).toContain("not something the model wrote");
  });

  it("draws no control anywhere, because it renders inside the panel", () => {
    /*
     * ADR 0008 bars **any** control from the declarative panel region, and
     * `DigestBody` is one of the components that renders there.
     *
     * This assertion exists because the first draft of this feature failed it.
     * The mechanism sentence was behind an `InfoNote`, `InfoNote` is a
     * `<button>`, and the packaged capture counted two of them per frame in the
     * panel — which is the harness catching something no unit test was looking
     * for. It is a unit test now.
     */
    expect(render(curated)).not.toContain("<button");
    expect(render(digest({ state: "not_curated", reason: "not_connected" }))).not.toContain(
      "<button",
    );
  });

  it("draws nothing at all for a digest that predates the feature", () => {
    const html = render(digest(undefined));
    expect(html).not.toContain(CURATED_HEADING);
    // And says nothing about a summary being missing, because nothing tried.
    // Absent is not `not_curated` — see `DigestCuration`.
    expect(html).not.toContain("was not summarised");
    expect(html).toContain("A lab shipped a smaller model");
  });

  it("survives a group naming an item this artifact does not have", () => {
    // Unreachable through the agent, which checks indexes against its own list.
    // Reaching it means an artifact from a build that disagreed with this one,
    // and a page a person is reading must not crash on the day they do.
    const html = render(
      digest({ state: "curated", groups: [{ label: "Ghosts", items: [0, 99] }] }),
    );
    expect(html).toContain("Ghosts");
    expect(html).toContain("A lab shipped a smaller model");
  });
});

/* ---------------------------------------------------------------------- *
 * A digest nothing grouped
 * ---------------------------------------------------------------------- */

describe("a digest that was not summarised", () => {
  it("says why, and shows the whole digest anyway", () => {
    for (const reason of CURATION_REFUSALS) {
      const html = render(digest({ state: "not_curated", reason }));
      const recovery = describeNotCurated(reason, { agent: TITLE, service: "OpenRouter" });
      expect(html).toContain(recovery.headline);
      expect(html).toContain(recovery.next_action);
      // The digest is complete in every one of the six. That is the honest
      // degradation this feature promised: a run that could not summarise still
      // collected the news and still links every item.
      expect(html).toContain("A lab shipped a smaller model");
      expect(html).toContain('href="https://example.invalid/three"');
    }
  });

  it("never blames the reader for an agent that was not built to summarise", () => {
    const recovery = describeNotCurated("no_model_connection", {
      agent: TITLE,
      service: "OpenRouter",
    });
    expect(recovery.actor).toBe("dash");
    expect(recovery.next_action).toContain("Nothing to do");
  });

  it("says whether money changed hands, in every reason", () => {
    /*
     * The first thing anybody wants to know about a feature that spends their
     * money is whether this particular failure cost them anything. Five of the
     * six get to say nothing was charged; `unreadable` is the one where the
     * money is gone, and it says so rather than reporting a failed run.
     */
    for (const reason of CURATION_REFUSALS) {
      const recovery = describeNotCurated(reason, { agent: TITLE, service: "OpenRouter" });
      const said = `${recovery.headline} ${recovery.meaning}`;
      expect(said).toMatch(/charged|bill|paid|no accounts/i);
    }
    const lost = describeNotCurated("unreadable", { agent: TITLE, service: "OpenRouter" });
    expect(lost.meaning).toContain("bill");
  });
});

/* ---------------------------------------------------------------------- *
 * Before the press
 * ---------------------------------------------------------------------- */

describe("the spend disclosure at the run trigger", () => {
  it("names no amount, because DASH does not have one", () => {
    const sentence = describeRunSpend({ agent: TITLE, service: "OpenRouter" });
    expect(sentence).not.toBeNull();
    // No currency symbol anywhere. DASH cannot know what a run will cost before
    // it runs, and two of the three providers never say afterwards either — so
    // a figure here could only be invented, which is what `describeAmount`
    // exists to refuse.
    expect(sentence).not.toMatch(/[$£€]/);
    expect(sentence).toContain("your own");
    expect(sentence).toContain("OpenRouter");
  });

  it("is silent for an agent that cannot spend", () => {
    // Nearly every agent. An unconditional warning about money would be a
    // warning about nothing on almost every screen in DASH.
    expect(describeRunSpend({ agent: TITLE, service: null })).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * The copy sweep
 * ---------------------------------------------------------------------- */

describe("everything this feature says", () => {
  it("is plain language with no identifier in it", () => {
    expectPlainLanguage(everyCurationSentence());
  });

  it("covers every reason, so a new one cannot slip past the gate", () => {
    // The shape `everyConnectSentence` established: derived from the union
    // rather than written out, so a reason added without a sentence fails here
    // rather than reaching a screen unworded.
    const swept = everyCurationSentence().join(" ");
    for (const reason of CURATION_REFUSALS satisfies readonly CurationRefusal[]) {
      const recovery = describeNotCurated(reason, { agent: TITLE, service: "OpenRouter" });
      expect(swept).toContain(recovery.headline);
    }
  });
});
