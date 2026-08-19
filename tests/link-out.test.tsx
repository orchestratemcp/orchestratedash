/**
 * Links a person can press, and the ones DASH still refuses to draw
 * (MAR-698).
 *
 * ## Two properties, and this file exists because they pull in opposite
 * directions
 *
 * 1. **Every address DASH collected becomes a link.** Item headlines, the
 *    source list under a digest, and a brief's Written-from citations — in both
 *    renderers, because `outputs.tsx` and `panel.tsx` each draw an artifact
 *    card and a fix to one is not a fix to the other.
 * 2. **Nothing a model wrote becomes a link.** That property is structural
 *    rather than checked: the model's characters are rendered as text, so there
 *    is no anchor for a URL inside a paragraph to be. MAR-698 is explicit that
 *    this change must not soften it, so it is asserted here as well as in
 *    `tests/deep-dive-render.test.tsx`, from the surface this issue touched.
 *
 * ## What cannot be tested here, and where it is tested instead
 *
 * The suite renders through `renderToStaticMarkup`, which drops handlers and
 * dispatches no events — there is no DOM in this repository's tests. So the
 * interception is tested by calling `followCollectedLink` directly, which is
 * why it is exported at all. Whether main will actually open a given address is
 * `tests/outbound-link.test.ts`, over the pure decision; whether the command
 * carries no path is `tests/shell.test.ts`, over the dispatcher.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LinkOut, followCollectedLink } from "../app/_components/link-out";
import { DigestBody } from "../app/_components/digest";
import type { DigestArtifact } from "../lib/contracts";

const AGENT = "ai-agent-news";
const RUN_ID = "run-mar698";

function digest(overrides: Partial<DigestArtifact> = {}): DigestArtifact {
  return {
    artifact_version: 1,
    kind: "digest",
    agent: AGENT,
    run_id: RUN_ID,
    artifact_id: "digest-mar698",
    title: "AI agent news",
    generated_at: "2026-08-18T09:00:00.000Z",
    sources_fetched: [
      {
        source_name: "Hacker News",
        source_url: "https://hn.algolia.com/api/v1/search",
        status: "ok",
        item_count: 2,
      },
    ],
    items: [
      {
        headline: "A supervisor for long-running agents lands in beta",
        item_url: "https://news.test/supervision",
      },
    ],
    ...overrides,
  } as DigestArtifact;
}

function render(artifact: DigestArtifact): string {
  return renderToStaticMarkup(DigestBody({ artifact, grounding: null }));
}

describe("an address DASH collected", () => {
  it("is drawn as an anchor with the headline as its text", () => {
    const html = render(digest());
    expect(html).toContain('href="https://news.test/supervision"');
    // The headline is the link text and the address is what the anchor
    // carries — `DigestItem`'s rule, unchanged.
    expect(html).toContain(">A supervisor for long-running agents lands in beta</a>");
    expect(html).not.toContain(">https://news.test/supervision<");
  });

  /**
   * MAR-698's other half of the complaint. This list named where the digest
   * came from and gave no way to go there — the address was in the markup only
   * as a React key.
   */
  it("is drawn on the source list too, which had no link at all", () => {
    const html = render(digest());
    expect(html).toContain('href="https://hn.algolia.com/api/v1/search"');
    expect(html).toContain(">Hacker News</a>");
  });

  it("carries the rel that stops the opened page reaching back", () => {
    expect(render(digest())).toContain('rel="noreferrer noopener"');
  });
});

describe("an address DASH will not open", () => {
  /**
   * The refusal that keeps this fix from shipping the defect it repairs.
   *
   * An anchor whose press main declines looks exactly like a link that does
   * nothing, which is Henrik's original report. So a plain-`http` address is
   * drawn as text: the headline is still there and the record still holds the
   * address, and nothing on screen promises a press that cannot work.
   */
  it("keeps the headline and draws no anchor for it", () => {
    const html = render(
      digest({
        items: [{ headline: "An item from a plain http feed", item_url: "http://news.test/a" }],
      }),
    );

    expect(html).toContain("An item from a plain http feed");
    expect(html).not.toContain('href="http://news.test/a"');
    // The headline itself, specifically. The fixture's source list still
    // carries its own secure address and is still a link, which is the point:
    // this refusal is per address rather than a switch on the whole card.
    expect(html).toContain("<h3>An item from a plain http feed</h3>");
  });

  it.each(["javascript:alert(1)", "file:///C:/Windows/System32/cmd.exe", "dash://agents/x"])(
    "draws no anchor for %s",
    (address) => {
      const html = renderToStaticMarkup(LinkOut({ href: address, children: "Press me" }));
      expect(html).toBe("Press me");
    },
  );
});

describe("what a model wrote stays linkless", () => {
  /**
   * The citation-integrity property, asserted from the surface MAR-698
   * changed.
   *
   * Only links DASH itself collected become clickable. A URL a model put in its
   * own prose is rendered as characters — no markup step, no
   * `dangerouslySetInnerHTML` — so there is no anchor for this change to have
   * made pressable.
   */
  it("leaves a URL in a deep dive as inert text", () => {
    const html = render(
      digest({
        deep_dive: {
          state: "written",
          text: "See https://not-a-real-source.example for more.",
          model: "some-provider/some-model",
        },
      } as Partial<DigestArtifact>),
    );

    expect(html).toContain("https://not-a-real-source.example");
    expect(html).not.toContain('href="https://not-a-real-source.example"');
  });

  it("leaves a URL in an item summary as inert text", () => {
    const html = render(
      digest({
        items: [
          {
            headline: "An item the model summarised",
            summary: "The model wrote https://invented.example into this sentence.",
          },
        ],
      }),
    );

    expect(html).toContain("https://invented.example");
    expect(html).not.toContain('href="https://invented.example"');
  });
});

describe("what a press does", () => {
  /**
   * Tested by calling the decision rather than by clicking, because there is no
   * DOM in this suite. That is the reason `followCollectedLink` takes its event
   * as an argument and is exported.
   */
  it("stops the browser and asks main instead, when there is a bridge", () => {
    const asked: Array<{ url: string }> = [];
    let prevented = false;
    const event = {
      preventDefault: () => {
        prevented = true;
      },
    };

    const intercepted = followCollectedLink(event, "https://news.test/supervision", {
      open: (args) => {
        asked.push(args);
        return Promise.resolve({ ok: true });
      },
    });

    expect(intercepted).toBe(true);
    // The whole point: the renderer never navigates, so `createWindow`'s denial
    // is never reached and never has to be relaxed.
    expect(prevented).toBe(true);
    expect(asked).toEqual([{ url: "https://news.test/supervision" }]);
  });

  /**
   * The developer path, and an installed shell older than the command. Both
   * land here, and in both the right answer is to let an anchor be an anchor —
   * correct in a browser tab, and exactly as inert as today in an old shell.
   */
  it("leaves the anchor alone when there is no bridge", () => {
    let prevented = false;
    const intercepted = followCollectedLink(
      {
        preventDefault: () => {
          prevented = true;
        },
      },
      "https://news.test/supervision",
      null,
    );

    expect(intercepted).toBe(false);
    expect(prevented).toBe(false);
  });
});
