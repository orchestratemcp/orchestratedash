/**
 * Where a run has got to (MAR-680), and which run that is (MAR-685).
 *
 * Henrik pressed Run on the competitor scout during the 2026-08-17 attended
 * walk and could not find out three things: which step it was on, whether it
 * had finished, and whether leaving the page would break it. Every assertion
 * here is one of those three, or the selection defect that made the first one
 * answer about a five-hour-old run.
 *
 * The interesting half is the **phases**, and specifically the two that are
 * easy to conflate: a run that stopped without saying how, and a run that
 * failed. DASH observed a silence in the first case and a `run_failed` in the
 * second, and reporting the silence as a failure would be a verdict on evidence
 * it has not got — the same discipline `lib/copy/working.ts` states as "never
 * invent a phase the system isn't in".
 */

import { describe, expect, it } from "vitest";

import type { RunEvent, RunEventType } from "../lib/contracts";
import { AGENT_RUN_PROGRESS_COPY, describeRunPosition } from "../lib/copy/agent-page";
import {
  buildRunProgress,
  selectCurrentRun,
  RUN_SILENT_AFTER_MS,
  type RunProgressPlanStep,
  type RunProgressRunRow,
  type RunProgressView,
} from "../lib/views/run-progress";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "competitor-scout";
const RUN = "run-now";
const OLDER = "run-before";

/** The scout's own six, in the order its manifest declares them. */
const PLAN: RunProgressPlanStep[] = [
  { step: 1, component_id: "public_source_fetch" },
  { step: 2, component_id: "signal_sort" },
  { step: 3, component_id: "digest_curate" },
  { step: 4, component_id: "deep_dive_synthesis" },
  { step: 5, component_id: "competitor_choice" },
  { step: 6, component_id: "report_file_write" },
];

const NOW = new Date("2026-08-17T18:36:30.000Z");

function event(seq: number, type: RunEventType, extra: Partial<RunEvent> = {}): RunEvent {
  return {
    event_version: 1,
    agent: AGENT,
    run_id: extra.run_id ?? RUN,
    seq,
    ts: extra.ts ?? `2026-08-17T18:36:${String(seq).padStart(2, "0")}Z`,
    type,
    ...extra,
  };
}

function progress(
  events: readonly RunEvent[],
  over: { plan?: RunProgressPlanStep[]; runs?: RunProgressRunRow[]; now?: Date } = {},
): RunProgressView {
  return buildRunProgress({
    events,
    now: over.now ?? NOW,
    plan: over.plan ?? PLAN,
    runs: over.runs ?? [],
  });
}

/** The view, narrowed, so a test that selected nothing fails loudly. */
function run(view: RunProgressView): Extract<RunProgressView, { kind: "run" }> {
  if (view.kind === "none") {
    throw new Error("no run was selected");
  }
  return view;
}

const WORKING = [
  event(0, "run_started"),
  event(1, "step_started", { component_id: "public_source_fetch" }),
  event(2, "step_completed", { component_id: "public_source_fetch", status: "ok" }),
  event(3, "step_started", { component_id: "signal_sort" }),
];

describe("which step a run is on", () => {
  it("draws nothing at all for an agent that has never run", () => {
    expect(progress([])).toEqual({ kind: "none" });
  });

  it("marks the step that is happening and leaves the rest of the plan visible", () => {
    const view = run(progress(WORKING));
    expect(view.phase).toBe("running");
    expect(view.steps.map((step) => step.state)).toEqual([
      "done",
      "running",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    // The half a log cannot have: the steps that have not happened yet.
    expect(view.steps.map((step) => step.label)).toEqual([
      "Public source fetch",
      "Signal sort",
      "Digest curate",
      "Deep dive synthesis",
      "Competitor choice",
      "Report file write",
    ]);
    expect(view.position).toBe("Step 2 of 6");
  });

  /**
   * `humanizeAgentName`, not the id. `lib/copy/identifiers.ts`'s rule reaches
   * this surface the same way it reaches the feed, and a step list is the most
   * likely place for a slug to arrive on a guided path.
   */
  it("never prints a component id", () => {
    const view = run(progress(WORKING));
    const said = view.steps.map((step) => step.label);
    expectPlainLanguage([...said, view.headline, view.detail, view.position]);
    for (const step of PLAN) {
      expect(said.join("\n")).not.toContain(step.component_id);
    }
  });

  /**
   * DASH's own sample agent's shape, and the one that would have shipped
   * broken.
   *
   * `agent-kit/template/agent.mjs` emits `step_started` per step and **no
   * `step_completed` at all** — the run's own `run_completed` is the only
   * completion it writes. Read literally that agent's every step is running at
   * once, which on a finished run is six spinners on the page DASH ships to
   * demonstrate itself.
   */
  it("reads a step the run moved past as done, even with no completion event", () => {
    const view = run(
      progress([
        event(0, "run_started"),
        event(1, "step_started", { component_id: "public_source_fetch" }),
        event(2, "step_started", { component_id: "signal_sort" }),
        event(3, "step_started", { component_id: "digest_curate" }),
      ]),
    );
    expect(view.steps.slice(0, 3).map((step) => step.state)).toEqual([
      "done",
      "done",
      "running",
    ]);
    expect(view.position).toBe("Step 3 of 6");
  });

  /**
   * And when that run is over, the step it stopped inside is neither of the two
   * easier words. `todo` would be a flat untruth about a step that visibly
   * began; `failed` would be a verdict on evidence DASH has not got.
   */
  it("says a step did not finish rather than that it failed or never started", () => {
    const view = run(
      progress([
        event(0, "run_started"),
        event(1, "step_started", { component_id: "public_source_fetch" }),
        event(2, "run_failed", { status: "error" }),
      ]),
    );
    const states = new Map(view.steps.map((step) => [step.label, step.state]));
    expect(states.get("Public source fetch")).toBe("unfinished");
    // The steps it genuinely never reached still read as not started.
    expect(states.get("Signal sort")).toBe("todo");
  });

  /**
   * An agent from another toolchain declares no `planned_route`, and it must
   * not be an agent DASH goes quiet about. What it did is still a position.
   */
  it("counts what actually ran when no plan declares a total", () => {
    const view = run(progress(WORKING, { plan: [] }));
    expect(view.steps.map((step) => step.label)).toEqual(["Public source fetch", "Signal sort"]);
    expect(view.position).toBe("Step 2 of 2");
  });

  /**
   * A step the run reported that the plan never declared is appended rather
   * than dropped. It is still a step the agent took, and a list that omitted it
   * would be a plan wearing a record's clothes.
   */
  it("keeps a step the run took that the plan did not declare", () => {
    const view = run(
      progress([...WORKING, event(4, "step_started", { component_id: "extra_pass" })]),
    );
    expect(view.steps).toHaveLength(7);
    expect(view.steps[6]?.label).toBe("Extra pass");
    expect(view.steps[6]?.state).toBe("running");
  });

  it("does not tick a step that errored or was skipped, and says which", () => {
    const view = run(
      progress([
        event(0, "run_started"),
        event(1, "step_completed", {
          component_id: "digest_curate",
          status: "error",
          detail: "the model provider is not connected",
        }),
        event(2, "step_completed", { component_id: "deep_dive_synthesis", status: "skipped" }),
      ]),
    );
    const states = new Map(view.steps.map((step) => [step.label, step]));
    expect(states.get("Digest curate")?.state).toBe("failed");
    expect(states.get("Digest curate")?.detail).toBe("the model provider is not connected");
    expect(states.get("Deep dive synthesis")?.state).toBe("skipped");
  });
});

describe("whether the run is over", () => {
  it("says finished, definitely, and stops offering the leave line", () => {
    const view = run(progress([...WORKING, event(9, "run_completed")]));
    expect(view.phase).toBe("finished");
    expect(view.headline).toBe(AGENT_RUN_PROGRESS_COPY.phase.finished.headline);
    expect(view.ended).not.toBeNull();
    // A finished run has nothing to interrupt, so the reassurance would be
    // furniture. See the field's own note.
    expect(view.safe_to_leave).toBeNull();
  });

  it("says it can be left while it is going, and says it about the page", () => {
    const view = run(progress(WORKING));
    expect(view.safe_to_leave).toBe(AGENT_RUN_PROGRESS_COPY.safe_to_leave);
    expect(view.ended).toBeNull();
    /*
     * The claim stops at the page on purpose. Whether a run survives DASH
     * *closing* is per agent (`continues_when_dash_closed`) and is on the Logs
     * stage; a sentence here that mentioned closing would be composing a claim
     * from a field this view does not read.
     */
    expect(view.safe_to_leave).not.toContain("clos");
  });

  it("distinguishes a run that failed from one that went quiet", () => {
    const failed = run(progress([...WORKING, event(9, "run_failed", { status: "error" })]));
    expect(failed.phase).toBe("failed");

    /*
     * MAR-685's run, exactly: two steps, no terminal event, and nothing in the
     * agent's snapshot that knows about it. The old surface called this
     * "working" for five hours.
     */
    const quiet = run(
      progress(WORKING, { now: new Date(NOW.getTime() + RUN_SILENT_AFTER_MS + 1_000) }),
    );
    expect(quiet.phase).toBe("unfinished");
    expect(quiet.headline).not.toBe(AGENT_RUN_PROGRESS_COPY.phase.failed.headline);
    // And no spinner left running on a step of a run that is over.
    expect(quiet.steps.some((step) => step.state === "running")).toBe(false);
  });

  it("keeps calling a slow step working, because a slow step is not a dead run", () => {
    // The scout's own competitor-choice step took about five minutes. Calling
    // that agent dead mid-step would be a worse lie than the one being fixed.
    const view = run(progress(WORKING, { now: new Date(NOW.getTime() + 60_000) }));
    expect(view.phase).toBe("running");
  });

  /**
   * The agent's own state machine outranks the clock, and it is the only record
   * that can tell a paused run from a slow one.
   */
  it("believes the snapshot over the silence", () => {
    const late = new Date(NOW.getTime() + RUN_SILENT_AFTER_MS + 1_000);
    for (const [status, phase] of [
      ["running", "running"],
      ["queued", "running"],
      ["paused", "paused"],
      ["waiting_for_approval", "waiting"],
      ["waiting_for_choice", "waiting"],
      ["cancelled", "stopped"],
      ["completed", "finished"],
    ] as const) {
      const view = run(progress(WORKING, { now: late, runs: [{ id: RUN, status }] }));
      expect(view.phase, status).toBe(phase);
    }
  });

  /**
   * A terminal event outranks the snapshot in the other direction, because it
   * is the run's own last word and a snapshot drained five seconds ago is not.
   */
  it("believes a finished run over a snapshot that has not caught up", () => {
    const view = run(
      progress([...WORKING, event(9, "run_completed")], {
        runs: [{ id: RUN, status: "running" }],
      }),
    );
    expect(view.phase).toBe("finished");
  });

  it("reads an unanswered gate as waiting for a person rather than as working", () => {
    const view = run(progress([...WORKING, event(4, "gate_requested")]));
    expect(view.phase).toBe("waiting");
    // The step under the gate is waiting too — the system is not working, a
    // person is being waited for, and the two must not look the same.
    expect(view.steps.some((step) => step.state === "waiting")).toBe(true);
    expect(view.steps.some((step) => step.state === "running")).toBe(false);
  });

  it("goes back to working once the gate is answered", () => {
    const view = run(
      progress([...WORKING, event(4, "gate_requested"), event(5, "gate_resolved")]),
    );
    expect(view.phase).toBe("running");
  });
});

describe("which run is described", () => {
  /**
   * The whole of MAR-685 in one assertion. See `tests/agent-feed.test.ts` for
   * the same case against the log, and `lib/views/run-progress.ts` for why one
   * function decides it for both.
   */
  it("describes the newest run, not an older one that never ended", () => {
    const selected = selectCurrentRun([
      event(0, "run_started", { run_id: OLDER, ts: "2026-08-17T13:10:20Z" }),
      event(1, "step_started", { run_id: OLDER, component_id: "digest_curate", ts: "2026-08-17T13:10:24Z" }),
      event(0, "run_started", { ts: "2026-08-17T18:33:21Z" }),
      event(1, "run_completed", { ts: "2026-08-17T18:36:02Z" }),
    ]);
    expect(selected?.run_id).toBe(RUN);
    expect(selected?.ended_in_events).toBe(true);
  });

  it("finds nothing rather than inventing a run", () => {
    expect(selectCurrentRun([])).toBeNull();
  });
});

describe("the position sentence", () => {
  it("counts forward while working and backward once it is over", () => {
    // Two tenses, because a person watching wants to know which step is
    // happening and a person reading afterwards wants to know how many ran.
    expect(describeRunPosition(2, 6, true)).toBe("Step 3 of 6");
    expect(describeRunPosition(6, 6, false)).toBe("All 6 steps ran");
    expect(describeRunPosition(2, 6, false)).toBe("2 of 6 steps ran");
  });

  it("never counts past the end of the plan", () => {
    // The last step being done must not read as "Step 7 of 6" for the moment
    // between its completion and the run's own terminal event.
    expect(describeRunPosition(6, 6, true)).toBe("Step 6 of 6");
  });

  it("says something for a run that reported no steps at all", () => {
    expect(describeRunPosition(0, 0, true)).toBe("Starting");
    expect(describeRunPosition(0, 0, false)).toBe("No steps were reported");
  });
});

describe("every sentence this panel can say", () => {
  it("is plain language in every phase", () => {
    const said = Object.values(AGENT_RUN_PROGRESS_COPY.phase).flatMap((phase) => [
      phase.headline,
      phase.detail,
    ]);
    expectPlainLanguage([
      ...said,
      AGENT_RUN_PROGRESS_COPY.heading,
      AGENT_RUN_PROGRESS_COPY.safe_to_leave,
      AGENT_RUN_PROGRESS_COPY.open_output,
      AGENT_RUN_PROGRESS_COPY.step_done,
      AGENT_RUN_PROGRESS_COPY.step_failed,
      AGENT_RUN_PROGRESS_COPY.step_running,
      AGENT_RUN_PROGRESS_COPY.step_skipped,
      AGENT_RUN_PROGRESS_COPY.step_todo,
      AGENT_RUN_PROGRESS_COPY.step_unfinished,
      AGENT_RUN_PROGRESS_COPY.step_waiting,
    ]);
  });

  /**
   * A phase with no sentence behind it would render `undefined` into the page —
   * the failure `AGENT_CONTROL_COPY.idle`'s own test exists for, on a union
   * with twice as many arms.
   */
  it("has a headline and a detail for every phase the builder can produce", () => {
    for (const phase of [
      "running",
      "waiting",
      "paused",
      "finished",
      "failed",
      "stopped",
      "unfinished",
    ] as const) {
      expect(AGENT_RUN_PROGRESS_COPY.phase[phase].headline, phase).toBeTruthy();
      expect(AGENT_RUN_PROGRESS_COPY.phase[phase].detail, phase).toBeTruthy();
    }
  });
});
