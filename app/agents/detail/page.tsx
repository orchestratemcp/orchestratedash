"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

/* `RunOutput` is deliberately not imported. MAR-434 replaced this page's single
   `RunOutput` call with `OutputsArea` and left the import behind, where it sat
   unread until MAR-576 went looking for why the news was not on the page. It
   was not the cause — `OutputsPanel` renders the digest through `DigestBody`
   either way — but a dead import of the component whose whole job is to draw
   the thing a user says is missing is a false lead, and removing it is cheaper
   than the next person following it. */
import { DeployToServer } from "../../_components/deploy";
import { FolderUpdate } from "../../_components/folder-update";
import { AgentControls, AgentCockpitHeader } from "../../_components/agent-header";
import { AgentHealth } from "../../_components/agent-health";
import { AgentRail } from "../../_components/agent-rail";
import { AgentSettings, StandingAnswers } from "../../_components/agent-settings";
import { AgentStageView } from "../../_components/agent-stage";
import { AgentTelemetry } from "../../_components/agent-telemetry";
/* `AgentTiles` is not imported and the file is gone (MAR-646). The row was two
   tiles restating two settings; see the note on the header band below and
   `AGENT_TILE_COPY`, which is what is left of its copy. */
import { AgentChatBar, AskThread } from "../../_components/ask";
import { LiveFeed } from "../../_components/live-feed";
import { ModelChoice } from "../../_components/model-choice";
import { InputsPanel, type SelectedInput } from "../../_components/inputs";
import { LiveBrowserPanel } from "../../_components/browser-panel";
import { ExportsList } from "../../_components/output-exports";
import { OutputsPanel } from "../../_components/outputs";
import { AgentPanel } from "../../_components/panel";
import { RemoveAgent } from "../../_components/remove-agent";
import { RunProgress } from "../../_components/run-progress";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { WorkingLine } from "../../_components/working";
import { AGENT_WORKSPACE_PARAMS, agentStageHref, runDetailHref } from "../../_data/routes";
import {
  dataSource,
  downloadOutput,
  exportBriefAsPdf,
  markAgentLooked,
  openExport,
  refreshSampleAgent,
  revealAgentFolder,
  setStandingAnswer,
  startAgent,
  submitAgentCommand,
  submitHostCommand,
  submitWorkspaceCommand,
  type AgentCommandArgs,
} from "../../_data/source";
import { useCanAct, useHost, useLiveView } from "../../_data/use-view";
import type { GroundingAnalysis } from "../../../lib/analyze";
import type { PermissionGrant } from "../../../lib/contracts";
import { startAndRun } from "../../../lib/agent-start";
import {
  AGENT_COCKPIT_COPY,
  AGENT_CONTROL_COPY,
  AGENT_OUTPUTS_COPY,
  AGENT_TILE_COPY,
} from "../../../lib/copy/agent-page";
import { EXPORTS_PANEL_COPY } from "../../../lib/copy/artifacts";
import { INPUTS_PANEL_COPY } from "../../../lib/copy/inputs";
import { SAMPLE_REFRESH_COPY } from "../../../lib/copy/panel";
import { describeWorkingPhase } from "../../../lib/copy/working";
/* MAR-602. Safe as a value in this bundle: `lib/copy/where-it-ran.ts` imports
   nothing that reaches a disk, and its one reference to `lib/store.ts` is a
   type. Same arrangement `lib/deploy/connection-travel.ts` has, and for the
   same reason — a sentence about two machines has to be worded where both
   panels naming them can reach it. */
import { describeRunOnHost, describeRunTarget } from "../../../lib/copy/where-it-ran";
/* A type, so it erases — `lib/sample-refresh.ts` reaches `agent-kit/scaffold.ts`
   and must never arrive in this bundle as a value. See tests/client-bundle. */
import type { ManifestGapView } from "../../../lib/sample-refresh";
import {
  buildAgentChecklist,
  isEmptyAgent,
  type AgentChecklistStep,
} from "../../../lib/views/agent-checklist";
import { buildAgentControl } from "../../../lib/views/agent-control";
import { resolveAgentStage, type AgentStage } from "../../../lib/views/agent-stage";
import type { InputRoleView } from "../../../lib/views/inputs";
import { resolveOpenCard, type ArtifactCardView } from "../../../lib/views/artifacts";
import { isRunInFlight, type InboxItem } from "../../../lib/workspace";
import type {
  AgentDeployTarget,
  AgentExportView,
  WorkspaceRunView,
  WorkspaceSnapshotView,
} from "../../../lib/views/types";

type CommandFeedback = { ok: boolean; message: string } | null;

/**
 * How long the page keeps following after a press that asked for a run
 * (MAR-680).
 *
 * Twenty seconds is four of `electron/agent-adapters.ts`'s five-second drains,
 * which is the thing being waited for: DASH does not learn that a run started
 * from the press, it learns it from the next snapshot the runner hands over.
 * One drain would be the theoretical minimum and would lose a race with a
 * runner that is busy; a minute would leave a refused press polling long after
 * the refusal is on screen.
 *
 * It bounds a hopeful state and nothing else. The moment a run actually
 * appears, `running` takes over and this stops mattering.
 */
const RUN_APPEARS_WITHIN_MS = 20_000;

/**
 * The one extra read after a run leaves flight (MAR-680).
 *
 * Long enough for the artifact write that trails the last telemetry event to
 * have landed, short enough that a person watching sees the output arrive
 * rather than wondering whether it will. Two seconds is a guess about two
 * writes on two channels and is deliberately a small one: being early costs a
 * read that shows the same bytes, and the next natural refresh — a stage
 * change, a window focus — still corrects it.
 */
const RUN_SETTLE_MS = 2_000;

export default function AgentWorkspacePage(): ReactNode {
  return (
    <Suspense fallback={<ViewLoading what="this agent workspace" />}>
      <AgentWorkspace />
    </Suspense>
  );
}

function AgentWorkspace(): ReactNode {
  const params = useSearchParams();
  const router = useRouter();
  const agent = params.get(AGENT_WORKSPACE_PARAMS.agent) ?? "";
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CommandFeedback>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [live, setLive] = useState(false);
  /*
   * MAR-507. The task and what has been put in it, held here rather than on the
   * view, because neither is a fact DASH's store holds: the runner owns the task
   * workspace, and what is in it is the answer to a command rather than a row.
   *
   * **The consequence is named rather than hidden.** Leaving this page before
   * pressing Run now loses the task id, and the files already copied stay in the
   * runner's workspace until it cleans them up. There is no route to list an
   * agent's open tasks, so DASH cannot offer to pick one back up — and a page
   * that silently opened a *second* task on return would quietly orphan the
   * first one's files rather than reuse them. `INPUTS_PANEL_COPY.dispatch_note`
   * is what tells a person the selection is waiting on the button.
   */
  const [taskId, setTaskId] = useState<string | null>(null);
  const [selectedInputs, setSelectedInputs] = useState<SelectedInput[]>([]);
  const [busyRole, setBusyRole] = useState<string | null>(null);
  /*
   * MAR-680. Keep following for a moment after a press that starts a run.
   *
   * The snapshot below is the *agent's* account of itself, drained from the
   * runner every five seconds by `electron/agent-adapters.ts`. So for up to a
   * poll after Run now, DASH holds a snapshot that still says idle — and the
   * old `running` predicate, reading only that, left the page still. One
   * re-read fired by `issue`, nothing after it, and the person is looking at
   * "Started a new run." and a page that never changes again. That is Henrik's
   * sentence exactly: *"The only information we get is that it has started a
   * new run."*
   *
   * A press counter rather than a deadline, because a deadline read during
   * render needs a clock that ticks and this needs none: it goes up on a press,
   * and whichever comes first — a run appearing or the grace expiring — puts it
   * back to nought. See the two effects below.
   *
   * A counter rather than a boolean for one case a boolean gets wrong: a second
   * press while the first grace is still open sets the same value, so the
   * effect below does not re-run and the second press inherits whatever is left
   * of the first one's timer. Counting means every press restarts the window.
   */
  const [asked, setAsked] = useState(0);
  const state = useLiveView(
    (source) => source.workspace(agent),
    `${agent}:${String(refreshKey)}`,
    live,
  );
  const canAct = useCanAct();
  const host = useHost();

  /*
   * Whether a run of this agent could change what is on screen without anybody
   * pressing anything here.
   *
   * `isRunInFlight` and not `status === "running"`, which is what this was.
   * A run parked at an approval is not running and the page must still follow
   * it: the approval arrives in a *separate window*, the runner carries on the
   * moment it is answered, and a page frozen at the moment the popup opened is
   * the hang Henrik described — *"the approval popup arrived ~5 minutes in with
   * no preceding feedback, so it felt like a hang rather than a step reaching a
   * gate."* `lib/workspace.ts` says why `paused` is not in the set.
   */
  const running =
    state.status === "ready" &&
    state.data.found &&
    (state.data.snapshot?.runs ?? []).some((run) => isRunInFlight(run.status));
  const following = running || asked > 0;
  useEffect(() => {
    setLive(following);
  }, [following]);

  /*
   * The grace window, and the two ways out of it.
   *
   * A run appearing is the good exit: `running` is now the reason to poll and
   * is a fact rather than an assumption, so this state stops claiming
   * anything. The timer is the other: a press that started nothing — a refusal,
   * an agent that publishes no run — must not leave the page polling forever,
   * which would be the "nothing refreshes without saying it did" rule broken by
   * a hopeful boolean.
   */
  useEffect(() => {
    if (running) {
      setAsked(0);
    }
  }, [running]);
  useEffect(() => {
    if (asked === 0 || typeof window === "undefined") {
      return;
    }
    const timer = window.setTimeout(() => setAsked(0), RUN_APPEARS_WITHIN_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [asked]);

  /*
   * MAR-680's second ask, in one effect: *"It should trigger a reload so a new
   * output lands."*
   *
   * A run's last telemetry event and the artifact it produced are two separate
   * writes on two separate channels, and the poll that observes the run leaving
   * flight may land between them. Stopping there would leave a page that says
   * *Finished* above the output from the run before — which is a smaller
   * version of the same stale render MAR-685 is about.
   *
   * So one more read, once, a beat after the run ends. A ref rather than state
   * because nothing renders differently for having been running a moment ago,
   * and the effect must fire on the *edge* rather than on every subsequent
   * still frame.
   */
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current || typeof window === "undefined") {
      return;
    }
    wasRunning.current = false;
    const timer = window.setTimeout(
      () => setRefreshKey((value) => value + 1),
      RUN_SETTLE_MS,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [running]);

  /*
   * MAR-586. Write down that this page was opened, once per agent.
   *
   * The dependency is `agent` alone and deliberately not `refreshKey` or the
   * view: a person pressing Refresh state has not arrived again, and a page that
   * re-stamped on every poll would record the window being left open rather than
   * anybody reading anything.
   *
   * Fired for an agent DASH may not even hold — the guard is in main, where
   * writing an unknown agent's look is a harmless row and asking the renderer to
   * check first would mean a read before a write for no gain. Nothing is awaited
   * and no failure is surfaced: `markAgentLooked` refuses silently in the hosts
   * that cannot write, and there is no question on this screen for an error to
   * be the answer to.
   */
  useEffect(() => {
    if (agent === "") {
      return;
    }
    void markAgentLooked(agent);
  }, [agent]);

  /*
   * MAR-586. Honour the fragment a fleet chip arrived with.
   *
   * A browser scrolls to `#waiting-work` when the document that contains it has
   * loaded, and this page has no such element then: every DASH page reads its
   * content across the IPC boundary *after* the first paint, so the fragment has
   * already been resolved against an empty page and dropped. Without this, a
   * chip that promised to take somebody to the thing that needs them would land
   * them at the top of a page and leave them looking.
   *
   * Runs when the view arrives rather than on mount, and asks the document
   * rather than trusting the fragment: an unknown name simply finds nothing and
   * leaves the reader where they are, which is the right outcome for a section
   * that exists only when there is something in it.
   */
  const ready = state.status === "ready";
  /*
   * MAR-641 added `stage` to the dependencies, and it is the fragment's second
   * hurdle rather than a tidy-up. The cockpit's rail links to
   * `?stage=overview#work-…`, which for somebody already on the Overview stage
   * is a *fragment-only* navigation: the view has long since arrived, `ready`
   * has not changed, and without a dependency that moves, this effect would
   * never run again. A stage change is the one thing that reliably differs
   * between "the same page" and "the page I have just asked to be taken into".
   */
  const stageParam = params.get(AGENT_WORKSPACE_PARAMS.stage);
  /*
   * The fragment, in state, because the stage depends on it (MAR-641).
   *
   * It cannot be read during render: `window` does not exist while this page is
   * prerendered, and a value read straight off the browser would also never
   * re-render when it changed. The lazy initialiser is safe because nothing
   * that reads this is on screen at hydration — the page draws `ViewLoading`
   * until its view arrives over IPC, which is well after.
   *
   * Re-read on a route change (a fleet chip arriving from another page) and on
   * `hashchange` (an anchor pressed on this one). See `resolveAgentStage` for
   * why the fragment outranks a live run.
   */
  const [fragment, setFragment] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash.slice(1),
  );
  /*
   * MAR-648. The stage the chat composer was focused from, for Escape.
   *
   * A ref and not state, deliberately: nothing renders differently because of
   * it, and making it state would repaint the whole cockpit the moment somebody
   * put a cursor in the box. Null until the composer is focused from another
   * stage, which is also the honest answer for somebody who arrived on the chat
   * stage directly — there is nothing underneath to put back.
   *
   * **Declared up here with the other hooks, and that placement is the bug this
   * line was written wrong once.** It first sat beside `stage`, three hundred
   * lines down, which reads better and is after three early returns — the
   * loading, failed and not-found branches. So the first render of this page
   * (loading) ran one fewer hook than the second, and React threw *Rendered
   * more hooks than during the previous render* the instant a view arrived.
   *
   * Nothing caught it. Every render test here is `renderToStaticMarkup`, which
   * renders once and can never see a hook count change between two renders; the
   * whole suite, the typecheck and the brand gate were all green. Two capture
   * harnesses photographing Next's error boundary are what found it.
   */
  const returnStage = useRef<AgentStage | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const read = (): void => {
      setFragment(window.location.hash.slice(1));
    };
    read();
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("hashchange", read);
    };
  }, [agent, stageParam]);

  useEffect(() => {
    if (!ready || typeof window === "undefined") {
      return;
    }
    if (fragment === "") {
      return;
    }
    // One frame later: the branch that draws the section is rendering in this
    // same commit, so the element does not exist yet when the effect runs.
    const timer = window.setTimeout(() => {
      document.getElementById(fragment)?.scrollIntoView({ block: "start" });
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [ready, agent, stageParam, fragment]);

  async function issue(
    key: string,
    command: Parameters<typeof submitAgentCommand>[0],
    args: AgentCommandArgs,
  ): Promise<void> {
    setPending(key);
    setFeedback(null);
    try {
      const result = await submitAgentCommand(command, args);
      setFeedback({
        ok: result.ok,
        message:
          result.detail ??
          (result.ok
            ? "The runner accepted the request."
            : `The runner refused the request${result.reason === undefined ? "." : `: ${result.reason}.`}`),
      });
      /*
       * MAR-680. The two verbs that put work in flight, followed rather than
       * assumed to have started.
       *
       * Only on `ok`: a refused command changes nothing, and following a
       * refusal for twenty seconds would be the page looking busy on behalf of
       * something that did not happen. `pause` and `cancel` are deliberately
       * absent — they take work *out* of flight, and the snapshot they produce
       * arrives on the refresh directly below.
       */
      if (result.ok && (command === "retry" || command === "resume")) {
        setAsked((value) => value + 1);
      }
      // One explicit refresh after a command. This is not background polling:
      // the UI shows the loading state and the user action is what caused it.
      setRefreshKey((value) => value + 1);
    } catch {
      setFeedback({
        ok: false,
        message: "DASH could not reach the command boundary. Your agent was not changed.",
      });
    } finally {
      setPending(null);
    }
  }

  /**
   * Ask for one file for one declared role, and record what came back
   * (MAR-507).
   *
   * Opens a task on the first selection rather than on page load: an agent
   * whose files a person never chooses should not leave a directory behind on
   * the runner for having been looked at.
   *
   * The `selected` state is written three times on purpose — before the picker,
   * and again with whichever answer arrived — because the copy is not instant
   * for a large file and "nothing appears to have happened" is how a person
   * clicks twice.
   */
  async function chooseInput(roleId: string): Promise<void> {
    setBusyRole(roleId);
    setFeedback(null);
    const key = `${roleId}:${String(Date.now())}`;
    try {
      let task = taskId;
      if (task === null) {
        const opened = await submitWorkspaceCommand("open", { agent_id: agent });
        const openedId = opened.data?.["task_id"];
        if (!opened.ok || typeof openedId !== "string" || openedId.length === 0) {
          setFeedback({
            ok: false,
            message: opened.detail ?? "DASH could not open a place to put a file for this agent.",
          });
          return;
        }
        task = openedId;
        setTaskId(openedId);
      }

      setSelectedInputs((current) => [
        ...current,
        { role_id: roleId, state: "selected", display_name: "", byte_size: 0, key },
      ]);

      const result = await submitWorkspaceCommand("select", {
        agent_id: agent,
        task_id: task,
        role_id: roleId,
      });

      if (result.reason === "cancelled") {
        // Not a failure and must not read as one — the same call
        // `describeAuthorizationFailure` makes about a cancelled sign-in. The
        // placeholder row goes away rather than becoming a rejection.
        setSelectedInputs((current) => current.filter((input) => input.key !== key));
        setFeedback({ ok: true, message: INPUTS_PANEL_COPY.cancelled });
        return;
      }

      setSelectedInputs((current) =>
        current.map((input) =>
          input.key === key
            ? {
                ...input,
                state: result.ok ? "copied" : "rejected",
                display_name: String(result.data?.["display_name"] ?? ""),
                byte_size: Number(result.data?.["byte_size"] ?? 0),
                // The runner's own sentence, verbatim. `lib/copy/inputs.ts` says
                // why DASH does not reword it.
                detail: result.detail,
              }
            : input,
        ),
      );
    } catch {
      setSelectedInputs((current) => current.filter((input) => input.key !== key));
      setFeedback({
        ok: false,
        message: "DASH could not reach the command boundary. Nothing was copied.",
      });
    } finally {
      setBusyRole(null);
    }
  }

  /**
   * Hand the chosen files to the agent, and say whether it worked (MAR-507).
   *
   * **This is the join, and its failure branch is the interesting half.** If
   * dispatch fails, the agent must not be started: an agent triggered without
   * the files a person just chose would run, finish, and produce an output
   * derived from nothing they gave it — which is the same run as a successful
   * one from the outside, and the one that would be believed.
   *
   * The run id is DASH's. `runner/task-api.ts` files whatever the agent writes
   * against the run bound here, which is how proof 9 finds the output; the
   * agent's own telemetry run id is its own and may differ. That seam is
   * MAR-434's and is unchanged by this — what is new is that a person can now
   * cause it from the page rather than from a script.
   */
  async function dispatchTask(): Promise<boolean> {
    if (taskId === null) {
      return true;
    }
    const runId = `run-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await submitWorkspaceCommand("dispatch", {
      agent_id: agent,
      task_id: taskId,
      run_id: runId,
    });
    if (!result.ok) {
      setFeedback({
        ok: false,
        message:
          result.detail ??
          "DASH could not hand your files to the agent, so it was not started.",
      });
      return false;
    }
    // The task is closed to further changes now, so the next selection has to
    // open a new one. Keeping the id would offer a picker the runner refuses.
    setTaskId(null);
    return true;
  }

  /**
   * Start this agent on this computer, then ask it to run (MAR-657).
   *
   * The sequence itself is `lib/agent-start.ts` and is tested without a browser;
   * this supplies the four local ports and turns the outcome into the one line
   * this page uses for every command's answer.
   *
   * ## Why the files are dispatched inside the run port
   *
   * `dispatchTask` hands staged files down the child's own stdin, and a child
   * that is not running has no stdin — so the order that works for Run now
   * (files, then run) has to become *start, then files, then run* here. Putting
   * it in the port rather than before the call is what guarantees that: the port
   * is invoked once, immediately before the run, on the far side of a start that
   * succeeded. Doing it earlier would hand a person's files to a process that
   * does not exist yet and report a run that read none of them.
   *
   * ## Why `pending` is the literal "start"
   *
   * `AgentControls` compares against that exact string, and the key cannot be
   * built from a task id the way `run:${taskId}` is, because the task this press
   * will bind does not exist when the press happens. That absence is the issue.
   */
  async function startAndRunHere(): Promise<void> {
    setPending("start");
    setFeedback(null);
    /* MAR-680. Follow from the press rather than from the first snapshot that
       admits a run exists. Set here and not on the outcome because a start
       spawns a process before it asks for anything, and the interesting
       feedback — a status moving off `offline` — happens during that window
       whether or not the run half succeeds. `issue`'s own note says why the
       ordinary commands set it only on `ok`. */
    setAsked((value) => value + 1);
    /*
     * Whether the files step already put its own, more specific sentence on
     * screen. A flag rather than a distinguishable `CommandResult`, because
     * `dispatchTask` reports by calling `setFeedback` and returning a boolean —
     * inventing a reason code here so this function could recognise its own
     * refusal downstream would be a second vocabulary for one failure.
     */
    let filesRefused = false;
    try {
      const outcome = await startAndRun(agent, {
        start: (agentId) => startAgent({ agent_id: agentId }),
        readWaitingTask: async (agentId) => {
          const result = await dataSource().workspace(agentId);
          if (!result.ok || !result.data.found || result.data.snapshot === null) {
            return null;
          }
          const { snapshot } = result.data;
          // `buildAgentControl`'s predicate, deliberately by hand rather than by
          // calling it: that function decides what to *draw* from a snapshot the
          // page already has, and this is asking whether a just-started agent has
          // published anything yet. Reusing it would mean re-deciding the whole
          // control — including the `start` branch this press is already inside —
          // and getting `start` back forever, because a status poll is slower
          // than this loop.
          const waiting = snapshot.tasks.find(
            (task) => task.status === "pending" && task.run_id === null,
          );
          return waiting === undefined
            ? null
            : { task_id: waiting.id, observed_at: snapshot.observed_at };
        },
        retry: async (agentId, task) => {
          if (!(await dispatchTask())) {
            // `dispatchTask` has already put its own sentence on screen, and it
            // is the more specific one. Reported as a refusal so nothing below
            // overwrites it with a cheerier summary.
            filesRefused = true;
            return { ok: false, request_id: "" };
          }
          return submitAgentCommand("retry", {
            agent_id: agentId,
            observed_at: task.observed_at,
            task_id: task.task_id,
          });
        },
        wait: (ms) =>
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, ms);
          }),
      });

      if (outcome.kind === "start_refused") {
        setFeedback({
          ok: false,
          message: outcome.result.detail ?? AGENT_CONTROL_COPY.start_failed,
        });
        return;
      }
      if (outcome.kind === "nothing_offered") {
        // `ok: true` on purpose. The process is up, which is what the person
        // asked for and what a red alert would deny. See `start_nothing_offered`.
        setFeedback({ ok: true, message: AGENT_CONTROL_COPY.start_nothing_offered });
        return;
      }
      if (filesRefused) {
        // The files refusal, already on screen and more specific. Leave it.
        return;
      }
      setFeedback({
        ok: outcome.result.ok,
        message:
          outcome.result.detail ??
          (outcome.result.ok
            ? "The runner accepted the request."
            : "The runner refused the request."),
      });
    } catch {
      setFeedback({
        ok: false,
        message: "DASH could not reach the command boundary. Your agent was not changed.",
      });
    } finally {
      setPending(null);
      setRefreshKey((value) => value + 1);
    }
  }

  /**
   * Ask one server to start the copy of this agent that is on it (MAR-602,
   * ADR 0014).
   *
   * Deliberately **not** routed through `issue`. That function is the Agent DOM
   * command path and it refreshes this page's view afterwards, because a local
   * command changes what the local snapshot says. This one changes something on
   * a machine whose snapshot DASH does not store — and re-reading the page after
   * it would show the local copy, unchanged, directly under a message saying a
   * server was asked to run. That reads as the press having done nothing, which
   * is the exact confusion ADR 0014's disclosure exists to prevent.
   *
   * So what a person gets is the sentence main composed, which already says the
   * evidence arrives whenever DASH can next reach that server. `feedback` is the
   * one line this page uses for every command's answer, and this is one.
   */
  async function runOnHost(target: AgentDeployTarget): Promise<void> {
    setPending(`host-run:${target.host_id}`);
    setFeedback(null);
    try {
      const result = await submitHostCommand("run", {
        host_id: target.host_id,
        agent_id: agent,
      });
      setFeedback({
        ok: result.ok,
        message:
          result.detail ??
          (result.ok
            ? `${target.label} was asked to start this agent.`
            : `${target.label} would not start this agent.`),
      });
    } catch {
      setFeedback({
        ok: false,
        message: "DASH could not reach the command boundary. Nothing was started.",
      });
    } finally {
      setPending(null);
    }
  }

  /**
   * Put a different part of this agent on the stage (MAR-641).
   *
   * `push` and not `replace`, so Back returns to the view somebody was on. That
   * is the whole reason the stage is in the address rather than in state — see
   * `lib/views/agent-stage.ts` — and a replace here would have quietly given it
   * up while keeping the URL that advertises it.
   *
   * **This is the first `useRouter` in DASH, and it is the machinery every link
   * here already uses.** `next/link` renders an anchor and calls this same
   * router on click; the fleet cards reach this page, query string and all,
   * through it, in the packaged shell over `dash-app://`. So the risk worth
   * naming is not whether it navigates — it is that a *button* has no `href` to
   * fall back on if the script that binds it never runs. Both call sites are
   * covered: the action grid's Settings and Logs cells are real links, the chat
   * bar's blocked state is a real link, and this is reached only from the two
   * controls that must be buttons because they also *act*.
   */
  function goToStage(next: AgentStage, options: { output?: string } = {}): void {
    router.push(agentStageHref(agent, next, options));
  }

  /**
   * Open this agent's folder in the operating system's own file window
   * (MAR-584's `folder.reveal`, reached from MAR-641's overflow menu).
   *
   * Offered only where DASH holds a folder of its own — see `hasFolder` on the
   * header — so the ordinary answer here is that a window opens and nothing on
   * this page changes. A refusal still gets a sentence, because the two shells
   * too old to have the command cannot be told apart from a missing folder by
   * anything on screen.
   */
  async function openFolder(): Promise<void> {
    setPending("folder-reveal");
    setFeedback(null);
    try {
      const result = await revealAgentFolder({ agent_id: agent });
      if (result.ok) {
        return;
      }
      setFeedback({
        ok: false,
        message: result.detail ?? "DASH could not open this agent's folder.",
      });
    } catch {
      setFeedback({
        ok: false,
        message: "DASH could not reach the command boundary. Nothing was opened.",
      });
    } finally {
      setPending(null);
    }
  }

  if (state.status === "loading") {
    return <ViewLoading what="this agent workspace" />;
  }
  if (state.status === "failed") {
    return <ViewFailed recovery={state.recovery} />;
  }
  if (!state.data.found) {
    return (
      <>
        <h1>That agent is not here</h1>
        <div className="empty" role="alert">
          <p>DASH has no imported manifest for this agent.</p>
          <p>
            <Link href="/">Go back to your agents.</Link>
          </p>
        </div>
      </>
    );
  }

  const view = state.data;
  /*
   * MAR-609. One decision about what can be pressed, taken once.
   *
   * The page used to make this three times over — `RunNow` decided whether to
   * draw a button, `WorkspaceBody` decided whether to draw a status, and each
   * `RunCard` decided whether to draw pause and cancel — with the result that a
   * new agent got none of the three and no explanation for any of them.
   */
  const control = buildAgentControl(view.snapshot, canAct);
  /*
   * There is no tile row here and there were four of them (MAR-646).
   *
   * Status went when a capture showed a tile saying "Not reported" 300px under
   * a pill saying NOT REPORTED. "Runs on" went when the header gained a
   * Local/Cloud chip and the next capture showed the two contradicting each
   * other. The last two — the trigger and the model — go for the reason the
   * first two did, said generally: **a tile is a read-only copy of a fact you
   * cannot act on where you are reading it.** Both are settings and the
   * Settings stage owns them with the controls that change them, one press away
   * from every stage. `AGENT_TILE_COPY`'s own header records what was checked
   * before deleting them, which is that nothing is now unsaid.
   */
  const overview = view.snapshot?.overview ?? null;

  /*
   * MAR-641. Which part of this agent is on the stage.
   *
   * The address decides, and `resolveAgentStage` decides what an address that
   * says nothing means — the run while one is going, the overview otherwise.
   * Nothing in this component may write to it except `goToStage`, so there is
   * one route into every view of an agent and it is one somebody can send to
   * somebody else.
   */
  const inbox = view.snapshot?.inbox ?? [];
  /* MAR-646. The same list the rail indexes decides where a link with no stage
     in it lands, so the landing stage and the rail cannot disagree about
     whether this agent has made anything. */
  const stage = resolveAgentStage(stageParam, {
    running,
    fragment,
    has_output: view.outputs.length > 0,
  });
  const openOutput = params.get(AGENT_WORKSPACE_PARAMS.output);
  /*
   * MAR-668. The one artifact the Output stage draws in full, by id.
   *
   * A set of one, because the stage draws one card — MAR-646's rule, and the
   * rail beside it is the index of the rest. It is a set rather than a string
   * so the author's panel takes the same shape of answer if a later surface
   * ever draws two, which is the change that would otherwise reintroduce the
   * duplication one card at a time.
   */
  const openCard = resolveOpenCard(view.outputs, openOutput);
  const drawnOutputs = new Set(openCard === null ? [] : [openCard.reference.artifact_id]);
  const checklistFacts = {
    models: view.models,
    run_count: view.snapshot?.runs.length ?? 0,
    output_count: view.outputs.length,
  };
  /* MAR-609's rule, still binding: the never-run agent gets a guided checklist
     rather than a column of empty sections. Every other agent gets what it has
     actually done. */
  const empty = isEmptyAgent(checklistFacts);

  const runControls = (
    <AgentControls
        busy={pending}
        hasFiles={selectedInputs.some((input) => input.state === "copied")}
        /* MAR-602. Filtered on the same field the sentence is built from, so a
           server with no name a person would recognise cannot get a button
           reading "Run on ". */
        hosts={view.deploy_targets.filter((target) => target.label.length > 0)}
        onCancelKey={(command, runId) => `${command}:${runId}`}
        onRunOnHost={(target) => {
          void runOnHost(target);
        }}
        onRun={(taskId_, observedAt) => {
          void (async () => {
            /*
             * MAR-507. The files go first, and a refusal here stops the run.
             *
             * The order is the whole point: an agent started before its task is
             * bound would read an empty workspace, and an agent started after a
             * dispatch that failed would produce an output derived from nothing
             * the person gave it. Both look exactly like a successful run from
             * outside, which is why neither may happen quietly.
             */
            if (!(await dispatchTask())) {
              return;
            }
            await issue(`run:${taskId_}`, "retry", {
              agent_id: view.agent,
              observed_at: observedAt,
              task_id: taskId_,
            });
          })();
        }}
        onRunControl={(command, runId, observedAt) => {
          void issue(`${command}:${runId}`, command, {
            agent_id: view.agent,
            observed_at: observedAt,
            run_id: runId,
          });
        }}
        /* MAR-657. The press that starts a stopped agent's process on this
           computer and then asks it to run. */
        onStart={() => {
          void startAndRunHere();
        }}
        run={control.run}
        /* MAR-619, ADR 0016. Already worded by `lib/copy/curation.ts` and
           resolved in `lib/views/build.ts`, which is the only layer that can
           tell whether pressing this would actually cost anything. */
        runSpend={view.run_spend}
      />
  );

  /*
   * MAR-641. The six views of one agent, built once and drawn one at a time.
   *
   * A record rather than a switch, so `AgentStageView` can refuse a stage
   * nobody has given a view to, and so this list reads as what it is: an
   * inventory of every part of an agent, in the order the wireframe puts them.
   * Nothing here is new work — each entry is a block this page already drew,
   * moved out from under the others.
   */
  const stages: Record<AgentStage, ReactNode> = {
    /*
     * What needs you, and what is left before this agent works.
     *
     * ## What left this stage, and why it is still the fleet chip's landing
     *
     * MAR-641 made this the summary of an agent, and MAR-646 found that a
     * summary of an agent is a page of echoes. It drew the newest output under
     * the heading *Latest output* with the rail three hundred pixels away
     * drawing the same heading and the same title, and under that a row of
     * tiles restating two settings. Both are gone: the output is on the Output
     * stage the rail points into, and the settings are on the stage that can
     * change them.
     *
     * What is left is the part that is nowhere else — a decision waiting on a
     * person — plus the notice about DASH's own template and the first-run
     * checklist. `#waiting-work` still lives here, which it must: MAR-586's
     * fleet chip promises to take somebody to the thing that needs them and it
     * names no stage, so the thing that needs them has to be on the stage a
     * fragment resolves to.
     */
    overview: (
      <>
        {/* MAR-576. First, because it is the reason the rest of this stage may
            be empty — and DASH's own voice about DASH's own template, which is
            why it is a plain notice and not a region attributed to anyone.
            Null for every agent DASH did not scaffold and for every scaffolded
            agent already current, which is almost all of them. */}
        <ManifestGapNotice
          agent={view.agent}
          canAct={canAct}
          gap={view.manifest_gap}
          onRefreshed={() => setRefreshKey((value) => value + 1)}
          setFeedback={setFeedback}
        />

        <WaitingWork
          agent={view.agent}
          canAct={canAct}
          issue={issue}
          pending={pending}
          reasons={reasons}
          setFeedback={setFeedback}
          setReasons={setReasons}
          snapshot={view.snapshot}
        />

        {empty ? (
          <GuidedChecklist
            agent={view.agent}
            steps={buildAgentChecklist(checklistFacts)}
          />
        ) : inbox.length === 0 && view.manifest_gap === null ? (
          /* The one state where this stage has nothing at all: an agent that
             has run, with a clear queue and a current manifest. It is not what
             a link to this agent lands on — `resolveAgentStage` sends a
             produced agent to its output — but it is what answering the last
             thing in the queue leaves you looking at, and a region that
             vanished would read as a fault. See `overview_empty_headline`. */
          <div className="empty">
            <p>
              <strong>{AGENT_COCKPIT_COPY.overview_empty_headline}</strong>
            </p>
            <p>{AGENT_COCKPIT_COPY.overview_empty_detail}</p>
          </div>
        ) : null}
      </>
    ),

    /*
     * The run: what you can press, what it is doing, and what it cost.
     *
     * MAR-635's two blocks, unchanged, with the control panel they belong
     * beside. This is also the stage `resolveAgentStage` hands an address that
     * names none while a run is going, which is what the wireframe means by
     * the run taking the stage while live — and with the status pill in the
     * frame above it, it is the Monitor requirement met.
     */
    run: (
      <>
        {runControls}

        {/* MAR-680. Directly under the controls, because it is the answer to
            the press directly above it: which step, whether it is over, and
            whether you may walk away. Above the feed rather than beside it —
            the position is what a person reads first and the log is what they
            read when the position is not enough. Renders nothing at all for an
            agent that has never run. */}
        <RunProgress
          outputHref={
            view.outputs.length === 0
              ? undefined
              : agentStageHref(view.agent, "output")
          }
          progress={view.run_progress}
        />

        <div className="agent-command-grid">
          <LiveFeed
            feed={view.feed}
            runHref={
              view.feed.kind === "empty"
                ? undefined
                : runDetailHref(view.agent, view.feed.run_id)
            }
          />
          <AgentTelemetry telemetry={view.telemetry} />
        </div>

        {/* MAR-507. Below the controls: choosing a file is a step before a run,
            and this is the stage the run happens on. Renders nothing for an
            agent that declares no input roles, which is most of them. */}
        <InputsPanel
          busyRole={busyRole}
          canAct={canAct}
          onChoose={(roleId) => void chooseInput(roleId)}
          roles={view.input_roles}
          selected={selectedInputs}
        />

        {/* MAR-628, ADR 0019. On this stage and no other, because the browser
            exists during a run and the person watching one is standing here.
            The alternative homes were both worse: Overview is where MAR-646
            found a page of echoes, and a stage of its own would be a tab that
            is empty for every agent that never asks for a browser — which is
            every agent but one. Renders nothing at all for those; see
            `BrowserPanel`. */}
        <LiveBrowserPanel agent={view.agent} />
      </>
    ),

    /* MAR-645. A read-only verdict over records already in the workspace view
       plus ADR 0015's sightings held for this window. Mounting this stage does
       not issue a command, contact a provider or probe a host. */
    health: (
      <AgentHealth
        agent={view.agent}
        health={view.health}
        targets={view.deploy_targets}
        title={view.title}
      />
    ),

    /*
     * One thing this agent made, and the region its author declared.
     *
     * ## One, not the archive (MAR-646)
     *
     * This stage drew the open card in full and every other output as a dated
     * `<details>` — the day and the title of each — which is line for line what
     * `AgentRail` draws beside it. The same list twice on one screen, in a
     * frame whose rail exists to be the index. So the stage reads one output
     * and the rail indexes them: pressing an entry sets `?output=…` and *that*
     * one is what is here.
     *
     * Nothing became unreachable. The rail is a band of the frame rather than a
     * panel of this stage, and under 900px it becomes a strip above the stage
     * rather than an overlay — so the index is on screen at every width and
     * from every stage.
     *
     * The author's panel is on this stage and no other, which is ADR 0008
     * slice 3 unchanged: DASH's own record of the outputs comes first, and
     * somebody else's box is below it rather than in the position a person has
     * learned to read as DASH's own voice. It renders nothing at all for the
     * agents that declare no panel, which is most of them and every empty one.
     *
     * ## And it draws the briefing once (MAR-668)
     *
     * MAR-641's placement and ADR 0008's protection of the author's region are
     * both right, and together they put the same briefing on the screen twice —
     * three times on the competitor scout, whose manifest declares a `report`
     * *and* an `outputs` section both resolving the newest digest. `tests/agent-
     * one-home.test.tsx` did not catch it, because its rule is about what a
     * *stage* draws and the second rendering arrives from a manifest.
     *
     * So the stage tells the panel which artifact it has already drawn, and the
     * panel yields the body for exactly that one. `resolveOpenCard` is the same
     * function `OutputsPanel` chooses the card with — see its own note on why
     * the page may not work it out a second way.
     */
    output: (
      <>
        <OutputsArea
          agent={view.agent}
          canAct={canAct}
          cards={view.outputs}
          exports={view.exports}
          grounding={view.latest_digest_grounding}
          onExported={() => setRefreshKey((value) => value + 1)}
          openId={openOutput}
          setFeedback={setFeedback}
        />
        <AgentPanel alreadyShown={drawnOutputs} view={view.panel} />
      </>
    ),

    /* MAR-545's conversation, without its composer — the composer is the bar
       pinned to the bottom of the frame, so it is on screen from every stage.
       The blocked arms render as the one fix-it card MAR-641 asks for. */
    chat: (
      <AskThread
        ask={view.ask}
        canAct={canAct}
        onAsked={() => setRefreshKey((value) => value + 1)}
        setFeedback={setFeedback}
      />
    ),

    settings: (
      <AgentSettings
        avatar={view.avatar}
        canAct={canAct}
        id={view.agent}
        onAvatarChanged={() => setRefreshKey((value) => value + 1)}
        onClose={() => goToStage("overview")}
        onRenamed={() => setRefreshKey((value) => value + 1)}
        renamed={view.renamed}
        setFeedback={setFeedback}
        title={view.title}
        trigger={view.snapshot?.overview.trigger_label ?? null}
        danger={
            /* MAR-595 finding 18 shipped these two buttons and Henrik still
               asked for a remove button, which means the buttons were not where
               he looked. They were last on a page of eighteen sections, under
               the audit history, with no heading of their own — two bare
               controls a reader met only by scrolling past everything. Behind
               the settings button, under a heading that says what they do, is
               where a person goes looking for "get rid of this". */
            <RemoveAgent
              agentId={view.agent}
              displayName={view.title}
              canAct={canAct}
              deployedServers={view.deploy_targets.map((target) => target.label)}
            />
          }
        >
          {/* MAR-583. The model picker is a setting, and it was a full-width
              section on the page competing with the agent's own output. Its
              behaviour is unchanged — this stage owns where it sits, not what
              it does. Renders nothing for an agent whose plan uses no model. */}
          <ModelChoice
            agent={view.agent}
            settings={view.models}
            canAct={canAct}
            onChanged={() => setRefreshKey((value) => value + 1)}
            setFeedback={setFeedback}
          />

          {/* MAR-577, moved onto this stage by MAR-641 and **not** changed by
              it. Where an agent lives is a setting, and the Local/Cloud chip in
              the header clicks through to here.

              Henrik decided deploy single-home on 2026-08-15: push to cloud and
              bring home live *only* here. The other half of that decision —
              the Servers page's card losing its "Put an agent here" panel and
              linking into this stage instead — is scoped to MAR-642, so
              `app/settings/servers` is untouched by this packet. Nothing here
              says out loud that this is the only way to deploy, because until
              MAR-642 lands it is not: a sentence claiming exclusivity while a
              second door is still open is the kind of copy MAR-624 was filed
              on. The component itself is unchanged. */}
          <DeployToServer
            agent={view.agent}
            title={view.title}
            deploy={view.deploy}
            targets={view.deploy_targets}
            canAct={canAct}
            onBroughtHome={() => setRefreshKey((value) => value + 1)}
          />

          {/* MAR-584. Same argument: a person opens this page to read what
              their agent found, not to audit its folder. Renders nothing at all
              for an agent DASH holds no folder of its own for. */}
          <FolderUpdate
            agent={view.agent}
            canAct={canAct}
            checkable={view.folder_checkable}
            onAdopted={() => setRefreshKey((value) => value + 1)}
            setFeedback={setFeedback}
          />

          {/* MAR-681. Renders nothing for an agent nobody has answered
              "always this" for — see the component's own note. */}
          <StandingAnswers
            agent={view.agent}
            answers={view.standing_answers}
            canAct={canAct}
            onChanged={() => setRefreshKey((value) => value + 1)}
            setFeedback={setFeedback}
          />
        </AgentSettings>
    ),

    /*
     * The record, un-buried (MAR-641).
     *
     * MAR-609 folded seven sections behind one disclosure, because on an agent
     * with no output they *were* the page — seven headings each followed by a
     * sentence saying there was nothing under it. A stage is the same move made
     * properly: the sections are one press away rather than one press *and* a
     * scroll, and they are no longer competing with the agent's own output for
     * the top of a page, because they are not on that page at all.
     */
    logs: (
      <>
        <PermissionReceipt permissions={view.permissions} />
        {view.snapshot === null ? (
          <div className="empty">
            <p>
              <strong>No live state has arrived yet.</strong>
            </p>
            <p>
              The manifest is imported, but this agent has not published an Agent
              DOM snapshot. DASH will not invent tasks, controls or connection
              health for it.
            </p>
          </div>
        ) : (
          <WorkspaceRecord
            agent={view.agent}
            canAct={canAct}
            issue={issue}
            pending={pending}
            snapshot={view.snapshot}
          />
        )}
      </>
    ),
  };

  /*
   * MAR-641. The frame, which never scrolls, around the stage, which does.
   *
   * Three bands and one of them is the whole of the rest of this page. That is
   * the wireframe's shape and it is also the argument for it: a person looking
   * at an agent should be able to see who it is, what it is doing, what it made
   * and what it needs from them without moving anything, and should reach every
   * other part of it with one press rather than a scroll.
   *
   * `HostNotice` and the command feedback live in the frame rather than on a
   * stage on purpose. Both are answers to something the person just did — or to
   * which window they are in — and an answer that appeared on one stage and
   * vanished when they moved would be an answer nobody could rely on having
   * read.
   */
  return (
    <div className="agent-cockpit">
      <div className="cockpit-top">
        {/*
          MAR-502. The portrait belongs to the identity band and nowhere else on
          this page: runs, verdicts, gates and outputs are all inside the stage,
          and a character standing beside any of them would be a character
          implying it had something to do with the finding.

          MAR-589. `view.title` is `agentDisplayName`'s answer and the id
          travels beside it as a value — Henrik's ruling, applied at the one
          place on this page that names the agent.
        */}
        <AgentCockpitHeader
          agent={view.agent}
          avatar={view.avatar}
          busy={pending}
          control={control}
          goal={view.goal}
          hasFolder={view.folder_checkable && canAct}
          live={following ? timeOnly(state.last_read_at) : null}
          onOpenFolder={() => void openFolder()}
          onRefresh={() => setRefreshKey((value) => value + 1)}
          /*
           * MAR-687. There is no `onTriggerRun` and there was one until this
           * packet.
           *
           * It did both halves of "acts and switches the stage" — `goToStage`
           * and then `startAndRunHere` or a `retry` — and the acting half is
           * what Henrik asked to be taken out: *"Clicked Trigger run in the
           * header. It swapped to the page and automatically triggered a run.
           * There is a button on that page. Let's make that the actual
           * trigger."* Nothing is unreachable by the loss: `AgentControls` on
           * the Run stage draws Run now and Start and run from the same
           * `control` this header is handed, and both go through the same two
           * functions this handler called.
           */
          places={view.deploy_targets}
          plan={view.plan}
          stage={stage}
          title={view.title}
        />
        <HostNotice host={host} />
        {feedback === null ? null : (
          <div
            className={feedback.ok ? "notice notice-ok" : "notice notice-err"}
            role={feedback.ok ? "status" : "alert"}
          >
            {feedback.message}
          </div>
        )}
      </div>

      <div className="cockpit-body">
        <AgentStageView stage={stage} views={stages} />
        <AgentRail
          agent={view.agent}
          inbox={inbox}
          openId={openOutput}
          outputs={view.outputs}
        />
      </div>

      {/* MAR-545's composer, pinned. Focusing it moves the stage to the thread,
          which is what keeps MAR-545's rule true in a frame: the estimate — the
          sentence that could change what somebody types — ends up on screen
          directly above the box before a word is typed. */}
      <AgentChatBar
        agent={view.agent}
        /* MAR-648. The same stored character the header's portrait draws, so
           the O that animates while a question runs is recognisably this
           agent rather than a second opinion about which costume it wears. */
        agentAvatar={view.avatar}
        /* MAR-659. The header's own name for this agent, so the composer's
           visible label and the page it is pinned to agree on what to call it. */
        agentTitle={view.title}
        ask={view.ask}
        canAct={canAct}
        onChatStage={stage === "chat"}
        onAsked={() => setRefreshKey((value) => value + 1)}
        /*
         * MAR-648. Escape puts back the stage the composer was focused from.
         *
         * Not `router.back()`, which would be one line and is wrong for the
         * case that matters: an address that named the chat stage directly —
         * MAR-586's chips and `lib/open-link.ts` both produce those — has no
         * earlier stage of this agent behind it, so Back would leave the agent
         * altogether. Escape on a surface that expanded means "put back what
         * was underneath", and where nothing was underneath it correctly does
         * nothing.
         */
        onEscape={() => {
          const back = returnStage.current;
          if (back !== null && back !== "chat") {
            returnStage.current = null;
            goToStage(back);
          }
        }}
        onFocus={() => {
          if (stage !== "chat") {
            returnStage.current = stage;
            goToStage("chat");
          }
        }}
        setFeedback={setFeedback}
      />
    </div>
  );
}

/**
 * The one sentence an agent older than DASH's own template is owed (MAR-576).
 *
 * ## Why this exists at all
 *
 * DASH ships one demo agent, and every machine that added it before MAR-548 has
 * a manifest with no panel in it. MAR-553's migration deliberately never
 * rewrites an author's document — the right rule — so those agents render
 * without the report the same agent added today would draw, and until now
 * nothing on screen said so. That is silent degradation on the product's only
 * demo agent: the page simply looked like an agent that produces nothing.
 *
 * So the sentence is not a nicety. It is the render-side half of the discipline
 * `MANIFEST_ONLY_DEPLOY_REFUSAL` applies on the deploy path — when DASH knows it
 * is doing less than it could, it says so and names the way forward, rather than
 * quietly doing less.
 *
 * ## The button is offered, never assumed
 *
 * `repairable` decides whether there is a control, and the sentence renders
 * with or without one. `canAct` decides whether it is drawn at all rather than
 * drawn disabled — `lib/workspace.ts`'s rule about dead controls, and sharper
 * here than usual: a greyed-out "Update this agent" reads as "this agent cannot
 * be updated", which is a claim about the agent rather than about the window.
 *
 * `detail` is rendered beside the button and not inside a confirmation dialog.
 * The action replaces a saved document and preserves everything a person would
 * miss, and saying which is which *before* the press is more use than a modal
 * that appears after they have already decided.
 */
function ManifestGapNotice({
  agent,
  canAct,
  gap,
  onRefreshed,
  setFeedback,
}: {
  agent: string;
  canAct: boolean;
  gap: ManifestGapView | null;
  /** Re-read the workspace, so the page redraws with the panel it just gained. */
  onRefreshed: () => void;
  setFeedback: Dispatch<SetStateAction<CommandFeedback>>;
}): ReactNode {
  const [busy, setBusy] = useState(false);

  if (gap === null) {
    return null;
  }

  async function update(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await refreshSampleAgent({ agent_id: agent });
      setFeedback({
        ok: result.ok,
        message: result.detail ?? (result.ok ? SAMPLE_REFRESH_COPY.ok : SAMPLE_REFRESH_COPY.failed),
      });
      if (result.ok) {
        onRefreshed();
      }
    } catch {
      setFeedback({
        ok: false,
        message: "DASH could not reach the command boundary. Nothing was changed.",
      });
    } finally {
      setBusy(false);
    }
  }

  const offered = gap.repairable && canAct;

  return (
    <div className="notice notice-warn manifest-gap" role="status">
      <div className="manifest-gap-said">
        <p>
          <strong>{gap.card.headline}</strong>
        </p>
        <p className="wrap">{gap.card.meaning}</p>
        {/* Only for the reader who has no button. With one, the control *is*
            the way forward and this sentence would be the same instruction
            twice; without one — a browser tab, or a shell older than the
            command — it is the only way forward there is, and a notice that
            named a problem and no way out would be the silence this issue is
            about wearing a different shape. */}
        {offered || gap.card.next_action === null ? null : (
          <p className="next-action">{gap.card.next_action}</p>
        )}
      </div>
      {offered ? (
        <div className="manifest-gap-do">
          <button
            className="button-primary"
            disabled={busy}
            onClick={() => void update()}
            type="button"
          >
            {busy ? SAMPLE_REFRESH_COPY.pending : SAMPLE_REFRESH_COPY.action}
          </button>
          <p className="muted wrap">{SAMPLE_REFRESH_COPY.detail}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What this agent last produced, as things the person owns (MAR-434).
 *
 * A first-class area of the workspace rather than a footnote under the run
 * cards: "what did it make for me?" is one of the three questions the home view
 * exists to answer, and until now the workspace answered it with the single
 * newest digest and no way to get the file.
 *
 * The link out is to the run detail page rather than to a list of every output
 * this agent has ever made. `WorkspaceView.outputs` is deliberately one run's
 * worth — see its comment — and pointing at the run is how somebody reaches the
 * rest without this page becoming an archive.
 *
 * `onDownload` is passed only when the window can act. `OutputsPanel` renders no
 * button at all in that case rather than a disabled one, which is why this is an
 * absent prop and not a `false`.
 */
function OutputsArea({
  agent,
  canAct,
  cards,
  exports,
  grounding,
  onExported,
  openId,
  setFeedback,
}: {
  agent: string;
  canAct: boolean;
  cards: ArtifactCardView[];
  /** What DASH has saved for this agent (MAR-697). */
  exports: AgentExportView[];
  grounding: GroundingAnalysis | null;
  /**
   * Read this agent again, because a file has just been saved (MAR-697).
   *
   * The list below is built from the folder on disk, and the page would
   * otherwise pick the new file up on its next poll — a few seconds during
   * which the sentence DASH just showed points at a list the file is not in
   * yet. A promise made in a notice has to be true by the time somebody looks
   * down to check it.
   */
  onExported: () => void;
  /** Which card the rail asked for, or null for the newest (MAR-641). */
  openId?: string | null;
  setFeedback: Dispatch<SetStateAction<CommandFeedback>>;
}): ReactNode {
  /**
   * Save one briefing as a PDF (MAR-674).
   *
   * `save`'s twin below, deliberately not folded into it. The two commands have
   * different sources — one fetches bytes the runner holds, one composes a
   * document DASH holds — and therefore different sentences when they fail; a
   * single handler branching on the artifact kind would have one message for
   * two situations.
   */
  async function exportBrief(card: ArtifactCardView): Promise<void> {
    setFeedback(null);
    const result = await exportBriefAsPdf({
      agent_id: agent,
      artifact_id: card.reference.artifact_id,
    });
    /*
     * Always a sentence now (MAR-697).
     *
     * `save` below still has the silent branch, because a save dialog can
     * still be cancelled and reporting that would be DASH narrating a choice
     * back at the person who made it. This flow has no dialog to cancel: it
     * either saved the document or it could not, and both are worth saying.
     */
    setFeedback({
      ok: result.ok,
      message: result.detail ?? "DASH could not save this briefing as a PDF.",
    });
    if (result.ok) {
      // Before the person looks down for the list the sentence just named.
      onExported();
    }
  }

  /**
   * Open one of the files DASH saved (MAR-697).
   *
   * A refusal is shown here, unlike a link press, and the difference is what
   * the person is looking at afterwards. A link sends them to their browser;
   * this one leaves them on this page in front of a name that did nothing, so
   * the two things that can go wrong — the file has been deleted since the
   * page was drawn, or this computer has no program for it — both need a
   * sentence. Main composes it; there is nothing for this handler to decide.
   */
  async function openSaved(entry: AgentExportView): Promise<void> {
    setFeedback(null);
    const result = await openExport({ agent_id: agent, file: entry.file });
    if (result.ok) {
      return;
    }
    setFeedback({
      ok: false,
      message: result.detail ?? EXPORTS_PANEL_COPY.open_failed,
    });
  }

  async function save(card: ArtifactCardView): Promise<void> {
    setFeedback(null);
    const result = await downloadOutput({
      agent_id: agent,
      artifact_id: card.reference.artifact_id,
    });
    // A cancelled save dialog answers `ok` with no sentence. That is the user
    // deciding not to, and reporting it as an outcome would be DASH narrating
    // a choice back at the person who just made it.
    if (result.ok && (result.detail ?? "") === "") {
      return;
    }
    setFeedback({
      ok: result.ok,
      message: result.detail ?? "DASH could not save a copy of this output.",
    });
  }

  return (
    <>
      <OutputsPanel
        cards={cards}
        emptyState={{
          headline: AGENT_OUTPUTS_COPY.empty_headline,
          detail: AGENT_OUTPUTS_COPY.empty_detail,
        }}
        grounding={grounding}
        heading={AGENT_OUTPUTS_COPY.heading}
        openId={openId}
        onDownload={canAct ? (card) => void save(card) : undefined}
        onExportBrief={canAct ? (card) => void exportBrief(card) : undefined}
        /* Per card, because this list spans runs now. The old page had one link
           under the whole panel saying "open the run these came from", which was
           true when every card came from one run and would have been a lie the
           moment MAR-609 widened the scope. */
        runHref={(card) => runDetailHref(agent, card.reference.run_id)}
        /* MAR-646. One output at a time, because the rail beside this stage is
           the index of them. */
        single
      />
      {/* MAR-697, ADR 0008. Under DASH's account of the outputs and above the
          author's panel, which is where DASH's own records go on this stage.
          It draws nothing at all until something has been saved — see
          `ExportsList` for why that is the opposite of the rule the panel
          above it follows. */}
      <ExportsList
        exports={exports}
        onOpen={canAct ? (entry) => void openSaved(entry) : undefined}
      />
    </>
  );
}

/**
 * What is left before a new agent works (MAR-609's rule, MAR-641's stage).
 *
 * The Overview stage's answer for an agent that has never run, and the reason
 * `resolveAgentStage` still lands a new agent here: there is nothing it has
 * made to land on. Every line is a fact `buildAgentChecklist` read off the same
 * view the Settings stage reads — this component decides nothing and looks
 * nothing up, which is what keeps the checklist and the model picker from
 * becoming two surfaces with opinions about one key (MAR-624).
 *
 * The marks are text as well as shape. `lib/copy/glance.ts` and MAR-547 both
 * land on the same rule — no state that is readable only from a colour — so
 * each row carries a done/still-to-do word for a screen reader and for anyone
 * who cannot tell the two glyphs apart.
 */
function GuidedChecklist({
  agent,
  steps,
}: {
  agent: string;
  steps: AgentChecklistStep[];
}): ReactNode {
  return (
    <section className="section agent-checklist" aria-labelledby="agent-checklist-heading">
      <div className="section-heading">
        <h2 id="agent-checklist-heading">{AGENT_COCKPIT_COPY.checklist.heading}</h2>
      </div>
      <ol className="checklist-steps">
        {steps.map((step) => (
          <li className={step.done ? "checklist-step is-done" : "checklist-step"} key={step.id}>
            <span className="checklist-mark" aria-hidden="true">
              {step.done ? "✓" : "•"}
            </span>
            <span className="checklist-body">
              <span className="checklist-label">
                {step.label}
                <span className="visually-hidden">
                  {step.done
                    ? AGENT_COCKPIT_COPY.checklist.done
                    : AGENT_COCKPIT_COPY.checklist.todo}
                </span>
              </span>
              <span className="muted wrap">{step.detail}</span>
              {step.action === null ? null : (
                <Link className="button-link" href={agentStageHref(agent, step.action.stage)}>
                  {step.action.label}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
/**
 * A clock time, or nothing.
 *
 * Time only, not a date: this line exists to answer "is this still moving?",
 * which is a question about the last few seconds. A full timestamp answers a
 * question nobody asked and makes the line harder to read at a glance.
 */
function timeOnly(at: Date | null): string {
  return at === null ? "just now" : at.toLocaleTimeString();
}

/**
/**
 * What the agent said it would do, kept where the user can find it again.
 *
 * The consent dialog said this once, at the moment of decision. A receipt has to
 * outlive that moment: "what did I agree to?" is a question people ask days
 * later, and an answer that existed only in a dialog they dismissed is no answer.
 *
 * The closing sentence is the one ADR 0002 requires and is not optional. DASH
 * renders what an agent declares; the runner strips the environment but spawns
 * an ordinary process with ordinary network access, so nothing here is enforced.
 * Saying so plainly is the difference between a receipt and a false assurance.
 */
function PermissionReceipt({ permissions }: { permissions: PermissionGrant[] }): ReactNode {
  if (permissions.length === 0) {
    return null;
  }

  return (
    <section className="section" aria-labelledby="permission-receipt">
      <h2 id="permission-receipt">What this agent said it would do</h2>
      <ul className="capability-list">
        {permissions.map((grant) => (
          <li key={grant.id}>
            <strong>{grant.label}</strong>
            <div className="wrap muted">{grant.detail}</div>
          </li>
        ))}
      </ul>
      <p className="muted wrap">
        This is what the agent declared when you added it. DASH shows you the
        claim and keeps it here; it does not restrict what the agent can reach.
      </p>
    </section>
  );
}

/**
 * The one part of the workspace record that is waiting for a person (MAR-609).
 *
 * ## Why this is not inside the disclosure with everything else
 *
 * Every other section of the old `WorkspaceBody` describes something already
 * finished — runs, tasks, memory, the audit trail. This one is a queue of
 * decisions the agent cannot proceed without, and burying a blocked agent's
 * approvals behind "Show the full record" would be the MAR-586 fleet chip
 * pointing at a `#waiting-work` anchor inside a closed `<details>`, which a
 * browser will not scroll to.
 *
 * ## Why it renders nothing when the inbox is empty
 *
 * The old section drew its heading and *"No choices or enforceable approvals
 * are pending"* on every agent, forever. On the empty agent MAR-609 asks to be
 * sized for, that is one of seven headings each followed by a sentence saying
 * there is nothing under it — the wall Henrik was describing. An empty queue is
 * the ordinary state and it is now silent; the status pill already says whether
 * anything needs attention, and `next_action` is carried in the record below.
 */
function WaitingWork({
  agent,
  canAct,
  issue,
  pending,
  reasons,
  setFeedback,
  setReasons,
  snapshot,
}: {
  agent: string;
  canAct: boolean;
  issue: (
    key: string,
    command: Parameters<typeof submitAgentCommand>[0],
    args: AgentCommandArgs,
  ) => Promise<void>;
  pending: string | null;
  reasons: Record<string, string>;
  setFeedback: Dispatch<SetStateAction<CommandFeedback>>;
  setReasons: Dispatch<SetStateAction<Record<string, string>>>;
  snapshot: WorkspaceSnapshotView | null;
}): ReactNode {
  if (snapshot === null || snapshot.inbox.length === 0) {
    return null;
  }
  return (
    <section className="section" aria-labelledby="waiting-work">
      <h2 id="waiting-work">Waiting for you</h2>
      <div className="work-list">
        {snapshot.inbox.map((item) => (
          <InboxControl
            agent={agent}
            canAct={canAct}
            issue={issue}
            item={item}
            key={item.id}
            observedAt={snapshot.observed_at}
            pending={pending}
            reason={reasons[item.id] ?? ""}
            setFeedback={setFeedback}
            setReason={(reason) => {
              setReasons((current) => ({ ...current, [item.id]: reason }));
            }}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Everything DASH holds about this agent that is a record rather than content
 * (MAR-609).
 *
 * Unchanged in substance from the old `WorkspaceBody` minus its overview block
 * and its inbox: the same sections, the same components, the same empty
 * sentences. What changed is that the whole thing now lives behind one
 * disclosure, so the facts are one click away instead of being the page.
 *
 * The overview block is gone rather than moved. Its two headline facts — the
 * runtime and the trigger — are tiles now, and its status heading is the pill
 * in the header; what is left of it are the four smaller facts, which are in
 * the `<dl>` at the top of this section where a person reading the record
 * expects them.
 */
function WorkspaceRecord({
  agent,
  canAct,
  issue,
  pending,
  snapshot,
}: {
  agent: string;
  canAct: boolean;
  issue: (
    key: string,
    command: Parameters<typeof submitAgentCommand>[0],
    args: AgentCommandArgs,
  ) => Promise<void>;
  pending: string | null;
  snapshot: WorkspaceSnapshotView;
}): ReactNode {
  const { overview } = snapshot;

  return (
    <>
      <section className="section" aria-labelledby="workspace-facts">
        <h2 id="workspace-facts">State</h2>
        {overview.next_action === null ? null : (
          <p className="next-action">{overview.next_action}</p>
        )}
        <dl className="facts">
          {/* MAR-641. The tile's fact, in the record. It left the Overview
              stage because the header's Local/Cloud chip reads as an answer to
              the same question and the two disagreed on the first frame — see
              the note on `tiles`. It is a recorded fact and it is kept. */}
          <div>
            <dt>{AGENT_TILE_COPY.where}</dt>
            <dd>{overview.runtime_label}</dd>
          </div>
          <div>
            <dt>When DASH closes</dt>
            <dd>
              {overview.continues_when_dash_closed
                ? "Keeps running"
                : "May stop or become unavailable"}
            </dd>
          </div>
          {overview.offline_behavior === null ? null : (
            <div>
              <dt>When offline</dt>
              <dd>{overview.offline_behavior}</dd>
            </div>
          )}
          {overview.last_activity_at === null ? null : (
            <div>
              <dt>Last activity</dt>
              <dd>{overview.last_activity_at}</dd>
            </div>
          )}
          {/*
            * Relabelled with MAR-464's binding. This value now advances when
            * the agent's decision-relevant state changes, not on every poll, so
            * "last snapshot" would read as "DASH has stopped checking" the
            * moment an idle agent sat still — which is the opposite of true.
            * When DASH last looked is a separate question, and `useLiveView`
            * already answers it in its own live region during a run.
            */}
          <div>
            <dt>State last changed</dt>
            <dd>{snapshot.observed_at}</dd>
          </div>
        </dl>
      </section>

      <section className="section" aria-labelledby="current-runs">
        <h2 id="current-runs">Runs</h2>
        {snapshot.runs.length === 0 ? (
          <p className="muted">This agent has not published a run yet.</p>
        ) : (
          <div className="card-grid">
            {snapshot.runs.map((run) => (
              <RunCard agent={agent} key={run.id} run={run} />
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="tasks">
        <h2 id="tasks">Tasks</h2>
        {snapshot.tasks.length === 0 ? (
          <p className="muted">No tasks have been published.</p>
        ) : (
          <ol className="row-list">
            {snapshot.tasks.map((task) => (
              <li key={task.id}>
                <article className="row-card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">{task.status.replaceAll("_", " ")}</p>
                      <h3>{task.label}</h3>
                    </div>
                  </div>
                  {task.detail === null ? null : <p className="muted wrap">{task.detail}</p>}
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="section" aria-labelledby="workspace-connections">
        <div className="section-heading">
          <h2 id="workspace-connections">Connections</h2>
          <Link href="/settings">Open Connection Center</Link>
        </div>
        {snapshot.connections.length === 0 ? (
          <p className="muted">The agent has not reported connection health.</p>
        ) : (
          <div className="card-grid">
            {snapshot.connections.map((connection) => (
              <article className="summary-card" key={connection.connection_id}>
                <p className="eyebrow">{connection.state.replaceAll("_", " ")}</p>
                <h3>{connection.connection_id}</h3>
                <p>{connection.masked_account ?? "No account hint reported"}</p>
                <p className="muted">
                  Checked {connection.checked_at}
                  {connection.reauthorization_required ? " · reconnect required" : ""}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="memory">
        <h2 id="memory">Memory</h2>
        <p className="muted">
          Durable preferences are shown only as user-visible descriptors with
          provenance. Agent suggestions are not silently saved here.
        </p>
        {snapshot.memory.length === 0 ? (
          <p className="muted">No user-visible memory has been published.</p>
        ) : (
          <div className="card-grid">
            {snapshot.memory.map((entry) => (
              <article className="summary-card" key={entry.id}>
                <p className="eyebrow">
                  {entry.retention === "user_approved"
                    ? "User approved"
                    : "Descriptor only"}
                </p>
                <h3>{entry.label}</h3>
                <p>{entry.summary}</p>
                <p className="muted">{entry.provenance}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <PlanVsActual snapshot={snapshot} />
      <AuditHistory snapshot={snapshot} />
    </>
  );
}

function InboxControl({
  agent,
  canAct,
  issue,
  item,
  observedAt,
  pending,
  reason,
  setFeedback,
  setReason,
}: {
  agent: string;
  canAct: boolean;
  issue: (
    key: string,
    command: Parameters<typeof submitAgentCommand>[0],
    args: AgentCommandArgs,
  ) => Promise<void>;
  item: InboxItem;
  observedAt: string;
  pending: string | null;
  reason: string;
  setFeedback: Dispatch<SetStateAction<CommandFeedback>>;
  setReason: (reason: string) => void;
}): ReactNode {
  const base = {
    agent_id: agent,
    observed_at: observedAt,
    task_id: item.task_id,
  };
  // MAR-681. One checkbox per card rather than per option: "always this way"
  // describes the question, not any one answer to it, and it is read at the
  // moment an option is pressed rather than driving a second control.
  const [remember, setRemember] = useState(false);

  async function chooseOption(optionId: string, optionLabel: string): Promise<void> {
    const key = `choice:${item.id}:${optionId}`;
    if (remember) {
      const stored = await setStandingAnswer({
        agent_id: agent,
        question_label: item.label,
        option_id: optionId,
        option_label: optionLabel,
      });
      if (!stored.ok) {
        setFeedback({
          ok: false,
          message:
            stored.detail ?? "DASH could not remember this answer, but is answering it this once.",
        });
      }
    }
    await issue(key, "choose", { ...base, choice_id: item.id, option_id: optionId });
  }

  return (
    /* MAR-641. An id per item, because the cockpit's rail names one decision
       rather than the queue: `#waiting-work` is still the section's anchor and
       still where MAR-586's fleet chip lands, and `#work-…` is how a rail entry
       lands on the exact approval it was describing. */
    <article
      className={item.expired ? "work-card is-expired" : "work-card"}
      id={`work-${item.id}`}
    >
      <div>
        <p className="eyebrow">
          {item.kind === "approval"
            ? AGENT_COCKPIT_COPY.work_kind.approval
            : AGENT_COCKPIT_COPY.work_kind.choice}{" "}
          · {item.expired ? "expired" : `by ${item.expires_at}`}
        </p>
        <h3>{item.task_label}</h3>
        <p>{item.label}</p>
        {item.kind === "approval" ? (
          <div className="effect-preview">
            <strong>What approval permits</strong>
            <p>{item.action_label}</p>
            {item.context?.map((context) => (
              <p key={`${context.label}:${context.detail ?? ""}`}>
                {context.label}
                {context.detail === undefined ? "" : ` · ${context.detail}`}
              </p>
            ))}
            <p className="muted">
              The runner will recheck this approval, its expiry and the exact
              target before performing anything.
            </p>
          </div>
        ) : null}
      </div>

      {!canAct || item.expired ? null : item.kind === "choice" ? (
        <div className="choice-list-wrap">
          <div className="choice-list" aria-label={item.label}>
            {item.options.map((option) => (
              <button
                disabled={pending !== null}
                key={option.id}
                onClick={() => void chooseOption(option.id, option.label)}
                type="button"
              >
                <span>{option.label}</span>
                {option.detail === undefined ? null : <small>{option.detail}</small>}
              </button>
            ))}
          </div>
          {/* MAR-681, Henrik's own words: "I want both all the time." Read at
              the moment an option is pressed, so one press both answers this
              occurrence and remembers the answer — revocable on the Settings
              stage, `AGENT_SETTINGS_COPY.standing_answers`. */}
          <label className="choice-remember">
            <input
              checked={remember}
              disabled={pending !== null}
              onChange={(event) => setRemember(event.target.checked)}
              type="checkbox"
            />
            {AGENT_COCKPIT_COPY.remember_choice}
          </label>
        </div>
      ) : (
        <div className="approval-controls">
          <label htmlFor={`reason-${item.id}`}>Optional note to the runner</label>
          <textarea
            id={`reason-${item.id}`}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            value={reason}
          />
          <div className="button-row">
            <button
              className="button-danger"
              disabled={pending !== null}
              onClick={() =>
                void issue(`reject:${item.id}`, "reject", {
                  ...base,
                  approval_id: item.id,
                  action_id: item.action_id,
                  reason: reason === "" ? undefined : reason,
                })
              }
              type="button"
            >
              Reject
            </button>
            <button
              className="button-primary"
              disabled={pending !== null}
              onClick={() =>
                void issue(`approve:${item.id}`, "approve", {
                  ...base,
                  approval_id: item.id,
                  action_id: item.action_id,
                  reason: reason === "" ? undefined : reason,
                })
              }
              type="button"
            >
              Approve exact action
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/**
 * One run, in the record (MAR-609, subtracted by MAR-646).
 *
 * ## The buttons left, and the run they controlled did not
 *
 * This card drew `run.controls` — pause, resume, cancel — for every run with
 * any, which for the run in flight is the same pair of buttons `AgentControls`
 * draws on the Run stage, wired to the same command with the same arguments.
 * Two controls for one act, on two stages, is the shape MAR-609 built
 * `buildAgentControl` to end: *one decision about what can be pressed, taken
 * once*. That decision is the Run stage's, because Run owns *now* and this
 * section is the record of what happened.
 *
 * Nothing about the run is unsaid by the loss. The status, the start and the
 * progress are still here, the live run's controls are one press away on the
 * stage whose whole subject they are, and the technical detail link is
 * untouched.
 */
function RunCard({
  agent,
  run,
}: {
  agent: string;
  run: WorkspaceRunView;
}): ReactNode {
  const phase = describeWorkingPhase(run.status);
  return (
    <article className="summary-card">
      {/*
        A run in flight gets the living line; every other status keeps the
        plain eyebrow (MAR-544). The split is `describeWorkingPhase`'s and is
        deliberate: an approval waiting on the person is not the system
        working, and a pulse on "waiting for approval" would claim it is.
      */}
      {phase !== null ? (
        <p className="eyebrow">
          <WorkingLine phase={phase} />
        </p>
      ) : (
        <p className="eyebrow">{run.status.replaceAll("_", " ")}</p>
      )}
      <h3>{run.started_at === null ? "Current run" : `Started ${run.started_at}`}</h3>
      {run.progress === null ? null : (
        <progress aria-label="Run progress" max={1} value={run.progress}>
          {Math.round(run.progress * 100)}%
        </progress>
      )}
      <p>
        <Link href={runDetailHref(agent, run.id)}>Open technical run detail</Link>
      </p>
    </article>
  );
}

function PlanVsActual({
  snapshot,
}: {
  snapshot: WorkspaceSnapshotView;
}): ReactNode {
  const plan = snapshot.plan_vs_actual;
  if (plan === null) {
    return (
      <section className="section" aria-labelledby="workspace-plan">
        <h2 id="workspace-plan">Plan-vs-actual</h2>
        <p className="muted">The agent has not published a comparison yet.</p>
      </section>
    );
  }

  return (
    <section className="section" aria-labelledby="workspace-plan">
      <div className="section-heading">
        <h2 id="workspace-plan">Plan-vs-actual</h2>
        <Link href={runDetailHref(snapshot.overview.agent_id, plan.run_id)}>
          Open technical run detail
        </Link>
      </div>
      <p>
        {plan.executed_components.length} of {plan.planned_components.length} planned
        steps have run.
      </p>
      {plan.deviations.length === 0 ? (
        <p className="muted">No deviations reported in this snapshot.</p>
      ) : (
        <ul>
          {plan.deviations.map((deviation, index) => (
            <li key={`${deviation.kind}:${String(index)}`}>
              <strong>{deviation.kind.replaceAll("_", " ")}:</strong>{" "}
              {deviation.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditHistory({
  snapshot,
}: {
  snapshot: WorkspaceSnapshotView;
}): ReactNode {
  return (
    <section className="section" aria-labelledby="audit-history">
      <h2 id="audit-history">Audit history</h2>

      <h3>Approval decisions</h3>
      {snapshot.approval_decisions.length === 0 ? (
        <p className="muted">No approval decision has been published.</p>
      ) : (
        <ul className="audit-list">
          {snapshot.approval_decisions.map((decision) => (
            <li key={decision.id}>
              <strong>{decision.decision}</strong> at {decision.decided_at}
            </li>
          ))}
        </ul>
      )}

      <details>
        <summary>Technical audit details</summary>
        <p className="muted">
          Raw event, actor, target and correlation identifiers for an audit or
          support investigation.
        </p>

        <h3>Recorded approval identities</h3>
        {snapshot.approval_decisions.length === 0 ? (
          <p className="muted">No approval identity has been published.</p>
        ) : (
          <ul className="audit-list">
            {snapshot.approval_decisions.map((decision) => (
              <li key={`technical:${decision.id}`}>
                {decision.decision} by {decision.actor_id} · request{" "}
                {decision.request_id} · correlation {decision.correlation_id}
              </li>
            ))}
          </ul>
        )}

        <h3>Agent events</h3>
        {snapshot.audit_events.length === 0 ? (
          <p className="muted">No Agent DOM audit event has been published.</p>
        ) : (
          <ul className="audit-list">
            {snapshot.audit_events.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong> by {event.actor_id} on {event.target_id} at{" "}
                {event.ts} · correlation {event.correlation_id}
              </li>
            ))}
          </ul>
        )}

        <h3>DASH command decisions</h3>
        {snapshot.command_audit.length === 0 ? (
          <p className="muted">No command has crossed the audited agent boundary.</p>
        ) : (
          <ol className="row-list">
            {snapshot.command_audit.map((record, index) => (
              <li key={`${record.correlation_id}:${record.command}:${String(index)}`}>
                <article className="row-card">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">{record.decision}</p>
                      <h3>{record.command}</h3>
                    </div>
                  </div>
                  <dl className="facts">
                    <div>
                      <dt>Actor</dt>
                      <dd>{record.actor_id}</dd>
                    </div>
                    <div>
                      <dt>Authenticated by</dt>
                      <dd>{record.authenticated_by}</dd>
                    </div>
                    <div>
                      <dt>When</dt>
                      <dd>{record.decided_at}</dd>
                    </div>
                    {record.reason === null ? null : (
                      <div>
                        <dt>Reason</dt>
                        <dd>{record.reason}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Correlation</dt>
                      <dd>
                        <code>{record.correlation_id}</code>
                      </dd>
                    </div>
                  </dl>
                </article>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
