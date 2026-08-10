"use client";

import { useState, type ReactNode } from "react";

import { BrokerLapseNotice } from "../_components/connection-card";
import { ConnectorTile } from "../_components/connector-tile";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { submitConnectionCommand } from "../_data/source";
import { useCanAct, useHost, useView } from "../_data/use-view";
import { buildConnectorTiles, summariseConnectors } from "../../lib/connectors";
import type { AgentConnections } from "../../lib/views/types";

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
 * ## Still no credential input here
 *
 * Unchanged and load-bearing. Connect opens a window main owns with its own
 * preload; the value goes from that window to the operating system's vault
 * without passing through this page. What this page sends is three ids, and what
 * it gets back is a state, a masked hint and a sentence.
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

  return (
    <>
      <h1>Connections</h1>
      <p className="lede">
        The services your agents reach outside this computer. Connect one and
        every agent that needs it is connected — anything DASH holds is kept in
        this computer&rsquo;s credential vault.
      </p>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="what your agents can reach" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <ConnectorList
          agents={state.data.agents}
          older={state.data.older_agent_names}
          canAct={canAct}
          onChanged={() => {
            setRevision((current) => current + 1);
          }}
        />
      )}
    </>
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
    return (
      <div className="empty">
        <p>No agent here has asked to reach anything outside this computer.</p>
        <p>
          <a href="/settings/add-agent">Add an agent</a> to see what it would need.
        </p>
      </div>
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
    <>
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
    </>
  );
}
