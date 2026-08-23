/**
 * What a person actually receives when they press Save as PDF (MAR-674, ADR
 * 0025 decision 4).
 *
 * The print path has three parts and only two of them can be tested without a
 * window: the document DASH wraps around the brief, and the filename it
 * proposes. The third — `printToPDF` against a hidden `BrowserWindow`, and that
 * window being destroyed on every path — needs Electron and is owed as an
 * attended proof.
 *
 * The claim worth defending here is the one Henrik's ruling turns on.
 * **Printing the React output means there is no second escaper**, so a model
 * that wrote a markdown link or a script tag produces inert characters in the
 * PDF exactly as it does on screen. This file holds that to be true by driving
 * the same components the app draws.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BriefBody } from "../app/_components/digest";
import { briefFileName } from "../electron/brief-pdf";
import { briefPrintDocument } from "../lib/brief/print";
import { fingerprintItems } from "../lib/brief/fingerprint";
import type { BriefArtifact, DigestArtifact } from "../lib/contracts";

const ITEMS: DigestArtifact["items"] = [
  {
    headline: "Providers cut prices",
    source_url: "https://feed.test/a",
    item_url: "https://news.test/prices",
  },
];

/** A model that tried to smuggle markup and a link out through its prose. */
const HOSTILE_BRIEF: BriefArtifact = {
  artifact_version: 2,
  kind: "brief",
  agent: "scout",
  run_id: "run-1",
  artifact_id: "brief-1",
  title: "What it adds up to",
  generated_at: "2026-08-18T09:01:00.000Z",
  document: {
    sections: [
      {
        heading: "A <script>alert(1)</script> heading",
        paragraphs: [
          { body: "See [click here](http://evil.example) for more.", items: [0] },
          { body: "<img src=x onerror=alert(1)>", items: [0] },
        ],
      },
    ],
  },
  derived_from: {
    artifact_id: "digest-1",
    run_id: "run-1",
    item_count: ITEMS.length,
    items_digest: fingerprintItems(ITEMS),
  },
};

function printed(artifact: BriefArtifact, title = artifact.title): string {
  return briefPrintDocument({
    title,
    subtitle: "scout · 18 August 2026 at 11:01",
    body: renderToStaticMarkup(
      BriefBody({
        artifact,
        citations: {
          state: "matched",
          items: ITEMS,
          expected_count: ITEMS.length,
          found_count: ITEMS.length,
        },
      }),
    ),
  });
}

describe("the printed document", () => {
  it("carries the brief and DASH's own head", () => {
    const html = printed(HOSTILE_BRIEF);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<h1>What it adds up to</h1>");
    expect(html).toContain("scout · 18 August 2026 at 11:01");
  });

  it("prints a model's markdown link as text, with no live anchor for it", () => {
    // Henrik's ruling made this true rather than something to be enforced. The
    // Markdown writer this ADR first proposed would have needed a hand-written
    // escaper here; React's output needs none, because React never produced an
    // anchor for those characters in the first place.
    const html = printed(HOSTILE_BRIEF);
    expect(html).toContain("[click here](http://evil.example)");
    expect(html).not.toContain('href="http://evil.example"');
  });

  it("prints a model's markup as characters rather than elements", () => {
    const html = printed(HOSTILE_BRIEF);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // The characters survive; the ELEMENTS never exist. `onerror=` does appear
    // in the file — inside `&lt;img src=x onerror=alert(1)&gt;`, as text
    // content with no tag around it — so the assertion worth making is about
    // the tag rather than about the substring. A first draft asserted the
    // substring and failed on correct output.
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });

  it("keeps the only live links the ones DASH collected", () => {
    // The citation's anchor comes from the digest item's own `item_url`, which
    // the agent collected and the fingerprint checked — never from the model.
    const html = printed(HOSTILE_BRIEF);
    expect(html).toContain('href="https://news.test/prices"');
  });

  it("escapes the two strings it positions itself", () => {
    // The one exception to this path's no-escaper rule, and it is narrow: the
    // title is the AGENT's own name for its brief, so it is a plain string
    // rather than React output.
    const html = printed(HOSTILE_BRIEF, 'Weekly <b>brief</b> & "notes"');
    expect(html).toContain("Weekly &lt;b&gt;brief&lt;/b&gt; &amp; &quot;notes&quot;");
    expect(html).not.toContain("<b>brief</b>");
  });

  it("forces light and hides controls, so a dark app does not print a black page", () => {
    const html = printed(HOSTILE_BRIEF);
    expect(html).toContain("color-scheme: light");
    expect(html).toContain("background: #ffffff");
    expect(html).toContain("button, input, select, [role=\"button\"] { display: none !important; }");
  });
});

describe("the filename DASH proposes", () => {
  it("uses the agent's own words for it", () => {
    expect(briefFileName("Weekly digest 18 August")).toBe("Weekly digest 18 August.pdf");
  });

  /**
   * MAR-740. `dir` showed this exact name on disk, byte for byte, and the
   * default PDF handler `shell.openPath` invoked still reported it missing —
   * a Windows shell seam this repository does not own. The fold means DASH
   * never hands that seam an em dash to begin with.
   */
  it("folds an em dash rather than carrying it into a path (MAR-740)", () => {
    expect(briefFileName("Competitor brief — OpenClaw and Hermes Agent")).toBe(
      "Competitor brief - OpenClaw and Hermes Agent.pdf",
    );
  });

  it("folds the rest of the class a model reaches for, not just the one caught", () => {
    expect(briefFileName("It’s “big” news…")).toBe("It's big news....pdf");
    expect(briefFileName("Q1–Q2 pipeline review")).toBe("Q1-Q2 pipeline review.pdf");
  });

  it("cannot propose a path", () => {
    // This string reaches `dialog.showSaveDialog` as a default. A title
    // carrying a separator would otherwise suggest a location nobody chose,
    // which is the thing every workspace command in this repository refuses.
    expect(briefFileName("reports/2026/august")).toBe("reports 2026 august.pdf");
    expect(briefFileName("C:\\Windows\\System32")).toBe("C Windows System32.pdf");
    expect(briefFileName("a:b*c?d<e>f|g")).toBe("a b c d e f g.pdf");
  });

  it("still proposes something for a title made only of separators", () => {
    expect(briefFileName("///")).toBe("briefing.pdf");
    expect(briefFileName("   ")).toBe("briefing.pdf");
  });

  it("bounds a title long enough to trouble a filesystem", () => {
    expect(briefFileName("x".repeat(400))).toBe(`${"x".repeat(80)}.pdf`);
  });
});
