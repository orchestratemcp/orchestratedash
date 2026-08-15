"use client";

import { useState, type ReactNode } from "react";

import { ConnectionCards, type ConnectionAct } from "./connection-card";
import { InfoNote } from "./info-note";
import { OAvatar } from "./o-avatar";
import { splitProof, type ProofKind } from "../../lib/copy/info-note";
import { describeProof } from "../../lib/connection-card";
import { describeAccounts, describeExpansion, type ServiceRow as Row } from "../../lib/connections-list";
import { describeSharedGrant } from "../../lib/connectors";
import { describeSkip, type FleetSkip } from "../../lib/fleet/grants";
import type { Recovery } from "../../lib/copy/recovery";
import type { FleetAct } from "./fleet-connector";

/**
 * One service, once (MAR-642).
 *
 * ## What this replaces
 *
 * Two components that drew the same service twice on one page:
 * `FleetConnectorCard` for the catalogue and `ConnectorTile` for what agents
 * asked for. `lib/connections-list.ts` argues the merge; this is the row it
 * produces.
 *
 * **Nothing honest was dropped.** Every sentence either half rendered still
 * renders: the operation list, the wider-permission disclosure, the reach
 * sentence, the skipped agents, the proof line, the shared-grant warning and
 * MAR-533's per-agent receipt. What changed is that they are behind **one**
 * disclosure on **one** row instead of spread over two cards a reader had to
 * deduplicate by eye.
 *
 * ## What stays above the fold, and why exactly this
 *
 * Henrik's shape, verbatim: *service glyph · name · account hint · status chip ·
 * needed-by avatars; everything else expands.* Each of those is a thing a person
 * scanning the page is looking for — which service, do I have it, whose account,
 * and who here needs it — and none of them is a consequence they have to read
 * before pressing something.
 *
 * The **button is above the fold too**, which the brief does not list and the
 * novice test requires: a person arriving at Settings to connect Gmail must not
 * have to open a disclosure to find the control. What is behind the disclosure
 * is everything that explains, and nothing that acts.
 *
 * The consequences that ADR 0002 amendment 2 requires *before* a grant — the
 * permission wider than what DASH does with it, and who else this reaches — are
 * the exception, and they stay on the surface above the button whenever they
 * exist. A disclosure that hid them would be the amendment's own failure case.
 */

interface RowOutcome {
  ok: boolean;
  detail?: string;
  recovery?: Recovery;
}

export function ServiceRow({
  row,
  fleetAct,
  agentAct,
  canAct,
}: {
  row: Row;
  /** Acts on the fleet connection, for a service in DASH's catalogue. */
  fleetAct: FleetAct;
  /** Acts on one agent's own row, for a service only an agent named. */
  agentAct: (agent: string) => ConnectionAct;
  canAct: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RowOutcome | null>(null);

  const { fleet, tile } = row;
  /*
   * Whether there is anything left to connect, which is not the same question
   * as whether DASH holds anything.
   *
   * `row.accounts` is non-empty as soon as *one* agent has a credential, and a
   * partly connected service must still offer the plain sign-in: "Sign in
   * again" on a row where one of two agents cannot reach the service would
   * describe the press as a refresh when it is the thing that fixes it. So the
   * tile's standing decides when there is one — `ConnectorTile`'s own rule,
   * carried over — and what DASH holds decides when there is not.
   */
  const connected =
    tile !== null && tile.dependents.length > 0
      ? tile.standing === "connected"
      : row.accounts.length > 0;
  const signIn = fleet?.connector_kind === "google_oauth_broker";
  const accounts = describeAccounts(row.accounts);
  const shared = tile === null ? null : describeSharedGrant(tile);
  const proof = tile === null ? null : describeProof(tile.proof, row.service);
  const split = tile === null || proof === null ? null : splitProof(tile.proof as ProofKind, proof);

  async function runFleet(action: "connect" | "test" | "disconnect" | "share"): Promise<void> {
    setBusy(action);
    setOutcome(null);
    const result = await fleetAct(action, row.provider);
    setBusy(null);
    setOutcome(result);
  }

  /**
   * Connect a service only an agent named, through that agent's own row.
   *
   * `connectTarget`'s rule, moved here with the component that needs it: the
   * first dependent DASH could hold a credential for, preferring one that is
   * not connected yet, so pressing Connect on a partly-connected row fills the
   * gap rather than re-signing an agent that is already fine. `findGrantSharers`
   * reaches the others, which is why one row is enough — and why this must never
   * be presented as connecting only that agent.
   */
  const target =
    tile === null
      ? null
      : (tile.dependents.filter((one) => one.row.dash_can_hold && one.row.field_id !== null).find(
          (one) => !one.connected,
        ) ??
        tile.dependents.filter((one) => one.row.dash_can_hold && one.row.field_id !== null)[0] ??
        null);

  async function runAgent(): Promise<void> {
    if (target === null || target.row.field_id === null) {
      return;
    }
    setBusy("connect");
    setOutcome(null);
    const result = await agentAct(target.agent)("connect", {
      connection_id: target.row.connection_id,
      field_id: target.row.field_id,
    });
    setBusy(null);
    setOutcome(result);
  }

  return (
    <article className="row-card service-row">
      <div className="service-head">
        <ServiceGlyph kind={row.kind} />
        <h3 className="service-name">{row.service}</h3>
        {/* The account, where a person looks for it: beside the name rather
            than in the expansion, because "which of my accounts is this" is the
            question a second glance asks and the one MAR-643 will make plural. */}
        {accounts === null ? null : <span className="service-account">{accounts}</span>}
        <span className={`chip ${row.chip.tone}`}>{row.chip.label}</span>
      </div>

      {/*
        Who needs this. The tile's whole reason for existing — one service,
        several agents — kept above the fold as avatars rather than as the
        sentence it used to be: a picture per agent says the same thing in one
        line, and each carries its own name for anybody not looking at pictures.
      */}
      {tile === null || tile.dependents.length === 0 ? null : (
        <ul className="service-needed-by">
          {tile.dependents.map((dependent) => (
            <li key={dependent.agent} className="service-needed">
              {/* 50, because `OSize` is a closed set of three and the cast's
                  sprites exist at exactly those sizes — a 32 here would be a
                  browser scaling a pixel-art portrait, which is the one thing
                  `lib/brand/o-cast.ts` bounds its sizes to prevent. */}
              {dependent.avatar === null ? null : (
                <OAvatar name={dependent.avatar} size={50} />
              )}
              {/* MAR-589. The name a person reads, never the id. */}
              <span className="service-needed-name">{dependent.title}</span>
              <span className={`chip ${dependent.connected ? "chip-ok" : "chip-muted"}`}>
                {dependent.connected ? "connected" : "not connected"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        What DASH can and cannot prove, on the surface (MAR-570, MAR-614).

        Kept above the fold rather than folded into the expansion, and it was
        the one thing this merge nearly lost. MAR-570's novice test is *could
        someone who has never heard of OAuth say what DASH is allowed to do* —
        this line is the answer, and a surface showing `can` without `cannot`
        would be the reassuring half of a sentence whose value is the other one.

        MAR-614 already split it once: which half stays on the surface is
        decided per arrangement by `splitProof`, and its reasoning is what to
        read before changing anything here. Prose rather than a bordered note,
        because two bordered boxes stacked is what pushed this row's own button
        off a 900px viewport the last time.
      */}
      {split === null ? null : (
        <p className="muted wrap" role="note">
          {split.surface.join(" ")}
          {split.note.length === 0 ? null : <InfoNote>{split.note.join(" ")}</InfoNote>}
        </p>
      )}

      {/*
        The two consequences that are said *before* the button, in one box.

        ADR 0002 amendment 2's rule and MAR-614's layout finding together: the
        permission that is wider than what DASH does with it, and who else a
        press reaches, both survive being connected — because they are what
        would otherwise vanish at the moment they start to matter — and both are
        one bordered box rather than two, because two identical boxes read as
        two alarms and push the button toward the fold.

        Nothing here is conditional on anything else being present; a row with
        none of them draws no box at all.
      */}
      {(fleet?.wider_permissions.length ?? 0) === 0 &&
      (fleet?.reach_sentence ?? null) === null &&
      shared === null ? null : (
        <div className="notice notice-warn wrap">
          {(fleet?.wider_permissions ?? []).map((sentence) => (
            <p key={sentence} role="note">
              {sentence}
            </p>
          ))}
          {fleet?.reach_sentence == null ? null : <p role="note">{fleet.reach_sentence}</p>}
          {shared === null ? null : <p role="note">{shared}</p>}
        </div>
      )}

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

      {canAct ? (
        <div className="button-row">
          {fleet === null ? (
            /*
             * A service only an agent named. DASH has built no fleet flow for
             * it, so the press goes through that agent's own row — and there is
             * no button at all when no dependent is connectable, rather than
             * one that would fire nothing.
             */
            target === null ? null : (
              <button
                type="button"
                className={connected ? "button-secondary" : "button-primary"}
                disabled={busy !== null}
                onClick={() => void runAgent()}
              >
                {busy === "connect"
                  ? "Waiting…"
                  : target.row.credential_kind === "oauth"
                    ? connected
                      ? `Sign in to ${row.service} again`
                      : `Sign in to ${row.service}`
                    : connected
                      ? "Replace"
                      : `Connect ${row.service}`}
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                className={connected ? "button-secondary" : "button-primary"}
                disabled={busy !== null}
                onClick={() => void runFleet("connect")}
              >
                {/* A sign-in and a typed key are different acts and the button
                    says which is about to happen — "Connect" on a control that
                    opens a browser gives no warning that the person is about to
                    leave DASH. */}
                {busy === "connect"
                  ? "Waiting…"
                  : signIn
                    ? connected
                      ? `Sign in to ${row.service} again`
                      : `Sign in to ${row.service}`
                    : connected
                      ? "Replace the key"
                      : `Add your ${row.service} key`}
              </button>

              {connected ? (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy !== null}
                  onClick={() => void runFleet("test")}
                >
                  {busy === "test" ? "Checking…" : "Check it still works"}
                </button>
              ) : null}

              {/* The one button that gives out a consent DASH already holds.
                  Drawn only when somebody is actually waiting — which happens
                  exactly when an agent was imported after this was connected —
                  so it is never a control that would do nothing. */}
              {fleet.waiting.length > 0 ? (
                <button
                  type="button"
                  className="button-primary"
                  disabled={busy !== null}
                  onClick={() => void runFleet("share")}
                >
                  {busy === "share"
                    ? "Giving…"
                    : fleet.waiting.length === 1
                      ? `Give it to ${fleet.waiting[0] as string}`
                      : `Give it to ${String(fleet.waiting.length)} waiting agents`}
                </button>
              ) : null}

              {connected ? (
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy !== null}
                  onClick={() => void runFleet("disconnect")}
                >
                  {busy === "disconnect"
                    ? "Disconnecting…"
                    : (fleet.agents.length === 0
                      ? "Disconnect"
                      : "Disconnect everywhere")}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : (
        /*
         * Said rather than drawn as a disabled button, both halves' shared
         * reason: a greyed-out control reads as a claim about the service, and
         * the true statement is about which window this is.
         */
        <p className="muted wrap">Open the installed DASH app to connect a service.</p>
      )}

      {/*
        Everything that explains, behind one disclosure — and built only while
        it is open. `ConnectionCards` is the heaviest component in DASH (a
        three-party drawing, two capability lists and a usage history per agent)
        and a list that built one per agent per service on first paint would
        spend its whole budget on the view nobody has asked for yet.
      */}
      <details
        className="card-more service-more"
        open={open}
        onToggle={(event) => {
          setOpen((event.target as HTMLDetailsElement).open);
        }}
      >
        <summary>{describeExpansion(row)}</summary>
        {open ? (
          <>
            {fleet === null ? null : <p className="wrap">{fleet.purpose}</p>}

            {/* What DASH can do, in DASH's own plain sentences. A list of
                scopes here would be the machine vocabulary
                `lib/copy/identifiers.ts` forbids on a guided surface. */}
            {fleet === null || fleet.capabilities.length === 0 ? null : (
              <ul className="capability-list">
                {fleet.capabilities.map((capability) => (
                  <li key={capability.id}>
                    <p>{capability.label}</p>
                    {/* What a write leaves behind, under the capability rather
                        than in a tooltip, because a capability list can read
                        like a list of reads. */}
                    {capability.consequence === null ? null : (
                      <p className="muted wrap">{capability.consequence}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {fleet?.held == null || fleet.held.permissions.length === 0 ? null : (
              <>
                <p className="eyebrow">What you allowed</p>
                <ul className="capability-list">
                  {fleet.held.permissions.map((permission) => (
                    <li key={permission}>
                      <p>{permission}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* Agents this names and does not reach, each with the reason and
                the next move. Drawn rather than filtered out: an agent silently
                missing is a person wondering why theirs still cannot do the
                thing they just connected. */}
            {(fleet?.skipped ?? []).map((one) => {
              const said = describeSkip(one.reason as FleetSkip, row.service);
              return (
                <p key={one.agent} className="muted wrap">
                  <strong>{one.title}</strong> — {said.label}. {said.meaning}
                </p>
              );
            })}

            {/* MAR-533's receipt, still one click deep and still per agent:
                what DASH is allowed to do is per agent even when the sign-in is
                not, and this is where that shows. */}
            {(tile?.dependents ?? []).map((dependent) => (
              <section key={dependent.agent} className="service-receipt">
                <h4>{dependent.title}</h4>
                {/* The author's own words about why this agent wants it. */}
                <p className="muted wrap">{dependent.purpose}</p>
                <ConnectionCards rows={[dependent.row]} act={agentAct(dependent.agent)} />
              </section>
            ))}

            {/* Where to get the thing, for a connector somebody has to go and
                make one for. A sentence rather than a link — a person needs to
                know which page of their account to look on more than they need
                something to click, and a raw link is refused on a guided surface
                anyway. */}
            {fleet?.help == null || connected ? null : (
              <p className="muted wrap">{fleet.help}</p>
            )}
          </>
        ) : null}
      </details>
    </article>
  );
}

/**
 * A picture of what kind of thing this is, on the 12×12 grid the sidebar uses.
 *
 * An outlined figure for an account somebody signs into, a key for a key, and a
 * stack for a server — which nothing produces yet and which is drawn anyway, so
 * the day ADR 0020's first catalogue entry lands the list has a glyph rather
 * than a gap. `DensityToggle` makes the argument for pictures of the thing:
 * an abstract icon is the kind that needs a legend.
 */
function ServiceGlyph({ kind }: { kind: Row["kind"] }): ReactNode {
  return (
    <svg
      className="service-glyph"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "account" ? (
        <>
          <circle cx="6" cy="4" r="2.2" fill="none" stroke="currentColor" strokeWidth="1" />
          <path
            d="M2 11a4 4 0 0 1 8 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </>
      ) : kind === "key" ? (
        <>
          <circle cx="4" cy="6" r="2.2" fill="none" stroke="currentColor" strokeWidth="1" />
          <path
            d="M6.2 6H11M9 6v2.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <rect x="1.5" y="2" width="9" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
          <rect x="1.5" y="7" width="9" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
        </>
      )}
    </svg>
  );
}
