/**
 * The Outputs panel, rendered (MAR-434).
 *
 * `tests/outputs-panel.test.ts` holds the vocabulary and the view model. This
 * one renders the actual component, because three of MAR-434's requirements are
 * about the *output of the renderer* and cannot be checked any other way:
 *
 * 1. every output is drawn, not just the newest;
 * 2. the provenance receipt survives an output being gone;
 * 3. raw identifiers appear **only** inside the developer disclosure.
 *
 * The third is the one that needed rendering. A test over the copy module can
 * prove the sentences are clean and still miss a component printing an
 * `artifact_id` into a heading, which is exactly the failure MAR-423 calls
 * "verified by inspection".
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { OutputsPanel } from "../app/_components/outputs";
import { OUTPUTS_PANEL_COPY, describeArtifactAvailability } from "../lib/copy/artifacts";
import { buildArtifactCards } from "../lib/views/artifacts";
import type { ArtifactAvailability } from "../lib/copy/artifacts";
import type { DigestArtifact, DraftArtifact } from "../lib/contracts";
import type { RunArtifactRecord } from "../lib/store";

const AGENT = "ai-agent-news";
const RUN_ID = "run-mar434-demo";
const DIGEST_ID = "digest-2026-08-05";
const DRAFT_ID = "draft-2026-08-05";

const digest: DigestArtifact = {
  artifact_version: 1,
  kind: "digest",
  agent: AGENT,
  run_id: RUN_ID,
  artifact_id: DIGEST_ID,
  title: "AI agent news for 5 August",
  generated_at: "2026-08-05T21:14:02.000Z",
  sources_fetched: [
    {
      source_name: "Hacker News",
      source_url: "https://hn.algolia.com/api/v1/search",
      status: "ok",
      item_count: 1,
    },
  ],
  items: [{ headline: "A supervisor for long-running agents lands in beta" }],
};

const draft: DraftArtifact = {
  artifact_version: 1,
  kind: "draft",
  agent: AGENT,
  run_id: RUN_ID,
  artifact_id: DRAFT_ID,
  title: "Reply to Maria about the pilot",
  generated_at: "2026-08-05T21:14:05.000Z",
  draft: {
    to: ["maria@example.com"],
    subject: "Re: pilot scope",
    body: "Thanks for the note.",
    placement: { where: "provider_draft", service: "Gmail" },
  },
};

function records(): RunArtifactRecord[] {
  return [
    { artifact: digest, received_at: "2026-08-05T21:14:08.412Z", stored_bytes: 4210 },
    { artifact: draft, received_at: "2026-08-05T21:14:09.004Z", stored_bytes: 812 },
  ];
}

/**
 * Undo React's entity escaping so an assertion can be written in the words the
 * copy module actually holds. React renders `DASH's` as `DASH&#x27;s`, which is
 * correct output and a miserable thing to write a test against — and writing
 * the escaped form into the test would mean the assertion no longer looks like
 * the sentence a person reads.
 *
 * Only the five characters React escapes, and applied after the structural
 * matching below, which keys off tag and class names that contain none of them.
 */
function decode(html: string): string {
  return html
    .replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function render(
  resolve?: (record: RunArtifactRecord) => ArtifactAvailability,
  input: RunArtifactRecord[] = records(),
  onDownload?: () => void,
): string {
  return decode(
    renderToStaticMarkup(
      <OutputsPanel
        cards={buildArtifactCards(input, resolve)}
        grounding={null}
        onDownload={onDownload}
      />,
    ),
  );
}

/** Everything outside the `<details>` blocks — i.e. what a normal person sees. */
function guidedPathOf(html: string): string {
  return html.replace(/<details class="output-developer">[\s\S]*?<\/details>/g, "");
}

describe("every output is drawn", () => {
  it("renders both artifacts, not just the newest", () => {
    /*
     * The defect this slice fixes. The page rendered `artifacts[0]`, so a run
     * that produced a digest and a reply showed one of them and said nothing
     * about the other.
     */
    const html = render();
    expect(html).toContain("AI agent news for 5 August");
    expect(html).toContain("Reply to Maria about the pilot");
    expect(html.match(/class="output-card/g)).toHaveLength(2);
  });

  it("names each one by its role rather than its kind", () => {
    const html = guidedPathOf(render());
    expect(html).toContain("Summary");
    expect(html).toContain("Draft reply");
    // The internal word for a draft must not reach the guided path.
    expect(html).not.toContain(">draft<");
  });

  it("carries the no-send safeguard onto the card", () => {
    expect(render()).toContain("in your drafts, not sent");
  });

  it("says so plainly when a run produced nothing", () => {
    expect(render(undefined, [])).toContain(OUTPUTS_PANEL_COPY.empty);
  });
});

/**
 * MAR-434's acceptance criterion, at the point a person meets it.
 *
 * The interesting assertions are the negative ones. A surface that cannot act
 * must not draw a dead button, and an output that is not there must not offer to
 * fetch itself — the four unavailable states each have a next action and none of
 * them is "download".
 */
describe("saving a copy", () => {
  const noop = (): void => {};

  it("offers the action on every output that is actually here", () => {
    const html = render(undefined, records(), noop);
    expect(html).toContain(OUTPUTS_PANEL_COPY.download);
    expect(html.match(/Save a copy/g)).toHaveLength(2);
  });

  it("draws no button at all where the window cannot act", () => {
    // Not a disabled button: a greyed-out Save beside a file that exists reads
    // as a claim about the file rather than about the window.
    expect(render()).not.toContain(OUTPUTS_PANEL_COPY.download);
  });

  it.each(["missing", "moved", "quarantined", "deleted"] as const)(
    "does not offer to fetch an output that is %s",
    (availability) => {
      const html = render(() => availability, records(), noop);
      expect(html).not.toContain(OUTPUTS_PANEL_COPY.download);
      // The recovery is what is offered instead, and it still has a next action.
      expect(html).toContain(
        describeArtifactAvailability(availability, { title: "AI agent news for 5 August" })
          ?.next_action ?? "",
      );
    },
  );

  it("keeps the vocabulary off the developer disclosure", () => {
    // "Save a copy", not "Download": the file is already on this computer, and
    // nothing crosses a network.
    expect(guidedPathOf(render(undefined, records(), noop))).toContain("Save a copy");
  });
});

describe("raw identifiers stay behind the disclosure", () => {
  it("prints no artifact id or run id on the guided path", () => {
    /*
     * MAR-434's constraint, and the reason it needs a render: the ids are
     * exactly the strings that want a monospace slot, and the panel gives one
     * to the display name instead.
     */
    const guided = guidedPathOf(render());
    for (const identifier of [DIGEST_ID, DRAFT_ID, RUN_ID]) {
      expect(guided, identifier).not.toContain(identifier);
    }
  });

  it("still offers them to a developer who needs them", () => {
    const html = render();
    expect(html).toContain(OUTPUTS_PANEL_COPY.developer_summary);
    for (const identifier of [DIGEST_ID, DRAFT_ID, RUN_ID]) {
      expect(html, identifier).toContain(identifier);
    }
  });
});

describe("the receipt survives an output going missing", () => {
  it.each(["missing", "moved", "quarantined", "deleted"] as const)(
    "keeps provenance when the output is %s",
    (state) => {
      /*
       * Density is allowed to change spacing and nothing else, and an output
       * being gone is not a licence to drop its provenance either — the receipt
       * is how somebody works out what happened to it.
       */
      const html = render(() => state);
      for (const label of Object.values(OUTPUTS_PANEL_COPY.receipt)) {
        expect(html, label).toContain(label);
      }
      expect(html).toContain("2026-08-05T21:14:02.000Z");
      expect(html).toContain("4.2 kB");
    },
  );

  it.each(["missing", "moved", "quarantined", "deleted"] as const)(
    "renders all three parts of the %s recovery",
    (state) => {
      // Three fields rather than one string precisely so a surface cannot
      // render two and drop the third — which is always the next action.
      const recovery = describeArtifactAvailability(state, { title: digest.title })!;
      const html = render(() => state);
      expect(html).toContain(recovery.headline);
      expect(html).toContain(recovery.meaning);
      expect(html).toContain(recovery.next_action);
    },
  );

  it("does not draw a preview under a notice saying the output is gone", () => {
    const html = render(() => "moved");
    expect(html).not.toContain("A supervisor for long-running agents lands in beta");
  });
});

describe("a kind DASH cannot draw", () => {
  const unknown = { ...digest, kind: "spreadsheet" } as unknown as DigestArtifact;
  const html = (): string =>
    render(undefined, [
      { artifact: unknown, received_at: "2026-08-05T21:14:08.412Z", stored_bytes: 4210 },
    ]);

  it("offers the record instead of pretending to preview it", () => {
    expect(html()).toContain(OUTPUTS_PANEL_COPY.reveal);
  });

  it("does not report it to the user as damage", () => {
    const guided = guidedPathOf(html());
    for (const word of ["error", "broken", "failed", "corrupt", "invalid"]) {
      expect(guided.toLowerCase(), word).not.toContain(word);
    }
  });

  it("still shows its provenance", () => {
    expect(html()).toContain("4.2 kB");
  });
});
