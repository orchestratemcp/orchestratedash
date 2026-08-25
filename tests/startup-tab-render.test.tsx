/**
 * The Startup tab, drawn (MAR-785, ADR 0030).
 *
 * `tests/autostart.test.ts` drives the decisions. This drives the thing on
 * screen, for `tests/ai-tab-render.test.tsx`' reason: a photograph proves a
 * state was drawn once on one machine, and this proves each one is still drawn
 * on every run.
 *
 * Five states, and every one of them is unreachable from a fake data source
 * because the fact lives in the Windows registry rather than in `dash.sqlite`:
 * off, on, on-but-disabled-in-Task-Manager, pointing at another copy of DASH,
 * and refused because this is a working copy of the source.
 *
 * The claim these exist to hold is the honesty one. ADR 0029's third liveness
 * sentence — *a window that came round while the machine was off is missed and
 * is not run late* — has to survive being next to a switch that says the helper
 * starts at sign-in, because the switch is exactly the thing that makes somebody
 * assume otherwise.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { StartupSettings } from "../app/settings/startup/page";
import { STARTUP_COPY, describeAutostartRefusal } from "../lib/copy/startup";
import { AUTOSTART_SWITCH, type AutostartState } from "../lib/shell/autostart";

const COMMAND = `"C:\\dash\\electron.exe" C:\\dash ${AUTOSTART_SWITCH}`;

function state(over: Partial<AutostartState> = {}): AutostartState {
  return {
    available: true,
    refusal: null,
    enrolled: false,
    approved: false,
    foreign: false,
    command: COMMAND,
    ...over,
  };
}

/**
 * The markup with React's entity escaping undone.
 *
 * `renderToStaticMarkup` writes `&#x27;` for an apostrophe and `&quot;` for a
 * quote, so half the copy in `STARTUP_COPY` — every sentence with "DASH's" in
 * it — would never match a literal comparison. Un-escaping here rather than
 * writing the entities into the assertions keeps the expected strings readable
 * as the sentences a person sees.
 */
function text(html: string): string {
  return html.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
}

function draw(over: Partial<AutostartState> = {}, canAct = true): string {
  return text(
    renderToStaticMarkup(
      <StartupSettings
        state={state(over)}
        canAct={canAct}
        busy={false}
        outcome={null}
        onPress={() => {
          /* the press is `tests/shell.test.ts`' subject, not this file's */
        }}
      />,
    ),
  );
}

describe("the switch", () => {
  it("offers to turn on, and says nothing has been added yet", () => {
    const html = draw();
    expect(html).toContain(STARTUP_COPY.toggle_on);
    expect(html).toContain("Off");
    // The opt-in promise is on the page in the state where it matters, which is
    // before the press rather than after it.
    expect(html).toContain(STARTUP_COPY.opt_in);
  });

  it("offers to turn off once enrolled, and says the helper starts at sign-in", () => {
    const html = draw({ enrolled: true, approved: true });
    expect(html).toContain(STARTUP_COPY.toggle_off);
    expect(html).toContain(STARTUP_COPY.liveness_on[0] ?? "");
  });

  it("is disabled on a host that cannot act, rather than absent", () => {
    // Absent would be worse: a person reading a browser tab would learn that
    // DASH has no such setting, which is a different and untrue sentence.
    expect(draw({}, false)).toContain("disabled");
  });
});

describe("what the page refuses to let a person assume", () => {
  it("keeps ADR 0029's missed-window sentence beside the switch, in both states", () => {
    for (const enrolled of [false, true]) {
      const html = draw({ enrolled, approved: enrolled });
      expect(html).toContain(STARTUP_COPY.liveness_on[2] ?? "");
    }
  });

  it("says what it does not do, including the window and the port", () => {
    const html = draw();
    for (const sentence of STARTUP_COPY.not_this) {
      expect(html).toContain(sentence);
    }
  });

  it("shows the literal command it would add", () => {
    const html = draw();
    expect(html).toContain(STARTUP_COPY.command_label);
    // Escaped by React, so the assertion is on the switch rather than on the
    // whole line — the backslashes in a Windows path do not survive verbatim.
    expect(html).toContain(AUTOSTART_SWITCH);
    expect(html).toContain(STARTUP_COPY.command_note);
  });
});

describe("the states a machine can be in that DASH did not choose", () => {
  it("says so when Windows has the entry switched off", () => {
    // The defect this prevents: an entry that exists, so DASH says On, and a
    // Task Manager bitmask that means it never runs. Both facts are true and
    // only one of them was on screen before this.
    const html = draw({ enrolled: true, approved: false });
    expect(html).toContain(STARTUP_COPY.windows_disabled);
  });

  it("does not cry disabled when nothing is enrolled", () => {
    expect(draw({ enrolled: false, approved: false })).not.toContain(STARTUP_COPY.windows_disabled);
  });

  it("says so when the entry belongs to another copy of DASH", () => {
    const html = draw({ enrolled: false, foreign: true });
    expect(html).toContain(STARTUP_COPY.foreign);
    // And still offers the press, because turning it on is what replaces it —
    // and turning it off is the only thing in the product that removes a login
    // entry pointing at a DASH that may no longer exist.
    expect(html).toContain(STARTUP_COPY.toggle_on);
  });
});

describe("a copy of DASH that may not enrol", () => {
  it("says why, in the person's terms, and draws no switch", () => {
    const html = draw({ available: false, refusal: "foreign_checkout", command: "" });
    expect(html).toContain(describeAutostartRefusal("foreign_checkout"));
    expect(html).not.toContain(STARTUP_COPY.toggle_on);
    expect(html).not.toContain(STARTUP_COPY.toggle_off);
  });

  it("shows no command line, because there is no command it would write", () => {
    const html = draw({ available: false, refusal: "scratch_store", command: "" });
    expect(html).not.toContain(STARTUP_COPY.command_label);
  });
});
