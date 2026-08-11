"use client";

import { useState, type ReactNode } from "react";

import { describeSkip, type FleetSkip } from "../../lib/fleet/grants";
import type { Recovery } from "../../lib/copy/recovery";
import type { FleetConnectorView } from "../../lib/views/types";

/**
 * One service DASH can hold an account or a key for (MAR-593, ADR 0013).
 *
 * `ConnectorTile` beside it draws a service **an agent asked for**, and its
 * subject is therefore the agents: who needs this, and which of them has it.
 * This card's subject is the person. It exists on a DASH with nothing imported,
 * which is the state Henrik's test plan starts from, and the agent list on it is
 * a *consequence* — here is what connecting this will reach — rather than the
 * reason the card is there.
 *
 * ## What is said before the button, and why it is in this order
 *
 * 1. what it is for, in the person's terms;
 * 2. what DASH will be able to do — the operation list, never a scope;
 * 3. the permission that is wider than that, when there is one (ADR 0002
 *    amendment 2, and it renders before a sign-in as much as after, because the
 *    person who has not granted it yet is the one it is for);
 * 4. which agents this reaches beyond the card.
 *
 * Every one of those is above the control. A consequence that arrives with the
 * confirmation describes a window the person has already walked through.
 *
 * ## The novice test, unchanged
 *
 * *Could someone who has never heard of OAuth look at this and say what DASH is
 * allowed to do?* Which is why the word does not appear, no scope string does,
 * and the button says whether a browser is about to open.
 */

interface CardOutcome {
  ok: boolean;
  detail?: string;
  recovery?: Recovery;
}

export type FleetAct = (
  action: "connect" | "test" | "disconnect" | "share",
  provider: string,
) => Promise<CardOutcome>;

export function FleetConnectorCard({
  connector,
  act,
  canAct,
}: {
  connector: FleetConnectorView;
  act: FleetAct;
  canAct: boolean;
}): ReactNode {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CardOutcome | null>(null);

  const connected = connector.held !== null;
  const signIn = connector.connector_kind === "google_oauth_broker";

  async function run(action: "connect" | "test" | "disconnect" | "share"): Promise<void> {
    setBusy(action);
    setOutcome(null);
    const result = await act(action, connector.provider);
    setBusy(null);
    setOutcome(result);
  }

  return (
    <article className="row-card fleet-connector">
      <div className="card-head">
        <h3>{connector.service}</h3>
        <span className={connected ? "chip chip-ok" : "chip chip-muted"}>
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <p className="wrap">{connector.purpose}</p>

      {connector.held === null ? null : (
        <p className="muted wrap">
          {/* Which account, and since when. Never invented: a provider that named
              no account gets the honest sentence rather than "your account",
              which would be DASH asserting something it was not told. */}
          {connector.held.account_hint ?? connector.held.masked_hint ?? "An account the provider did not name"}
          {connector.held.since === null ? "" : `, since ${connector.held.since}`}.
        </p>
      )}

      {/*
        What DASH will be able to do. The operation labels, which are DASH's own
        plain-language sentences — a list of scopes here would be the machine
        vocabulary `lib/copy/identifiers.ts` forbids on a guided surface, and
        would answer a question nobody asked.
      */}
      <details className="card-more">
        <summary>
          {connected ? "What DASH can do with this" : "What DASH would be able to do"}
        </summary>
        <ul className="capability-list">
          {connector.capabilities.map((capability) => (
            <li key={capability.id}>
              <p>{capability.label}</p>
              {/* What a write leaves behind. Under the capability rather than in
                  a tooltip, because a capability list can read like a read. */}
              {capability.consequence === null ? null : (
                <p className="muted wrap">{capability.consequence}</p>
              )}
            </li>
          ))}
        </ul>
        {connector.held === null || connector.held.permissions.length === 0 ? null : (
          <>
            <p className="eyebrow">What you allowed</p>
            <ul className="capability-list">
              {connector.held.permissions.map((permission) => (
                <li key={permission}>
                  <p>{permission}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>

      {/*
        The two consequences of pressing the button, in one box (MAR-614).

        Both were here already and neither has changed a word: the permission
        that is wider than what DASH does with it — before the button, surviving
        being connected, because it is the sentence that would otherwise vanish
        at the moment it started to matter — and who else this reaches.

        What changed is that they were two separately bordered warning panels
        stacked on top of each other, which is the exact defect MAR-570 found and
        fixed one component over on `ConnectorTile`: two identical boxes read as
        two alarms, take twice the vertical space of the thing they qualify, and
        push the card's own button toward the fold. One box, two paragraphs, both
        still announced as notes.

        Nothing is conditional on the other being present. A card with only one
        of them draws one box with one paragraph, and a card with neither draws
        nothing at all — a warning about nobody is one people learn to skip.
      */}
      {connector.wider_permissions.length === 0 && connector.reach_sentence === null ? null : (
        <div className="notice notice-warn wrap">
          {connector.wider_permissions.map((sentence) => (
            <p key={sentence} role="note">
              {sentence}
            </p>
          ))}
          {connector.reach_sentence === null ? null : (
            <p role="note">{connector.reach_sentence}</p>
          )}
        </div>
      )}

      {connector.agents.length === 0 ? null : (
        <ul className="connector-agents">
          {connector.agents.map((one) => (
            <li key={one.agent} className="connector-agent">
              <p className="connector-agent-name">{one.agent}</p>
              <span className={one.connected ? "chip chip-ok" : "chip chip-muted"}>
                {one.connected ? "has this" : "waiting"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Agents this names and does not reach, each with the reason and the next
        move. Drawn rather than filtered out: an agent silently missing from the
        list above is a person wondering why their agent still cannot do the
        thing they just connected.
      */}
      {connector.skipped.map((one) => {
        const said = describeSkip(one.reason as FleetSkip, connector.service);
        return (
          <p key={one.agent} className="muted wrap">
            <strong>{one.agent}</strong> — {said.label}. {said.meaning}
          </p>
        );
      })}

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
          <button
            type="button"
            className={connected ? "button-secondary" : "button-primary"}
            disabled={busy !== null}
            onClick={() => void run("connect")}
          >
            {/* A sign-in and a typed key are different acts and the button says
                which is about to happen — "Connect" on a control that opens a
                browser gives no warning that the person is about to leave DASH. */}
            {busy === "connect"
              ? "Waiting…"
              : signIn
                ? connected
                  ? `Sign in to ${connector.service} again`
                  : `Sign in to ${connector.service}`
                : connected
                  ? "Replace the key"
                  : `Add your ${connector.service} key`}
          </button>

          {connected ? (
            <button
              type="button"
              className="button-secondary"
              disabled={busy !== null}
              onClick={() => void run("test")}
            >
              {busy === "test" ? "Checking…" : "Check it still works"}
            </button>
          ) : null}

          {/*
            The one button that gives out a consent DASH already holds. Drawn
            only when somebody is actually waiting — which happens exactly when
            an agent was imported after this was connected — so it is never a
            control that would do nothing.
          */}
          {connector.waiting.length > 0 ? (
            <button
              type="button"
              className="button-primary"
              disabled={busy !== null}
              onClick={() => void run("share")}
            >
              {busy === "share"
                ? "Giving…"
                : connector.waiting.length === 1
                  ? `Give it to ${connector.waiting[0] as string}`
                  : `Give it to ${String(connector.waiting.length)} waiting agents`}
            </button>
          ) : null}

          {connected ? (
            <button
              type="button"
              className="button-secondary"
              disabled={busy !== null}
              onClick={() => void run("disconnect")}
            >
              {busy === "disconnect"
                ? "Disconnecting…"
                : connector.agents.length === 0
                  ? "Disconnect"
                  : "Disconnect everywhere"}
            </button>
          ) : null}
        </div>
      ) : (
        /*
         * Said rather than drawn as a disabled button, for `ConnectorTile`'s
         * reason: a greyed-out control reads as a claim about the service, and
         * the true statement is about which window this is.
         */
        <p className="muted wrap">Open the installed DASH app to connect a service.</p>
      )}

      {/* Where to get the thing, for the connector that needs somebody to go and
          make one. A sentence rather than a link — a person needs to know which
          page of their account to look on more than they need something to
          click, and a raw URL is refused on a guided surface anyway. */}
      {connector.help === null || connected ? null : (
        <p className="muted wrap">{connector.help}</p>
      )}
    </article>
  );
}
