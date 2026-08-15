"use client";

import { useState, type ReactNode } from "react";

import { BrokerLapseNotice } from "../_components/connection-card";
import { ConnectorTile } from "../_components/connector-tile";
import { FleetConnectorCard } from "../_components/fleet-connector";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { submitConnectionCommand, submitFleetCommand } from "../_data/source";
import { useCanAct, useHost, useView } from "../_data/use-view";
import { buildConnectorTiles, summariseConnectors } from "../../lib/connectors";
import type { AgentConnections, FleetConnectorView } from "../../lib/views/types";

/**
 * The Connections page, as connectors (MAR-570).
 *
 * ## Two verdicts, one page
 *
 * Henrik on MAR-383's checklist: *"the current connection page makes no sense to
 * me right now."* MAR-533 answered that — four questions per connection, in the
 * order a person arrives with them — and drew one card per **agent per
 * connection**. Henrik on that: *"cluttered and a lot of text."*
 *
 * Both verdicts are about the same thing, one layer apart: the page was
 * organised by DASH's own bookkeeping. The first page grouped by who holds the
 * credential; the second grouped by which agent asked. Neither is what a person
 * has in mind, which is a service they recognise.
 *
 * > The connector is the unit that gets connected; the agent is the unit that
 * > needs it.
 *
 * So the page is tiles — one per service, each naming the agents that depend on
 * it — and MAR-533's capability card is the **receipt one click away**. Nothing
 * honest is removed. The three-party drawing, the nobody-asked-for-this list,
 * the wider-permission banner and the usage history are all still rendered by
 * the same component; they are one click deep instead of being the front page.
 *
 * ## Connect once, and it really is once
 *
 * Two agents that need Gmail used to mean two sign-ins, because a grant is keyed
 * per agent. That is still true of the *record* — each agent has its own vault
 * entry, its own receipt and its own revocation — and it is no longer true of
 * the *act*: `findGrantSharers` writes one received consent to every agent that
 * named the provider and independently qualified for it.
 *
 * The sentence that discloses this is on the tile, above the button, and it is
 * built by `describeSharedGrant` rather than written here, so the page cannot
 * soften a consequence that lands on an agent the reader is not looking at.
 *
 * ## The test this page is written against, unchanged
 *
 * *Could someone who has never heard of OAuth look at this and say what DASH is
 * allowed to do?*
 *
 * ## The third verdict: there was nothing here at all (MAR-593)
 *
 * Henrik, 2026-08-10, on a DASH he had just cleared of agents, following his own
 * test plan's step 2 — *configure DASH: sign in to Google, add OpenRouter, a
 * Discord webhook and a server.* The page was empty, and it was right to be: every
 * tile above comes from an agent's manifest, and there were no agents.
 *
 * So the page is now two things, in the order somebody actually needs them:
 *
 * 1. **What you can connect** — the fleet cards, from `lib/fleet/catalogue.ts`,
 *    which exist whether or not anything is imported.
 * 2. **What your agents need** — the tiles above, unchanged, which is where a
 *    person looks once agents exist and something is not working.
 *
 * The second is not a lesser version of the first. A connection is fleet-level
 * and a *grant* is per agent, so "which of my agents can actually do this" stays
 * a real question with its own answer, and MAR-533's receipt is still one click
 * away underneath it. See ADR 0013.
 *
 * ## The heading does not repeat the tab
 *
 * MAR-592 put a tab strip above this page whose active tab reads "Connections",
 * two lines above an `<h1>` that read "Connections". The fix is not a hidden
 * heading — the visual anchor is worth keeping — and it is not moving the title
 * into the layout, which MAR-592 argued against for reasons that still hold.
 *
 * It is that the `<h1>` now says what a connection *is*, which a novice arriving
 * at an empty page needs more than they need the word they just pressed. The tab
 * is where you are; the heading is what is here.
 *
 * ## Still no credential input here
 *
 * Unchanged and load-bearing. Connect opens a window main owns with its own
 * preload; the value goes from that window to the operating system's vault
 * without passing through this page. What this page sends is three ids — or, for
 * a fleet card, one provider — and what it gets back is a state, a masked hint
 * and a sentence.
 */
export default function ConnectionsPage(): ReactNode {
  // Bumped after any command that changed something, so the page re-reads the
  // view rather than trusting its own optimistic idea of what happened. That
  // matters more than it did: a connect now changes rows belonging to agents
  // other than the one whose button was pressed, and only a re-read shows it.
  const [revision, setRevision] = useState(0);
  const state = useView((source) => source.connections(), revision);
  const host = useHost();
  const canAct = useCanAct();

  const bump = (): void => {
    setRevision((current) => current + 1);
  };

  return (
    <>
      <h1>Accounts and keys</h1>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="what DASH can reach" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <>
          <FleetConnectors
            connectors={state.data.fleet}
            canAct={canAct}
            onChanged={bump}
          />
          <ConnectorList
            agents={state.data.agents}
            older={state.data.older_agent_names}
            canAct={canAct}
            onChanged={bump}
          />
        </>
      )}
    </>
  );
}

/**
 * What you can connect, before any agent is involved (MAR-593).
 *
 * Split out for `ConnectorList`'s reason: a render test can drive the whole
 * surface from a view document without a data source, and a photograph proves a
 * state was drawn once while a render test proves it is still drawn on every
 * run.
 *
 * An empty catalogue draws nothing rather than an empty state. It cannot happen
 * through `fleetCatalogue`, which is a by-value list with entries in it, and if
 * it ever did the true statement would be that this build offers no connectors —
 * not that the person has nothing connected.
 */
export function FleetConnectors({
  connectors,
  canAct,
  onChanged,
}: {
  connectors: readonly FleetConnectorView[];
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  if (connectors.length === 0) {
    return null;
  }

  const connected = connectors.filter((one) => one.held !== null).length;

  return (
    <section className="fleet-connectors">
      {/*
        Counted rather than asserted, over the cards this page actually drew, so
        the line cannot drift from what is under it — `summariseConnectors`' rule
        applied to the surface above it.
      */}
      <p className="page-summary wrap">
        {connected === 0
          ? `${String(connectors.length)} ${connectors.length === 1 ? "service" : "services"} DASH can connect for you. None is connected yet.`
          : connected === connectors.length
            ? `${String(connectors.length)} ${connectors.length === 1 ? "service" : "services"}, and ${connectors.length === 1 ? "it is" : "all of them are"} connected.`
            : `${String(connectors.length)} services DASH can connect for you. ${String(connected)} of them ${connected === 1 ? "is" : "are"} connected.`}
      </p>

      <ul className="row-list">
        {connectors.map((connector) => (
          <li key={connector.provider}>
            <FleetConnectorCard
              connector={connector}
              canAct={canAct}
              act={async (action, provider) => {
                const result = await submitFleetCommand(action, { provider });
                if (result.ok) {
                  onChanged();
                }
                return {
                  ok: result.ok,
                  detail: result.detail,
                  recovery: result.recovery,
                };
              }}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The tiles, and the two things that are not tiles.
 *
 * Split out so a render test can drive the whole surface from a view document
 * without a data source — the shape `DeployPanel` and `ServerCard` established,
 * and the reason MAR-574's card states: a photograph proves a state was drawn
 * once, a render test proves it is still drawn on every run.
 */
export function ConnectorList({
  agents,
  older,
  canAct,
  onChanged,
}: {
  agents: readonly AgentConnections[];
  older: readonly string[];
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const tiles = buildConnectorTiles(agents);

  if (tiles.length === 0) {
    /*
     * Quieter than it was, because it is no longer the whole page (MAR-593).
     * Before the fleet cards above existed, this sentence was what somebody with
     * a cleared DASH saw and it read as a dead end. It is now a true note under a
     * page they can act on, so it says the smaller thing and does not repeat the
     * invitation the empty state used to have to carry.
     */
    return (
      <section className="agent-connections">
        <h2>What your agents need</h2>
        <p className="muted wrap">
          No agent here has asked to reach anything outside this computer. Add
          one and what it needs will appear here, connected already if you have
          connected it above.
        </p>
      </section>
    );
  }

  /*
   * Every agent's lapse notices, above the tiles rather than inside them.
   *
   * MAR-467's argument for putting these first is unchanged — somebody who
   * opened this page because an agent did less than they expected is looking for
   * exactly this. What changed is that a lapse belongs to an *agent* and the
   * tiles below are services, so it cannot live on one of them without being
   * filed under whichever service happened to be first.
   */
  const lapsing = agents.filter((agent) => agent.lapses.length > 0);

  return (
    <section className="agent-connections">
      {/* The section this page's second half is about, said once. A person
          scrolling past the fleet cards needs to know the unit changed: above is
          what you connected, here is what each agent may do with it. */}
      <h2>What your agents need</h2>

      {/* Counted rather than asserted, over the tiles this page actually drew,
          so the line cannot drift from what is under it. */}
      <p className="page-summary wrap">{summariseConnectors(tiles)}</p>

      {lapsing.map((agent) => (
        <div key={agent.name} className="connector-lapse">
          <p className="eyebrow">{agent.name}</p>
          <BrokerLapseNotice lapses={agent.lapses} />
        </div>
      ))}

      <ul className="row-list connector-grid">
        {tiles.map((tile) => (
          <li key={tile.provider}>
            <ConnectorTile
              tile={tile}
              canAct={canAct}
              act={(agent) => async (action, target) => {
                const result = await submitConnectionCommand(action, {
                  agent_id: agent,
                  ...target,
                });
                if (result.ok) {
                  onChanged();
                }
                return {
                  ok: result.ok,
                  detail: result.detail,
                  recovery: result.recovery,
                };
              }}
            />
          </li>
        ))}
      </ul>

      {older.length > 0 ? (
        <p className="muted wrap">
          {older.length === 1
            ? "1 agent here was added in an older format that cannot say what it needs to reach"
            : `${String(older.length)} agents here were added in an older format that cannot say what they need to reach`}
          : {older.join(", ")}. DASH does not guess.
        </p>
      ) : null}
    </section>
  );
}
