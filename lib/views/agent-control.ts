/**
 * What the agent page's control panel and tiles can offer, decided once
 * (MAR-609).
 *
 * ## Why this is a module and not four ternaries in the page
 *
 * The old page decided "is there a button" inline, in `RunNow`, with two early
 * returns:
 *
 * ```ts
 * if (!canAct || snapshot === null) return null;
 * const waiting = snapshot.tasks.find(…);
 * if (waiting === undefined) return null;
 * ```
 *
 * Three different reasons for no control, all rendering as the same nothing.
 * The consequence is the defect MAR-609 was filed on, in its sharpest form: a
 * freshly added agent — the state every new user meets — showed **no run
 * button and no sentence saying why**, and the page around it was full of prose
 * about everything else. A person who had just added an agent could not start
 * it and could not find out that they could not.
 *
 * Returning a *reason* instead of a null forces every caller to render
 * something, which is the whole point. `AGENT_CONTROL_COPY.idle` has a sentence
 * for each of the three.
 *
 * ## What this module may not do
 *
 * It is pure and it reads nothing. No disk, no store, no clock — it is handed a
 * snapshot the view already built and returns a decision about it, so it can be
 * imported into the `"use client"` tree without dragging `node:fs` into the
 * browser bundle. `tests/client-bundle` is the gate on that and this module is
 * inside it.
 *
 * It also invents no verbs. `pause`, `resume` and `cancel` arrive already
 * worded on `WorkspaceRunView.controls`, decided by the agent's own state
 * machine in `lib/workspace.ts`. This hoists them; it does not second-guess
 * which are available, because a control panel that computed its own answer
 * would be free to offer Resume on a run the state machine considers finished.
 */

import type { AvailableControl, WorkspaceStatus } from "../workspace";
import type { WorkspaceSnapshotView } from "./types";

/**
 * How loudly the status pill reads.
 *
 * Deliberately three and not seven. The pill is a glance, and a palette with
 * one colour per status would be a legend a person has to learn — MAR-423's
 * calm-default rule applied to the one element that is on screen before
 * anything else. `attention` is the only one that is allowed to be loud, and
 * exactly one status earns it.
 */
export type StatusTone = "calm" | "live" | "attention";

const STATUS_TONE: Record<WorkspaceStatus, StatusTone> = {
  inactive: "calm",
  ready: "calm",
  running: "live",
  paused: "calm",
  needs_attention: "attention",
  offline: "attention",
  error: "attention",
  stalled: "attention",
};

/**
 * The primary action, or the reason there is not one.
 *
 * A union rather than an optional button, so that "DASH cannot start this" and
 * "DASH is already running this" cannot collapse into the same render — they
 * did on the old page, and both looked like an absent feature.
 */
export type AgentRunControl =
  | {
      kind: "run_now";
      /** Pending Agent DOM task, or null for a trusted taskless fresh run. */
      task_id: string | null;
      /** The snapshot's own value, never re-read. See `RunNow`'s note on MAR-464. */
      observed_at: string;
    }
  | {
      kind: "live";
      run_id: string;
      observed_at: string;
      /** The state machine's own verbs, in its own words. */
      controls: AvailableControl[];
    }
  | {
      kind: "idle";
      /** Which sentence in `AGENT_CONTROL_COPY.idle` answers this. */
      reason: "not_reported" | "nothing_waiting" | "read_only";
    };

export interface AgentControlView {
  status: {
    /** The status as a person would say it, not the underscored enum value. */
    label: string;
    tone: StatusTone;
    detail: string;
  };
  run: AgentRunControl;
}

/**
 * Read the control panel off a snapshot.
 *
 * The order of the branches is the order of what dominates the screen: a run in
 * flight outranks a task waiting to start, because a person looking at a
 * working agent wants Pause and not a second Run now.
 */
export function buildAgentControl(
  snapshot: WorkspaceSnapshotView | null,
  canAct: boolean,
): AgentControlView {
  if (snapshot === null) {
    return {
      // Said in DASH's own words rather than left blank. An agent with no
      // snapshot has a real state and "Not reported" is it — the old page's
      // status heading simply did not render, so the tile it now fills was an
      // absence rather than a fact.
      status: {
        label: "Not reported",
        tone: "calm",
        detail: "This agent has not published its state to DASH yet.",
      },
      run: { kind: "idle", reason: canAct ? "not_reported" : "read_only" },
    };
  }

  const { overview } = snapshot;
  const status = {
    label: sentence(overview.status),
    tone: STATUS_TONE[overview.status],
    detail: overview.status_detail,
  };

  if (!canAct) {
    return { status, run: { kind: "idle", reason: "read_only" } };
  }

  const live = snapshot.runs.find((run) => run.status === "running");
  if (live !== undefined && live.controls.length > 0) {
    return {
      status,
      run: {
        kind: "live",
        run_id: live.id,
        observed_at: snapshot.observed_at,
        controls: live.controls,
      },
    };
  }

  /*
   * A real pending task remains the first choice. It may carry work the agent
   * published, so targetless retry does not discard it merely because a fresh
   * run can now exist without one.
   */
  const waiting = snapshot.tasks.find(
    (task) => task.status === "pending" && task.run_id === null,
  );
  if (waiting !== undefined) {
    return {
      status,
      run: { kind: "run_now", task_id: waiting.id, observed_at: snapshot.observed_at },
    };
  }

  /*
   * MAR-621. Empty is not permission. `workspaceSnapshot` computed this from
   * the manifest and `availableControls(manifest, state, null)`, so unsupported
   * control, a live run, or an unsafe fresh retry still gets a stated reason
   * instead of a button that is refused after the press.
   */
  return snapshot.can_start_without_task
    ? {
        status,
        run: { kind: "run_now", task_id: null, observed_at: snapshot.observed_at },
      }
    : { status, run: { kind: "idle", reason: "nothing_waiting" } };
}

/**
 * `needs_attention` into "Needs attention".
 *
 * The old page did this inline with `.replaceAll("_", " ")` in three places and
 * got a lower-case heading out of it. Sentence case, because a status is a
 * label and not a heading — the same call `humanizeAgentName` makes.
 */
function sentence(value: string): string {
  const words = value.replaceAll("_", " ");
  return words[0].toUpperCase() + words.slice(1);
}
