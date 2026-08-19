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
 * The statuses that mean the local process is not running (MAR-657).
 *
 * Exactly the two `runner/state.ts` produces when its child is not live, and
 * exactly the two `SELF_REPORTABLE_STATUSES` forbids an agent from claiming for
 * itself. That asymmetry is what makes this set safe to spawn from: every other
 * status in the table is something a *running* agent said about itself, and
 * starting a process because the process told us it was idle would be a spawn
 * decided by the thing being spawned.
 */
const STOPPED: ReadonlySet<WorkspaceStatus> = new Set(["offline", "error"]);

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
      /** The pending task this press binds to. */
      task_id: string;
      /** The snapshot's own value, never re-read. See `RunNow`'s note on MAR-464. */
      observed_at: string;
    }
  | {
      /**
       * The agent is registered on this computer and its process is not running
       * (MAR-657).
       *
       * Distinct from `run_now` because the press is a different act on a
       * different channel: this one asks the runner to *start the process*
       * (`runner.start` → `POST /agents/{id}/lifecycle`), and only then binds the
       * task that starting it produces. `run_now` binds a task that already
       * exists and starts no process at all.
       */
      kind: "start";
      /**
       * The snapshot's own value, never re-read — `run_now`'s rule, and it
       * matters less here only because the task this press eventually binds is
       * one the agent has not published yet. Carried so the caller has the same
       * freshness token for the second half.
       *
       * **Null when there is no snapshot at all (MAR-703).** That is the state
       * an agent is in before it has ever reported on this store, and it is one
       * of the two this control now answers — so there is no observation to
       * carry, and inventing a timestamp would assert a freshness DASH does not
       * have. Nothing reads it on this arm: `startAndRun` polls for the task the
       * press produces and pairs *that* read's `observed_at` with the `retry`,
       * which is the only pairing the command layer accepts.
       */
      observed_at: string | null;
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

/**
 * What DASH holds for this agent, as against what the agent has said (MAR-703).
 *
 * An object rather than a third positional boolean, and the reason is the one
 * `AgentControls.onStart` gives about its own callback: `(snapshot, true, true)`
 * is a call one transposition away from offering to spawn a process, and the
 * two flags here mean opposite kinds of thing — one is about the window, the
 * other about the disk. Named at every call site, they cannot be swapped
 * silently.
 *
 * It is deliberately not the registration itself. This module reads nothing and
 * must not learn how to; a caller that handed it a `ManagedRegistration` would
 * be handing the client bundle a shape whose home is `node:fs`, and
 * `tests/client-bundle` is the gate that would catch it a week later.
 */
export interface AgentHolding {
  /**
   * Whether DASH holds a registration naming a program it could spawn here.
   *
   * The registration file's existence, not the runner's current opinion of it.
   * Those differ for exactly one moment — a registration written while the
   * runner is up and not yet re-read — and the doors that write one ask the
   * supervisor to reload precisely so the difference does not outlive the press
   * (MAR-616). A refusal from that window is named on screen rather than
   * predicted here.
   *
   * False is the honest answer for a manifest-only agent: ADR 0008's
   * row-without-a-program standing, where there is nothing to start and
   * `AGENT_CONTROL_COPY.idle.not_reported` is the true sentence.
   */
  startable: boolean;
}

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
  holding: AgentHolding,
): AgentControlView {
  if (snapshot === null) {
    return {
      // Said in DASH's own words rather than left blank. An agent with no
      // snapshot has a real state and "Not reported" is it — the old page's
      // status heading simply did not render, so the tile it now fills was an
      // absence rather than a fact.
      //
      // It stays "Not reported" even when the branch below offers Start, and the
      // two do not contradict each other: the status tile says what the *agent*
      // has told DASH, which is nothing, and the button says what *DASH* can do
      // about it, which is start it. Relabelling the tile to match the button
      // would put a claim about the process into the one field that is only ever
      // the agent's own word.
      status: {
        label: "Not reported",
        tone: "calm",
        detail: "This agent has not published its state to DASH yet.",
      },
      /*
       * The door ADR 0022 built, reached from the state that needs it most
       * (MAR-703).
       *
       * ## Why this branch existed and did nothing
       *
       * ADR 0022 decided that DASH may start a registered agent whose process is
       * not running, and gated it on `STOPPED` — `offline` or `error` — because
       * those are the two verdicts the *runner* publishes about its own child.
       * That predicate is right and is untouched below. What it could never
       * cover is this branch, which returns above it: `STOPPED.has(...)` reads
       * `overview.status`, and an agent with no snapshot has no overview to
       * read. So the one state in which a person most needs to start something
       * — nothing has ever run here — was the one state decided before the
       * start branch was reached.
       *
       * The consequence is a closed loop, and Henrik met it on the installed app
       * after the 2026-08-19 store restore: no snapshot means no start control,
       * no start control means no run, and no run means no snapshot. The Overview
       * checklist went on saying "Open Run and press Run now" at a stage that
       * answered with a sentence and no button.
       *
       * ## Why an absent snapshot is safe to spawn from, when a claimed idle is
       * not
       *
       * `STOPPED`'s note refuses to start an agent because the agent said it was
       * idle — "a spawn decided by the thing being spawned". Nothing says
       * anything here. An absent snapshot is not a claim by the agent; it is the
       * absence of every claim, and `runner/state.ts` cannot have published one
       * for a child it does not have running. So this reads no agent's word at
       * all, which is a stronger position than the branch below rather than a
       * looser one.
       *
       * ## What is checked instead, and why it is not the snapshot
       *
       * `holding.startable` — whether DASH holds a registration naming a program
       * it could spawn. That is the question `Supervisor.start` will actually
       * answer, and asking it here is what keeps `not_reported` honest: the
       * sentence stays for the agent DASH genuinely cannot start, and stops
       * being the answer for one it can. Offering the button to an agent with no
       * registration would earn an `unknown_agent` *after* the press, which is
       * the refusal this whole module exists to not create.
       */
      run:
        !canAct
          ? { kind: "idle", reason: "read_only" }
          : holding.startable
            ? { kind: "start", observed_at: null }
            : { kind: "idle", reason: "not_reported" },
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
   * The process is not running, so the thing to offer is starting it (MAR-657).
   *
   * ## Why this is above the pending-task check and not below it
   *
   * `runner/state.ts` gates `runs`, `choices`, `actions` and
   * `approval_requests` on the process being live. **`tasks` is the one array it
   * does not gate** — a dead agent's last self-report keeps its tasks verbatim.
   * So an agent that ran and then exited still carries its pending
   * `waiting-to-be-run`, and a `run_now` decided before this branch would draw a
   * button whose `retry` the supervisor answers with `not_running`. That is
   * precisely the after-the-press refusal the note below refuses to create,
   * arriving by the road MAR-657's own correction comment predicted. Deciding
   * `start` first replaces a button that cannot work with one that can.
   *
   * ## Why these two statuses and no others
   *
   * `offline` and `error` are the only statuses `resolveStatus` produces for a
   * process that is not live, and `SELF_REPORTABLE_STATUSES` forbids an agent
   * from claiming either — "a claim about the process, which is the runner's to
   * make". So this reads the runner's own verdict about its own child, which is
   * the only thing in the snapshot that could honestly gate a spawn.
   *
   * ## Why this is a statement about *this* computer
   *
   * `agent_dom_state` "is keyed by agent id alone — … there is exactly one row
   * and it belongs to the copy on this computer" (`lib/agent-dom/runner.ts`). A
   * deployed copy's state never lands in it; a remote command is judged against
   * a substituted snapshot instead. Nothing here reads `agent_deploys`, so ADR
   * 0010's rule that a deploy row is not a liveness record is untouched, and the
   * copy names the machine per ADR 0014.
   */
  if (STOPPED.has(overview.status)) {
    return { status, run: { kind: "start", observed_at: snapshot.observed_at } };
  }

  /*
   * The same predicate `RunNow` used, and it has to stay the same one.
   *
   * A pending task with no run attached is what "there is something to start"
   * means in the Agent DOM: the runner opens a task, and Run now binds it to a
   * run. Widening this — offering Run now whenever the agent looks idle — would
   * put a button on screen that `submitAgentCommand` refuses, which is worse
   * than no button because the refusal arrives after the press.
   *
   * MAR-657 did not widen it. The branch above answers a *different* question on
   * a *different* channel — is there a process — and leaves this one deciding
   * exactly what it always decided about a live agent.
   */
  const waiting = snapshot.tasks.find(
    (task) => task.status === "pending" && task.run_id === null,
  );
  if (waiting === undefined) {
    return { status, run: { kind: "idle", reason: "nothing_waiting" } };
  }

  return {
    status,
    run: { kind: "run_now", task_id: waiting.id, observed_at: snapshot.observed_at },
  };
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
