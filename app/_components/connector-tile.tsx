"use client";

import { useState, type ReactNode } from "react";

import { OAvatar } from "./o-avatar";
import { ConnectionCards, type ConnectionAct } from "./connection-card";
import {
  connectorChip,
  describeDependents,
  describeSharedGrant,
  type ConnectorDependent,
  type ConnectorTile as Tile,
} from "../../lib/connectors";
import { describeProof } from "../../lib/connection-card";
import type { Recovery } from "../../lib/copy/recovery";

/**
 * One service, as a tile (MAR-570).
 *
 * ## What moved, and what did not
 *
 * MAR-533's card answers the right four questions — what can this reach, whose
 * account, since when, what has it been used for — and answered them once per
 * *agent per connection*. Two agents needing Gmail produced two full capability
 * cards and left the reader to work out that it was one Gmail. Henrik's verdict
 * on that page was *"cluttered and a lot of text."*
 *
 * So the front of this surface is now the connector, and the capability card is
 * the **receipt one click away**. Nothing honest is lost: `ConnectionCards` is
 * the same component, rendered inside the disclosure, with the same three-party
 * drawing, the same nobody-asked-for-this list, the same wider-permission banner
 * and the same usage history.
 *
 * ## The order, and why it is this order
 *
 * *Someone who has never heard of OAuth can say what DASH is allowed to do.*
 * That decides it: the service by name, whether it is connected, **who needs
 * it**, what DASH can and cannot prove — then the disclosure that one sign-in
 * covers several agents, and only then the button. The disclosure is above the
 * control rather than beside the result, because it describes something that
 * happens to an agent the person is not looking at, and ADR 0002 amendment 2's
 * rule is that such a thing is said before the grant rather than after it.
 */

interface TileOutcome {
  ok: boolean;
  detail?: string;
  recovery?: Recovery;
}

/**
 * Which agent's row a press acts on.
 *
 * The first one DASH could actually hold a credential for, preferring one that
 * is not connected yet — so pressing Connect on a partly-connected tile fills
 * the gap rather than re-signing an agent that is already fine. The fan-out in
 * `findGrantSharers` reaches the others, which is why one row is enough and why
 * this must never be presented as connecting only that agent.
 *
 * Null when no dependent is connectable: the tile then draws no button at all,
 * rather than one that would fire nothing.
 */
export function connectTarget(tile: Tile): ConnectorDependent | null {
  const holdable = tile.dependents.filter(
    (one) => one.row.dash_can_hold && one.row.field_id !== null,
  );
  return holdable.find((one) => !one.connected) ?? holdable[0] ?? null;
}

export function ConnectorTile({
  tile,
  act,
  canAct,
}: {
  tile: Tile;
  act: (agent: string) => ConnectionAct;
  canAct: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<TileOutcome | null>(null);

  const chip = connectorChip(tile.standing);
  const proof = describeProof(tile.proof, tile.service);
  const shared = describeSharedGrant(tile);
  const target = connectTarget(tile);
  const everyoneConnected = tile.standing === "connected";

  async function connect(): Promise<void> {
    if (target === null || target.row.field_id === null) {
      return;
    }
    setBusy(true);
    setOutcome(null);
    const result = await act(target.agent)("connect", {
      connection_id: target.row.connection_id,
      field_id: target.row.field_id,
    });
    setBusy(false);
    setOutcome(result);
  }

  return (
    <article className="row-card connector-tile">
      <div className="card-head">
        <h2>{tile.service}</h2>
        <span className={`chip chip-${chip.tone}`}>{chip.label}</span>
      </div>

      {/*
        Who needs this, immediately under the name. It is the tile's whole reason
        for existing — one service, several agents — and burying it under the
        disclosures would leave a reader deduplicating the page by eye, which is
        the work this surface exists to remove.
      */}
      <p className="connector-dependents wrap">{describeDependents(tile)}</p>

      <ul className="connector-agents">
        {tile.dependents.map((dependent) => (
          <li key={dependent.agent} className="connector-agent">
            {dependent.avatar === null ? null : <OAvatar name={dependent.avatar} size={50} />}
            <div>
              <p className="connector-agent-name">{dependent.agent}</p>
              {/* The author's own words about why this agent wants it. What DASH
                  is allowed to do is per agent even when the sign-in is not, and
                  this is where that shows. */}
              <p className="muted wrap">{dependent.purpose}</p>
            </div>
            <span className={`chip ${dependent.connected ? "chip-ok" : "chip-muted"}`}>
              {dependent.connected ? "connected" : "not connected"}
            </span>
          </li>
        ))}
      </ul>

      {/*
        What DASH can and cannot prove, from `describeProof`. The pair is
        rendered whole: a surface showing `can` without `cannot` would be the
        reassurance half of a sentence whose value is the other half.
      */}
      {/*
        Prose, not a bordered note — and that is a layout finding rather than a
        softening. Both this and the shared-grant sentence below were drawn as
        boxes, and two identical boxes stacked pushed the tile's own Sign in
        button off a 900px viewport on the one tile that most needed it. The
        sentence is unchanged, verbatim, and still announced as a note; what it
        stops doing is competing with the one consequence on this card that a
        person has to read before pressing.
      */}
      <p className="wrap">{proof.can}</p>
      <p className="muted wrap" role="note">
        {proof.cannot}
      </p>

      {outcome === null ? null : (
        <div
          className={outcome.ok ? "notice notice-ok" : "notice notice-err"}
          role={outcome.ok ? "status" : "alert"}
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
      )}

      {/*
        The consequence that lands on an agent the person is not looking at,
        above the button and never with the result. Null on the ordinary tile, so
        a warning that is usually about nothing never trains anybody to skip it.
      */}
      {shared === null ? null : (
        <p className="notice notice-warn wrap" role="note">
          {shared}
        </p>
      )}

      {target === null ? null : canAct ? (
        <div className="button-row">
          <button
            type="button"
            className={everyoneConnected ? "button-secondary" : "button-primary"}
            disabled={busy}
            onClick={() => void connect()}
          >
            {/* A sign-in and a typed key are different acts and the button says
                which one is about to happen — "Connect" on a row that opens a
                browser gives no warning that the user is about to leave DASH
                (MAR-446). */}
            {busy
              ? "Waiting…"
              : target.row.credential_kind === "oauth"
                ? everyoneConnected
                  ? `Sign in to ${tile.service} again`
                  : `Sign in to ${tile.service}`
                : everyoneConnected
                  ? "Replace"
                  : `Connect ${tile.service}`}
          </button>
        </div>
      ) : (
        /*
         * Said rather than drawn as a disabled button. A greyed-out Connect on a
         * service tile reads as "this service cannot be connected", which is a
         * claim about the service; the true statement is about which window this
         * is.
         */
        <p className="muted wrap">Open the installed DASH app to connect a service.</p>
      )}

      {/*
        The receipt, one click deep. A disclosure rather than a link, because the
        answer to "what exactly is DASH allowed to do" belongs beside the thing
        it is about — and a second page would be a third place this data is
        rendered.
      */}
      <details
        className="card-more connector-receipt"
        open={open}
        onToggle={(event) => {
          setOpen((event.target as HTMLDetailsElement).open);
        }}
      >
        <summary>
          {tile.dependents.length === 1
            ? "What exactly this agent may do"
            : "What exactly each agent may do"}
        </summary>
        {/*
          Built only while open. These are the heaviest components in DASH — a
          three-party drawing, two capability lists and a usage history per agent
          — and a page of tiles that built every one on first paint would spend
          its whole budget on the view nobody has asked for yet.
        */}
        {open
          ? tile.dependents.map((dependent) => (
              <section key={dependent.agent} className="connector-receipt-agent">
                <h3>{dependent.agent}</h3>
                <ConnectionCards rows={[dependent.row]} act={act(dependent.agent)} />
              </section>
            ))
          : null}
      </details>
    </article>
  );
}
