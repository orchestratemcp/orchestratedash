"use client";

import { useState, type ReactNode } from "react";

import { BrokerLapseNotice } from "../_components/connection-card";
import { ServiceRow } from "../_components/service-row";
import { HostNotice, ViewFailed, ViewLoading } from "../_components/view-state";
import { submitConnectionCommand, submitFleetCommand } from "../_data/source";
import { useCanAct, useHost, useView } from "../_data/use-view";
import { aiProviderFor } from "../../lib/ai/providers";
import { serviceRows, summariseServices } from "../../lib/connections-list";
import { buildConnectorTiles } from "../../lib/connectors";
import type { ConnectionsView } from "../../lib/views/types";

/**
 * The Connections page: one list, keyed by service (MAR-570, MAR-593, MAR-642).
 *
 * ## Three verdicts, one page
 *
 * Henrik on MAR-383's checklist: *"the current connection page makes no sense to
 * me right now."* MAR-533 answered that — four questions per connection, in the
 * order a person arrives with them — and drew one card per **agent per
 * connection**. Henrik on that: *"cluttered and a lot of text."* MAR-570 answered
 * *that* by making the connector the unit and putting MAR-533's capability card
 * one click away.
 *
 * The third verdict was MAR-593's own doing and took a year of issues to become
 * visible. That packet found the page empty on a DASH with no agents — correctly,
 * because every tile came from a manifest — and added a second list above the
 * first: the catalogue, keyed by provider, with its own cards and its own
 * Connect buttons. From then on a DASH with one Gmail agent drew **Gmail twice**,
 * one above the other, with two chips and two buttons for one account.
 *
 * MAR-642 merges them. The key was always `provider` and both halves already
 * grouped on it; nothing about them was ever two lists except the rendering. See
 * `lib/connections-list.ts` for the merge and `ServiceRow` for what a row shows
 * before you expand it.
 *
 * ## Connect once, and it really is once
 *
 * Two agents that need Gmail used to mean two sign-ins, because a grant is keyed
 * per agent. That is still true of the *record* — each agent has its own vault
 * entry, its own receipt and its own revocation — and it is no longer true of
 * the *act*: `findGrantSharers` writes one received consent to every agent that
 * named the provider and independently qualified for it.
 *
 * The sentence that discloses this is on the row, above the button, and it is
 * built by `describeSharedGrant` rather than written here, so the page cannot
 * soften a consequence that lands on an agent the reader is not looking at.
 *
 * ## The test this page is written against, unchanged
 *
 * *Could someone who has never heard of OAuth look at this and say what DASH is
 * allowed to do?*
 *
 * ## The heading does not repeat the tab
 *
 * MAR-592 put a tab strip above this page whose active tab reads "Connections",
 * two lines above an `<h1>` that read "Connections". The fix is not a hidden
 * heading and not moving the title into the layout: the `<h1>` says what a
 * connection *is*, which a novice arriving at an empty page needs more than they
 * need the word they just pressed.
 *
 * ## The model keys left (MAR-642)
 *
 * Three of the four catalogue entries this page drew were model-provider keys,
 * and they are the AI tab's now. What is left is what the heading says — the
 * accounts DASH signs into on somebody's behalf — and the split is
 * `ai_provider_id`, taken off the catalogue entry rather than decided here.
 *
 * ## Still no credential input here
 *
 * Unchanged and load-bearing. Connect opens a window main owns with its own
 * preload; the value goes from that window to the operating system's vault
 * without passing through this page. What this page sends is three ids — or, for
 * a fleet row, one provider — and what it gets back is a state, a masked hint
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
      {/* MAR-642: "and keys" left with the keys. What this page holds is the
          accounts DASH signs into for you; the model keys are on the AI tab,
          and a heading naming both would send somebody looking for one to the
          page holding the other. */}
      <h1>Accounts you connect</h1>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="what DASH can reach" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <ServiceList view={state.data} canAct={canAct} onChanged={bump} />
      )}
    </>
  );
}

/**
 * The list, and the two things that are not in it.
 *
 * Split out so a render test can drive the whole surface from a view document
 * without a data source — the shape `DeployPanel` and `ServerCard` established,
 * and the reason MAR-574's card states: a photograph proves a state was drawn
 * once, a render test proves it is still drawn on every run.
 */
export function ServiceList({
  view,
  canAct,
  onChanged,
}: {
  view: ConnectionsView;
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  /*
   * MAR-642. A model provider is neither a card nor a tile on this page.
   *
   * Both halves are filtered by the same fact — `ai_provider_id` on the
   * catalogue entry, `aiProviderFor` on the manifest's provider string, which
   * is DASH's own closed registry either way — so the two sides of the merge
   * cannot disagree about which services belong to the AI tab.
   */
  const fleet = view.fleet.filter((connector) => connector.ai_provider_id === null);
  const tiles = buildConnectorTiles(view.agents).filter(
    (tile) => aiProviderFor(tile.provider) === null,
  );
  const rows = serviceRows(fleet, tiles);

  /*
   * Every agent's lapse notices, above the list rather than inside a row.
   *
   * MAR-467's argument for putting these first is unchanged — somebody who
   * opened this page because an agent did less than they expected is looking for
   * exactly this. What keeps them out of the rows is that a lapse belongs to an
   * *agent* and the rows are services, so it cannot live on one of them without
   * being filed under whichever service happened to be first.
   */
  const lapsing = view.agents.filter((agent) => agent.lapses.length > 0);

  return (
    <section className="service-list">
      {/* One line, counted over the rows this page actually drew. Before the
          merge there were two summaries counting two different things about
          overlapping sets, which is the arithmetic version of the same defect
          the two lists were. */}
      <p className="page-summary wrap">{summariseServices(rows)}</p>

      {lapsing.map((agent) => (
        <div key={agent.name} className="connector-lapse">
          <p className="eyebrow">{agent.name}</p>
          <BrokerLapseNotice lapses={agent.lapses} />
        </div>
      ))}

      {rows.length === 0 ? (
        /*
         * Reachable only on a build whose catalogue is empty, which
         * `fleetCatalogue` cannot produce — it is a by-value list. The true
         * statement in that case is about this build rather than about the
         * person, so it says that rather than inviting them to connect
         * something DASH is not offering.
         */
        <p className="muted wrap">
          This version of DASH offers nothing to connect here.
        </p>
      ) : (
        <ul className="row-list">
          {rows.map((row) => (
            <li key={row.provider}>
              <ServiceRow
                row={row}
                canAct={canAct}
                fleetAct={async (action, provider) => {
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
                agentAct={(agent) => async (action, target) => {
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
      )}

      {view.older_agent_names.length > 0 ? (
        <p className="muted wrap">
          {view.older_agent_names.length === 1
            ? "1 agent here was added in an older format that cannot say what it needs to reach"
            : `${String(view.older_agent_names.length)} agents here were added in an older format that cannot say what they need to reach`}
          : {view.older_agent_names.join(", ")}. DASH does not guess.
        </p>
      ) : null}
    </section>
  );
}
