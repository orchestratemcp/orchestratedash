"use client";

import { useState, type ReactNode } from "react";
import { removeAgent, removeAgentKeepFiles } from "../_data/source";
import {
  describeAgentRemoval,
  describeStrandedByRemoval,
  type RemoveAgentMode,
} from "../../lib/copy/remove-agent";

/**
 * DASH's two removal actions, on the one page that already knows this
 * agent's name (MAR-595 finding 18).
 *
 * `removeAgentWithReport` and `removeAgentFolder` (`electron/main.ts`,
 * `lib/agent-folders.ts`) already existed; nothing in the UI reached them.
 * Two buttons rather than one with a mode switch: `removeAgent` and
 * `removeAgentKeepFiles` are two very different blast radii, and a checkbox
 * beside a red button is how the wrong one gets pressed by accident. Each
 * button asks its own question — `describeAgentRemoval` — before the bridge
 * is called at all, the same two-step shape `ForgetConfirmation`
 * (`app/_components/server-card.tsx`) already uses for disconnecting a
 * server.
 *
 * ## The gate MAR-611 adds in front of both (ADR 0017)
 *
 * Neither removal has ever reached a server — both are local acts. What was
 * missing is the warning: an agent still sent somewhere and removed here
 * becomes a copy DASH has no record of and can no longer reach, which is
 * exactly the orphan Henrik described on the issue. So when `deployedServers`
 * is non-empty, the first press lands on `describeStrandedByRemoval` instead
 * of the usual confirmation — a third state ahead of `confirming` rather than
 * a condition folded into it, so the two sentences cannot be merged into one
 * that says both things half as clearly.
 */
export function RemoveAgent({
  agentId,
  displayName,
  canAct,
  deployedServers,
}: {
  agentId: string;
  displayName: string;
  canAct: boolean;
  /**
   * Servers this agent is still sent to, DASH's own record (MAR-584) minus
   * whatever it has already brought home (MAR-611). Empty for almost every
   * agent, which is why this gate is a rare extra step rather than a tax on
   * every removal.
   */
  deployedServers: readonly string[];
}): ReactNode {
  const [confirming, setConfirming] = useState<RemoveAgentMode | null>(null);
  /** Set once a person has read the stranded-copy warning and chosen to proceed anyway. */
  const [acknowledgedStranded, setAcknowledgedStranded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string } | null>(null);

  async function run(mode: RemoveAgentMode): Promise<void> {
    setBusy(true);
    const result =
      mode === "keep_files"
        ? await removeAgentKeepFiles({ agent_id: agentId })
        : await removeAgent({ agent_id: agentId });
    setBusy(false);
    setConfirming(null);
    setAcknowledgedStranded(false);
    setOutcome({ ok: result.ok, detail: result.detail ?? "" });
  }

  if (outcome !== null) {
    return (
      <div className={outcome.ok ? "notice notice-ok" : "notice notice-err"} role="status">
        <p>{outcome.detail}</p>
      </div>
    );
  }

  if (confirming !== null && deployedServers.length > 0 && !acknowledgedStranded) {
    const stranded = describeStrandedByRemoval(displayName, deployedServers);
    return (
      <section className="notice notice-warn wrap" role="alert">
        <p>
          <strong>{stranded.headline}</strong>
        </p>
        <p>{stranded.detail}</p>
        <div className="button-row">
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setConfirming(null);
            }}
          >
            Keep it
          </button>
          {/*
            An in-page jump to the deploy section's own bring-home control
            rather than a second copy of it here — `SentServers`
            (`app/_components/deploy.tsx`) is the one place that sequence is
            wired, and this removal is not the place to duplicate it.
          */}
          <a
            className="button-secondary"
            href="#deploy-to-server"
            onClick={() => {
              setConfirming(null);
            }}
          >
            {stranded.bring_home_label}
          </a>
          <button
            type="button"
            className="button-danger"
            onClick={() => {
              setAcknowledgedStranded(true);
            }}
          >
            {stranded.proceed_label}
          </button>
        </div>
      </section>
    );
  }

  if (confirming !== null) {
    const copy = describeAgentRemoval(displayName, confirming);
    return (
      <section className="notice wrap" role="alert">
        <p>
          <strong>{copy.headline}</strong>
        </p>
        <p>{copy.detail}</p>
        <div className="button-row">
          <button
            type="button"
            className="button-secondary"
            disabled={busy}
            onClick={() => {
              setConfirming(null);
              setAcknowledgedStranded(false);
            }}
          >
            Keep it
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => void run(confirming)}
          >
            {busy ? "Removing…" : copy.confirm_label}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="button-row">
      <button
        type="button"
        className="button-secondary"
        disabled={!canAct}
        onClick={() => {
          setConfirming("keep_files");
        }}
      >
        Remove from DASH
      </button>
      <button
        type="button"
        className="button-danger"
        disabled={!canAct}
        onClick={() => {
          setConfirming("delete_files");
        }}
      >
        Remove and delete all files
      </button>
    </div>
  );
}
