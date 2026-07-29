"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { AGENT_WORKSPACE_PARAMS, runDetailHref } from "../../_data/routes";
import {
  submitAgentCommand,
  type AgentCommandArgs,
} from "../../_data/source";
import { useCanAct, useHost, useView } from "../../_data/use-view";
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
  const state = useView(
    (source) => source.workspace(agent),
    `${agent}:${String(refreshKey)}`,
  );
  const canAct = useCanAct();
  const host = useHost();

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
        <div>
          <p className="eyebrow">Agent workspace</p>
          <h1>{view.title}</h1>
          <p className="lede">{view.goal}</p>
        </div>
        <button
          className="button-secondary"
          onClick={() => setRefreshKey((value) => value + 1)}
          type="button"
        >
          Refresh state
        </button>
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
          <div>
            <dt>Last agent snapshot</dt>
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.tasks.map((task) => (
                  <tr key={task.id}>
                    <td>{task.label}</td>
                    <td>{task.status.replaceAll("_", " ")}</td>
                    <td className="wrap">{task.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  return (
    <article className="summary-card">
      <p className="eyebrow">{run.status.replaceAll("_", " ")}</p>
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Decision</th>
                  <th>Command</th>
                  <th>Actor</th>
                  <th>Authenticated by</th>
                  <th>When</th>
                  <th>Reason</th>
                  <th>Correlation</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.command_audit.map((record, index) => (
                  <tr key={`${record.correlation_id}:${record.command}:${String(index)}`}>
                    <td>{record.decision}</td>
                    <td>{record.command}</td>
                    <td>{record.actor_id}</td>
                    <td>{record.authenticated_by}</td>
                    <td>{record.decided_at}</td>
                    <td>{record.reason ?? ""}</td>
                    <td>
                      <code>{record.correlation_id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  );
}
