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

import { AddedReport, ChooseFolder } from "../app/_components/choose-folder";
import AddAgentPage from "../app/settings/add-agent/page";
import {
  CHOOSE_FOLDER_COPY,
  FOLDER_ALREADY_IN_DASH,
  FOLDER_DECLINED,
  FOLDER_NOT_AN_AGENT,
  describeFolderAdded,
} from "../lib/copy/add-agent";
import { explainImportFailure } from "../lib/import-feedback";
import type { AddedAgentReport } from "../lib/shell/ipc";

const DESTINATION = "C:\\Users\\sam\\AppData\\Roaming\\orchestratedash\\agents\\ai-news-scout";

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

  it("leads with choosing a folder", () => {
    /*
     * The issue in one assertion: the first thing on the page is about a folder,
     * and the commands are not.
     *
     * Asserted on the lede rather than on the button, because the button is
     * deliberately withheld until `useHost` has answered — an effect, which does
     * not run in a static render. That withholding is the same one
     * `AddAgentForm` has always had and it is the right way round: showing
     * nothing for one frame is better than showing "open the installed app"
     * inside the installed app. `ChooseFolder`'s own tests above cover the
     * control itself.
     */
    const ledeAt = markup.indexOf(CHOOSE_FOLDER_COPY.lede);
    const commandAt = markup.indexOf("npx create-dash-agent");
    expect(ledeAt).toBeGreaterThan(-1);
    expect(commandAt).toBeGreaterThan(ledeAt);
    expect(markup.indexOf(CHOOSE_FOLDER_COPY.heading)).toBeLessThan(ledeAt);
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
        startable: true,
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
