"use client";

import { useState, type ReactNode } from "react";

import { listProviderModels, setDefaultModel } from "../_data/source";
import type { FleetConnectorView, FleetModelDefaultView } from "../../lib/views/types";

/**
 * The model DASH gives an agent that has not been given one (MAR-642).
 *
 * ## The setting that did not exist
 *
 * Model was per agent per step and there was no fleet-wide answer, so a person
 * who had just pasted a key and imported an agent had a third step nobody told
 * them about: open that agent, find the picker, ask the provider what it offers,
 * choose. Until they did, the agent's chat refused — `describeUnavailable`'s
 * `no_model_chosen` — and its brokered steps were refused for the same reason.
 * One control here answers it for every agent that arrives afterwards.
 *
 * ## What it is not allowed to do
 *
 * **Change an agent that has chosen.** Henrik's 2026-08-15 ruling, and it is
 * kept by `applyFleetDefault` rather than by this component: the default is read
 * only where an agent's own row is absent. Nothing on this page writes to an
 * agent, and the command behind it — `model.default` — has no field an agent id
 * could travel in.
 *
 * ## The list is asked for, not fetched
 *
 * `ModelChoice`'s rule, for its reason: a page that loaded a provider's
 * catalogue on mount would contact a third party every time somebody opened
 * Settings. So the models arrive when a person presses a button that says what
 * it will do, they live in this component's state, and nothing stores them.
 *
 * ## Every sentence comes from the trusted side
 *
 * The headline, the detail and the in-force line are composed in
 * `lib/ai/model-choice.ts` and arrive on the view already worded, so the plain
 * language gate holds over them and this page cannot describe the setting
 * differently from the process that resolves it.
 */
export function ModelDefault({
  setting,
  keys,
  canAct,
  onChanged,
}: {
  setting: FleetModelDefaultView;
  /** The key connectors on this tab, in the order the page drew them. */
  keys: readonly FleetConnectorView[];
  canAct: boolean;
  onChanged: () => void;
}): ReactNode {
  const held = keys.filter((connector) => connector.held !== null);
  /**
   * Which provider the person is picking a model from.
   *
   * The stored default's provider, or the first key DASH holds. Held in state
   * rather than read off the view on every render because it changes on a
   * dropdown a person is using, and the view only changes when a command lands.
   */
  const [provider, setProvider] = useState<string>(
    setting.provider_id ?? held[0]?.ai_provider_id ?? "",
  );
  /** What the provider named, for as long as this page is open. Never stored. */
  const [models, setModels] = useState<string[] | null>(null);
  /** Which provider the list above came from, so switching provider drops it. */
  const [listedFor, setListedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; detail: string } | null>(null);

  const chosen = keys.find((connector) => connector.ai_provider_id === provider) ?? null;
  const listed = listedFor === provider ? (models ?? []) : null;

  async function ask(): Promise<void> {
    if (chosen === null) {
      return;
    }
    setBusy(true);
    setOutcome(null);
    const result = await listProviderModels({ provider_id: provider });
    setBusy(false);
    if (!result.ok) {
      // The list is left as it was rather than emptied — `ModelChoice`'s rule: a
      // provider that could not be reached says nothing about what it offered a
      // minute ago, and clearing the dropdown would take a working choice off
      // the screen on the strength of a failed request.
      setOutcome({
        ok: false,
        detail: result.detail ?? "DASH could not ask which models are available.",
      });
      return;
    }
    setModels(result.models ?? []);
    setListedFor(provider);
    setOutcome({ ok: true, detail: result.detail ?? "" });
  }

  async function choose(modelId: string): Promise<void> {
    setBusy(true);
    setOutcome(null);
    // The empty value is "no default", and it becomes an absent field rather
    // than a magic string main would have to recognise — the shape
    // `chooseAgentModel` uses one level down.
    const result =
      modelId === ""
        ? await setDefaultModel()
        : await setDefaultModel({ provider_id: provider, model_id: modelId });
    setBusy(false);
    setOutcome({ ok: result.ok, detail: result.detail ?? "" });
    if (result.ok) {
      onChanged();
    }
  }

  return (
    <section className="section model-default" aria-labelledby="model-default">
      <h2 id="model-default">{setting.headline}</h2>
      <p className="muted wrap">{setting.detail}</p>
      <p className="model-in-force wrap">{setting.in_force}</p>

      {held.length === 0 ? (
        /*
         * No control at all until a key is held, and no disabled one either.
         * There is nothing to list, nothing to choose between, and a greyed-out
         * dropdown would read as a claim about the providers rather than about
         * what DASH is holding. The in-force sentence above already says what to
         * do, and the thing to do is directly below this section.
         */
        null
      ) : !canAct ? (
        /*
         * Said rather than drawn disabled, `ModelChoice`'s reason: a greyed
         * control here would read as a claim about the setting, and the true
         * statement is about which window this is.
         */
        <p className="muted wrap">
          Open the installed DASH app to change the model new agents use.
        </p>
      ) : (
        <div className="model-picker">
          {held.length > 1 ? (
            <>
              <label className="field-label" htmlFor="model-default-provider">
                Service
              </label>
              <select
                id="model-default-provider"
                className="field"
                value={provider}
                disabled={busy}
                onChange={(event) => {
                  setProvider(event.target.value);
                  // The catalogue belonged to the other provider. Dropped rather
                  // than kept, because a list of OpenRouter names under a label
                  // saying Anthropic is the worst of both.
                  setOutcome(null);
                }}
              >
                {held.map((connector) => (
                  <option key={connector.provider} value={connector.ai_provider_id ?? ""}>
                    {connector.service}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <label className="field-label" htmlFor="model-default-select">
            Model
          </label>
          <select
            id="model-default-select"
            className="field"
            /*
             * The stored model only while the stored provider is the one on
             * screen. Somebody who switched the service dropdown is choosing a
             * new default, and showing the old provider's model as selected
             * under the new service would be a control claiming a setting that
             * does not exist.
             */
            value={setting.provider_id === provider ? (setting.model_id ?? "") : ""}
            disabled={busy}
            onChange={(event) => {
              void choose(event.target.value);
            }}
          >
            <option value="">No default — each step at the strength its plan asks for</option>
            {/*
              A model already set is always in the list even before anything has
              been asked for, `ModelPicker`'s rule: a `select` whose value
              matches no option silently shows the first one, and a person would
              see "no default" on a DASH that has one.
            */}
            {optionsFor(listed, setting.provider_id === provider ? setting.model_id : null).map(
              (id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ),
            )}
          </select>

          <div className="model-picker-ask">
            <button type="button" className="button-secondary" disabled={busy} onClick={() => void ask()}>
              {listed === null
                ? `See what ${chosen?.service ?? "this service"} offers`
                : `Ask ${chosen?.service ?? "this service"} again`}
            </button>
            <p className="muted wrap">
              {listed === null
                ? `DASH will present the key it holds to ${chosen?.service ?? "this service"} and list what that key can reach. It keeps no copy of the list.`
                : listed.length === 0
                  ? `${chosen?.service ?? "This service"} answered, and named nothing this key can reach.`
                  : `${String(listed.length)} to choose from, as ${chosen?.service ?? "this service"} answered a moment ago. DASH keeps no copy of the list.`}
            </p>
          </div>

          {outcome === null ? null : (
            <p className={outcome.ok ? "notice-ok" : "notice-warn"} role="status">
              {outcome.detail}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** The catalogue, with whatever is already set kept in it. */
function optionsFor(listed: readonly string[] | null, current: string | null): string[] {
  const models = listed ?? [];
  return current !== null && !models.includes(current) ? [current, ...models] : [...models];
}
