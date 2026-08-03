"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { agentWorkspaceHref } from "../_data/routes";
import { useHost, useView } from "../_data/use-view";

/** Pending choices and runner-enforced approvals across every imported agent. */
export default function WorkInboxPage(): ReactNode {
  const state = useView((source) => source.inbox());
  const host = useHost();

  return (
    <>
      <h1>Work inbox</h1>
      <p className="lede">
        Choices and guarded actions waiting for you, ordered by the soonest
        deadline.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="work waiting for you" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : state.data.items.length === 0 && state.data.stalled.length === 0 ? (
        <div className="empty">
          <p>Nothing needs your attention right now.</p>
          <p>
            <Link href="/">Open an agent</Link> to inspect its current state,
            tasks, memory and audit history.
          </p>
        </div>
      ) : (
        <>
          {state.data.stalled.length === 0 ? null : (
            <section aria-labelledby="stalled-agents">
              <h2 id="stalled-agents">May need a look</h2>
              <p className="lede">
                These agents have a schedule but have not reported activity
                within the window DASH expected.
              </p>
              <div className="work-list">
                {state.data.stalled.map((row) => (
                  <article className="work-card" key={row.agent}>
                    <div>
                      <p className="eyebrow">Stalled</p>
                      <h2>{row.agent_title}</h2>
                      <p>{row.next_action}</p>
                      <p className="muted">
                        {row.last_activity_at === null
                          ? "No activity recorded yet"
                          : `Last activity ${row.last_activity_at}`}
                      </p>
                    </div>
                    <Link className="button-link" href={agentWorkspaceHref(row.agent)}>
                      Open
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          )}

          {state.data.items.length === 0 ? null : (
            <div className="work-list">
              {state.data.items.map((item) => (
                <article
                  className={item.expired ? "work-card is-expired" : "work-card"}
                  key={`${item.agent}:${item.id}`}
                >
                  <div>
                    <p className="eyebrow">
                      {item.kind === "approval" ? "Approval" : "Choice"} ·{" "}
                      {item.expired ? "expired" : `by ${item.expires_at}`}
                    </p>
                    <h2>{item.task_label}</h2>
                    <p>{item.kind === "approval" ? item.action_label : item.label}</p>
                    {item.kind === "approval"
                      ? item.context?.map((context) => (
                          <p key={`${context.label}:${context.detail ?? ""}`}>
                            {context.label}
                            {context.detail === undefined ? "" : ` · ${context.detail}`}
                          </p>
                        ))
                      : null}
                    <p className="muted">{item.agent_title}</p>
                  </div>
                  <Link className="button-link" href={agentWorkspaceHref(item.agent)}>
                    {item.expired ? "Open recovery" : "Review"}
                  </Link>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
