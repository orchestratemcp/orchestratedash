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

import { RunOutput } from "../../_components/digest";
import { InputsPanel, type SelectedInput } from "../../_components/inputs";
import { OAvatar } from "../../_components/o-avatar";
import { OutputsPanel } from "../../_components/outputs";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { WorkingLine } from "../../_components/working";
import { AGENT_WORKSPACE_PARAMS, runDetailHref } from "../../_data/routes";
import {
  downloadOutput,
  submitAgentCommand,
  submitWorkspaceCommand,
  type AgentCommandArgs,
} from "../../_data/source";
import { useCanAct, useHost, useLiveView } from "../../_data/use-view";
import type { GroundingAnalysis } from "../../../lib/analyze";
import type { OName } from "../../../lib/brand/o-cast";
import type { PermissionGrant } from "../../../lib/contracts";
import { INPUTS_PANEL_COPY } from "../../../lib/copy/inputs";
import { describeWorkingPhase } from "../../../lib/copy/working";
import type { InputRoleView } from "../../../lib/views/inputs";
import type { ArtifactCardView } from "../../../lib/views/artifacts";
import type { InboxItem } from "../../../lib/workspace";
import type {
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
  return (
    <>
      <div className="workspace-title">
        {/*
          MAR-502. The portrait belongs to the identity header and nowhere else
          on this page: runs, verdicts, gates and outputs are all below, and a
          character standing beside any of them would be a character implying it
          had something to do with the finding. Here it is next to the agent's
          own name, which is the one thing on the page it is genuinely about.
        */}
        <div className="agent-identity agent-portrait">
          <AgentPortrait avatar={view.avatar} />
          <div>
            <p className="eyebrow">Agent workspace</p>
            <h1>{view.title}</h1>
            <p className="lede">{view.goal}</p>
          </div>
        </div>
        <div>
          {/*
            The design brief's rule — "nothing moves or refreshes without saying
            it did" — applied to the one place DASH now refreshes on its own.
            A live region so it is announced rather than only seen, polite so it
            waits its turn, and it disappears with the run rather than becoming
            furniture.
          */}
          <p aria-live="polite" className="live-note">
            {running
              ? `Following this run. Last updated ${timeOnly(state.last_read_at)}.`
              : ""}
          </p>
          <button
            className="button-secondary"
            onClick={() => setRefreshKey((value) => value + 1)}
            type="button"
          >
            Refresh state
          </button>
        </div>
      </div>
      <HostNotice host={host} />
      {feedback === null ? null : (
        <div
          className={feedback.ok ? "notice notice-ok" : "notice notice-err"}
          role={feedback.ok ? "status" : "alert"}
        >
          {feedback.message}
        </div>
      )}

      {/* MAR-507. Above Run now, because it is the step before it. */}
      <InputsPanel
        busyRole={busyRole}
        canAct={canAct}
        onChoose={(roleId) => void chooseInput(roleId)}
        roles={view.input_roles}
        selected={selectedInputs}
      />

      <RunNow
        agent={view.agent}
        canAct={canAct}
        hasFiles={selectedInputs.some((input) => input.state === "copied")}
        issue={issue}
        onDispatch={dispatchTask}
        pending={pending}
        snapshot={view.snapshot}
      />

      <PermissionReceipt permissions={view.permissions} />

      {/* Outside the snapshot branch on purpose. Outputs are DASH's own record
          and outlive the process that made them, so a stopped or unreachable
          agent still shows what it last produced.

          MAR-434: this used to be `RunOutput` on `latest_digest` alone — one
          artifact, on a page whose agent may well have written two. The panel
          draws every output of that run, each with its own receipt and its own
          availability, which is the same correction MAR-434 made on the run
          detail page. `latest_digest_grounding` still rides along because
          grounding is a verdict about the newest digest specifically. */}
      <OutputsArea
        agent={view.agent}
        canAct={canAct}
        cards={view.outputs}
        grounding={view.latest_digest_grounding}
        runId={view.outputs_run_id}
        setFeedback={setFeedback}
      />

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
        <WorkspaceBody
          agent={view.agent}
          canAct={canAct}
          issue={issue}
          pending={pending}
          reasons={reasons}
          setReasons={setReasons}
          snapshot={view.snapshot}
        />
      )}
    </>
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
  runId,
  setFeedback,
}: {
  agent: string;
  canAct: boolean;
  cards: ArtifactCardView[];
  grounding: GroundingAnalysis | null;
  runId: string | null;
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
        grounding={grounding}
        onDownload={canAct ? (card) => void save(card) : undefined}
      />
      {runId === null ? null : (
        <p className="muted">
          <Link href={runDetailHref(agent, runId)}>
            Open the run these came from
          </Link>
        </p>
      )}
    </>
  );
}

/**
 * This agent's character, at 2x (MAR-502).
 *
 * 100px because a portrait is what this surface is — the one place in DASH
 * where the character is closest to being the subject rather than a marker in a
 * list. Never 1.5x and never a percentage: `image-rendering: pixelated`
 * upscales by nearest neighbour, so a fractional ratio lands some source pixels
 * on two screen pixels and some on three, and the sprite stops reading as pixel
 * art and starts reading as a rendering fault.
 *
 * **The empty case reserves the box rather than collapsing it.** `avatar` is
 * null only when DASH cannot read this agent's own row — the workspace is built
 * from the manifest, which is a different column — and a header that reflowed
 * when a database read came back short would move the agent's name under the
 * user's cursor for a reason that has nothing to do with them. Nothing is drawn
 * in the reserved space and nothing is announced: an invented character would
 * be a costume this agent might not be wearing on the card it came from, and
 * the whole value of one is that it is the same every time.
 */
export function AgentPortrait({ avatar }: { avatar: OName | null }): ReactNode {
  if (avatar === null) {
    return <span className="o-portrait-empty" aria-hidden="true" />;
  }
  return <OAvatar name={avatar} size={100} />;
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
 * The primary action for an agent that only acts when asked (MAR-457).
 *
 * `retry` against the waiting task, not against a run. A freshly added agent has
 * no runs, and `contracts/agent-command.schema.json` requires the command to
 * name a run or a task — which is why the agent publishes a task it is not yet
 * working on. Without this the manual-first agent could be added and never
 * started.
 *
 * It goes through the same audited boundary every other control uses. A "Run
 * now" that called the runner directly would be a second command path, and the
 * second path is the one that skips the audit row.
 *
 * Absent rather than disabled when a run is already in flight: `lib/workspace.ts`
 * calls dead controls out as a thing not to render, and the run card below
 * already offers cancel while one is going.
 */
function RunNow({
  agent,
  canAct,
  hasFiles,
  issue,
  onDispatch,
  pending,
  snapshot,
}: {
  agent: string;
  canAct: boolean;
  /** Whether the person has files waiting that this run should receive (MAR-507). */
  hasFiles: boolean;
  issue: (
    key: string,
    command: Parameters<typeof submitAgentCommand>[0],
    args: AgentCommandArgs,
  ) => Promise<void>;
  /** Binds the open task to a run. False means the agent must not be started. */
  onDispatch: () => Promise<boolean>;
  pending: string | null;
  snapshot: WorkspaceSnapshotView | null;
}): ReactNode {
  if (!canAct || snapshot === null) {
    return null;
  }
  const waiting = snapshot.tasks.find((task) => task.status === "pending" && task.run_id === null);
  if (waiting === undefined) {
    return null;
  }

  /*
   * The rendered snapshot's own value, like every other control on this page.
   *
   * MAR-457 shipped a re-read here — ask DASH for the current `observed_at`
   * immediately before issuing — because the value churned on the five-second
   * poll and this button was refused as `stale_snapshot` for anyone who read the
   * screen first. MAR-464 fixed the binding instead: `observed_at` now advances
   * when the decision context does, so the workaround has nothing left to work
   * around and is removed.
   *
   * Removing it is not tidying. A re-read mints a *fresh* value per click, and
   * `idempotencyKey` hashes that value — so the workaround gave this control a
   * new idempotency key on every press, which is the one property the key
   * exists to deny. It was defensible only because starting a manual-first
   * agent is not irreversible and the agent refuses a concurrent run itself.
   * With the binding fixed, two presses of this button collapse to one command,
   * which is what it should always have done.
   */
  // Captured after the guards above, so the closure below does not have to
  // re-narrow what this function body already established.
  const taskId = waiting.id;
  const observedAt = snapshot.observed_at;

  return (
    <section className="section run-now">
      <button
        className="button-primary"
        disabled={pending !== null}
        onClick={() => {
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
            if (!(await onDispatch())) {
              return;
            }
            await issue(`run:${taskId}`, "retry", {
              agent_id: agent,
              observed_at: observedAt,
              task_id: taskId,
            });
          })();
        }}
        type="button"
      >
        {pending === `run:${taskId}` ? "Starting…" : hasFiles ? "Send files and run now" : "Run now"}
      </button>
      <p className="muted">
        It runs only when you ask. Nothing happens on a timer.
      </p>
    </section>
  );
}

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

function WorkspaceBody({
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
  snapshot: WorkspaceSnapshotView;
}): ReactNode {
  const { overview } = snapshot;

  return (
    <>
      <section className="workspace-overview" aria-labelledby="workspace-overview">
        <div>
          <p className="eyebrow">Status</p>
          <h2 id="workspace-overview">{overview.status.replaceAll("_", " ")}</h2>
          <p>{overview.status_detail}</p>
          {overview.next_action === null ? null : (
            <p className="next-action">{overview.next_action}</p>
          )}
        </div>
        <dl className="facts">
          <div>
            <dt>Runs on</dt>
            <dd>{overview.runtime_label}</dd>
          </div>
          <div>
            <dt>Starts when</dt>
            <dd>{overview.trigger_label}</dd>
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

      <section className="section" aria-labelledby="waiting-work">
        <h2 id="waiting-work">Waiting for you</h2>
        {snapshot.inbox.length === 0 ? (
          <p className="muted">No choices or enforceable approvals are pending.</p>
        ) : (
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
                setReason={(reason) =>
                  setReasons((current) => ({ ...current, [item.id]: reason }))
                }
              />
            ))}
          </div>
        )}
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
          <Link href="/connections">Open Connection Center</Link>
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
