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

/**
 * The two things DASH can hold for an agent, named once (MAR-703).
 *
 * `HELD` is the ordinary agent: imported through any of the three doors, with a
 * registration naming a program the runner could spawn. `UNHELD` is ADR 0008's
 * manifest-only standing — DASH knows the plan and has nothing to run.
 *
 * Every call names one of them, which is the point of the parameter being an
 * object: `buildAgentControl(snapshot, true, true)` would be a fixture one
 * transposition away from asserting the opposite of what it reads.
 */
const HELD = { startable: true } as const;
const UNHELD = { startable: false } as const;

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
   * MAR-703, and the defect in one test.
   *
   * A snapshot only ever arrives from a running agent, so an agent that has
   * never run on this store has none — the state a fresh import is in, and the
   * state every agent was in after the 2026-08-19 store restore rebuilt the
   * `agents` table from folders. This branch answered all of them with a
   * sentence and no button, which closed the loop Henrik reported: no snapshot,
   * no start control, no run, no snapshot.
   *
   * ADR 0022 had already decided DASH may start a registered agent whose process
   * is not running. It could never fire here, because it is gated on a status
   * read off the snapshot this branch returns above.
   */
  it("offers a start when DASH holds a program, though nothing has reported", () => {
    const control = buildAgentControl(null, true, HELD);

    expect(control.run).toEqual({ kind: "start", observed_at: null });
  });

  /**
   * The status tile is the agent's own word and the button is DASH's, and the
   * two are allowed to disagree.
   *
   * "Not reported" stays true beside a Start button — nothing has reported —
   * and relabelling the tile to match the control would put a claim about the
   * process into the one field that only ever carries the agent's own report.
   */
  it("still says the agent has reported nothing, beside the button", () => {
    const control = buildAgentControl(null, true, HELD);

    expect(control.status.label).toBe("Not reported");
    expect(control.status.detail).not.toBe("");
  });

  /**
   * What the sentence is *for*, after the narrowing.
   *
   * MAR-609 built `not_reported` because a freshly added agent once showed no
   * button and no explanation. That is still the right answer for the agent DASH
   * genuinely cannot run — ADR 0008's manifest-only standing — and this holds
   * the sentence to that population rather than letting the fix delete it.
   */
  it("keeps the stated reason for an agent DASH holds no program for", () => {
    const control = buildAgentControl(null, true, UNHELD);

    expect(control.run).toEqual({ kind: "idle", reason: "not_reported" });
    expect(control.status.label).toBe("Not reported");
  });

  /**
   * The one refusal that is about the window rather than the agent, and it
   * outranks the new branch as it outranks every other.
   *
   * A browser tab reading the same agent must not be told the agent has not
   * reported — that is a claim about the agent, and it would be false — and it
   * must certainly not be offered a spawn it cannot reach.
   */
  it("blames the window rather than the agent when the window cannot act", () => {
    for (const holding of [HELD, UNHELD]) {
      expect(buildAgentControl(null, false, holding).run).toEqual({
        kind: "idle",
        reason: "read_only",
      });
    }
  });
});

describe("an agent that has reported", () => {
  it("offers Run now for a pending task with no run", () => {
    const control = buildAgentControl(
      snapshot({
        tasks: [{ id: "task-1", label: "Collect the news", status: "pending", run_id: null, detail: null, created_at: OBSERVED }],
      }),
      true,
      HELD,
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
      HELD,
    );

    expect(control.run).toEqual({ kind: "idle", reason: "nothing_waiting" });
  });

  /**
   * MAR-657. The sentence survives, and this is the test that says so.
   *
   * The fix adds a way to start; it does not delete the explanation MAR-609
   * built. A *running* agent with nothing pending still gets `nothing_waiting`
   * and no button, which is the case the one above covers — this asserts the
   * distinction the new branch could have destroyed by widening.
   */
  it("keeps nothing_waiting for a live agent and does not offer to start it again", () => {
    for (const status of ["ready", "running", "paused", "inactive", "needs_attention"] as const) {
      const control = buildAgentControl(
        snapshot({ overview: { ...snapshot().overview, status } }),
        true,
        HELD,
      );

      expect(control.run).toEqual({ kind: "idle", reason: "nothing_waiting" });
    }
  });

  it.each(["offline", "error"] as const)("offers a start for %s", (status) => {
    const control = buildAgentControl(
      snapshot({ overview: { ...snapshot().overview, status } }),
      true,
      HELD,
    );

    expect(control.run).toEqual({ kind: "start", observed_at: OBSERVED });
  });

  /**
   * The regression this branch's *placement* exists for.
   *
   * `runner/state.ts` gates `runs`, `choices`, `actions` and
   * `approval_requests` on the process being live. `tasks` is the one array it
   * does not — a dead agent's last self-report keeps them verbatim. So an agent
   * that ran and then exited still carries its pending `waiting-to-be-run`, and
   * a `run_now` decided from that would draw a button whose `retry` the
   * supervisor answers with `not_running`: the after-the-press refusal this
   * module refuses to create, arriving by a different road.
   */
  it("offers a start rather than a Run now the supervisor would refuse", () => {
    const control = buildAgentControl(
      snapshot({
        overview: { ...snapshot().overview, status: "offline" },
        // Exactly what a stopped kit agent's stale report looks like.
        tasks: [
          {
            id: "waiting-to-be-run",
            label: "Waiting to be run",
            status: "pending",
            run_id: null,
            detail: null,
            created_at: OBSERVED,
          },
        ],
      }),
      true,
      HELD,
    );

    expect(control.run).toEqual({ kind: "start", observed_at: OBSERVED });
  });

  /**
   * A browser tab must not be offered a spawn. `read_only` outranks every
   * branch below it and this keeps it that way — the one refusal that is about
   * the window rather than the agent.
   */
  it("offers nothing to a window that cannot act", () => {
    const control = buildAgentControl(
      snapshot({ overview: { ...snapshot().overview, status: "offline" } }),
      false,
      HELD,
    );

    expect(control.run).toEqual({ kind: "idle", reason: "read_only" });
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
      HELD,
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
      HELD,
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
      buildAgentControl(snapshot({ overview: { ...snapshot().overview, status } }), true, HELD).status
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
      HELD,
    );

    expect(control.status.label).toBe("Needs attention");
  });
});
