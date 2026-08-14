"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
import { AgentControls, AgentHeader } from "../../_components/agent-header";
import { AgentSettings } from "../../_components/agent-settings";
import { AgentTelemetry } from "../../_components/agent-telemetry";
import { AgentTiles, type AgentTile } from "../../_components/agent-tiles";
import { AskAgent } from "../../_components/ask";
import { LiveFeed } from "../../_components/live-feed";
import { ModelChoice } from "../../_components/model-choice";
import { InputsPanel, type SelectedInput } from "../../_components/inputs";
import { OutputsPanel } from "../../_components/outputs";
import { AgentPanel } from "../../_components/panel";
import { RemoveAgent } from "../../_components/remove-agent";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { WorkingLine } from "../../_components/working";
import { AGENT_WORKSPACE_PARAMS, runDetailHref } from "../../_data/routes";
import {
  downloadOutput,
  markAgentLooked,
  refreshSampleAgent,
  submitAgentCommand,
  submitHostCommand,
  submitWorkspaceCommand,
  type AgentCommandArgs,
} from "../../_data/source";
import { useCanAct, useHost, useLiveView } from "../../_data/use-view";
import type { GroundingAnalysis } from "../../../lib/analyze";
import type { PermissionGrant } from "../../../lib/contracts";
import {
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
import { buildAgentControl } from "../../../lib/views/agent-control";
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
  const agent = params.get(AGENT_WORKSPACE_PARAMS.agent) ?? "";
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<CommandFeedback>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [live, setLive] = useState(false);
  /*
   * MAR-609. Closed by default, and deliberately not remembered.
   *
   * The settings a person changes here — which model, the folder, removing the
   * agent — are changed once and then not looked at, so the state that serves
   * the common visit is closed. A remembered drawer would mean the page a
   * person opens to read the news has a removal button on it because they
   * changed a model setting last week.
   */
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  }, [ready, agent]);

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
   * Three tiles, and there were four until the first screenshot.
   *
   * The fourth was Status, and the frame showed it saying "Not reported" about
   * 300px below a status pill saying NOT REPORTED — the same fact twice, on the
   * one screen whose whole complaint is redundant text. The pill wins because
   * it is in the header, beside the controls the status governs, and it is
   * there in every state including the ones with no snapshot.
   *
   * Found by looking. Nothing measures "these two elements say the same thing",
   * which is the fourth DASH defect in a row that only a photograph caught.
   */
  const tiles = [
    {
      label: AGENT_TILE_COPY.trigger,
      value: overview?.trigger_label ?? AGENT_TILE_COPY.trigger_default,
    },
    modelTile(view.models),
    {
      label: AGENT_TILE_COPY.where,
      value: overview?.runtime_label ?? AGENT_TILE_COPY.where_unknown,
    },
  ];

  return (
    <>
      {/*
        MAR-502. The portrait belongs to the identity header and nowhere else
        on this page: runs, verdicts, gates and outputs are all below, and a
        character standing beside any of them would be a character implying it
        had something to do with the finding. Here it is next to the agent's
        own name, which is the one thing on the page it is genuinely about.

        MAR-589. `view.title` is `agentDisplayName`'s answer and the id travels
        beside it as a value — Henrik's ruling, applied at the one place on this
        page that names the agent.
      */}
      <AgentHeader
        avatar={view.avatar}
        control={control}
        goal={view.goal}
        id={view.agent}
        live={running ? timeOnly(state.last_read_at) : null}
        onRefresh={() => setRefreshKey((value) => value + 1)}
        onSettings={() => setSettingsOpen((open) => !open)}
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

      {/* MAR-576. Before the output, because it is the reason the output may be
          the only thing here — and DASH's own voice about DASH's own template,
          which is why it is a plain notice and not a region attributed to
          anyone. Null for every agent DASH did not scaffold and for every
          scaffolded agent already current, which is almost all of them. */}
      <ManifestGapNotice
        agent={view.agent}
        canAct={canAct}
        gap={view.manifest_gap}
        onRefreshed={() => setRefreshKey((value) => value + 1)}
        setFeedback={setFeedback}
      />

      {/* MAR-609. The control panel Henrik asked for, directly under the
          header, and drawn in every state including the three where there is
          nothing to press. See `buildAgentControl` for why "no button" was the
          worst thing the old page did. */}
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

      {/* MAR-609, reusing MAR-570. Four answers, one row, no prose. */}
      <AgentTiles tiles={tiles} />

      {/* MAR-609. The settings button's drawer, in place rather than in a
          modal: it holds `RemoveAgent`, and a destructive control inside an
          overlay that can be dismissed by a stray click is the wrong container
          for it. Closed by default, so it costs nothing on the page a person
          opens to read the news. */}
      {settingsOpen ? (
        <AgentSettings
          avatar={view.avatar}
          canAct={canAct}
          id={view.agent}
          onClose={() => setSettingsOpen(false)}
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
              behaviour is unchanged — this drawer owns where it sits, not what
              it does. Renders nothing for an agent whose plan uses no model. */}
          <ModelChoice
            agent={view.agent}
            settings={view.models}
            canAct={canAct}
            onChanged={() => setRefreshKey((value) => value + 1)}
            setFeedback={setFeedback}
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
      ) : null}

      {/* MAR-635. The command surface: a live feed of what the agent is doing,
          and beside it the numbers the run actually reported. Telemetry draws
          nothing when there is no number, so an empty agent is the feed's two
          sentences plus the assets empty state — not a panel of invented
          meters.

          There is no power toggle. Turning an agent "off" has no exact meaning
          in DASH today: a local runner can be stopped, a deployed copy cannot
          (ADR 0010), and a control that looked like both would be a lie on one
          of the two machines. MAR-547's rule is that a control does something
          or is not drawn. */}
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

      {/* MAR-576, and now MAR-609's second ask, retitled by MAR-635 as
          generated assets. Same cards, same MAR-622 dated history, same two
          renderers — this panel and the author's `AgentPanel` below. The
          newest digest stays a full card so the news remains readable.

          It was fifth — behind the files panel, the Run now button and the
          permission receipt — and inside it the digest came last, under a
          four-row provenance receipt. On a 375px viewport the first headline
          began 1166px down an 812px screen, so opening the AI News Scout showed
          a permission disclaimer and a byte count and no news at all. Henrik's
          words for that page were "I get no AI news from it. Only some text
          about that it ran or something", and he was describing the ordering
          rather than a missing record: every digest was there, below the fold.

          What moved is only DASH's own surfaces relative to each other. The
          author's panel stays below them (see `AgentPanel` further down), so the
          attribution rule MAR-548 argued for is untouched — nothing an agent's
          author controls has been promoted into the position a person reads as
          DASH's own voice.

          Outside the snapshot branch on purpose. Outputs are DASH's own record
          and outlive the process that made them, so a stopped or unreachable
          agent still shows what it last produced.

          MAR-609 widened the scope from one run to every run — see the note on
          `outputs` in `lib/views/types.ts`. `latest_digest_grounding` still
          rides along because grounding is a verdict about the newest digest
          specifically, which is why `OutputsPanel` hangs the chip on the first
          card only. */}
      <OutputsArea
        agent={view.agent}
        canAct={canAct}
        cards={view.outputs}
        grounding={view.latest_digest_grounding}
        setFeedback={setFeedback}
      />

      {/* MAR-545, moved up by MAR-609. Directly under the agent's own output,
          because the question a person has is about what they have just read —
          "you mentioned tariffs last week, what else did you find?" — and a
          conversation placed below three controls would be a conversation about
          something the reader has scrolled past.

          Henrik asked for a chat window on a page that already had one. It was
          sixth of eleven sections, under the outputs, the inputs panel, Run now
          and a manifest notice; the model picker that makes it work on an
          unconfigured agent was below it, and the receipt, the panel and the
          whole workspace record below that. Nothing about it was broken — it
          was unfindable, which for a feature is the same thing.

          Draws in every state, including the four where nothing can be asked.
          Each of those is a fact about this agent worth knowing, and one of them
          — the conversation an agent had before its key was withdrawn — is
          content rather than a control. */}
      <AskAgent
        ask={view.ask}
        canAct={canAct}
        onAsked={() => setRefreshKey((value) => value + 1)}
        setFeedback={setFeedback}
      />

      {/* MAR-507. Below the output and the chat: choosing a file is a step
          before a run, and the run button is now in the header where it is
          always reachable. Renders nothing for an agent that declares no input
          roles, which is most of them. */}
      <InputsPanel
        busyRole={busyRole}
        canAct={canAct}
        onChoose={(roleId) => void chooseInput(roleId)}
        roles={view.input_roles}
        selected={selectedInputs}
      />

      {/* MAR-586. Actionable and therefore not behind the disclosure: this is
          the one part of the workspace record that is waiting for a person
          rather than describing something already finished. Renders nothing
          when the inbox is empty, which is the ordinary case — the old page
          drew the heading and a "nothing is pending" sentence regardless, which
          is one more paragraph on the empty agent MAR-609 asks to be sized
          for. */}
      <WaitingWork
        agent={view.agent}
        canAct={canAct}
        issue={issue}
        pending={pending}
        reasons={reasons}
        setReasons={setReasons}
        snapshot={view.snapshot}
      />

      {/* MAR-577. Left on the page rather than folded into settings: it is an
          action on the agent, not a preference, and MAR-606 is about to make
          this the surface that says whether the agent is live somewhere. The
          Servers page asks which agent goes on a machine; this asks which
          machine an agent goes on, and both reach the same `host.deploy`. */}
      <DeployToServer
        agent={view.agent}
        title={view.title}
        deploy={view.deploy}
        targets={view.deploy_targets}
        canAct={canAct}
        onBroughtHome={() => setRefreshKey((value) => value + 1)}
      />

      {/* MAR-548, ADR 0008 slice 3. Below DASH's own surfaces on purpose: the
          Outputs area is DASH's record and DASH's controls, and the panel is
          somebody else's box. Putting the author's region above them would let a
          `note` sit where a person has learned to read DASH's own voice.

          Deliberately **not** inside MAR-609's disclosure, though it is the
          longest thing on the page for the sample agent. A disclosure is DASH
          deciding somebody else's report is secondary, and ADR 0008's whole
          point is that DASH renders what the author declared without editorial-
          ising. It renders nothing at all for the agents that declare no panel,
          which is most of them and every empty one. */}
      <AgentPanel view={view.panel} />

      {/* MAR-609. Everything that is a *record* rather than content or a
          control, behind one disclosure.

          These are six sections — the permission receipt, runs, tasks,
          connections, memory, plan-versus-actual and the audit history — and
          every one of them rendered unconditionally, each with its own heading
          and its own sentence for the empty case. On an agent with no output
          that is the entire page: seven headings and seven paragraphs
          explaining that there is nothing under any of them. That is what
          Henrik meant by "way to much text for an agent with no output ;p".

          Kept, not deleted. This is MAR-570's move exactly — the receipt is one
          click away rather than gone — and every fact that was on the page is
          still on the page. */}
      <details className="agent-record">
        <summary>{AGENT_TILE_COPY.details_summary}</summary>
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
      </details>
    </>
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
  setFeedback,
}: {
  agent: string;
  canAct: boolean;
  cards: ArtifactCardView[];
  grounding: GroundingAnalysis | null;
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
    <OutputsPanel
      cards={cards}
      emptyState={{
        headline: AGENT_OUTPUTS_COPY.empty_headline,
        detail: AGENT_OUTPUTS_COPY.empty_detail,
      }}
      grounding={grounding}
      heading={AGENT_OUTPUTS_COPY.heading}
      history
      onDownload={canAct ? (card) => void save(card) : undefined}
      /* Per card, because this list spans runs now. The old page had one link
         under the whole panel saying "open the run these came from", which was
         true when every card came from one run and would have been a lie the
         moment MAR-609 widened the scope. */
      runHref={(card) => runDetailHref(agent, card.reference.run_id)}
    />
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
    <article className={item.expired ? "work-card is-expired" : "work-card"}>
      <div>
        <p className="eyebrow">
          {item.kind === "approval" ? "Guarded action" : "Choice"} ·{" "}
          {item.expired ? "expired" : `by ${item.expires_at}`}
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
