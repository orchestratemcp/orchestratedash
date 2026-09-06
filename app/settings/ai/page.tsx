"use client";

import { useEffect, useState, type ReactNode } from "react";

import { describeKeysHeld } from "../../../lib/ai/model-choice";
import {
  AI_ADVANCED_SUMMARY,
  AI_CHANGE_LABEL,
  AI_FIRST_KEY_DETAIL,
  AI_FIRST_KEY_HEADLINE,
  AI_FIRST_KEY_LABEL,
  AI_TROUBLESHOOT_SUMMARY,
  describeAiTrouble,
  describeAiWaiting,
} from "../../../lib/copy/settings-ai";
import { ConnectionsRefresh } from "../../_components/connections-refresh";
import { FleetConnectorCard, type FleetAct } from "../../_components/fleet-connector";
import { ModelDefault } from "../../_components/model-default";
import { HostNotice, ViewFailed, ViewLoading } from "../../_components/view-state";
import { submitFleetCommand } from "../../_data/source";
import { useCanAct, useHost, useView } from "../../_data/use-view";
import type { ConnectionsView, FleetConnectorView } from "../../../lib/views/types";

/**
 * AI: the keys your agents think with, and the model they use (MAR-642,
 * rearranged by MAR-877).
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
 * ## What MAR-877 changed, and what it did not
 *
 * **Not a sentence.** Every word on this tab is still composed in
 * `lib/ai/model-choice.ts`, `lib/copy/fleet-standing.ts` and `lib/ai/refresh.ts`
 * and arrives already worded. What changed is the order a person meets them in,
 * and it is now two orders rather than one:
 *
 * - **No key.** One question — which provider — and the card for the one they
 *   picked. Nothing about routing, defaults or repair is drawn: there is
 *   nothing yet to route, default or repair, and the page used to open with
 *   recovery prose above a setup it had not offered.
 * - **A key.** One line saying what is in force, then two folds: *Advanced
 *   routing* over the level rows and the key cards, *Troubleshoot* over the
 *   refresh control. Each fold opens itself when there is a reason to — no
 *   default chosen, an agent waiting for a key DASH already holds, a key DASH
 *   cannot read — so nothing a person has to do is ever behind a shut fold.
 *
 * ## The refresh control still lives beside the loading gate
 *
 * MAR-685, and MAR-877 does not get to move it. `useView` returns to `loading`
 * on every `bump`, so everything under that gate unmounts while the view
 * reloads — and the report `ConnectionsRefresh` produces is held in its own
 * state. Mounted under the gate, a refresh would destroy its own answer: a page
 * telling somebody nothing happened to their credentials, and then telling them
 * nothing at all.
 *
 * So the *Troubleshoot* fold is a sibling of the gate rather than a section of
 * `AiSettings`, and it is mounted from the first moment this page has seen a
 * key — see `everHeld` below for why that is sticky rather than read fresh.
 */
export default function AiPage(): ReactNode {
  const [revision, setRevision] = useState(0);
  const state = useView((source) => source.connections(), revision);
  const host = useHost();
  const canAct = useCanAct();

  const bump = (): void => {
    setRevision((current) => current + 1);
  };

  const ready = state.status === "ready" ? state.data : null;
  const held = ready === null ? [] : heldAiKeys(ready);
  const trouble = held.filter((connector) => connector.held?.unreadable != null).length;

  /*
   * Whether this page has ever seen a key, kept rather than read.
   *
   * The fold below holds `ConnectionsRefresh`, whose report must survive the
   * `bump` that unmounts everything under the gate. A fold rendered from
   * `held.length > 0` would satisfy "no recovery prose until there is something
   * to recover" and then unmount itself on every reload, which is MAR-685
   * again wearing a disclosure. A DASH that has never held a key never draws
   * it, a DASH that holds one draws it from then on, and neither state
   * flickers.
   */
  const [everHeld, setEverHeld] = useState(false);
  const heldCount = held.length;
  useEffect(() => {
    if (heldCount > 0) {
      setEverHeld(true);
    }
  }, [heldCount]);

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

      {everHeld ? (
        <TroubleshootFold trouble={trouble} canAct={canAct} onRefreshed={bump} />
      ) : null}
    </>
  );
}

/** The model-provider halves of the catalogue, in the order the view holds them. */
export function aiKeys(view: ConnectionsView): FleetConnectorView[] {
  return view.fleet.filter((connector) => connector.ai_provider_id !== null);
}

/** The ones DASH actually holds a credential for. */
export function heldAiKeys(view: ConnectionsView): FleetConnectorView[] {
  return aiKeys(view).filter((connector) => connector.held !== null);
}

/**
 * The command every card on this tab sends, built once.
 *
 * One function rather than one per section, so the two places a key can be
 * connected from cannot drift into sending two different shapes of the same
 * command.
 */
function fleetActFor(onChanged: () => void): FleetAct {
  return async (action, provider) => {
    const result = await submitFleetCommand(action, { provider });
    if (result.ok) {
      onChanged();
    }
    return { ok: result.ok, detail: result.detail, recovery: result.recovery };
  };
}

/**
 * The tab's body, exported so a render test can drive it from a view document
 * without a data source.
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
  const keys = aiKeys(view);
  const held = keys.filter((connector) => connector.held !== null);

  if (held.length === 0) {
    /*
     * One question, asked once. Three cards each carrying a paragraph of
     * consequence is the right shape for comparing providers and the wrong one
     * for a person who has not yet been told they need a provider at all — and
     * `describeLevelModels` is explicit that DASH ranks none of them, so the
     * page has nothing to add to the comparison it was staging.
     */
    return <AiFirstKey connectors={keys} canAct={canAct} onChanged={onChanged} />;
  }

  return <ModelRouting view={view} keys={keys} canAct={canAct} onChanged={onChanged} />;
}

/**
 * A DASH with no model key: pick a service, then read that service's card
 * (MAR-877).
 *
 * The card is `FleetConnectorCard` unchanged, so every sentence a person needs
 * before handing over a key — what it is for, what DASH will be able to do, the
 * permission that is wider than that, where to get one — is still the card's
 * own and still above its own button. What this adds is that they read one set
 * of them rather than three stacked.
 *
 * The chooser is a `select` rather than three buttons because it is not a
 * decision DASH is qualified to help with: a row of buttons implies a
 * recommended one, and there is none.
 */
export function AiFirstKey({
  connectors,
  canAct,
  onChanged,
}: {
  connectors: readonly FleetConnectorView[];
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const [provider, setProvider] = useState<string>(connectors[0]?.provider ?? "");

  if (connectors.length === 0) {
    /*
     * Nothing at all rather than an empty state, `FleetConnectors`' call. It
     * cannot happen through `fleetCatalogue`, which is a by-value list with
     * three model providers in it, and if it ever did the true statement would
     * be about this build rather than about the person.
     */
    return null;
  }

  const chosen =
    connectors.find((connector) => connector.provider === provider) ??
    (connectors[0] as FleetConnectorView);

  return (
    <section className="section ai-first-key" aria-labelledby="ai-first-key">
      <h2 id="ai-first-key">{AI_FIRST_KEY_HEADLINE}</h2>
      <p className="muted wrap">{AI_FIRST_KEY_DETAIL}</p>

      {connectors.length > 1 ? (
        <>
          <label className="field-label" htmlFor="ai-first-key-provider">
            {AI_FIRST_KEY_LABEL}
          </label>
          <select
            id="ai-first-key-provider"
            className="field"
            value={chosen.provider}
            onChange={(event) => {
              setProvider(event.target.value);
            }}
          >
            {connectors.map((connector) => (
              <option key={connector.provider} value={connector.provider}>
                {connector.service}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <FleetConnectorCard connector={chosen} canAct={canAct} act={fleetActFor(onChanged)} />
    </section>
  );
}

/**
 * A DASH that holds a key: what is in force, and two folds (MAR-877).
 *
 * ## What is above the fold, and why exactly this
 *
 * `setting.in_force` — the one sentence naming the model and the key it is
 * bought through, composed by `describeFleetDefault` and unchanged. Beside it,
 * only the two facts that are somebody's move rather than DASH's state: an
 * agent waiting to be given a key, and a key DASH cannot read. Both point at a
 * fold, and both open the fold they point at, so neither is a notice with
 * nowhere to go.
 *
 * ## Why *Advanced routing* opens itself
 *
 * Two reasons, and they are the two states where the fold would be hiding work.
 * With no default chosen, the picker under it is the whole reason the person is
 * here. With an agent waiting, the button under it is ADR 0013's third moment —
 * the deliberate press that gives an agent imported after a connect the consent
 * DASH already holds — and MAR-874 and MAR-878 both depend on it being
 * findable. It is *the same button on the same card*: this opens the fold
 * rather than drawing a second one, because two controls doing one thing is how
 * a page comes to disagree with itself about whether it was pressed.
 */
function ModelRouting({
  view,
  keys,
  canAct,
  onChanged,
}: {
  view: ConnectionsView;
  keys: readonly FleetConnectorView[];
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const setting = view.model_default;
  const waiting = keys.reduce((total, connector) => total + connector.waiting.length, 0);
  const trouble = keys.filter((connector) => connector.held?.unreadable != null).length;

  /*
   * Null until somebody presses, then a boolean — the shape `AiKeys` below and
   * `app/settings/servers/page.tsx` both use, for its reason: the page's own
   * idea of what is worth showing must not fight the person's.
   */
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? (waiting > 0 || setting.model_id === null);

  return (
    <>
      <section className="section model-standing" aria-labelledby="model-standing">
        <h2 id="model-standing">{setting.headline}</h2>
        <p className="model-in-force wrap">{setting.in_force}</p>

        {waiting === 0 ? null : <p className="wrap">{describeAiWaiting(waiting)}</p>}
        {trouble === 0 ? null : (
          <p className="notice-warn wrap" role="note">
            {describeAiTrouble(trouble)}
          </p>
        )}

        {expanded ? null : (
          <div className="button-row">
            <button
              type="button"
              className="button-secondary"
              onClick={() => {
                setOpen(true);
              }}
            >
              {AI_CHANGE_LABEL}
            </button>
          </div>
        )}
      </section>

      <details
        className="card-more section-disclosure"
        open={expanded}
        onToggle={(event) => {
          setOpen(event.currentTarget.open);
        }}
      >
        <summary>{AI_ADVANCED_SUMMARY}</summary>
        <ModelDefault
          setting={setting}
          levels={view.level_models}
          keys={keys}
          canAct={canAct}
          onChanged={onChanged}
          standing={false}
        />
        <AiKeys connectors={keys} canAct={canAct} onChanged={onChanged} />
      </details>
    </>
  );
}

/**
 * The repair control, folded (MAR-877, MAR-742's control unchanged).
 *
 * Closed unless there is a key DASH cannot read, in which case the fold opens
 * and says so — because a disclosure labelled *Troubleshoot* with nothing
 * beside it gives a person in trouble no reason to press it.
 *
 * The `open` state is the same null-until-pressed shape as *Advanced routing*,
 * so a person who folds it shut while a key is still unreadable keeps it shut.
 */
function TroubleshootFold({
  trouble,
  canAct,
  onRefreshed,
}: {
  trouble: number;
  canAct: boolean;
  onRefreshed: () => void;
}): ReactNode {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? trouble > 0;

  return (
    <details
      className="card-more section-disclosure"
      open={expanded}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>{AI_TROUBLESHOOT_SUMMARY}</summary>
      {trouble === 0 ? null : (
        <p className="notice-warn wrap" role="note">
          {describeAiTrouble(trouble)}
        </p>
      )}
      <ConnectionsRefresh canAct={canAct} onRefreshed={onRefreshed} />
    </details>
  );
}

/**
 * The keys, connected ones first and the rest behind a **+**.
 *
 * `showAll` starts null, meaning "whatever the state of things implies", and
 * becomes a boolean the moment somebody presses — the same shape
 * `app/settings/servers/page.tsx` uses for its wizard, and for its reason: the
 * page's own idea of what is worth showing must not fight the person's.
 *
 * MAR-877 leaves this component alone and changes where it is drawn: under
 * *Advanced routing*, and only on a DASH that already holds a key. A DASH
 * holding none meets `AiFirstKey` instead, which asks the same question once.
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
              act={fleetActFor(onChanged)}
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
