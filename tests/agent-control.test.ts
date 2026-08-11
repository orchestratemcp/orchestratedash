/**
 * What the agent page offers to press, in every state (MAR-609).
 *
 * ## The regression this exists to catch
 *
 * The old page decided this inline in `RunNow` with two early returns, and the
 * three different reasons for "no button" all rendered as the same nothing. The
 * consequence was that a freshly added agent — the state every new user meets —
 * had no run control and no sentence saying why. `buildAgentControl` replaces
 * the nulls with a reason, and the value of that is entirely in the union
 * having no arm that means "draw nothing": these tests hold it to that.
 */

import { describe, expect, it } from "vitest";

import { buildAgentControl } from "../lib/views/agent-control";
import type { WorkspaceSnapshotView } from "../lib/views/types";

const OBSERVED = "2026-08-11T09:00:00.000Z";

function snapshot(over: Partial<WorkspaceSnapshotView> = {}): WorkspaceSnapshotView {
  return {
    observed_at: OBSERVED,
    received_at: OBSERVED,
    overview: {
      agent_id: "news-scout",
      title: "AI News Scout",
      goal: "Find the news",
      status: "ready",
      status_detail: "This agent is connected and ready to run.",
      runtime_label: "This computer",
      continues_when_dash_closed: false,
      offline_behavior: null,
      trigger_label: "When you ask",
      last_activity_at: null,
      next_action: null,
    },
    inbox: [],
    runs: [],
    tasks: [],
    connections: [],
    memory: [],
    approval_decisions: [],
    audit_events: [],
    command_audit: [],
    plan_vs_actual: null,
    ...over,
  };
}

describe("an agent that has not reported", () => {
  /**
   * The defect in one test. A null snapshot is the state a just-added agent is
   * in, and the old page drew no control and said nothing about it.
   */
  it("still has a status and a stated reason rather than nothing", () => {
    const control = buildAgentControl(null, true);

    expect(control.run).toEqual({ kind: "idle", reason: "not_reported" });
    expect(control.status.label).toBe("Not reported");
    expect(control.status.detail).not.toBe("");
  });

  it("blames the window rather than the agent when the window cannot act", () => {
    // A browser tab reading the same agent must not be told the agent has not
    // reported — that is a claim about the agent, and it would be false.
    expect(buildAgentControl(null, false).run).toEqual({
      kind: "idle",
      reason: "read_only",
    });
  });
});

describe("an agent that has reported", () => {
  it("offers Run now for a pending task with no run", () => {
    const control = buildAgentControl(
      snapshot({
        tasks: [{ id: "task-1", label: "Collect the news", status: "pending", run_id: null, detail: null, created_at: OBSERVED }],
      }),
      true,
    );

    expect(control.run).toEqual({
      kind: "run_now",
      task_id: "task-1",
      observed_at: OBSERVED,
    });
  });

  /**
   * The predicate has to stay exactly `RunNow`'s. Widening it — offering Run
   * now whenever the agent looks idle — would put a button on screen that
   * `submitAgentCommand` refuses, and the refusal arrives after the press.
   */
  it("says nothing is waiting rather than offering a run that would be refused", () => {
    const control = buildAgentControl(
      snapshot({
        tasks: [{ id: "task-1", label: "Done", status: "complete", run_id: "run-1", detail: null, created_at: OBSERVED }],
      }),
      true,
    );

    expect(control.run).toEqual({ kind: "idle", reason: "nothing_waiting" });
  });

  it("hoists a live run's own controls instead of a second Run now", () => {
    const control = buildAgentControl(
      snapshot({
        // The agent's own reported status, which is where the tone comes from.
        // `deriveStatus` sets this to "running" alongside a running run, so a
        // fixture with one and not the other would be a snapshot the runner
        // never publishes.
        overview: { ...snapshot().overview, status: "running" },
        runs: [
          {
            id: "run-1",
            status: "running",
            started_at: null,
            finished_at: null,
            current_step: null,
            progress: null,
            controls: [
              { command: "pause", label: "Pause" },
              { command: "cancel", label: "Cancel" },
            ],
          },
        ],
        // A pending task as well, so this proves the live run *outranks* it
        // rather than merely being found first in an empty list.
        tasks: [{ id: "task-1", label: "Next", status: "pending", run_id: null, detail: null, created_at: OBSERVED }],
      }),
      true,
    );

    expect(control.run.kind).toBe("live");
    if (control.run.kind !== "live") return;
    expect(control.run.controls.map((one) => one.command)).toEqual(["pause", "cancel"]);
    expect(control.status.tone).toBe("live");
  });

  it("reads a read-only window as read-only whatever the agent is doing", () => {
    const control = buildAgentControl(
      snapshot({
        tasks: [{ id: "task-1", label: "Collect", status: "pending", run_id: null, detail: null, created_at: OBSERVED }],
      }),
      false,
    );

    expect(control.run).toEqual({ kind: "idle", reason: "read_only" });
    // The status is still reported. A window that cannot act can still show.
    expect(control.status.label).toBe("Ready");
  });
});

describe("the status pill", () => {
  /**
   * Three tones and not seven. A palette with one colour per status is a legend
   * a person has to learn, and this is the first element on the page.
   */
  it("is loud only for the states that need a person", () => {
    const tone = (status: WorkspaceSnapshotView["overview"]["status"]) =>
      buildAgentControl(snapshot({ overview: { ...snapshot().overview, status } }), true).status
        .tone;

    expect(tone("ready")).toBe("calm");
    expect(tone("paused")).toBe("calm");
    expect(tone("inactive")).toBe("calm");
    expect(tone("running")).toBe("live");
    expect(tone("needs_attention")).toBe("attention");
    expect(tone("offline")).toBe("attention");
    expect(tone("error")).toBe("attention");
    expect(tone("stalled")).toBe("attention");
  });

  it("says a status as a person would rather than as the enum spells it", () => {
    const control = buildAgentControl(
      snapshot({ overview: { ...snapshot().overview, status: "needs_attention" } }),
      true,
    );

    expect(control.status.label).toBe("Needs attention");
  });
});
