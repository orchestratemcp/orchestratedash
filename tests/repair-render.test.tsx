/**
 * The two surfaces MAR-703 and MAR-705 put on screen, drawn.
 *
 * The decision that a start control is offered is `tests/agent-control.test.ts`;
 * the decision about what a repair writes is `tests/folder-repair*.test.ts`.
 * This is the last link in each chain — that the decision reaches the markup —
 * and it is worth its own file because both defects were *absences*: a control
 * that was decided and never drawn would look exactly like the bug being fixed.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentControls } from "../app/_components/agent-header";
import { RepairAgent } from "../app/_components/repair-agent";
import { AGENT_CONTROL_COPY } from "../lib/copy/agent-page";
import { REPAIR_AGENT_COPY } from "../lib/copy/repair";
import type { AgentControlView } from "../lib/views/agent-control";

function decode(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, "/")
    .replace(/&amp;/g, "&");
}

function controls(
  run: AgentControlView["run"],
  over: { onRepair?: (() => void) | null } = {},
): string {
  return decode(
    renderToStaticMarkup(
      <AgentControls
        busy={null}
        hasFiles={false}
        hosts={[]}
        onCancelKey={(command, runId) => `${command}:${runId}`}
        onRepair={over.onRepair === undefined ? () => {} : over.onRepair}
        onRun={() => {}}
        onRunControl={() => {}}
        onRunOnHost={() => {}}
        onStart={() => {}}
        run={run}
        runSpend={null}
      />,
    ),
  );
}

describe("the Run stage, for an agent that has reported nothing", () => {
  /**
   * MAR-703's screen, after.
   *
   * Henrik's report was that there was no run button anywhere. `buildAgentControl`
   * now returns `start` for this agent, and this is the assertion that the button
   * actually appears — the null `observed_at` this arm carries must not stop it
   * being drawn, which it would have done had the renderer read that field.
   */
  it("draws the start button when there is no snapshot to read", () => {
    const html = controls({ kind: "start", observed_at: null });

    expect(html).toContain(AGENT_CONTROL_COPY.start_and_run);
    expect(html).toContain(AGENT_CONTROL_COPY.start_here);
    // And not the dead end it used to draw instead.
    expect(html).not.toContain(AGENT_CONTROL_COPY.idle.not_reported);
  });

  /**
   * MAR-705's rule: no state without an exit.
   *
   * The sentence that survives the narrowing is the one for an agent DASH holds
   * no program for — the only reason on this panel a person can neither act on
   * nor wait out. It has to name the way out.
   */
  it("offers the repair beside the sentence that is a dead end", () => {
    const html = controls({ kind: "idle", reason: "not_reported" });

    expect(html).toContain(AGENT_CONTROL_COPY.idle.not_reported);
    expect(html).toContain(AGENT_CONTROL_COPY.not_reported_exit.action);
    expect(html).toContain(AGENT_CONTROL_COPY.not_reported_exit.detail);
  });

  /**
   * The other two idle reasons are not dead ends and must not grow a repair
   * button.
   *
   * `nothing_waiting` is a running agent that will offer something; `read_only`
   * is a browser tab, which has no controls at all and says so once. Offering a
   * repair on either would be DASH suggesting a fault where there is none.
   */
  it("offers it on no other reason", () => {
    for (const reason of ["nothing_waiting", "read_only"] as const) {
      const html = controls({ kind: "idle", reason });
      expect(html).not.toContain(AGENT_CONTROL_COPY.not_reported_exit.action);
    }
  });

  /** A read-only window has nowhere to send anybody, and is handed no route. */
  it("draws no repair route when there is none to offer", () => {
    const html = controls({ kind: "idle", reason: "not_reported" }, { onRepair: null });

    expect(html).toContain(AGENT_CONTROL_COPY.idle.not_reported);
    expect(html).not.toContain(AGENT_CONTROL_COPY.not_reported_exit.action);
  });
});

describe("the Settings stage repair control", () => {
  function repair(over: { canAct?: boolean; hasFolder?: boolean } = {}): string {
    return decode(
      renderToStaticMarkup(
        <RepairAgent
          agent="ai-news-scout"
          canAct={over.canAct ?? true}
          hasFolder={over.hasFolder ?? true}
          onRepaired={() => {}}
          setFeedback={() => {}}
        />,
      ),
    );
  }

  /**
   * MAR-705's answer to *"can you figure out how we can do it from dash and not
   * some terminal command?"* — the button has to be on the page.
   */
  it("draws the button and says what it will and will not touch", () => {
    const html = repair();

    expect(html).toContain(REPAIR_AGENT_COPY.heading);
    expect(html).toContain(REPAIR_AGENT_COPY.action);
    expect(html).toContain(REPAIR_AGENT_COPY.detail);
  });

  /**
   * `FolderUpdate`'s rule, kept: nothing at all rather than a section explaining
   * an absence. There is nothing to set up again from, and a browser tab has no
   * controls.
   */
  it("draws nothing where there is no folder or no way to act", () => {
    expect(repair({ hasFolder: false })).toBe("");
    expect(repair({ canAct: false })).toBe("");
  });
});
