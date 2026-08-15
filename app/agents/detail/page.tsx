"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
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
import { AgentRail } from "../../_components/agent-rail";
import { AgentSettings } from "../../_components/agent-settings";
import { AgentStageView } from "../../_components/agent-stage";
import { AgentTelemetry } from "../../_components/agent-telemetry";
import { AgentTiles, type AgentTile } from "../../_components/agent-tiles";
import { AgentChatBar, AskThread } from "../../_components/ask";
import { LiveFeed } from "../../_components/live-feed";
import { ModelChoice } from "../../_components/model-choice";
import { InputsPanel, type SelectedInput } from "../../_components/inputs";
import { OutputsPanel } from "../../_components/outputs";
import { AgentPanel } from "../../_components/panel";
import { RemoveAgent } from "../../_components/remove-agent";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { WorkingLine } from "../../_components/working";
import { AGENT_WORKSPACE_PARAMS, agentStageHref, runDetailHref } from "../../_data/routes";
import {
  downloadOutput,
  markAgentLooked,
  refreshSampleAgent,
  revealAgentFolder,
  submitAgentCommand,
  submitHostCommand,
  submitWorkspaceCommand,
  type AgentCommandArgs,
} from "../../_data/source";
import { useCanAct, useHost, useLiveView } from "../../_data/use-view";
import type { GroundingAnalysis } from "../../../lib/analyze";
import type { PermissionGrant } from "../../../lib/contracts";
import {
  AGENT_COCKPIT_COPY,
  AGENT_OUTPUTS_COPY,
  AGENT_TILE_COPY,
} from "../../../lib/copy/agent-page";
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
import type { ArtifactCardView } from "../../../lib/views/artifacts";
import type { InboxItem } from "../../../lib/workspace";
import type {
  AgentDeployTarget,
  AgentModelSettingsView,
  WorkspaceRunView,
  WorkspaceSnapshotView,
} from "../../../lib/views/types";

type CommandFeedback = { ok: boolean; message: string } | null;

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
  const state = useLiveView(
    (source) => source.workspace(agent),
    `${agent}:${String(refreshKey)}`,
    live,
  );
  const canAct = useCanAct();
  const host = useHost();

  // Follow a run only while one is actually going. `useLiveView` stops the
  // moment this turns false, so an idle agent's page is as still as every other
  // page in DASH.
  const running =
    state.status === "ready" &&
    state.data.found &&
    (state.data.snapshot?.runs ?? []).some((run) => run.status === "running");
  useEffect(() => {
    setLive(running);
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
  useEffect(() => {
    if (!ready || typeof window === "undefined") {
      return;
    }
    const fragment = window.location.hash.slice(1);
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
  }, [ready, agent, stageParam]);

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
  const overview = view.snapshot?.overview ?? null;
  /*
   * Two tiles, and there were four.
   *
   * The third to go was Status, and the frame showed it saying "Not reported"
   * about 300px below a status pill saying NOT REPORTED — the same fact twice,
   * on the one screen whose whole complaint is redundant text. The pill won: it
   * is in the header, beside the controls the status governs, and it is there
   * in every state including the ones with no snapshot.
   *
   * **The fourth was "Runs on", and the first cockpit frame caught it doing the
   * same thing in the other direction** (MAR-641). The header now carries a
   * Local/Cloud chip, and the two read as a contradiction rather than as one
   * fact twice: *LIVES ON Local* above *RUNS ON Not reported*. They are
   * genuinely different facts — where DASH sent the agent, and what runtime the
   * agent reported — but nothing on the screen said so, and a novice reading
   * two labels a word apart will not derive it. The chip is the one a person
   * asks for on this page; `runtime_label` is a record, and it is in the Logs
   * stage's State facts where the rest of the record is.
   *
   * Found by looking, both times. Nothing measures "these two elements
   * contradict each other", which is the fifth DASH defect in a row that only a
   * photograph caught.
   */
  const tiles = [
    {
      label: AGENT_TILE_COPY.trigger,
      value: overview?.trigger_label ?? AGENT_TILE_COPY.trigger_default,
    },
    modelTile(view.models),
  ];

  /*
   * MAR-641. Which part of this agent is on the stage.
   *
   * The address decides, and `resolveAgentStage` decides what an address that
   * says nothing means — the run while one is going, the overview otherwise.
   * Nothing in this component may write to it except `goToStage`, so there is
   * one route into every view of an agent and it is one somebody can send to
   * somebody else.
   */
  const stage = resolveAgentStage(stageParam, { running });
  const openOutput = params.get(AGENT_WORKSPACE_PARAMS.output);
  const inbox = view.snapshot?.inbox ?? [];
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
     * The landing view: what needs you, then what it made.
     *
     * That ordering is the wireframe's and it is also where `#waiting-work`
     * has to live — MAR-586's fleet chip promises to take somebody to the
     * thing that needs them, and it names no stage, so the thing that needs
     * them must be on the one an address without a stage resolves to.
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
          setReasons={setReasons}
          snapshot={view.snapshot}
        />

        {empty ? (
          <GuidedChecklist
            agent={view.agent}
            steps={buildAgentChecklist(checklistFacts)}
          />
        ) : (
          /* The newest output only. The whole list is the Output stage and the
             rail is the index of it; repeating twelve dated disclosures here
             would make the landing view the archive it was before MAR-609. */
          <OutputsArea
            agent={view.agent}
            canAct={canAct}
            cards={view.outputs.slice(0, 1)}
            grounding={view.latest_digest_grounding}
            heading={AGENT_COCKPIT_COPY.outputs_heading}
            more={view.outputs.length > 1 ? agentStageHref(view.agent, "output") : null}
            setFeedback={setFeedback}
          />
        )}

        {/* MAR-609, reusing MAR-570. Three answers, one row, no prose. Last,
            because they are facts about the agent and everything above them is
            something waiting for a person or something the agent made. */}
        <AgentTiles tiles={tiles} />
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
      </>
    ),

    /*
     * Everything this agent has made, and the region its author declared.
     *
     * The author's panel is on this stage and no other, which is ADR 0008
     * slice 3 unchanged: DASH's own record of the outputs comes first, and
     * somebody else's box is below it rather than in the position a person has
     * learned to read as DASH's own voice. It renders nothing at all for the
     * agents that declare no panel, which is most of them and every empty one.
     */
    output: (
      <>
        <OutputsArea
          agent={view.agent}
          canAct={canAct}
          cards={view.outputs}
          grounding={view.latest_digest_grounding}
          history
          openId={openOutput}
          setFeedback={setFeedback}
        />
        <AgentPanel view={view.panel} />
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

              This is not the deploy single-home move. That decision — whether
              the Servers page stops offering "Put an agent here" and links here
              instead — is Henrik's and is open, so `app/settings/servers` is
              untouched and nothing on this stage claims to be the only way to
              deploy. */}
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
          canTrigger={control.run.kind === "run_now"}
          control={control}
          goal={view.goal}
          hasFolder={view.folder_checkable && canAct}
          live={running ? timeOnly(state.last_read_at) : null}
          onOpenFolder={() => void openFolder()}
          onRefresh={() => setRefreshKey((value) => value + 1)}
          onTriggerRun={() => {
            /*
             * Both halves of "acts and switches the stage", in that order.
             *
             * The stage moves first and unconditionally: whatever this press
             * does or refuses to do, the Run stage is where the answer is
             * — the live feed if it started, `AGENT_CONTROL_COPY.idle`'s
             * sentence if there was nothing to start. Starting a run while
             * leaving the person on the Output stage is the silence MAR-609
             * was filed about wearing a different shape.
             */
            goToStage("run");
            if (control.run.kind !== "run_now") {
              return;
            }
            const { task_id: taskId_, observed_at: observedAt } = control.run;
            void (async () => {
              /*
               * MAR-507. The files go first, and a refusal here stops the run.
               * The order is the whole point — see `dispatchTask`.
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
          places={view.deploy_targets}
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
        ask={view.ask}
        canAct={canAct}
        onChatStage={stage === "chat"}
        onAsked={() => setRefreshKey((value) => value + 1)}
        onFocus={() => {
          if (stage !== "chat") {
            goToStage("chat");
          }
        }}
        setFeedback={setFeedback}
      />
    </div>
  );
}

/**
 * The model tile's value (MAR-609).
 *
 * A model id is a value and gets the monospace face; the three fallbacks are
 * prose and do not. `AGENT_TILE_COPY.model_value` says why they are not the
 * picker's own `headline`.
 */
function modelTile(settings: AgentModelSettingsView): AgentTile {
  if (!settings.can_choose) {
    return {
      label: AGENT_TILE_COPY.model,
      value:
        settings.reason === "no_model_needed"
          ? AGENT_TILE_COPY.model_value.none
          : AGENT_TILE_COPY.model_value.unavailable,
    };
  }
  return settings.chosen_model_id === null
    ? { label: AGENT_TILE_COPY.model, value: AGENT_TILE_COPY.model_value.per_step }
    : { label: AGENT_TILE_COPY.model, value: settings.chosen_model_id, mono: true };
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
  grounding,
  heading,
  history = false,
  more,
  openId,
  setFeedback,
}: {
  agent: string;
  canAct: boolean;
  cards: ArtifactCardView[];
  grounding: GroundingAnalysis | null;
  /** What to call this list. The Overview stage shows one; Output shows all. */
  heading?: string;
  /** Collapse everything but the open card. Off on Overview, where there is one. */
  history?: boolean;
  /** Where the rest of them are, or null when this list is all of them. */
  more?: string | null;
  /** Which card the rail asked for, or null for the newest (MAR-641). */
  openId?: string | null;
  setFeedback: Dispatch<SetStateAction<CommandFeedback>>;
}): ReactNode {
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
        heading={heading ?? AGENT_OUTPUTS_COPY.heading}
        history={history}
        openId={openId}
        onDownload={canAct ? (card) => void save(card) : undefined}
        /* Per card, because this list spans runs now. The old page had one link
           under the whole panel saying "open the run these came from", which was
           true when every card came from one run and would have been a lie the
           moment MAR-609 widened the scope. */
        runHref={(card) => runDetailHref(agent, card.reference.run_id)}
      />
      {/* MAR-641. The Overview stage shows the newest output and says so; this
          is how a person gets from it to the rest without going through the
          rail. Null on the Output stage, where the link would point at the page
          the reader is already on. */}
      {more === null || more === undefined ? null : (
        <p className="outputs-more">
          <Link href={more}>{AGENT_COCKPIT_COPY.outputs_all}</Link>
        </p>
      )}
    </>
  );
}

/**
 * What is left before a new agent works (MAR-609's rule, MAR-641's stage).
 *
 * The Overview stage's answer for an agent that has never run, in place of the
 * output panel it has nothing to fill. Every line is a fact
 * `buildAgentChecklist` read off the same view the tiles read — this component
 * decides nothing and looks nothing up, which is what keeps the checklist and
 * the Model tile from becoming two surfaces with opinions about one key
 * (MAR-624).
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
              <RunCard
                agent={agent}
                canAct={canAct}
                issue={issue}
                key={run.id}
                observedAt={snapshot.observed_at}
                pending={pending}
                run={run}
              />
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
  setReason: (reason: string) => void;
}): ReactNode {
  const base = {
    agent_id: agent,
    observed_at: observedAt,
    task_id: item.task_id,
  };

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
        <div className="choice-list" aria-label={item.label}>
          {item.options.map((option) => {
            const key = `choice:${item.id}:${option.id}`;
            return (
              <button
                disabled={pending !== null}
                key={option.id}
                onClick={() =>
                  void issue(key, "choose", {
                    ...base,
                    choice_id: item.id,
                    option_id: option.id,
                  })
                }
                type="button"
              >
                <span>{option.label}</span>
                {option.detail === undefined ? null : <small>{option.detail}</small>}
              </button>
            );
          })}
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

function RunCard({
  agent,
  canAct,
  issue,
  observedAt,
  pending,
  run,
}: {
  agent: string;
  canAct: boolean;
  issue: (
    key: string,
    command: Parameters<typeof submitAgentCommand>[0],
    args: AgentCommandArgs,
  ) => Promise<void>;
  observedAt: string;
  pending: string | null;
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
      {canAct && run.controls.length > 0 ? (
        <div className="button-row">
          {run.controls.map((control) => (
            <button
              className={control.command === "cancel" ? "button-danger" : "button-secondary"}
              disabled={pending !== null}
              key={control.command}
              onClick={() =>
                void issue(`${control.command}:${run.id}`, control.command, {
                  agent_id: agent,
                  observed_at: observedAt,
                  run_id: run.id,
                })
              }
              type="button"
            >
              {control.label}
            </button>
          ))}
        </div>
      ) : null}
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
