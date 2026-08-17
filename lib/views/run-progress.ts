/**
 * Where a run has got to, and whether it is still going (MAR-680, MAR-685).
 *
 * ## The two asks this answers, in Henrik's own words
 *
 * From the 2026-08-17 attended walk, after pressing Run on the competitor
 * scout: *"The only information we get is that it has started a new run. Not if
 * it finished, or if we can leave the page, or if we have to stand still here
 * for it not to break. I want a loader or a visual indicator on each step so we
 * can see where we are… **This is very important for me.**"*
 *
 * Three separate things are missing in that sentence and this module produces
 * all three: **which step is running now**, **a definite finished state**, and
 * **an explicit answer to "can I leave"**. The page already had a timestamped
 * log of the same events — `buildAgentFeed` — and a log is not a position.
 *
 * ## Why the selection lives here and the feed borrows it
 *
 * MAR-685 was confirmed from `broker_audit`: the run page drew a 15:10 refused
 * run's step log directly beside the 18:33 run's artifact. The cause was
 * `selectFeedRun`, which preferred **any run with no `run_completed` or
 * `run_failed` event** over every finished run, forever — so one run that died
 * without a terminal event pinned the surface to itself and no later run could
 * ever displace it. An absence is not evidence of life.
 *
 * So `selectCurrentRun` is the one selection for the whole run surface, exported
 * and imported by `lib/views/agent-feed.ts` rather than reimplemented there, and
 * it selects **the newest run by start time**. That is what a person means by
 * *the current run*, it is true whether or not anything terminal was ever
 * written, and having one function decide it is what stops the feed, the meters
 * and the step list from drawing three different runs on one screen.
 *
 * Timestamps are parsed rather than compared as strings. Telemetry v1 says
 * date-time and does not say UTC, so `2026-08-17T15:10:14+02:00` and
 * `2026-08-17T18:33:21.000Z` are both legal and a lexical comparison of the two
 * answers by their hour digits. That is a defect nobody would see until two runs
 * on one machine disagreed about their offset.
 *
 * ## Pure, and it must stay so
 *
 * No value import from anything reaching a Node builtin — `tests/client-bundle`
 * is the gate, and this module is rendered by a `"use client"` component. The
 * clock arrives as a parameter for the same reason `lib/workspace.ts` takes one:
 * a module that read `Date.now()` could not be tested against a fixture.
 */

import type { RunEvent } from "../contracts";
import { humanizeAgentName } from "../copy/agent-name";
import { AGENT_RUN_PROGRESS_COPY, describeRunPosition } from "../copy/agent-page";
import { plainClock } from "../copy/when";

/**
 * How long DASH waits before it stops calling a silent run "working".
 *
 * A run that has published no event for two minutes and whose agent is not
 * reporting it is not a run in flight — it is the 15:10 run, which the surface
 * described as live for five hours. Two minutes rather than ten seconds because
 * a step can legitimately be slow: the competitor scout's own choice step took
 * about five minutes, and calling that agent dead mid-step would be a worse lie
 * than the one being fixed.
 *
 * It only ever decides between "working" and "stopped without finishing" for a
 * run the agent's own snapshot has *nothing to say about*. A snapshot that names
 * the run outranks this in every case — see `resolvePhase`.
 */
export const RUN_SILENT_AFTER_MS = 120_000;

export type RunPhase =
  /** Work is happening. The one phase that gets a loader. */
  | "running"
  /** A gate is open and the run cannot proceed without a person. */
  | "waiting"
  | "paused"
  | "finished"
  | "failed"
  /** Cancelled by a person. Not a fault, and not worded as one. */
  | "stopped"
  /**
   * No terminal event, and nothing says it is still going.
   *
   * The state MAR-685's stale run was actually in, and the reason this member
   * exists rather than being folded into `failed`: DASH did not observe a
   * failure, it observed a silence, and reporting a silence as a failure would
   * be DASH inventing an outcome to avoid saying it does not know.
   */
  | "unfinished";

export type RunStepState =
  | "done"
  | "running"
  | "waiting"
  | "failed"
  | "skipped"
  /** Declared by the plan and not reached yet. */
  | "todo"
  /**
   * It started, the run is over, and nothing ever said how this step ended.
   *
   * Distinct from `todo`, which would be a flat untruth about a step that
   * visibly began, and from `failed`, which is a verdict DASH did not observe.
   * The state a run leaves behind when it stops in the middle of something.
   */
  | "unfinished";

export interface RunStepView {
  /** `humanizeAgentName`'s answer, never the raw component id. */
  label: string;
  state: RunStepState;
  /** 1-based, in the order the plan declares or the run reported. */
  position: number;
  /**
   * The step's own detail line when the run wrote one, else null.
   *
   * Only carried for the states where it is the reason a person is reading the
   * row — a failure, or a gate. A detail on a finished step is in the feed with
   * the clock time that makes it a record.
   */
  detail: string | null;
}

export type RunProgressView =
  /** Nothing has ever run. The surface draws its empty state, not a fake one. */
  | { kind: "none" }
  | {
      kind: "run";
      /** A value behind the "open this run" link, never drawn as a label. */
      run_id: string;
      phase: RunPhase;
      /** One word for the phase, already chosen. */
      headline: string;
      /** One sentence about what that word means for this run. */
      detail: string;
      /**
       * Whether the person may walk away, said only while it is worth saying.
       *
       * Null on a run that is over, because a finished run has nothing to
       * interrupt and the sentence would be furniture. See
       * `AGENT_RUN_PROGRESS_COPY.safe_to_leave` for why the claim is about the
       * page and never about closing DASH.
       */
      safe_to_leave: string | null;
      /** "Step 3 of 6", or "3 steps done" when no plan declares a total. */
      position: string;
      steps: RunStepView[];
      /** The clock time the run started, or null when it cannot be read. */
      started: string | null;
      /** The clock time it ended, or null while it has not. */
      ended: string | null;
    };

/** The narrow slice of a declared plan this module reads. */
export interface RunProgressPlanStep {
  step: number;
  component_id: string;
}

/** The narrow slice of the agent's own snapshot this module reads. */
export interface RunProgressRunRow {
  id: string;
  status: string;
}

export interface SelectedRun {
  run_id: string;
  /** This run's events in `seq` order. */
  events: RunEvent[];
  /**
   * Whether the run's own events end in a terminal one.
   *
   * Named for what it is rather than "live". An absence of `run_completed` is
   * the *question* this module answers with `resolvePhase`, not the answer —
   * which is the whole of MAR-685's defect stated as a variable name.
   */
  ended_in_events: boolean;
}

/**
 * The run a person means by "this run": the newest one this agent started.
 *
 * Exported because `lib/views/agent-feed.ts` must select the same one. Two
 * walks of one array choosing two runs is what put a stale step log beside a
 * current artifact, and the fix is not a second correct implementation.
 */
export function selectCurrentRun(events: readonly RunEvent[]): SelectedRun | null {
  const grouped = new Map<string, RunEvent[]>();
  for (const event of events) {
    const bucket = grouped.get(event.run_id) ?? [];
    bucket.push(event);
    grouped.set(event.run_id, bucket);
  }

  let chosen: SelectedRun | null = null;
  let chosenStarted = Number.NEGATIVE_INFINITY;
  let chosenSeq = Number.NEGATIVE_INFINITY;
  for (const [runId, bucket] of grouped) {
    const ordered = [...bucket].sort((a, b) => a.seq - b.seq);
    const started = earliest(ordered);
    const lastSeq = ordered[ordered.length - 1]?.seq ?? 0;
    /*
     * The tie-break is the higher sequence number, and it is not decoration: a
     * run whose every timestamp is unreadable scores `-Infinity` here, and two
     * of those would otherwise be ordered by `Map` insertion — which is the
     * order the store happened to return rows in. `seq` is monotonic per run
     * and is the only other thing telemetry guarantees.
     */
    if (started > chosenStarted || (started === chosenStarted && lastSeq > chosenSeq)) {
      chosen = {
        run_id: runId,
        events: ordered,
        ended_in_events: ordered.some(
          (event) => event.type === "run_completed" || event.type === "run_failed",
        ),
      };
      chosenStarted = started;
      chosenSeq = lastSeq;
    }
  }
  return chosen;
}

/**
 * Everything the run stage says about where this run has got to.
 *
 * The plan supplies the steps that have not happened yet, which is the half a
 * log cannot have: *"Step 2 of 6"* is only sayable because the manifest
 * declared six. An agent with no declared plan still gets a position — the
 * steps it has actually reported — because an agent brought from another
 * toolchain is not one DASH should go silent about.
 */
export function buildRunProgress({
  events,
  now,
  plan,
  runs,
}: {
  /** This agent's telemetry, already filtered to this agent. */
  events: readonly RunEvent[];
  now: Date;
  /** The manifest's declared route, in any order. */
  plan: readonly RunProgressPlanStep[];
  /** The runs the agent's own snapshot reports, or empty when it reports none. */
  runs: readonly RunProgressRunRow[];
}): RunProgressView {
  const selected = selectCurrentRun(events);
  if (selected === null) {
    return { kind: "none" };
  }

  const observed = observeSteps(selected.events);
  const steps = mergeSteps(plan, observed);
  const phase = resolvePhase(selected, runs, now);
  const marked = markCurrent(steps, phase);
  const done = marked.filter((step) => step.state === "done").length;

  return {
    kind: "run",
    run_id: selected.run_id,
    phase,
    headline: AGENT_RUN_PROGRESS_COPY.phase[phase].headline,
    detail: AGENT_RUN_PROGRESS_COPY.phase[phase].detail,
    safe_to_leave: ONGOING.has(phase) ? AGENT_RUN_PROGRESS_COPY.safe_to_leave : null,
    position: describeRunPosition(done, marked.length, ONGOING.has(phase)),
    steps: marked,
    started: clockOf(earliestIso(selected.events)),
    ended: ONGOING.has(phase) ? null : clockOf(latestIso(selected.events)),
  };
}

/** A clock time, or nothing at all when the instant could not be read. */
function clockOf(iso: string | null): string | null {
  return iso === null ? null : plainClock(iso);
}

/** The phases where something could still change without a person doing anything. */
const ONGOING: ReadonlySet<RunPhase> = new Set<RunPhase>(["running", "waiting", "paused"]);

/**
 * The run statuses the agent's own state machine uses for a run in flight.
 *
 * `lib/workspace.ts`'s `RunStatus`, read rather than re-decided. Kept as a
 * string map rather than the union so a status from a newer agent falls through
 * to the event-based reading instead of failing a type check on a value that
 * arrived over a wire.
 */
function phaseFromStatus(status: string): RunPhase | null {
  switch (status) {
    case "queued":
    case "running":
      return "running";
    case "waiting_for_choice":
    case "waiting_for_approval":
      return "waiting";
    case "paused":
      return "paused";
    case "completed":
      return "finished";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
    default:
      return null;
  }
}

/**
 * What state this run is in, from the two records that can say.
 *
 * The order is the argument. A **terminal event** is the run's own last word
 * and outranks everything, including a snapshot that has not caught up. The
 * **agent's snapshot** comes next, because it is a state machine rather than a
 * log and it is the only thing that can distinguish a paused run from a slow
 * one. Only when neither speaks does the **clock** decide, and it decides one
 * question: whether a silence is a run working or a run that stopped.
 */
function resolvePhase(
  selected: SelectedRun,
  runs: readonly RunProgressRunRow[],
  now: Date,
): RunPhase {
  const last = selected.events[selected.events.length - 1];
  if (last?.type === "run_failed") {
    return "failed";
  }
  if (selected.ended_in_events) {
    return selected.events.some((event) => event.type === "run_failed") ? "failed" : "finished";
  }

  const row = runs.find((candidate) => candidate.id === selected.run_id);
  const stated = row === undefined ? null : phaseFromStatus(row.status);
  if (stated !== null) {
    return stated;
  }

  /*
   * A gate the agent asked for and nobody has answered. Read off the events
   * rather than from the snapshot because a snapshot may be absent entirely —
   * an agent whose process exited while an approval was open still has the
   * `gate_requested` in the store, and "waiting for you" is the honest reading
   * of it right up until the silence check below says otherwise.
   */
  const gate = openGate(selected.events);

  /*
   * A run whose every timestamp is unreadable gets `unfinished` too, and that
   * is the right way round: DASH cannot tell how long ago it spoke, so it
   * cannot claim it is speaking now.
   */
  const spokeAt = latestIso(selected.events);
  const spoke = spokeAt === null ? Number.NaN : Date.parse(spokeAt);
  if (!Number.isFinite(spoke) || now.getTime() - spoke > RUN_SILENT_AFTER_MS) {
    return "unfinished";
  }
  return gate ? "waiting" : "running";
}

/** Whether a gate was requested and not resolved. */
function openGate(events: readonly RunEvent[]): boolean {
  let open = false;
  for (const event of events) {
    if (event.type === "gate_requested") {
      open = true;
    }
    if (event.type === "gate_resolved") {
      open = false;
    }
  }
  return open;
}

interface ObservedStep {
  component_id: string;
  state: RunStepState;
  detail: string | null;
}

/**
 * What the run's own events say about each step it named.
 *
 * A later event wins, which is what makes a `step_completed` overwrite the
 * `step_started` before it. `status: "error"` is a failure and `"skipped"` is
 * a skip — both are outcomes telemetry v1 carries and neither is a completion,
 * and rendering either as a tick is the kind of quiet flattery this product
 * does not do.
 *
 * ## The half that is an inference, named rather than hidden
 *
 * **`step_completed` is optional and the shipped agent template never emits
 * one.** `agent-kit/template/agent.mjs` calls `step(componentId, label)` as each
 * step begins and reports nothing when it ends; the run's own `run_completed`
 * is the only completion it writes. Read literally, that agent's every step is
 * running at once — six spinners on a finished run, on DASH's own sample agent.
 *
 * So a `step_started` that a **later step's own start** superseded reads as
 * done. The reading is sound rather than convenient: a runner advances one step
 * at a time, so a step it moved past is a step it got through, and the only
 * other reading — that the run stopped there — is contradicted by the event
 * that came after it. The last started step is the only one left claiming to be
 * running, and `markCurrent` is what decides whether it still may.
 */
function observeSteps(events: readonly RunEvent[]): ObservedStep[] {
  const order: string[] = [];
  const byId = new Map<string, ObservedStep>();
  /** The step whose `step_started` has not yet been superseded or completed. */
  let latest: string | null = null;

  for (const event of events) {
    const id = event.component_id?.trim() ?? "";
    if (id === "" || (event.type !== "step_started" && event.type !== "step_completed")) {
      continue;
    }
    if (!byId.has(id)) {
      order.push(id);
    }
    if (event.type === "step_started") {
      const previous = latest === null ? undefined : byId.get(latest);
      if (previous !== undefined && previous.state === "running" && latest !== id) {
        byId.set(latest as string, { ...previous, state: "done" });
      }
      latest = id;
    } else if (latest === id) {
      latest = null;
    }
    const detail = event.detail?.trim();
    byId.set(id, {
      component_id: id,
      state:
        event.type === "step_started"
          ? "running"
          : event.status === "error"
            ? "failed"
            : event.status === "skipped"
              ? "skipped"
              : "done",
      detail: detail === undefined || detail === "" ? null : detail,
    });
  }

  return order.map((id) => byId.get(id)).filter((step): step is ObservedStep => step !== undefined);
}

/**
 * The declared plan and what actually happened, as one list.
 *
 * Declared order first, because that is the shape a person read before pressing
 * Run and the one that lets a not-yet-reached step be drawn at all. Anything the
 * run reported that the plan never declared is appended rather than dropped: a
 * step DASH cannot place is still a step the agent took, and a progress list
 * that silently omitted it would be a plan pretending to be a record.
 */
function mergeSteps(
  plan: readonly RunProgressPlanStep[],
  observed: readonly ObservedStep[],
): RunStepView[] {
  const seen = new Map(observed.map((step) => [step.component_id, step]));
  const declared = [...plan].sort((a, b) => a.step - b.step);
  const placed = new Set(declared.map((step) => step.component_id));

  const rows: Array<{ id: string; step: ObservedStep | undefined }> = [
    ...declared.map((step) => ({ id: step.component_id, step: seen.get(step.component_id) })),
    ...observed
      .filter((step) => !placed.has(step.component_id))
      .map((step) => ({ id: step.component_id, step })),
  ];

  return rows.map((row, index) => ({
    label: humanizeAgentName(row.id),
    state: row.step?.state ?? "todo",
    position: index + 1,
    detail:
      row.step === undefined || (row.step.state !== "failed" && row.step.state !== "skipped")
        ? null
        : row.step.detail,
  }));
}

/**
 * A run that is over has no step running, whatever its last `step_started` said.
 *
 * This is the render-side half of the same honesty `resolvePhase` applies: an
 * agent that exited mid-step leaves a `step_started` with no completion, and a
 * spinner on that row would go on claiming work is happening on a page that has
 * just said the run stopped.
 *
 * The row becomes `unfinished` and neither of the two easier words. `todo`
 * would be a flat untruth about a step that visibly began — and it is the word
 * this function used in its first draft. `failed` would be a verdict on
 * evidence DASH has not got: what it observed is that the run ended and this
 * step never reported an outcome, which is an absence, and the whole of
 * MAR-685's lesson is that an absence is not evidence of anything in
 * particular.
 *
 * A gate turns the running row into a waiting one, which is the difference
 * between the system working and the system needing a person. The fleet strip
 * draws that same distinction (`fleet-motion.ts`) and the two must not disagree.
 */
function markCurrent(steps: readonly RunStepView[], phase: RunPhase): RunStepView[] {
  return steps.map((step) => {
    if (step.state !== "running") {
      return { ...step };
    }
    if (phase === "waiting") {
      return { ...step, state: "waiting" };
    }
    if (ONGOING.has(phase)) {
      return { ...step };
    }
    return { ...step, state: "unfinished" };
  });
}

/** The earliest readable instant in a run, as a number for comparison. */
function earliest(events: readonly RunEvent[]): number {
  let best = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const at = Date.parse(event.ts);
    if (Number.isFinite(at) && (best === Number.NEGATIVE_INFINITY || at < best)) {
      best = at;
    }
  }
  return best;
}

/** The earliest readable instant, as the string it arrived as. */
function earliestIso(events: readonly RunEvent[]): string | null {
  return edgeIso(events, (candidate, best) => candidate < best);
}

/** The latest readable instant, as the string it arrived as. */
function latestIso(events: readonly RunEvent[]): string | null {
  return edgeIso(events, (candidate, best) => candidate > best);
}

function edgeIso(
  events: readonly RunEvent[],
  wins: (candidate: number, best: number) => boolean,
): string | null {
  let bestAt = Number.NaN;
  let bestIso: string | null = null;
  for (const event of events) {
    const at = Date.parse(event.ts);
    if (!Number.isFinite(at)) {
      continue;
    }
    if (bestIso === null || wins(at, bestAt)) {
      bestAt = at;
      bestIso = event.ts;
    }
  }
  return bestIso;
}
