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
import { OutputHistory } from "../app/_components/output-history";
import { OUTPUTS_PANEL_COPY, describeArtifactAvailability } from "../lib/copy/artifacts";
import { buildArtifactCards } from "../lib/views/artifacts";
import { plainMoment } from "../lib/copy/when";
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
 * MAR-622's dated history, where MAR-646 left it.
 *
 * `OutputsPanel` no longer collapses anything: the cockpit's Output stage draws
 * one output because the rail beside it is the index, and the run detail page
 * draws one run's outputs flat. The wrapper still owns the behaviour and the
 * author's panel still asks for it, so the coverage moves to the wrapper rather
 * than going with the prop.
 */
describe("an agent's output history", () => {
  const today = new Date(2026, 4, 3, 12);
  const historical = [
    {
      artifact: {
        ...digest,
        artifact_id: "digest-today",
        title: "Today's news",
        generated_at: new Date(2026, 4, 3, 12).toISOString(),
      },
      received_at: new Date(2026, 4, 3, 12, 1).toISOString(),
      stored_bytes: 4210,
    },
    {
      artifact: {
        ...digest,
        artifact_id: "digest-yesterday",
        title: "Yesterday's news",
        generated_at: new Date(2026, 4, 2, 12).toISOString(),
      },
      received_at: new Date(2026, 4, 2, 12, 1).toISOString(),
      stored_bytes: 4210,
    },
    {
      artifact: {
        ...digest,
        artifact_id: "digest-may-first",
        title: "May Day news",
        generated_at: new Date(2026, 4, 1, 12).toISOString(),
      },
      received_at: new Date(2026, 4, 1, 12, 1).toISOString(),
      stored_bytes: 4210,
    },
  ] satisfies RunArtifactRecord[];

  const html = decode(
    renderToStaticMarkup(
      <OutputHistory
        cards={buildArtifactCards(historical, undefined, today)}
        collapsed
        renderCard={(card) => (
          <article className="output-card">
            <h3 className="value">{card.artifact.title}</h3>
          </article>
        )}
      />,
    ),
  );

  it("keeps the newest card open and turns every older card into one dated row", () => {
    expect(html.indexOf("Today's news")).toBeLessThan(html.indexOf("output-history-entry"));
    expect(html.match(/class="output-history-entry"/g)).toHaveLength(2);
    expect(html).toContain(">Yesterday</span>");
    expect(html).toContain(">1 May</span>");
  });

  it("ships every history entry closed with its full card still inside", () => {
    expect(html).not.toMatch(/<details class="output-history-entry" open/);
    expect(html).toContain("Yesterday's news");
    expect(html).toContain("May Day news");
    expect(html.match(/class="output-card/g)).toHaveLength(3);
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

/**
 * The output before the paperwork about the output (MAR-576).
 *
 * This card used to render its four-row provenance receipt and its button
 * *between* the title and the digest. On the AI News Scout — the one agent DASH
 * ships, whose entire purpose is a summary of the news — that made the first
 * four facts under "News from 3 sources" a name, two timestamps and a byte
 * count, and on a 375px viewport it put the first headline 1166px down an 812px
 * screen. The report this issue was filed on reads "I get no AI news from it.
 * Only some text about that it ran or something", which is that ordering
 * described exactly.
 *
 * Index comparison rather than a snapshot, because the claim is about order and
 * nothing else: what has to hold is that a person reading this card downwards
 * reaches the agent's work before they reach DASH's custody of it.
 */
describe("the output comes before the paperwork", () => {
  const headline = "A supervisor for long-running agents lands in beta";

  it("puts the digest above the provenance receipt", () => {
    const html = render();
    expect(html).toContain(headline);
    expect(html.indexOf(headline)).toBeLessThan(html.indexOf(OUTPUTS_PANEL_COPY.receipt.agent));
  });

  it("puts the digest above the save action", () => {
    const html = render(undefined, records(), () => {});
    expect(html.indexOf(headline)).toBeLessThan(html.indexOf(OUTPUTS_PANEL_COPY.download));
  });

  it("folds the receipt behind a disclosure while the output is here", () => {
    const html = render();
    expect(html).toContain(OUTPUTS_PANEL_COPY.receipt_summary);
    // Folded, never dropped: every label is still one press away.
    for (const label of Object.values(OUTPUTS_PANEL_COPY.receipt)) {
      expect(html, label).toContain(label);
    }
  });

  /**
   * A `<details open>` would satisfy every assertion above and put the receipt
   * back exactly where it was on screen.
   */
  it("ships that disclosure closed", () => {
    expect(render()).not.toMatch(/<details class="output-receipt-disclosure" open/);
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
      /*
       * MAR-548: this used to assert the stored `2026-08-05T21:14:02.000Z`
       * appeared, which is how the receipt came to ship a machine instant onto
       * three guided surfaces — the run detail page, this Outputs area, and the
       * panel — beside a `size` worded since MAR-434. Smoke check 6o found it.
       * The provenance still has to survive the output going, which is what
       * this case is about; it just has to survive in DASH's words.
       */
      expect(html).not.toContain("2026-08-05T21:14:02.000Z");
      expect(html).toContain("August 2026 at");
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
/**
 * A digest item's publish date, in DASH's words rather than the machine's.
 *
 * MAR-533 removed raw instants from the Connections page and named the rule —
 * "a timestamp with a `T` and a `Z` in it is the same failure" as a raw
 * identifier — and this call site was missed, so `Hacker News ·
 * 2026-08-05T09:00:00.000Z` kept reaching three surfaces: the run detail page,
 * this panel, and (since MAR-554) the declarative panel's `report` and
 * `outputs` sections. It survived because nothing was looking: no test rendered
 * a digest item that carried one.
 *
 * That is the gap these four assertions close, and the third is the one worth
 * having. `lib/copy/when.ts` returns `null` for anything it cannot read and no
 * function in it ever returns its input, precisely so a malformed value cannot
 * be echoed back onto the screen — which is the path nobody watches.
 */
describe("when a digest item was published", () => {
  const PUBLISHED = "2026-08-05T09:00:00.000Z";

  function withItems(items: DigestArtifact["items"]): string {
    return render(undefined, [
      {
        artifact: { ...digest, items },
        received_at: "2026-08-05T21:14:08.412Z",
        stored_bytes: 4210,
      },
    ]);
  }

  const html = (): string =>
    withItems([
      {
        headline: "A supervisor for long-running agents lands in beta",
        source_name: "Hacker News",
        published_at: PUBLISHED,
      },
    ]);

  it("never ships the machine's own spelling of the moment", () => {
    expect(html()).not.toContain(PUBLISHED);
  });

  it("says it the way a person writes a date", () => {
    // Compared against `plainMoment` rather than a literal: the value is local
    // time, so a literal would pin this test to the timezone it was written in.
    const moment = plainMoment(PUBLISHED);
    expect(moment).not.toBeNull();
    expect(html()).toContain(`Hacker News · ${moment ?? ""}`);
  });

  it("drops the whole segment for a timestamp it cannot read", () => {
    /*
     * Not the input, and not an empty separator either. Echoing the value back
     * would put the exact string this fix removes onto the screen, and a
     * dangling " · " would advertise a missing value a reader can do nothing
     * about — the source name is a complete line on its own.
     */
    const broken = withItems([
      {
        headline: "A supervisor for long-running agents lands in beta",
        source_name: "Hacker News",
        published_at: "the day before yesterday",
      },
    ]);
    expect(broken).not.toContain("the day before yesterday");
    expect(broken).toContain("Hacker News");
    expect(broken).not.toContain("Hacker News ·");
  });

  it("says nothing at all when the item carries no date", () => {
    const undated = withItems([
      { headline: "A supervisor for long-running agents lands in beta", source_name: "Hacker News" },
    ]);
    expect(undated).toContain("Hacker News");
    expect(undated).not.toContain("Hacker News ·");
  });
});
