"use client";

import Link from "next/link";
import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { describeCatalogueResult } from "../../lib/ai/model-choice";
import { DEFAULT_MODEL_LEVELS, levelLabel } from "../../lib/ai/model-levels";
import type { AgentModelSettingsView, ModelStepView } from "../../lib/views/types";
import { chooseAgentModel, listAgentModels, setAgentStepLevel } from "../_data/source";

/**
 * Which model this agent uses (MAR-583).
 *
 * ## The default is the answer, and the control exists to be ignored
 *
 * Henrik asked to be able to choose a model per agent, and *maybe* per step. The
 * order matters: one dropdown at the top, and the per-step levels folded away
 * behind a disclosure nobody has to open. A person who never touches either gets
 * every step running at the level its author declared for it, which is the
 * setting that is right for almost everybody — cheap models are enough for the
 * steps that pull facts out of text in front of them, and only the steps that
 * plan or write something new ask for more.
 *
 * That is why the recommended option is first in the list and named in words
 * rather than by a model, and why nothing on this section is required to make an
 * agent work.
 *
 * ## The list is asked for, not fetched
 *
 * A page that loaded a provider's catalogue on mount would contact a third party
 * every time somebody opened an agent — and this page polls every five seconds
 * while a run is going. So the models arrive when a person presses a button that
 * says what it will do, and they live in this component's state for as long as
 * the page is open. Nothing stores them: which models a key can reach is the
 * provider's content, and `lib/db.ts` refuses to keep a table of it.
 *
 * The consequence is visible rather than hidden — before the list is asked for,
 * the dropdown holds the recommended option and whatever model is already
 * chosen, and the button below says where the rest would come from.
 *
 * ## Every sentence comes from the trusted side
 *
 * This component words almost nothing. The headline, the detail, the in-force
 * sentence, each level's name and each level's meaning are composed in
 * `lib/ai/model-choice.ts` and `lib/ai/model-levels.ts`, so the plain-language
 * gate holds over the strings a person can reach here and a page cannot describe
 * a setting differently from the process that resolved it.
 */
export function ModelChoice({
  agent,
  settings,
  canAct,
  onChanged,
  setFeedback,
}: {
  agent: string;
  settings: AgentModelSettingsView;
  canAct: boolean;
  /** Re-read the workspace, so the page redraws with the setting it just saved. */
  onChanged: () => void;
  setFeedback: Dispatch<SetStateAction<{ ok: boolean; message: string } | null>>;
}): ReactNode {
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  /*
   * Nothing at all for an agent with no model in its plan and no levels to show.
   *
   * `FolderUpdate` makes the same call for the same reason: a notice explaining
   * an absence would be DASH describing its own internals at somebody who came
   * to look at their agent. Every other `can_choose: false` case does draw,
   * because each of those is a fact about this agent worth knowing.
   */
  if (!settings.can_choose && settings.reason === "no_model_needed") {
    return null;
  }

  async function ask(): Promise<void> {
    if (!settings.can_choose) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await listAgentModels({
      agent_id: agent,
      connection_id: settings.connection_id,
      field_id: settings.field_id,
    });
    setBusy(false);
    if (!result.ok) {
      // The list is left as it was rather than emptied. A provider that could
      // not be reached says nothing about the models it offered a minute ago,
      // and clearing the dropdown would take a working choice off the screen on
      // the strength of a failed request — `lib/ai/liveness.ts`'s own rule about
      // not rounding "could not ask" into a verdict.
      setFeedback({
        ok: false,
        message: result.detail ?? "DASH could not ask which models are available.",
      });
      return;
    }
    setModels(result.models ?? []);
    setFeedback({ ok: true, message: result.detail ?? "" });
  }

  async function choose(modelId: string): Promise<void> {
    if (!settings.can_choose) {
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await chooseAgentModel({
      agent_id: agent,
      connection_id: settings.connection_id,
      field_id: settings.field_id,
      // The empty value is the recommended option, and it is turned into an
      // absent field here rather than travelling as a magic string main would
      // have to recognise. See the preload's own note.
      model_id: modelId === "" ? undefined : modelId,
    });
    setBusy(false);
    setFeedback({ ok: result.ok, message: result.detail ?? "" });
    if (result.ok) {
      onChanged();
    }
  }

  async function setLevel(step: number, level: string): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await setAgentStepLevel({
      agent_id: agent,
      step,
      level: level === "" ? undefined : level,
    });
    setBusy(false);
    setFeedback({ ok: result.ok, message: result.detail ?? "" });
    if (result.ok) {
      onChanged();
    }
  }

  return (
    <section className="section model-choice" aria-labelledby="model-choice">
      {/* MAR-609. An `h3`, because this panel now renders inside the agent
          page's Settings drawer, whose own heading is the `h2` and whose other
          blocks — the trigger switcher, notifications, removal — are `h3`s
          beside this one. As an `h2` it outranked its own container: the first
          capture of the drawer shows this headline set larger than the section
          headings above it, which is a broken hierarchy for a screen reader as
          well as an odd-looking page. This component renders on the agent page
          and nowhere else, so the level is not shared with another surface. */}
      <h3 id="model-choice">{settings.headline}</h3>
      <p className="muted wrap">{settings.detail}</p>

      {settings.can_choose ? (
        <>
          <p className="model-in-force wrap">{settings.in_force}</p>
          {canAct ? (
            <ModelPicker
              chosen={settings.chosen_model_id}
              unpinned={settings.unpinned_option}
              models={models}
              provider={settings.provider_label}
              busy={busy}
              onChoose={(id) => void choose(id)}
              onAsk={() => void ask()}
            />
          ) : (
            /*
             * Said rather than drawn disabled, `FolderUpdate`'s reason: a greyed
             * control here would read as a claim about the agent, and the true
             * statement is about which window this is.
             */
            <p className="muted wrap">
              Open the installed DASH app to change which model this agent uses.
            </p>
          )}
        </>
      ) : settings.next_action === null ? null : (
        <p className="model-next wrap">{settings.next_action}</p>
      )}

      <ModelSteps
        steps={settings.steps}
        canAct={canAct && settings.can_choose}
        inForce={!settings.can_choose || settings.steps_in_force}
        note={settings.can_choose ? settings.steps_note : null}
        linkLabel={settings.can_choose ? settings.steps_link_label : null}
        busy={busy}
        onSetLevel={(step, level) => void setLevel(step, level)}
      />
    </section>
  );
}

/**
 * The one dropdown, with the recommended answer first.
 *
 * Two groups rather than one flat list, because the two kinds of option answer
 * different questions. The first is "let the plan decide", which is a policy; the
 * rest are model names, which are choices. A flat list would put a sentence and
 * three hundred identifiers in the same column and make the sentence look like
 * one of them.
 *
 * A model already chosen is always in the list even before anything has been
 * asked for — otherwise a `select` whose value matches no option would silently
 * show the first one, and a person would see the recommended setting on an agent
 * that is not on it.
 */
function ModelPicker({
  chosen,
  unpinned,
  models,
  provider,
  busy,
  onChoose,
  onAsk,
}: {
  chosen: string | null;
  /**
   * What leaving this alone gives you, worded by the view (MAR-642).
   *
   * A prop rather than the literal it used to be, because the answer changed:
   * with DASH's default set, the first option means "use the default", and an
   * option that went on promising per-step matching would describe a state this
   * agent is not in. The sentence is `describeUnpinnedOption`'s.
   */
  unpinned: string;
  models: string[] | null;
  provider: string;
  busy: boolean;
  onChoose: (modelId: string) => void;
  onAsk: () => void;
}): ReactNode {
  const listed = models ?? [];
  const options = chosen !== null && !listed.includes(chosen) ? [chosen, ...listed] : listed;

  return (
    <div className="model-picker">
      {/* `field-label` and `field` rather than a pair of new classes: DASH
          already has one look for a labelled control, and a second one invented
          here would be the first place the form vocabulary started to split. */}
      <label className="field-label" htmlFor="model-picker-select">
        Model
      </label>
      <select
        id="model-picker-select"
        className="field"
        value={chosen ?? ""}
        disabled={busy}
        onChange={(event) => {
          onChoose(event.target.value);
        }}
      >
        <optgroup label="Recommended">
          <option value="">{unpinned}</option>
        </optgroup>
        {options.length === 0 ? null : (
          <optgroup label="One model for everything">
            {options.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <div className="model-picker-ask">
        <button type="button" className="button-secondary" disabled={busy} onClick={onAsk}>
          {models === null ? `See what ${provider} offers` : `Ask ${provider} again`}
        </button>
        <p className="muted wrap">
          {/* MAR-742. One wording, three pickers — see
              `describeCatalogueResult` for the renderer that did not have it,
              and what its silence cost. The count is `options` rather than
              `models` because this picker prepends the model already in force
              when a provider did not name it, and the sentence must count what
              the dropdown actually offers. */}
          {describeCatalogueResult(provider, models === null ? null : options)}
        </p>
      </div>
    </div>
  );
}

/**
 * What each step asks for, folded away.
 *
 * Behind a `details` because it is the second question, and because an agent
 * with eight steps would otherwise put eight dropdowns above everything else on
 * the page. It is drawn even when a named model has set it aside — see
 * `buildAgentModelSettings` for why hiding a setting that still exists is worse
 * than showing it as inactive.
 */
function ModelSteps({
  steps,
  canAct,
  inForce,
  note,
  linkLabel,
  busy,
  onSetLevel,
}: {
  steps: readonly ModelStepView[];
  canAct: boolean;
  inForce: boolean;
  note: string | null;
  /**
   * Where a level becomes a model, in words (MAR-654, A1.6).
   *
   * Null on the arm where there is nothing to choose. The link it labels is the
   * answer to *unfindable is the same as missing*: the map lives on the AI tab,
   * one place for the whole fleet, and every step whose model comes from it says
   * where that is rather than leaving somebody to find a setting they have never
   * seen.
   */
  linkLabel: string | null;
  busy: boolean;
  onSetLevel: (step: number, level: string) => void;
}): ReactNode {
  if (steps.length === 0) {
    return null;
  }

  return (
    <details className="model-steps">
      <summary>
        {steps.length === 1
          ? "What the one step that needs a model asks for"
          : `What each of the ${String(steps.length)} steps that need a model asks for`}
      </summary>

      {note === null ? null : <p className="muted wrap">{note}</p>}
      {linkLabel === null || !inForce ? null : (
        <p className="model-steps-link">
          <Link href="/settings/ai">{linkLabel}</Link>
        </p>
      )}

      <ul className="row-list model-step-list">
        {steps.map((step) => (
          <li key={step.step} className="model-step">
            <div className="model-step-head">
              <span className="model-step-number">Step {step.step}</span>
              {step.overridden ? <span className="chip">You changed this</span> : null}
            </div>
            <p className="muted wrap">{step.meaning}</p>
            {/*
              MAR-654, A1.6. What this step's level resolves to right now, with
              which rung answered said in words.

              Under the meaning rather than above it, because the order is the
              question then the answer: the plan says how hard this step is, and
              this says what that currently buys. The sentence is
              `describeStepModel`'s — a page that worded it here could describe a
              resolution differently from the process that performs it.
            */}
            {step.resolved_note === null ? null : (
              <p className="model-step-resolved wrap">{step.resolved_note}</p>
            )}
            {canAct ? (
              <>
                <label className="field-label" htmlFor={`model-step-${String(step.step)}`}>
                  Strength
                </label>
                <select
                  id={`model-step-${String(step.step)}`}
                  className="field"
                  value={step.overridden ? step.level : ""}
                  disabled={busy || !inForce}
                  onChange={(event) => {
                    onSetLevel(step.step, event.target.value);
                  }}
                >
                  <option value="">{`What the plan asked for — ${step.declared_label.toLowerCase()}`}</option>
                  {DEFAULT_MODEL_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {levelLabel(level)}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="model-step-static">{step.label}</p>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
