"use client";

import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { REPAIR_AGENT_COPY } from "../../lib/copy/repair";
import { repairAgent } from "../_data/source";

/**
 * Setting an agent up again, without a terminal (MAR-705).
 *
 * ## The journey this section is the whole of
 *
 * Your agent has stopped working. You open its page, go to Settings, press one
 * button, read what DASH is about to do, agree, and it works again. That is the
 * entire story, and until this existed the only way through it was
 * `npm run open-in-dash` from the agent's original project — which Henrik met
 * and answered in one sentence: *"this redeploy of an faulty agent is to hard.
 * Can you figure out how we can do it from dash and not some terminal
 * command?"*
 *
 * ## Why it is here and not on the Run stage
 *
 * ADR 0008 puts an agent's controls on the Settings stage, and this is one. The
 * Run stage's `not_reported` sentence links here instead of growing a second
 * copy of the button, because two controls performing one repair is the
 * duplication `buildAgentControl` was written to end — and because a repair
 * reached from a dead end should land somebody where the rest of the agent's
 * settings are, not act and leave them where they were.
 *
 * ## Why it is always offered, and not only to a broken agent
 *
 * DASH cannot tell reliably, from the renderer, whether an agent is broken: a
 * missing registration and a stale one look the same from here, and the state
 * MAR-703 was filed on — a rebuilt store — looked entirely healthy on the
 * Settings stage while the Run stage had nothing to press. A control that
 * appeared only once DASH had diagnosed the fault would be missing in the cases
 * nobody predicted, which is the class of defect this whole packet is.
 *
 * It is safe to press when nothing is wrong: the write is idempotent, the folder
 * is only read, and the dialog says both before anything happens.
 *
 * ## Every sentence comes from the trusted side
 *
 * This component words nothing. The heading, the button, the detail line and
 * every receipt are `lib/copy/repair.ts`'s, and the refusals are main's own — so
 * a page cannot describe a repair differently from the process that performed
 * it, and the plain-language gate holds over every string a person can reach.
 */
export function RepairAgent({
  agent,
  canAct,
  hasFolder,
  onRepaired,
  setFeedback,
  startable = false,
}: {
  agent: string;
  canAct: boolean;
  /**
   * False for an agent DASH holds no folder of its own for.
   *
   * `FolderUpdate`'s gate and the same reasoning: there is nothing to set up
   * again from, so a button here would be one whose refusal arrives after the
   * press. MAR-553's row-only standing is a supported state, not a fault.
   */
  hasFolder: boolean;
  /** Re-read the workspace, so the page redraws as the agent it just repaired. */
  onRepaired: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
  /**
   * Whether DASH holds a registration naming a program it could spawn
   * (MAR-874).
   *
   * `WorkspaceView.startable`, and the only fact this component has ever had
   * about whether the agent in front of it is actually broken. It decides the
   * **heading** and nothing else: false gets `REPAIR_AGENT_COPY.heading`, which
   * is the alarm, and true gets `heading_calm`, which is a door.
   *
   * Defaulted to `false` rather than `true`, which is the safe direction for a
   * caller that forgets: an over-loud heading over a working agent is the
   * defect this packet fixed, but a *silent* one over an agent that genuinely
   * cannot start would be the older and worse failure — DASH doing less than it
   * could and saying nothing, which is what `ManifestGapNotice` exists against.
   */
  startable?: boolean;
}): ReactNode {
  const [busy, setBusy] = useState(false);

  if (!hasFolder || !canAct) {
    /*
     * Nothing at all, rather than a section explaining an absence.
     *
     * `FolderUpdate`'s rule. A read-only window has no controls and says so once,
     * on the Run stage, rather than once per control; and an agent with no folder
     * of DASH's own has nothing here to press. Either way a notice would be DASH
     * describing its own internals at somebody who came to look at their agent.
     */
    return null;
  }

  async function repair(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await repairAgent({ agent_id: agent });
    setBusy(false);
    /*
     * Cancelled, and deliberately silent — `chooseAgentFolder`'s rule, kept on
     * this side of the bridge too. Somebody who opened the question and closed
     * it again has not failed at anything, and a notice saying so would be DASH
     * reporting on a decision that was already theirs.
     */
    if (!result.ok && result.reason === "cancelled") {
      return;
    }
    setFeedback({
      ok: result.ok,
      message: result.detail ?? (result.ok ? REPAIR_AGENT_COPY.repaired : REPAIR_AGENT_COPY.failed),
    });
    if (result.ok) {
      // The Run stage's control is decided from `startable`, which this press may
      // have just changed. Without the re-read a person would repair an agent and
      // go back to the same sentence that sent them here.
      onRepaired();
    }
  }

  return (
    <section className="section repair-agent" aria-labelledby="repair-agent">
      {/* An `h3` for `FolderUpdate`'s reason: this renders inside the agent
          page's Settings drawer, and an `h2` would outrank the drawer's own
          heading. */}
      {/*
        MAR-874. The heading is the predicate now, and it was unconditional.

        `RepairAgent` drew *This agent will not run* over every agent with a
        folder in a window that could act — see this component's own note above
        on why it is always offered — so the Settings stage told a person their
        agent was broken while the header three bands up read READY and named
        the server it was living on. Two claims about one agent, and the one
        that had checked nothing was this one.

        `startable` is what DASH actually holds: a registration naming a program
        it could spawn. It is the same fact `AGENT_CONTROL_COPY.idle.not_reported`
        already speaks from on the Run stage, so the two surfaces now agree by
        construction rather than by coincidence. The control itself did not
        move and was not taken away.
      */}
      <h3 id="repair-agent">
        {startable ? REPAIR_AGENT_COPY.heading_calm : REPAIR_AGENT_COPY.heading}
      </h3>
      <div className="folder-update-do">
        <button
          className="button-secondary"
          disabled={busy}
          onClick={() => void repair()}
          type="button"
        >
          {busy ? REPAIR_AGENT_COPY.pending : REPAIR_AGENT_COPY.action}
        </button>
        <p className="muted wrap">{REPAIR_AGENT_COPY.detail}</p>
      </div>
    </section>
  );
}
