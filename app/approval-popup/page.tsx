"use client";

/**
 * The approval popup's page (MAR-421, DASH-17 first slice).
 *
 * Opened by `electron/approval-popup.ts` in its own window, shown and hidden
 * by main as approvals appear and resolve. This page does not know that: it
 * reads the same cross-agent work inbox `app/work/page.tsx` reads
 * (`dataSource().inbox()`, over the ordinary read channel) and decides
 * through the same function every other approval control uses
 * (`submitAgentCommand`, over the ordinary command channel). There is no
 * popup-specific data path and no popup-specific command path — only a window
 * main chooses to show.
 *
 * `useLiveView(..., true)` rather than a one-shot `useView`: this window can
 * sit open for a while, and a stale list here is a request the user thinks is
 * still there after someone resolved it from the workspace page instead.
 *
 * Read-only fallback mirrors `app/credential-prompt/page.tsx`: this route is
 * a normal page in the static export and can be opened in the developer
 * path's plain browser tab, which has no `dashShell`. It says so rather than
 * rendering buttons that can only ever fail.
 */

import { type ReactNode, useState } from "react";

import { pendingApprovals } from "../../lib/shell/approval-popup";
import { submitAgentCommand, type AgentCommandArgs } from "../_data/source";
import { useCanAct, useLiveView } from "../_data/use-view";

type Feedback = { id: string; ok: boolean; message: string } | null;

export default function ApprovalPopupPage(): ReactNode {
  const canAct = useCanAct();
  const state = useLiveView((source) => source.inbox(), "approval-popup", true);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [reason, setReason] = useState("");

  if (!canAct) {
    return (
      <>
        <h1>Approvals</h1>
        <p className="lede">
          This page only works inside the installed DASH app, which is the
          only place a command can be issued from.
        </p>
      </>
    );
  }

  if (state.status !== "ready") {
    // Loading and failed both render nothing alarming: main hides this window
    // the moment nothing is pending, and a transient read failure here should
    // not read as an approval that vanished. The next tick, five seconds
    // away, tries again.
    return null;
  }

  const items = pendingApprovals(state.data.items);
  const focus = items[0];

  if (focus === undefined) {
    return null;
  }

  async function decide(command: "approve" | "reject"): Promise<void> {
    setBusy(focus.id);
    setFeedback(null);
    const args: AgentCommandArgs = {
      agent_id: focus.agent,
      observed_at: focus.observed_at,
      task_id: focus.task_id,
      approval_id: focus.id,
      action_id: focus.action_id,
      reason: reason === "" ? undefined : reason,
    };
    try {
      const result = await submitAgentCommand(command, args);
      setFeedback({
        id: focus.id,
        ok: result.ok,
        message:
          result.detail ??
          (result.ok
            ? "The runner accepted the request."
            : `The runner refused the request${result.reason === undefined ? "." : `: ${result.reason}.`}`),
      });
    } catch {
      setFeedback({
        id: focus.id,
        ok: false,
        message: "DASH could not reach the command boundary. Your agent was not changed.",
      });
    } finally {
      setBusy(null);
      setReason("");
    }
  }

  return (
    <>
      <h1>{focus.agent_title} needs your approval</h1>
      {items.length <= 1 ? null : (
        <p className="lede">
          Plus {items.length - 1} more waiting — open DASH&rsquo;s{" "}
          <strong>Work inbox</strong> to see the rest.
        </p>
      )}

      <article className="work-card" key={focus.id}>
        <div>
          <p className="eyebrow">Guarded action · by {focus.expires_at}</p>
          <h2>{focus.task_label}</h2>
          <div className="effect-preview">
            <strong>What approval permits</strong>
            <p>{focus.action_label}</p>
            {focus.context?.map((context) => (
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
        </div>

        {feedback !== null && feedback.id === focus.id ? (
          <div
            className={feedback.ok ? "notice notice-ok" : "notice notice-err"}
            role={feedback.ok ? "status" : "alert"}
          >
            {feedback.message}
          </div>
        ) : (
          <div className="approval-controls">
            <label htmlFor="approval-popup-reason">Optional note to the runner</label>
            <textarea
              id="approval-popup-reason"
              onChange={(event) => {
                setReason(event.target.value);
              }}
              rows={2}
              value={reason}
            />
            <div className="button-row">
              <button
                className="button-danger"
                disabled={busy !== null}
                onClick={() => void decide("reject")}
                type="button"
              >
                Reject
              </button>
              <button
                className="button-primary"
                disabled={busy !== null}
                onClick={() => void decide("approve")}
                type="button"
              >
                Approve exact action
              </button>
            </div>
          </div>
        )}
      </article>
    </>
  );
}
