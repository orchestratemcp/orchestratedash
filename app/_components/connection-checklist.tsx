"use client";

import { useState, type ReactNode } from "react";
import { groupByOwnership } from "../../lib/connections";
import type { Recovery } from "../../lib/copy/recovery";
import type { ConnectionRowWithCredential } from "../../lib/views/types";
import { useCanAct } from "../_data/use-view";

/**
 * The Connection Center checklist.
 *
 * MAR-383's acceptance criterion is that a fresh user reaches a connection
 * checklist "without terminal, `.env`, component IDs or raw scopes". So this
 * renders only the plain-language fields `lib/connections.ts` produces — a
 * capability's `label`, never its `id`; a connection's `service`, never its
 * `provider` as the headline.
 *
 * Three honesty rules from MAR-383 are load-bearing here, and all three are
 * about not overclaiming:
 *
 * - A **derived** row must never look like a declared one. The model-provider
 *   row is inferred from the plan's model tiers; it is labelled as inferred.
 * - **Unconfirmed ownership must read as a question, not a statement.** DASH
 *   does not know who holds the model-provider credential, so the row says so
 *   rather than asserting "the agent has this".
 * - **A row DASH cannot connect gets no button.** An OAuth connection is not
 *   offered a text box that would take a token DASH could never refresh, and an
 *   agent-managed one is not offered a Connect that would imply DASH was taking
 *   it over. The button's absence is the honest answer, and the row says why.
 *
 * No secret is rendered. The strongest thing on this page is a masked hint —
 * four trailing characters behind bullets, produced by `maskSecret` at the
 * moment the value was stored and read here from a table that cannot hold a raw
 * value. Nothing on this page ever reads the vault.
 */

const OWNERSHIP_SECTIONS: Array<{
  ownership: "dash" | "agent" | "external";
  heading: string;
  lede: string;
}> = [
  {
    ownership: "dash",
    heading: "Connect through DASH",
    lede: "DASH holds these in this computer's credential vault and passes them to the agent when it runs.",
  },
  {
    ownership: "agent",
    heading: "Kept with the agent",
    lede: "The agent manages these itself. DASH shows them so the list is complete, and does not take them over.",
  },
  {
    ownership: "external",
    heading: "Managed elsewhere",
    lede: "Held in an external secrets manager. DASH neither stores nor tests these.",
  },
];

function SourceChip({ row }: { row: ConnectionRowWithCredential }): ReactNode {
  if (row.source === "declared_connection") {
    return (
      <span className="chip chip-ok" title="The agent's manifest declares this connection">
        declared
      </span>
    );
  }
  return (
    <span
      className="chip chip-warn"
      title="Not declared in the manifest — worked out from the steps in the agent's plan"
    >
      inferred from the plan
    </span>
  );
}

/** What one command left behind, shown under the row that caused it. */
interface RowOutcome {
  ok: boolean;
  detail?: string;
  recovery?: Recovery;
}

export interface ConnectionAct {
  (
    action: "connect" | "test" | "disconnect",
    target: { connection_id: string; field_id: string },
  ): Promise<RowOutcome>;
}

function ConnectionRow({
  row,
  act,
  canAct,
}: {
  row: ConnectionRowWithCredential;
  act: ConnectionAct | null;
  canAct: boolean;
}): ReactNode {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RowOutcome | null>(null);
  const [hint, setHint] = useState<string | null>(row.masked_hint);

  const connected = hint !== null;
  // A row is actionable only when the manifest says DASH may hold it, the
  // manifest named which field, and this window can cause an effect at all. The
  // browser development path fails the last one, which is what keeps it
  // read-only without the page having to know why.
  const actionable = row.dash_can_hold && row.field_id !== null && canAct && act !== null;

  async function run(action: "connect" | "test" | "disconnect"): Promise<void> {
    if (act === null || row.field_id === null) {
      return;
    }
    setBusy(action);
    setOutcome(null);
    const result = await act(action, { connection_id: row.connection_id, field_id: row.field_id });
    setBusy(null);
    setOutcome(result);
    // Only a definite outcome moves the hint. A failed test leaves the row
    // saying what it said before, because a locked vault is not evidence the
    // credential is gone — telling the user it disappeared would send them to
    // find a key they never lost.
    if (result.ok && action === "disconnect") {
      setHint(null);
    }
  }

  return (
    <tr>
      <td>
        <strong>{row.service}</strong>
        {/* The user asked for a checklist, not an inventory: why it is needed
            comes before what it is called. */}
        <div className="wrap muted">{row.purpose}</div>
        {/* The same three-part shape `ViewFailed` uses, and for the reason it
            states: a surface that shows two of headline/meaning/next action
            always drops the third, and the third is the one that helps. */}
        {outcome !== null ? (
          <div
            className={outcome.ok ? "notice notice-ok" : "notice notice-err"}
            role={outcome.ok ? undefined : "alert"}
          >
            {outcome.recovery !== undefined ? (
              <>
                <p>
                  <strong>{outcome.recovery.headline}</strong>
                </p>
                <p>{outcome.recovery.meaning}</p>
                <p>{outcome.recovery.next_action}</p>
              </>
            ) : (
              <p>{outcome.detail}</p>
            )}
          </div>
        ) : null}
      </td>
      <td className="wrap">
        <ul className="capability-list">
          {row.capabilities.map((capability) => (
            <li key={capability.id}>
              {capability.label} <span className="muted">({capability.access})</span>
            </li>
          ))}
        </ul>
      </td>
      <td>
        <div className="chips">
          <SourceChip row={row} />
          {row.ownership_confirmed ? null : (
            <span
              className="chip chip-muted"
              title="Nothing in the manifest says who holds this credential"
            >
              owner unknown — DASH will ask
            </span>
          )}
          {connected ? (
            <span className="chip chip-ok" title="DASH holds a credential for this connection">
              connected {hint}
            </span>
          ) : row.dash_can_hold ? (
            <span className="chip chip-muted">not connected yet</span>
          ) : row.requires_secret_input ? (
            <span className="chip chip-muted">needs a secret you enter</span>
          ) : null}
        </div>

        {actionable ? (
          <div className="button-row">
            <button
              type="button"
              className={connected ? "button-secondary" : "button-primary"}
              disabled={busy !== null}
              onClick={() => void run("connect")}
            >
              {/* A sign-in and a typed key are different acts, and the button
                  should say which one is about to happen — "Connect" on a row
                  that opens a browser gives no warning that the user is about
                  to leave DASH (MAR-446). */}
              {busy === "connect"
                ? "Waiting…"
                : row.credential_kind === "oauth"
                  ? connected
                    ? "Sign in again"
                    : "Sign in"
                  : connected
                    ? "Replace"
                    : "Connect"}
            </button>
            {connected ? (
              <>
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy !== null}
                  onClick={() => void run("test")}
                >
                  {busy === "test" ? "Checking…" : "Check"}
                </button>
                <button
                  type="button"
                  className="button-danger"
                  disabled={busy !== null}
                  onClick={() => void run("disconnect")}
                >
                  {busy === "disconnect" ? "Removing…" : "Disconnect"}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Said once, on the row it is true of, rather than as a footnote
            nobody reads. An OAuth row and an agent-managed row both have no
            button, and they have no button for different reasons. */}
        {row.dash_can_hold && row.delivered_to_agent ? null : row.dash_can_hold ? (
          row.credential_kind === "oauth" ? (
            <p className="muted wrap">
              DASH holds this sign-in and keeps it current. The agent&rsquo;s
              manifest does not say where to pass it, so the agent reaches it
              another way.
            </p>
          ) : (
            <p className="muted wrap">
              DASH keeps this for you. The agent&rsquo;s manifest does not say where
              to pass it, so the agent must fetch it another way.
            </p>
          )
        ) : row.ownership === "dash" && row.source === "declared_connection" ? (
          <p className="muted wrap">
            {row.service} signs in through its own provider. DASH cannot do that
            for you yet, so the agent handles this sign-in.
          </p>
        ) : null}
      </td>
    </tr>
  );
}

export function ConnectionChecklist({
  rows,
  act = null,
}: {
  rows: ConnectionRowWithCredential[];
  act?: ConnectionAct | null;
}): ReactNode {
  const canAct = useCanAct();

  if (rows.length === 0) {
    return (
      <p className="muted">
        This agent&rsquo;s manifest declares no connections, and its plan needs no
        model provider.
      </p>
    );
  }

  const grouped = groupByOwnership(rows);

  return (
    <>
      {OWNERSHIP_SECTIONS.map((section) => {
        const sectionRows = grouped[section.ownership] as ConnectionRowWithCredential[];
        // Empty sections are omitted rather than shown empty: a heading with
        // nothing under it reads as "nothing to do here yet", which is a
        // different claim from "this does not apply".
        if (sectionRows.length === 0) {
          return null;
        }
        return (
          <section key={section.ownership} className="connection-group">
            <h3>{section.heading}</h3>
            <p className="lede">{section.lede}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Connection</th>
                    <th>What the agent will do with it</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionRows.map((row) => (
                    <ConnectionRow
                      key={row.connection_id}
                      row={row}
                      act={act}
                      canAct={canAct}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
