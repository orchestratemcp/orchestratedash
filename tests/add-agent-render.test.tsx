/**
 * The Add agent page, drawn (MAR-598).
 *
 * `tests/folder-import.test.ts` drives the decisions and
 * `tests/copy-add-agent.test.ts` drives the sentences. This drives the surface,
 * and the assertions that matter are about **what is offered**: the primary
 * action is choosing a folder, the terminal commands are behind a disclosure
 * rather than at the top, a refusal shows the contract checker's own output, and
 * a window that cannot act is told which one can instead of being shown a dead
 * control.
 *
 * It also holds the one thing the page could regress silently: that the two
 * commands MAR-428 put here are still *reachable*. Demoting a path and deleting
 * it look identical from a screenshot of the top of the page, and only one of
 * them is what the issue asked for.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AddedReport,
  ChooseFolder,
  CopyableCommand,
  SampleAgentControl,
} from "../app/_components/choose-folder";
import AddAgentPage from "../app/settings/add-agent/page";
import {
  ADD_AGENT_PATHS,
  ASSISTANT_SETUP,
  CHOOSE_FOLDER_COPY,
  FOLDER_ALREADY_IN_DASH,
  FOLDER_DECLINED,
  FOLDER_NOT_AN_AGENT,
  describeFolderAdded,
} from "../lib/copy/add-agent";
import { createSampleAgent } from "../app/_data/source";
import { explainImportFailure } from "../lib/import-feedback";
import type { AddedAgentReport } from "../lib/shell/ipc";

const DESTINATION = "C:\\Users\\sam\\AppData\\Roaming\\orchestratedash\\agents\\ai-news-scout";

/**
 * The markup as a reader sees it.
 *
 * `renderToStaticMarkup` escapes apostrophes and angle brackets, so a copy
 * assertion written against the constant fails on a sentence that is on screen
 * and correct. Decoding here rather than writing the entities into the
 * expectations keeps the test comparing DASH's own strings — which is the
 * point, since the strings are what the copy gate holds.
 */
function text(markup: string): string {
  return markup
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function draw(report: AddedAgentReport): string {
  return renderToStaticMarkup(<AddedReport report={report} />);
}

describe("the primary action", () => {
  it("is a button that chooses a folder", () => {
    const markup = renderToStaticMarkup(<ChooseFolder canAct />);
    expect(markup).toContain(CHOOSE_FOLDER_COPY.action);
    expect(markup).toContain("button-primary");
    // No field a person could type a path into, and no file input. The whole
    // point is that the renderer never holds a path — see the component header.
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<textarea");
  });

  it("offers the sample as one press, not as a way to open a menu", () => {
    /*
     * `SampleAgentControl` takes the decided boolean rather than discovering it,
     * for `SettingsTabsStrip`'s reason: a static render runs no effects, so a
     * component that read `window.dashShell` itself could only be tested in one
     * of its two states.
     *
     * The negative assertion is the one that matters. This control's first
     * draft popped the application menu — `aria-haspopup="menu"`, because that
     * was the truth of it — since `shell.menu` carries two numbers and cannot
     * name an item. MAR-879 added `sample.create` so the press reaches
     * `offerSampleAgent` directly, and the haspopup going away is exactly what
     * says so from the outside.
     */
    const markup = renderToStaticMarkup(<SampleAgentControl available />);
    expect(markup).toContain(ADD_AGENT_PATHS.sample.action);
    expect(markup).toContain("button-primary");
    expect(markup).not.toContain("aria-haspopup");
    expect(text(markup)).toContain(ADD_AGENT_PATHS.sample.detail);
  });

  it("says which window can make a sample rather than drawing a dead control", () => {
    const markup = renderToStaticMarkup(<SampleAgentControl available={false} />);
    expect(markup).toContain(ADD_AGENT_PATHS.sample_read_only);
    expect(markup).not.toContain("<button");
  });

  it("puts the builder's setup line beside a button that copies it", () => {
    /*
     * "Copyable, not typed" is the issue's own wording. A line a person has to
     * transcribe from a screen into another program is a terminal instruction
     * wearing a different coat.
     */
    const markup = renderToStaticMarkup(
      <CopyableCommand
        text={ASSISTANT_SETUP.command}
        label={ASSISTANT_SETUP.copy_action}
        copied={ASSISTANT_SETUP.copied}
        failed={ASSISTANT_SETUP.copy_failed}
      />,
    );
    expect(markup).toContain(ASSISTANT_SETUP.copy_action);
    expect(markup).toContain("button-secondary");
    // The line stays on screen and selectable whatever the clipboard does — the
    // reason `copyText` has a second attempt and a spoken failure.
    expect(markup).toContain("setup-line");
  });

  it("says which window can act rather than drawing a dead control", () => {
    /*
     * `FolderUpdate`'s rule: a greyed-out button here would read as a claim
     * about this person's agents, and the true statement is about which window
     * this is. So a browser tab gets a sentence and no control at all.
     */
    const markup = renderToStaticMarkup(<ChooseFolder canAct={false} />);
    expect(markup).toContain(CHOOSE_FOLDER_COPY.read_only);
    expect(markup).not.toContain("<button");
  });
});

describe("the page's order", () => {
  const markup = renderToStaticMarkup(<AddAgentPage />);

  it("leads with a choice between three doors, and with no command at all", () => {
    /*
     * MAR-598's assertion, moved up a level by MAR-879.
     *
     * It used to read "leads with choosing a folder", which was the fix for a
     * page that led with two terminal commands. The invariant it was protecting
     * — **the first thing this page says is not a command** — is unchanged and
     * is asserted below; what changed is that a folder is now one of three
     * doors rather than the page, so leading with it would leave a person who
     * has no agent yet in the same place MAR-598 found them.
     *
     * Asserted on the ledes and headings rather than on the buttons, because
     * every control here is deliberately withheld until `useHost` has answered
     * — an effect, which does not run in a static render. `ChooseFolder`'s and
     * `SampleAgentControl`'s own tests cover the controls themselves.
     */
    const ledeAt = markup.indexOf(ADD_AGENT_PATHS.lede);
    expect(markup.indexOf(CHOOSE_FOLDER_COPY.heading)).toBeLessThan(ledeAt);
    expect(ledeAt).toBeGreaterThan(-1);

    const order = [
      ADD_AGENT_PATHS.sample.heading,
      ADD_AGENT_PATHS.assistant.heading,
      ADD_AGENT_PATHS.folder.heading,
    ].map((heading) => markup.indexOf(heading));
    for (const at of order) {
      expect(at).toBeGreaterThan(ledeAt);
    }
    // Sample, assistant, folder — the order of how much a person has to have
    // already. See `ADD_AGENT_PATHS`' header; a reordering that put the folder
    // first would be MAR-598's page again.
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // And the commands are still after all three, where MAR-598 put them.
    expect(markup.indexOf("npx create-dash-agent")).toBeGreaterThan(Math.max(...order));
  });

  it("offers the sample here rather than describing where its menu is", () => {
    /*
     * The defect MAR-879 names first. Before this the only way to the sample
     * was a paragraph on the Agents page giving a person coordinates — "the
     * menu button (☰) at the top left of the window" — and this page did not
     * mention the sample at all. A page that offers three ways to add an agent
     * and leaves one of them to be found by reading is offering two.
     */
    expect(markup).toContain(ADD_AGENT_PATHS.sample.heading);
    expect(markup).toContain(ADD_AGENT_PATHS.sample.means);
    expect(markup).not.toMatch(/top left of the window/i);
  });

  it("carries the builder's real setup line, copyable and behind a disclosure", () => {
    /*
     * The one line a person pastes, and it is `tools/dash-mcp/README.md`'s own
     * — a plugin install for a coding assistant, not a shell command, and not
     * something DASH can do for them because DASH is not the program it
     * installs into.
     *
     * Behind a disclosure because it is done once. Asserted as present rather
     * than as positioned: what would be wrong is this page explaining the
     * builder and then leaving somebody to search for how to get it.
     */
    expect(text(markup)).toContain(ASSISTANT_SETUP.command);
    expect(markup).toContain("dash-mcp");
    const summaryAt = text(markup).indexOf(ASSISTANT_SETUP.intro);
    expect(summaryAt).toBeGreaterThan(-1);
    expect(text(markup).indexOf(ASSISTANT_SETUP.command)).toBeGreaterThan(summaryAt);
    // The whole point of the assistant path: it ends where the other two end.
    expect(ADD_AGENT_PATHS.assistant.detail).toMatch(/asks whether to add it/i);
  });

  it("opens the builder's disclosure closed when no link asked for it", () => {
    /*
     * `?path=assistant` is read after mount, from `window.location` rather than
     * from a router — see `useOpenedPath`. A static render is the "nobody asked"
     * case and must not spring open, which is also what makes the assertion
     * above about ordering meaningful.
     */
    expect(markup).not.toContain("<details open");
  });

  it("keeps the scaffold path, behind a disclosure that says who it is for", () => {
    /*
     * Demoted, not deleted. It is the only way to make an agent that does not
     * exist yet, and MAR-428's "keep the developer path as a fallback, not the
     * novice path" is still the scope line — the change is where it sits.
     */
    expect(markup).toContain("npx create-dash-agent");
    expect(markup).toContain("npm run open-in-dash");
    expect(markup).toContain(CHOOSE_FOLDER_COPY.scaffold_summary);
    const summaryAt = markup.indexOf(CHOOSE_FOLDER_COPY.scaffold_summary);
    expect(markup.indexOf("npx create-dash-agent")).toBeGreaterThan(summaryAt);
  });

  it("keeps the paste-a-plan path too, behind its own disclosure", () => {
    expect(markup).toContain(CHOOSE_FOLDER_COPY.manifest_summary);
  });

  it("renders no listing of agents the person already has", () => {
    /*
     * The issue asks for the stray "2 agents · Open …" links to go. They were
     * never this page's: they are `FleetStrip`, DASH's own band along the bottom
     * of every window (MAR-503). What was in this page's gift is not growing one
     * of its own, and this is the assertion that keeps it that way — a future
     * "your agents" section here would fail it.
     */
    expect(markup).not.toContain("Open ");
    expect(markup).not.toMatch(/\d+ agents/);
  });
});

describe("what DASH says it did", () => {
  it("draws a success as a success, naming where the copy went", () => {
    const markup = draw({
      ok: true,
      card: describeFolderAdded({
        display_name: "AI News Scout",
        destination: DESTINATION,
        replaced: false,
        start: "ready",
      }),
      failure: null,
    });
    expect(markup).toContain("notice-ok");
    expect(markup).toContain("AI News Scout");
    // Escaped by React, so the assertion is on the escaped form the browser
    // actually receives rather than on the string as written.
    expect(markup).toContain(DESTINATION.replace(/\\/g, "\\"));
  });

  it("shows the contract checker's own output under DASH's explanation of it", () => {
    /*
     * MAR-423's arrangement, and MAR-584's gate arriving through a third door.
     * DASH's headline and suggestion first, the schema's errors underneath as
     * evidence — never paraphrased into something friendlier that would send an
     * author looking in the wrong place, and never instead of the explanation.
     */
    const failure = explainImportFailure(["/agent_dom must have required property 'runtime'"]);
    const markup = draw({ ok: false, card: FOLDER_NOT_AN_AGENT, failure });
    expect(markup).not.toContain("notice-ok");
    expect(markup).toContain(FOLDER_NOT_AN_AGENT.headline);
    expect(markup).toContain(failure.headline);
    expect(markup).toContain("folder-errors");
    expect(markup).toContain("required property");
    const explanationAt = markup.indexOf(failure.headline);
    expect(markup.indexOf("folder-errors")).toBeGreaterThan(explanationAt);
  });

  it("draws a decline calmly, with no error block to read", () => {
    // Somebody answered a question. There is nothing for a validator to say and
    // nothing to look up, so nothing is shown.
    const markup = draw({ ok: false, card: FOLDER_DECLINED, failure: null });
    expect(markup).toContain(FOLDER_DECLINED.meaning);
    expect(markup).not.toContain("folder-errors");
    expect(markup).not.toContain("notice-ok");
  });

  it("does not draw a folder DASH already keeps as a success", () => {
    /*
     * The state that would slip through a check derived from "no errors". This
     * card has a next action and no validator block, and it is still a refusal —
     * which is why `AddedAgentReport` carries `ok` rather than leaving a surface
     * to infer it.
     */
    const markup = draw({ ok: false, card: FOLDER_ALREADY_IN_DASH, failure: null });
    expect(markup).not.toContain("notice-ok");
    expect(markup).toContain(FOLDER_ALREADY_IN_DASH.next_action ?? "");
  });
});

/**
 * The other half of "one press": what the press actually reaches (MAR-879).
 *
 * `SampleAgentControl` is asserted above to be a plain button with no
 * `aria-haspopup`. That is what a reader sees; this is what happens when they
 * press it. The control words nothing and decides nothing — it calls
 * `createSampleAgent`, and every refusal on this path is composed here, in
 * `app/_data/source.ts`, so a page cannot describe a shell differently from the
 * seam that talked to it.
 *
 * The bridge is faked rather than the component driven, for the reason
 * `ChooseFolder`'s tests fake theirs: a test that had to raise a native consent
 * dialog to reach a branch would be testing the harness.
 */
describe("what the sample button reaches", () => {
  const realWindow = (globalThis as { window?: unknown }).window;

  function withBridge<T>(bridge: unknown, run: () => Promise<T>): Promise<T> {
    (globalThis as { window?: unknown }).window = bridge === undefined ? {} : { dashShell: bridge };
    return run().finally(() => {
      (globalThis as { window?: unknown }).window = realWindow;
    });
  }

  it("sends sample.create through the bridge when the shell has it", async () => {
    const calls: string[] = [];
    const result = await withBridge(
      {
        createSampleAgent: () => {
          calls.push("createSampleAgent");
          return Promise.resolve({ ok: true, request_id: "req-1" });
        },
      },
      () => createSampleAgent(),
    );

    // One call, no arguments. There is nothing a page could pass — see the
    // `sample.create` entry in `lib/shell/ipc.ts`, where the empty payload is
    // the security argument rather than a convenience.
    expect(calls).toEqual(["createSampleAgent"]);
    expect(result).toMatchObject({ ok: true });
  });

  it("tells a browser tab which window can make one", async () => {
    const result = await withBridge(undefined, () => createSampleAgent());

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/installed DASH app/i);
  });

  it("sends an older installed build to the menu it still has", async () => {
    /*
     * The refusal that had to be written rather than reused. Everywhere else on
     * this page a missing method means the path is unavailable; here it means
     * the path moved. An installed DASH older than `sample.create` still has
     * the application menu, and its first item is this same operation — so the
     * sentence names the door that exists on *their* build instead of leaving
     * somebody pressing a control that does nothing.
     */
    const result = await withBridge({}, () => createSampleAgent());

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/menu/i);
    expect(result.detail).toMatch(/Try a sample agent/);
  });
});
