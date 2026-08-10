"use client";

import { useState, type ReactNode } from "react";
import { removeAgent, removeAgentKeepFiles } from "../_data/source";
import { describeAgentRemoval, type RemoveAgentMode } from "../../lib/copy/remove-agent";

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
 */
export function RemoveAgent({
  agentId,
  displayName,
  canAct,
}: {
  agentId: string;
  displayName: string;
  canAct: boolean;
}): ReactNode {
  const [confirming, setConfirming] = useState<RemoveAgentMode | null>(null);
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
    setOutcome({ ok: result.ok, detail: result.detail ?? "" });
  }

  if (outcome !== null) {
    return (
      <div className={outcome.ok ? "notice notice-ok" : "notice notice-err"} role="status">
        <p>{outcome.detail}</p>
      </div>
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
