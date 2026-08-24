/**
 * What the Settings stage says about a schedule (MAR-742 item 8, ADR 0029).
 *
 * The planner being right and the panel saying something else is the specific
 * way a scheduler loses somebody's trust, because the sentence is the only
 * evidence they have. So the sentence has its own tests.
 */

import { describe, expect, it } from "vitest";

import { AGENT_TRIGGER_COPY } from "../lib/copy/agent-page";
import { buildAgentScheduleView } from "../lib/views/agent-schedule";
import type { AgentSchedule, ScheduleSettlement } from "../lib/schedule/plan";

const standing: AgentSchedule = {
  agent: "scout",
  enabled: true,
  kind: "daily",
  at_local: "08:00",
  created_at: "2026-08-24T12:00:00.000Z",
};

function settled(
  outcome: ScheduleSettlement["outcome"],
  due = "2026-08-25T06:00:00.000Z",
): ScheduleSettlement {
  return {
    agent: "scout",
    due_at: due,
    settled_at: "2026-08-25T06:00:12.000Z",
    outcome,
    detail: "A sentence the runner wrote.",
  };
}

describe("an agent nobody has scheduled", () => {
  it("says so, and says nothing else", () => {
    const view = buildAgentScheduleView(null, []);
    expect(view.at_local).toBeNull();
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.none_standing);
    expect(view.last).toBeNull();
  });

  /**
   * The liveness sentences and the spend sentence are about *your schedule*.
   *
   * Under a panel with none they would be DASH explaining the limits of a
   * feature nobody has asked for — the *"describing its own internals at
   * somebody who came to look at their agent"* failure `ModelChoice` names, and
   * the reason that component draws nothing for an agent with no model.
   */
  it("does not explain the limits of a feature nobody has asked for", () => {
    const view = buildAgentScheduleView(null, []);
    expect(view.liveness).toEqual([]);
    expect(view.no_spend).toBe("");
  });
});

describe("an agent with a schedule", () => {
  it("says the time back in the person's own terms", () => {
    const view = buildAgentScheduleView(standing, []);
    expect(view.at_local).toBe("08:00");
    expect(view.standing_line).toContain("08:00");
    expect(view.standing_line).toContain("this computer");
  });

  it("carries all three liveness sentences and the spend one", () => {
    const view = buildAgentScheduleView(standing, []);
    expect(view.liveness).toHaveLength(3);
    expect(view.no_spend).toBe(AGENT_TRIGGER_COPY.no_spend);
  });

  /**
   * A row with `enabled` false should not exist — turning a schedule off deletes
   * it — so if one ever reaches here it is read as no schedule rather than as a
   * cadence that is somehow standing and off at once.
   */
  it("treats a disabled row as no schedule at all", () => {
    const view = buildAgentScheduleView({ ...standing, enabled: false }, []);
    expect(view.at_local).toBeNull();
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.none_standing);
  });
});

describe("what became of the last window", () => {
  it("shows the newest and counts what is behind it", () => {
    const view = buildAgentScheduleView(standing, [
      settled("missed", "2026-08-27T06:00:00.000Z"),
      settled("ran", "2026-08-26T06:00:00.000Z"),
      settled("ran", "2026-08-25T06:00:00.000Z"),
    ]);
    expect(view.last?.due_at).toBe("2026-08-27T06:00:00.000Z");
    expect(view.settled_count).toBe(3);
  });

  it("words each outcome", () => {
    expect(buildAgentScheduleView(standing, [settled("ran")]).last?.outcome_label).toBe("Ran");
    expect(buildAgentScheduleView(standing, [settled("missed")]).last?.outcome_label).toBe("Missed");
    expect(buildAgentScheduleView(standing, [settled("refused")]).last?.outcome_label).toBe(
      "Did not start",
    );
  });

  /**
   * A missed window is a warning, not an error, and the distinction is the whole
   * content of the two values: the computer was not there, nothing is broken,
   * and colouring it red would send somebody to fix a laptop that was asleep
   * because they closed it.
   */
  it("colours a missed window as a warning and a refusal as an error", () => {
    expect(buildAgentScheduleView(standing, [settled("ran")]).last?.outcome_tone).toBe("ok");
    expect(buildAgentScheduleView(standing, [settled("missed")]).last?.outcome_tone).toBe("warn");
    expect(buildAgentScheduleView(standing, [settled("refused")]).last?.outcome_tone).toBe("err");
  });

  /**
   * The runner's own sentence, verbatim.
   *
   * A receipt in ADR 0012's sense: the detail says what happened and DASH's
   * paraphrase of it would be a second account of an event nobody watched.
   */
  it("keeps the runner's own sentence rather than restating it", () => {
    const view = buildAgentScheduleView(standing, [settled("missed")]);
    expect(view.last?.detail).toBe("A sentence the runner wrote.");
  });

  /**
   * ADR 0029: the history outlives the instruction, so the panel still shows it
   * after somebody turns the cadence off — which is exactly when they are
   * looking for it.
   */
  it("survives the schedule being turned off", () => {
    const view = buildAgentScheduleView(null, [settled("refused")]);
    expect(view.standing_line).toBe(AGENT_TRIGGER_COPY.none_standing);
    expect(view.last?.outcome).toBe("refused");
  });
});
