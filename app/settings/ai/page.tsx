"use client";

import { useState, type ReactNode } from "react";

import { describeKeysHeld } from "../../../lib/ai/model-choice";
import { FleetConnectorCard } from "../../_components/fleet-connector";
import { ModelDefault } from "../../_components/model-default";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { submitFleetCommand } from "../../_data/source";
import { useCanAct, useHost, useView } from "../../_data/use-view";
import type { ConnectionsView, FleetConnectorView } from "../../../lib/views/types";

/**
 * AI: the keys your agents think with, and the model they use (MAR-642).
 *
 * ## Why this is its own tab
 *
 * Connections held four cards and answered two questions. Three of them were
 * model-provider keys — OpenRouter, Anthropic, OpenAI — and the fourth was a
 * mailbox sign-in, and the two are asked at different times by people in
 * different states of mind. *What can my agents reach* is about a service you
 * already have an account with and a consent screen you are about to read.
 * *What do my agents think with* is about a key you may have to go and make, a
 * bill that will arrive, and a model whose name means nothing to most people.
 *
 * Splitting them is not tidying. It is what gives the second question a page
 * with room for the setting it had been missing entirely: **which model an
 * agent uses when nobody has told it.** That had no home because it belongs to
 * no agent, and the absence of a home is why it did not exist.
 *
 * ## Both tabs are drawn from one view
 *
 * `source.connections()`, filtered on `ai_provider_id`. A second view for a
 * second page would be two projections of one catalogue, free to disagree about
 * what is connected — and the fleet cards, the sharing sentence and the reach
 * list are all already right in the one that exists. What differs between the
 * tabs is which half of the list each draws and what it says above them.
 *
 * ## The keys are behind a + once you have one
 *
 * Three cards, each a paragraph of consequence, is the right shape for somebody
 * choosing a provider and the wrong one for somebody who chose months ago and
 * came here to change a model. So a key DASH holds is a card, a key it does not
 * is behind **Add a key**, and a DASH holding none opens with the picker
 * already showing — there is nothing to collapse, and the whole page is that
 * choice.
 */
export default function AiPage(): ReactNode {
  const [revision, setRevision] = useState(0);
  const state = useView((source) => source.connections(), revision);
  const host = useHost();
  const canAct = useCanAct();

  const bump = (): void => {
    setRevision((current) => current + 1);
  };

  return (
    <>
      {/* Not "AI", which is the word on the tab a person just pressed — the
          rule MAR-593 set for Connections and MAR-599 generalised. This says
          what is actually here: the keys, and the model they buy. */}
      <h1>Models and keys</h1>
      <HostNotice host={host} />

      {state.status === "loading" ? (
        <ViewLoading what="the models DASH can reach" />
      ) : state.status === "failed" ? (
        <ViewFailed recovery={state.recovery} />
      ) : (
        <AiSettings view={state.data} canAct={canAct} onChanged={bump} />
      )}
    </>
  );
}

/**
 * The tab's two sections, exported so a render test can drive them from a view
 * document without a data source.
 *
 * The shape `NotificationSettings` and `ConnectorList` established, for their
 * reason: a photograph proves a state was drawn once, and a render test proves
 * it is still drawn on every run.
 */
export function AiSettings({
  view,
  canAct,
  onChanged,
}: {
  view: ConnectionsView;
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const keys = view.fleet.filter((connector) => connector.ai_provider_id !== null);

  return (
    <>
      <ModelDefault setting={view.model_default} keys={keys} canAct={canAct} onChanged={onChanged} />
      <AiKeys connectors={keys} canAct={canAct} onChanged={onChanged} />
    </>
  );
}

/**
 * The keys, connected ones first and the rest behind a **+**.
 *
 * `showAll` starts null, meaning "whatever the state of things implies", and
 * becomes a boolean the moment somebody presses — the same shape
 * `app/settings/servers/page.tsx` uses for its wizard, and for its reason: the
 * page's own idea of what is worth showing must not fight the person's.
 */
export function AiKeys({
  connectors,
  canAct,
  onChanged,
}: {
  connectors: readonly FleetConnectorView[];
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const [showAll, setShowAll] = useState<boolean | null>(null);

  const held = connectors.filter((connector) => connector.held !== null);
  const rest = connectors.filter((connector) => connector.held === null);
  const expanded = showAll ?? held.length === 0;
  const drawn = expanded ? connectors : held;

  if (connectors.length === 0) {
    /*
     * Nothing at all rather than an empty state, `FleetConnectors`' call. It
     * cannot happen through `fleetCatalogue`, which is a by-value list with
     * three model providers in it, and if it ever did the true statement would
     * be that this build offers no model providers — not that the person has
     * nothing connected.
     */
    return null;
  }

  return (
    <section className="fleet-connectors" aria-labelledby="ai-keys">
      <h2 id="ai-keys">Your keys</h2>
      {/* Counted rather than asserted, over the cards this page actually drew,
          so the line cannot drift from what is under it. */}
      <p className="page-summary wrap">{describeKeysHeld(held.length, connectors.length)}</p>

      <ul className="row-list">
        {drawn.map((connector) => (
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

      {rest.length === 0 || expanded ? null : (
        <div className="button-row">
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setShowAll(true);
            }}
          >
            {/* The glyph is decoration and the words are the accessible name —
                a bare + is an icon with no legend, which is the one kind that
                never works. */}
            <span aria-hidden="true">+ </span>
            {rest.length === 1
              ? `Add a key for ${rest[0]?.service ?? "another service"}`
              : "Add a key"}
          </button>
        </div>
      )}
    </section>
  );
}
