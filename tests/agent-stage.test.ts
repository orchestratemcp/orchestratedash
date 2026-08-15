/**
 * The stage router (MAR-641).
 *
 * Three claims, and the third is the one that is easy to get wrong: an unknown
 * stage lands somewhere real, an address that names a stage is honoured, and an
 * address that names none resolves to the run only while one is going. That
 * last rule is the narrow reading of the wireframe's "auto-takes the stage
 * while live" — see `resolveAgentStage` for why the literal reading is a
 * surface that moves under a reader.
 */

import { describe, expect, it } from "vitest";

import { agentStageHref, agentWorkspaceHref, AGENT_WORKSPACE_PARAMS } from "../app/_data/routes";
import {
  AGENT_STAGES,
  isAgentStage,
  resolveAgentStage,
  type AgentStage,
} from "../lib/views/agent-stage";

describe("which part of an agent is on screen", () => {
  it("honours every stage this build can draw", () => {
    for (const stage of AGENT_STAGES) {
      expect(resolveAgentStage(stage, { running: false })).toBe(stage);
      // Even while a run is going: an address that names a stage is somebody's
      // choice, and a run starting must not take the page off them.
      expect(resolveAgentStage(stage, { running: true })).toBe(stage);
    }
  });

  it("sends an unknown stage to the overview rather than to an error", () => {
    // A link from an older build, a typo, and the Health stage before it is
    // built all arrive as a string this build does not know.
    for (const unknown of ["health", "", "Overview", "runs", "../logs"]) {
      expect(resolveAgentStage(unknown, { running: false })).toBe("overview");
    }
    expect(isAgentStage("health")).toBe(false);
    expect(isAgentStage(null)).toBe(false);
  });

  it("resolves an address with no stage by what the agent is doing", () => {
    expect(resolveAgentStage(null, { running: false })).toBe("overview");
    expect(resolveAgentStage(null, { running: true })).toBe("run");
  });

  it("lands a produced agent on what it produced (MAR-646)", () => {
    /*
     * The other half of a deletion. Overview stopped drawing the newest output
     * — the rail beside it was drawing the same heading and the same title —
     * and a subtraction that left the news on no landing page at all would be
     * MAR-576 again. So a link to an agent that has made something opens what
     * it made.
     *
     * `electron/smoke.ts`'s 6p is the same claim on the installed shell: it
     * loads the address with no stage and requires the digest inside
     * `.cockpit-stage`.
     */
    expect(resolveAgentStage(null, { running: false, has_output: true })).toBe("output");
    // A new agent still lands on the checklist, which is where it belongs.
    expect(resolveAgentStage(null, { running: false, has_output: false })).toBe("overview");
    // A live run still outranks it: the run is what is happening now.
    expect(resolveAgentStage(null, { running: true, has_output: true })).toBe("run");
    // And a fragment outranks both, so MAR-586's chip still lands on the queue.
    expect(
      resolveAgentStage(null, { running: false, has_output: true, fragment: "waiting-work" }),
    ).toBe("overview");
    // A stage somebody named beats every one of them.
    expect(resolveAgentStage("chat", { running: false, has_output: true })).toBe("chat");
  });

  it("lets a fragment outrank a live run, so the chip lands on the thing that needs you", () => {
    /*
     * MAR-586's fleet chip links to `#waiting-work` and names no stage. An
     * agent that needs you is very often *also* running — a run waiting on an
     * approval is still a run — so without this the chip would resolve to the
     * Run stage, where that anchor does not exist, and leave somebody looking
     * at a page for a decision that is one stage away. That is the exact
     * failure MAR-586 wrote its fragment effect to fix, arriving by a new door.
     */
    expect(resolveAgentStage(null, { running: true, fragment: "waiting-work" })).toBe("overview");
    expect(resolveAgentStage(null, { running: true, fragment: "work-ap-1" })).toBe("overview");
    // Any fragment, not a list of the two DASH emits: an address carrying one
    // has named something specific.
    expect(resolveAgentStage(null, { running: true, fragment: "anything" })).toBe("overview");
    // An empty fragment is no fragment.
    expect(resolveAgentStage(null, { running: true, fragment: "" })).toBe("run");
    // And a stage somebody named still wins over both.
    expect(resolveAgentStage("logs", { running: true, fragment: "waiting-work" })).toBe("logs");
  });

  it("does not name a stage it cannot draw", () => {
    /*
     * The wireframe names seven and this build has six. Health is absent on
     * purpose — it aggregates facts nothing computes yet — and this test is
     * what stops it being added to the vocabulary before it has a view: a stage
     * id that resolves to an empty room is a dead control wearing a URL.
     */
    expect(AGENT_STAGES).not.toContain("health");
    expect(AGENT_STAGES[0]).toBe("overview");
  });
});

describe("the address of one part of one agent", () => {
  it("round-trips every stage through the link builder", () => {
    for (const stage of AGENT_STAGES) {
      const href = agentStageHref("ai-agent-news", stage);
      const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
      expect(query.get(AGENT_WORKSPACE_PARAMS.agent)).toBe("ai-agent-news");
      const read = query.get(AGENT_WORKSPACE_PARAMS.stage);
      expect(resolveAgentStage(read, { running: false })).toBe(stage as AgentStage);
    }
  });

  it("carries the output the rail asked for, and only when there is one", () => {
    const named = agentStageHref("ai-agent-news", "output", { output: "digest-7" });
    expect(new URLSearchParams(named.slice(named.indexOf("?") + 1)).get("output")).toBe("digest-7");
    const plain = agentStageHref("ai-agent-news", "output");
    expect(plain).not.toContain("output=");
  });

  it("keeps every link written before the cockpit pointing somewhere real", () => {
    /*
     * MAR-586's fleet chip and `lib/open-link.ts` name an agent and no stage.
     * `agentWorkspaceHref` is what they call, so its answer has to stay an
     * address `resolveAgentStage` can read — the guarantee that made the stage
     * optional rather than a breaking change to four surfaces.
     */
    const href = agentWorkspaceHref("ai-agent-news");
    const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(query.get(AGENT_WORKSPACE_PARAMS.stage)).toBeNull();
    const read = query.get(AGENT_WORKSPACE_PARAMS.stage);
    expect(resolveAgentStage(read, { running: false })).toBe("overview");
    // And on an agent that has made something, the same link opens it.
    expect(resolveAgentStage(read, { running: false, has_output: true })).toBe("output");
  });

  it("escapes an agent id rather than pasting it into a query", () => {
    expect(agentStageHref("a&b=c", "logs")).toContain("agent=a%26b%3Dc");
  });
});
