/**
 * The list of files DASH has saved, rendered (MAR-697).
 *
 * `tests/agent-exports.test.ts` holds the folder and the naming. This one is
 * about what reaches the screen, and there are three claims worth rendering
 * for:
 *
 * 1. the person sees the document's own name, not a file name and not a path;
 * 2. a window that cannot open a file draws no control that says it can;
 * 3. the component is absent rather than empty before anything has been saved.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ExportsList } from "../app/_components/output-exports";
import { EXPORTS_PANEL_COPY } from "../lib/copy/artifacts";
import { rawIdentifiersIn } from "../lib/copy/identifiers";
import type { AgentExportView } from "../lib/views/types";

const SAVED: AgentExportView[] = [
  {
    file: "AI agent news for 18 August.pdf",
    label: "AI agent news for 18 August",
    when: "18 August 2026 at 21:14",
    size: "412.0 kB",
  },
  {
    file: "AI agent news for 17 August.pdf",
    label: "AI agent news for 17 August",
    when: "17 August 2026 at 20:58",
    size: "398.4 kB",
  },
];

function render(props: Parameters<typeof ExportsList>[0]): string {
  return renderToStaticMarkup(ExportsList(props));
}

describe("what the list says", () => {
  it("names each document the way the person named it", () => {
    const html = render({ exports: SAVED, onOpen: () => undefined });

    expect(html).toContain("AI agent news for 18 August");
    expect(html).toContain(EXPORTS_PANEL_COPY.heading);
    // The extension is DASH's filing detail, not the document's name.
    expect(html).not.toContain(".pdf");
  });

  it("says when and how big, in words already formed", () => {
    const html = render({ exports: SAVED, onOpen: () => undefined });

    expect(html).toContain("18 August 2026 at 21:14");
    expect(html).toContain("412.0 kB");
    // MAR-533's rule: a timestamp with a `T` and a `Z` in it is the same
    // failure as a raw identifier. The view words both before they get here.
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  /**
   * The one thing this component could most easily leak.
   *
   * It is a list of files, so a path is the obvious thing for it to print, and
   * `%APPDATA%\orchestratedash\exports\…` on a guided surface is exactly what
   * MAR-423's rule exists to keep off one. Nothing on the view carries a path,
   * which is what makes this assertion cheap to keep true.
   */
  it("prints no path and no raw identifier", () => {
    const html = render({ exports: SAVED, onOpen: () => undefined });

    expect(html).not.toContain("APPDATA");
    expect(html).not.toContain("orchestratedash");
    expect(html).not.toContain(":\\");
    expect(rawIdentifiersIn(html)).toEqual([]);
  });
});

describe("a window that cannot open a file", () => {
  /**
   * `OutputsPanel`'s rule about its Download button, and `LinkOut`'s about an
   * address DASH will not open. A name that looks pressable and does nothing is
   * MAR-698's own complaint, and shipping one here beside the fix for it would
   * be careless.
   */
  it("draws the names as text rather than as dead controls", () => {
    const html = render({ exports: SAVED });

    expect(html).toContain("AI agent news for 18 August");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });

  it("draws a control for each file when the window can act", () => {
    const html = render({ exports: SAVED, onOpen: () => undefined });

    expect([...html.matchAll(/<button/g)]).toHaveLength(2);
  });
});

describe("before anything has been saved", () => {
  it("renders nothing at all", () => {
    // Absent rather than empty, which is the opposite of the rule
    // `OutputsPanel` follows next door — see `ExportsList` for why the
    // ambiguity that rule resolves does not exist here.
    expect(render({ exports: [], onOpen: () => undefined })).toBe("");
  });

  it("says where files will come from, for a caller that asks for the empty state", () => {
    const html = render({ exports: [], emptyState: true, onOpen: () => undefined });

    expect(html).toContain(EXPORTS_PANEL_COPY.empty);
    // What will put something here, rather than the bare fact that nothing is.
    expect(EXPORTS_PANEL_COPY.empty).toContain("Save as PDF");
  });
});
