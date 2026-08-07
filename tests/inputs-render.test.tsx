/**
 * The Inputs area, rendered (MAR-507).
 *
 * Three of this slice's requirements are about the *output of the renderer* and
 * cannot be checked any other way — the same argument `tests/outputs-render.test.tsx`
 * makes for the panel at the other end of the journey:
 *
 * 1. no raw identifier reaches the screen, in particular the role id, which the
 *    view deliberately carries;
 * 2. selected, copied and rejected are told apart per file rather than rolled up
 *    per role;
 * 3. the runner's own refusal sentence is what appears, not a rewording.
 *
 * The third is the one that needed rendering. A test over the copy module can
 * prove `describeInputState` returns the runner's sentence and still miss a
 * component that renders its own fallback beside it.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { InputsPanel, describeBytes, type SelectedInput } from "../app/_components/inputs";
import { INPUTS_PANEL_COPY } from "../lib/copy/inputs";
import { buildInputRoles } from "../lib/views/inputs";
import { expectPlainLanguage } from "./helpers/plain-language";

const ROLES = buildInputRoles({
  agent_dom: {
    task_inputs: [
      {
        id: "customer_brief",
        label: "Customer brief",
        description: "The document describing what the customer asked for.",
        required: true,
        media_types: ["application/pdf"],
      },
      { id: "price_list", label: "Price list", required: false },
    ],
  },
});

function panel(selected: SelectedInput[] = [], canAct = true): string {
  return renderToStaticMarkup(
    <InputsPanel
      busyRole={null}
      canAct={canAct}
      onChoose={() => {
        /* not clicked in a static render */
      }}
      roles={ROLES}
      selected={selected}
    />,
  );
}

describe("the panel", () => {
  it("draws one card per declared role, headed with the author's own words", () => {
    const html = panel();
    expect(html).toContain("Customer brief");
    expect(html).toContain("Price list");
    expect(html).toContain("The document describing what the customer asked for.");
  });

  it("never prints a role id", () => {
    // The one field on `InputRoleView` a page must not render. It is on the view
    // because a command has to name which role a file is for.
    const html = panel([
      { role_id: "customer_brief", state: "copied", display_name: "brief.pdf", byte_size: 4096, key: "a" },
    ]);
    expect(html).not.toContain("customer_brief");
    expect(html).not.toContain("price_list");
  });

  it("is a card list and not a table", () => {
    // MAR-491 measured every table in DASH at 375px and found a 1425px scroller
    // in a 341px viewport. A new surface starting as a table would be a new
    // instance of a defect this project already paid to remove.
    const html = panel();
    expect(html).not.toContain("<table");
    expect(html).toContain("row-card");
  });

  it("says nothing for an agent that declares no roles", () => {
    const html = renderToStaticMarkup(
      <InputsPanel busyRole={null} canAct roles={[]} onChoose={() => {}} selected={[]} />,
    );
    expect(html).toBe("");
  });

  it("offers no picker to a window that cannot act", () => {
    // The browser dev path has no bridge. A button that could not do anything
    // is worse than none: `lib/workspace.ts` calls dead controls out by name.
    expect(panel([], false)).not.toContain("<button");
  });
});

describe("selected, copied and rejected", () => {
  const selected: SelectedInput[] = [
    { role_id: "customer_brief", state: "selected", display_name: "", byte_size: 0, key: "a" },
    { role_id: "customer_brief", state: "copied", display_name: "brief.pdf", byte_size: 41_231, key: "b" },
    {
      role_id: "price_list",
      state: "rejected",
      display_name: "",
      byte_size: 0,
      detail: "That file is larger than this agent accepts.",
      key: "c",
    },
  ];

  it("tells the three apart per file rather than per role", () => {
    // Two files under one role, in different states. A panel that rolled up to
    // "1 of 2 accepted" would be the summary that hides which one failed.
    const html = panel(selected);
    expect(html).toContain("is-selected");
    expect(html).toContain("is-copied");
    expect(html).toContain("is-rejected");
  });

  it("renders the runner's own refusal sentence, verbatim", () => {
    expect(panel(selected)).toContain("That file is larger than this agent accepts.");
  });

  it("says the copy is DASH's, on the file that has one", () => {
    expect(panel(selected)).toContain(INPUTS_PANEL_COPY.copied_note);
  });

  it("shows a size only for a file that has one", () => {
    const html = panel(selected);
    expect(html).toContain("41.2 kB");
    // A rejected or still-copying file has no size to state, and a "0 bytes"
    // there would be a fact about nothing.
    expect(html).not.toContain("0 bytes");
  });

  it("says what Run now will do, once something is ready to send", () => {
    expect(panel(selected)).toContain(INPUTS_PANEL_COPY.dispatch_note);
    expect(panel()).not.toContain(INPUTS_PANEL_COPY.dispatch_note);
  });

  it("shows no path, because there is nowhere for one to come from", () => {
    // `SelectedInput` has no path field and the command that fills it returns
    // none. This is the assertion that would fail the day somebody adds one.
    const html = panel(selected);
    expect(html).not.toMatch(/[A-Za-z]:\\/);
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("/home/");
  });

  it("is plain language on every string it renders", () => {
    expectPlainLanguage([panel(selected)]);
  });
});

describe("a size a person reads", () => {
  it.each([
    [0, "0 bytes"],
    [999, "999 bytes"],
    [1000, "1.0 kB"],
    [41_231, "41.2 kB"],
    [5_400_000, "5.4 MB"],
    [3_200_000_000, "3.2 GB"],
    // Above the largest unit it keeps counting in it rather than inventing one.
    [4_000_000_000_000, "4000.0 GB"],
  ])("renders %s as %s", (bytes, expected) => {
    expect(describeBytes(bytes)).toBe(expected);
  });
});
