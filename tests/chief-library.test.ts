/**
 * What the chief may read out of the fleet, and in what order (MAR-744).
 *
 * The interesting half is the ordering. `selectMaterial`'s fallback arm takes
 * the caller's order, which is right for one agent whose artifacts arrive
 * newest-first and wrong for a fleet: concatenating three agents' lists that way
 * puts all of the first agent's oldest items ahead of the second agent's newest,
 * so *"pull out the most current news"* would be answered from whichever agent
 * happened to sort first. That is the defect this file exists to pin.
 */

import { describe, expect, it } from "vitest";

import {
  chiefLibrary,
  MAX_LIBRARY_ITEMS,
  renderChiefItem,
  renderChiefMaterial,
  selectChiefMaterial,
  type ChiefAgentOutputs,
} from "../lib/chief/library";
import type { BriefArtifact, DigestArtifact, DraftArtifact } from "../lib/contracts";

function digest(over: Partial<DigestArtifact> & { agent: string; generated_at: string }): DigestArtifact {
  return {
    kind: "digest",
    artifact_version: 1,
    run_id: `run-${over.generated_at}`,
    artifact_id: `artifact-${over.agent}-${over.generated_at}`,
    title: "Roundup",
    items: [{ headline: `Story from ${over.generated_at}`, source_name: "Google News" }],
    ...over,
  };
}

function outputs(agent: string, title: string, dates: readonly string[]): ChiefAgentOutputs {
  return {
    agent,
    title,
    artifacts: dates.map((generated_at) => digest({ agent, generated_at })),
  };
}

describe("newest means newest across the whole fleet", () => {
  it("interleaves two agents by when each report was saved", () => {
    const library = chiefLibrary([
      outputs("scout", "AI agent news", ["2026-08-24T06:00:00.000Z", "2026-07-01T06:00:00.000Z"]),
      outputs("budget", "Budget digest", ["2026-08-23T06:00:00.000Z", "2026-08-01T06:00:00.000Z"]),
    ]);

    expect(library.map((item) => item.saved_at)).toEqual([
      "2026-08-24T06:00:00.000Z",
      "2026-08-23T06:00:00.000Z",
      "2026-08-01T06:00:00.000Z",
      "2026-07-01T06:00:00.000Z",
    ]);
    // The second agent's newest is ahead of the first agent's oldest, which is
    // the whole of the ordering claim.
    expect(library[1]?.agent).toBe("budget");
  });

  /*
   * A selection a person cannot predict is a selection they cannot check, so
   * ties break on a stable value rather than on which agent was read first.
   */
  it("orders two reports saved at the same moment the same way twice", () => {
    const at = "2026-08-24T06:00:00.000Z";
    const one = chiefLibrary([outputs("b", "B", [at]), outputs("a", "A", [at])]);
    const two = chiefLibrary([outputs("a", "A", [at]), outputs("b", "B", [at])]);
    expect(one.map((item) => item.agent)).toEqual(two.map((item) => item.agent));
  });

  it("bounds the library so a long history stays a small push", () => {
    const many = Array.from({ length: 400 }, (_, i) =>
      digest({ agent: "scout", generated_at: new Date(1_760_000_000_000 - i * 1000).toISOString() }),
    );
    const library = chiefLibrary([{ agent: "scout", title: "Scout", artifacts: many }]);
    expect(library).toHaveLength(MAX_LIBRARY_ITEMS);
    // What fell off the end is the oldest thing in the fleet.
    expect(library[0]?.saved_at).toBe(new Date(1_760_000_000_000).toISOString());
  });
});

describe("which kinds of output count", () => {
  const brief: BriefArtifact = {
    kind: "brief",
    artifact_version: 2,
    agent: "scout",
    run_id: "run-2",
    artifact_id: "artifact-brief",
    title: "This week",
    generated_at: "2026-08-24T06:05:00.000Z",
    document: {
      sections: [
        { heading: "Tariffs", paragraphs: [{ body: "Duties moved twice." }] },
        { heading: "Nothing here", paragraphs: [] },
      ],
    },
    derived_from: { artifact_id: "a", run_id: "run-2", item_count: 1, items_digest: "a".repeat(64) },
  };

  const draft: DraftArtifact = {
    kind: "draft",
    artifact_version: 1,
    agent: "scout",
    run_id: "run-2",
    artifact_id: "artifact-draft",
    title: "A reply",
    generated_at: "2026-08-24T06:10:00.000Z",
    draft: {
      to: ["someone@example.com"],
      subject: "Hello",
      body: "Text",
      placement: { where: "dash_only" },
    },
  };

  it("reads a brief's sections as citable items", () => {
    const library = chiefLibrary([{ agent: "scout", title: "Scout", artifacts: [brief] }]);
    expect(library).toHaveLength(1);
    expect(library[0]?.from).toBe("brief");
    expect(library[0]?.headline).toBe("Tariffs");
    expect(library[0]?.summary).toBe("Duties moved twice.");
    // A brief's paragraphs carry no address by contract, so there is nothing to
    // link and the citation says so rather than linking somewhere wrong.
    expect(library[0]?.item_url).toBeNull();
  });

  it("drops a section with no paragraphs rather than citing an empty one", () => {
    const library = chiefLibrary([{ agent: "scout", title: "Scout", artifacts: [brief] }]);
    expect(library.map((item) => item.headline)).not.toContain("Nothing here");
  });

  /*
   * `savedThingsForAgent`'s rule, inherited: a draft is a thing an agent
   * *wrote*, not a thing it *found*, and answering "what did you find" out of
   * it would be quoting the agent back to itself.
   */
  it("ignores a draft", () => {
    const library = chiefLibrary([{ agent: "scout", title: "Scout", artifacts: [draft] }]);
    expect(library).toEqual([]);
  });
});

describe("selecting what one question reads", () => {
  const library = chiefLibrary([
    {
      agent: "scout",
      title: "AI agent news",
      artifacts: [
        {
          ...digest({ agent: "scout", generated_at: "2026-08-24T06:00:00.000Z" }),
          items: [
            { headline: "Tariffs reshape the chip supply chain", source_name: "Google News" },
            { headline: "An agent framework ships", source_name: "Hacker News" },
          ],
        },
      ],
    },
  ]);

  it("matches on a distinctive word", () => {
    const selection = selectChiefMaterial(library, "what did you find about tariffs");
    expect(selection.basis).toBe("matched");
    expect(selection.terms).toContain("tariffs");
    expect(selection.chosen[0]?.headline).toContain("Tariffs");
  });

  /*
   * The arm Henrik's own sentence lands in. `questionTerms` drops `news`,
   * `latest` and `recent` as words that appear in every report ever written, so
   * this question has nothing to match on -- and the newest items are exactly
   * what it asked for rather than a fallback from a failed search.
   */
  it("falls to newest for a question with nothing distinctive in it", () => {
    const selection = selectChiefMaterial(library, "pull out the most current news");
    expect(selection.basis).toBe("newest");
    expect(selection.terms).toEqual([]);
    expect(selection.chosen.length).toBeGreaterThan(0);
  });

  it("selects by the agent's name as well as by the subject", () => {
    const selection = selectChiefMaterial(library, "what did the agent news scout collect");
    expect(selection.basis).toBe("matched");
  });

  it("says there is nothing rather than selecting from an empty fleet", () => {
    const selection = selectChiefMaterial([], "pull out the most current news");
    expect(selection.basis).toBe("nothing_saved");
    expect(selection.chosen).toEqual([]);
    expect(renderChiefMaterial(selection)).toBe("");
  });
});

describe("what the model is sent", () => {
  const item = chiefLibrary([
    {
      agent: "scout",
      title: "AI agent news",
      artifacts: [
        {
          ...digest({ agent: "scout", generated_at: "2026-08-24T06:00:00.000Z" }),
          items: [
            {
              headline: "Tariffs reshape the chip supply chain",
              summary: "Two governments moved.",
              source_name: "Google News",
              item_url: "https://collected.example/story",
              published_at: "2026-08-24T05:00:00.000Z",
            },
          ],
        },
      ],
    },
  ])[0];

  it("numbers an item and names the agent that found it", () => {
    const rendered = renderChiefItem(item!, 1);
    expect(rendered).toContain("[1] Tariffs reshape the chip supply chain");
    expect(rendered).toContain("Found by: AI agent news");
    expect(rendered).toContain("Source: Google News");
    expect(rendered).toContain("Two governments moved.");
  });

  /*
   * The grounding rule. An address in the material is an address the model can
   * repeat into an answer, and a person reading a reply cannot tell a link DASH
   * collected from a link a model assembled.
   */
  it("sends no address", () => {
    expect(renderChiefItem(item!, 1)).not.toContain("https://");
    expect(renderChiefItem(item!, 1)).not.toContain("collected.example");
  });

  it("keeps the address on the item, for the citation to carry", () => {
    expect(item?.item_url).toBe("https://collected.example/story");
  });
});
