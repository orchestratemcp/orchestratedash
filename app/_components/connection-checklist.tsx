"use client";

import { useState, type ReactNode } from "react";
import { groupByOwnership } from "../../lib/connections";
import type { Recovery } from "../../lib/copy/recovery";
import type { BrokerLapseView, ConnectionRowWithCredential } from "../../lib/views/types";
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
    <article className="row-card">
      <div className="section-heading">
        <div>
          <h3>{row.service}</h3>
          {/* The user asked for a checklist, not an inventory: why it is needed
              comes before what it is called. */}
          <p className="wrap muted">{row.purpose}</p>
        </div>
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
      </div>

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

      <ul className="capability-list">
        {row.capabilities.map((capability) => (
          <li key={capability.id}>
            {capability.label} <span className="muted">({capability.access})</span>
          </li>
        ))}
      </ul>

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

      {row.broker === null ? null : (
        <PermissionCard broker={row.broker} service={row.service} connected={connected} />
      )}
    </article>
  );
}

/**
 * What this agent may do with this account, who holds the sign-in, and what it
 * has actually done (MAR-458, ADR 0002 invariant 4).
 *
 * ## Why the custody sentence leads
 *
 * Because it is the fact that changes what every line under it means. "DASH
 * holds the sign-in and the agent never receives it" is the difference between a
 * list of capabilities that is a boundary and one that is a promise — and ADR
 * 0002 requires that native OAuth and, later, an authenticated MCP server render
 * through the same card while saying which of the two they are. A card that
 * looked identical for both would be the lie the ADR names: installing a Gmail
 * MCP server "changes who owns token custody".
 *
 * ## Why "asked for" and "approved" are separate lists
 *
 * They answer different questions and can differ. Before a sign-in there is only
 * the first. After a partial consent there are both, and they disagree — which
 * is exactly when a user needs to see it, rather than being shown one merged
 * list that quietly reports the smaller set as though it were what was asked.
 *
 * ## Why the history shows refusals
 *
 * A trail of successes is a trail nobody investigates. The rows worth having are
 * the ones where an agent asked for something it was not allowed to do, and
 * `describeBrokerRefusal` has already turned each into a sentence rather than a
 * code.
 */
function PermissionCard({
  broker,
  service,
  connected,
}: {
  broker: NonNullable<ConnectionRowWithCredential["broker"]>;
  service: string;
  connected: boolean;
}): ReactNode {
  const approved = broker.receipt?.capabilities ?? [];

  return (
    <div className="permission-card">
      <p className="wrap">
        <strong>{broker.custody_sentence}</strong>
      </p>
      {broker.client_sentence === null ? null : (
        <p className="muted wrap">{broker.client_sentence}</p>
      )}

      {/* Signing in to DASH and authorizing this connection are separate acts,
          and this is the sentence that says so. ADR 0002 opens on exactly this:
          "Signing in to DASH with Google would establish identity only. It would
          not grant Gmail or Calendar access." */}
      <p className="muted wrap">
        This is separate from signing in to DASH. Signing in identifies you;
        this grants {service} access on its own.
      </p>

      <h4>
        {connected && approved.length > 0
          ? "What you approved it to do"
          : `What it is asking to do with ${service}`}
      </h4>
      <ul className="permission-list">
        {(connected && approved.length > 0 ? approved : broker.requested).map((capability) => (
          <li key={capability.id}>
            {capability.label}
            {capability.access === "write" ? (
              <span className="chip chip-warn"> changes something</span>
            ) : null}
            {/* MAR-469. Under the capability and not in a tooltip: a write's
                label is a verb phrase, and the sentence that says where the
                result ends up and who can act on it is the one a person needs
                before approving. A consequence you have to hover to find is one
                that gets approved unread. */}
            {capability.consequence === null ? null : (
              <div className="wrap muted">{capability.consequence}</div>
            )}
          </li>
        ))}
        {(connected && approved.length > 0 ? approved : broker.requested).length === 0 ? (
          <li className="muted">
            Nothing. DASH has no action for the permissions this asks for, so the
            agent cannot reach {service} through DASH at all.
          </li>
        ) : null}
      </ul>

      {/* The line that used to be carried by "you granted permissions DASH
          offers no action for", and no longer can be (MAR-469). Once DASH built
          a draft action on the Gmail compose permission, that permission stopped
          being unused — so the disclosure would have vanished from this card at
          the moment it began to matter. It is rendered whether or not the user
          has signed in yet, because the person who has not yet granted it is the
          one it is for. */}
      {broker.wider_permission_sentence === null ? null : (
        <p className="notice wrap" role="note">
          {broker.wider_permission_sentence}
        </p>
      )}

      {/* The time-bounded twin of the disclosure above (MAR-482, ADR 0006).
          The wider-permission notice says the grant is broader than the
          actions; this one says the actions stop when DASH closes, even
          though the agent does not. Both render before a sign-in, because
          afterwards they are commentary and beforehand they are the
          decision. */}
      {broker.dash_closed_sentence === null ? null : (
        <p className="notice wrap" role="note">
          {broker.dash_closed_sentence}
        </p>
      )}

      {broker.receipt === null ? null : (
        <dl className="permission-receipt">
          <dt>Account</dt>
          <dd>{broker.receipt.account_hint ?? "Not named by the provider"}</dd>
          <dt>Approved</dt>
          <dd>{broker.receipt.granted_at}</dd>
          <dt>Last used</dt>
          <dd>{broker.receipt.last_used_at ?? "Never"}</dd>
        </dl>
      )}

      {broker.recent.length === 0 ? null : (
        <details className="permission-history">
          <summary>What it has done ({broker.recent.length})</summary>
          <ul>
            {broker.recent.map((entry) => (
              <li key={`${entry.decided_at}:${entry.label}`}>
                <span className={entry.decision === "allowed" ? "chip chip-ok" : "chip chip-warn"}>
                  {entry.decision === "allowed" ? "allowed" : "refused"}
                </span>{" "}
                {entry.refusal_headline ?? entry.label}
                {entry.decision === "allowed" && entry.result_count !== null ? (
                  <span className="muted">
                    {" "}
                    · {entry.result_count} result{entry.result_count === 1 ? "" : "s"}
                  </span>
                ) : null}
                <span className="muted"> · {entry.decided_at}</span>
                {entry.undelivered ? (
                  // MAR-467. On the decision, not beside it: DASH made this
                  // call, and what it could not confirm is that the answer got
                  // back. "Could not confirm" rather than "did not arrive"
                  // because an acknowledgement DASH never received looks the
                  // same from here as one that was never sent.
                  <div className="muted wrap">
                    DASH could not confirm this answer reached the agent, so the
                    agent may have carried on as though it had asked for nothing.
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="muted wrap">
            DASH records which action was asked for and when, never what was
            searched for and never anything from a message.
          </p>
        </details>
      )}
    </div>
  );
}

/**
 * What the permission cards cannot account for (MAR-467, ADR 0005).
 *
 * Rendered outside the cards and visually unlike them, on purpose. A permission
 * card's history is a list of decisions DASH made and is worth believing for
 * exactly that reason; these are requests DASH never adjudicated and a window in
 * which it was not running. Putting them in the same list — even styled
 * differently — would make the history a mixture of things DASH did and things
 * DASH infers, and a table like that cannot be trusted at a glance by anyone.
 *
 * So there is no `allowed`/`refused` chip here, no operation name, and nothing
 * shaped like a verdict. There is a sentence and the limits of it.
 */
export function BrokerLapseNotice({ lapses }: { lapses: BrokerLapseView[] }): ReactNode {
  if (lapses.length === 0) {
    return null;
  }

  return (
    <div className="broker-lapses">
      <h3>What DASH cannot account for</h3>
      <p className="muted wrap">
        These are not decisions. They are times this agent may have asked for
        something and DASH was not in a position to answer or to record it.
      </p>
      <ul>
        {lapses.map((lapse) => (
          <li key={`${lapse.kind}:${lapse.from_at}`} className="wrap">
            {lapse.sentence}
            <div className="muted">
              {lapse.until_at === null || lapse.until_at === lapse.from_at
                ? lapse.from_at
                : `${lapse.from_at} — ${lapse.until_at}`}
            </div>
            {lapse.qualifier === null ? null : (
              <div className="muted">{lapse.qualifier}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
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
            <ol className="row-list">
              {sectionRows.map((row) => (
                <li key={row.connection_id}>
                  <ConnectionRow row={row} act={act} canAct={canAct} />
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </>
  );
}
