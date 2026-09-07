"use client";

import Link from "next/link";
import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import { describeCatalogueResult } from "../../lib/ai/model-choice";
import { DEFAULT_MODEL_LEVELS, levelLabel } from "../../lib/ai/model-levels";
import { AGENT_SETTINGS_COPY } from "../../lib/copy/agent-page";
import type { AgentModelSettingsView, ModelStepView } from "../../lib/views/types";
import {
  chooseAgentModel,
  listAgentModels,
  setAgentStepLevel,
  submitConnectionCommand,
} from "../_data/source";
import { WhyDisclosure } from "./agent-settings";

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
   * MAR-874. The picker opens on a press rather than standing open.
   *
   * The rule this stage now follows is one state sentence and one action per
   * section, and for an agent that already has a model the state is
   * `in_force` — *Using your default, …* — while the action is *Change*. A
   * dropdown standing open under a setting almost nobody should touch was the
   * shape that made this section three controls tall before anybody had decided
   * to change anything.
   *
   * Component state and not remembered: like every disclosure on this stage,
   * the section looks the same on every visit.
   */
  const [changing, setChanging] = useState(false);

  /*
   * MAR-874. The adoptable press, normalised once.
   *
   * `AgentModelSettingsView.adopt` is optional and absent means the same as
   * null — see its own note. Read here rather than at each of the three places
   * below that ask about it, so the two spellings of "there is nothing to
   * adopt" cannot come apart between the arm that draws the button and the arm
   * that decides whether to draw the Why? beside it.
   */
  const adoptable = settings.can_choose ? null : (settings.adopt ?? null);

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

  /**
   * The adoption press (MAR-874, ADR 0013 moment 2).
   *
   * ## What it is, and what it deliberately is not
   *
   * It is **the connect that was already on this agent's own connection row**,
   * aimed from the place a person actually asks the question. `performConnectionAction`
   * routes a `connect` on an agent's row through `adoptFleetCredential` before
   * anything else, so a fleet connection for that provider is reused rather than
   * a second consent screen being opened — and the record of the decision is
   * filed there, beside the write, as it always was.
   *
   * It is **not** a new power and not a wider grant. Nothing here reads a
   * credential, nothing widens `resolveKeyGrant`, and no fleet key is bypassed:
   * if `materialize` produces no record for this agent the adoption undoes its
   * own grant row and the ordinary flow runs, which is main's business and not
   * this button's. The button reports whatever came back rather than predicting
   * it — `settings.adopt` says a press is *worth offering*, never that it will
   * succeed.
   */
  async function adopt(target: { connection_id: string; field_id: string }): Promise<void> {
    setBusy(true);
    setFeedback(null);
    const result = await submitConnectionCommand("connect", {
      agent_id: agent,
      connection_id: target.connection_id,
      field_id: target.field_id,
    });
    setBusy(false);
    setFeedback({
      ok: result.ok,
      message: result.detail ?? (result.ok ? "" : "DASH could not connect this agent's key."),
    });
    if (result.ok) {
      // The whole section is decided by `buildAgentModelSettings`, so the row
      // becomes the ordinary "talks with your default" state on the re-read
      // rather than on a second local guess about what the press did.
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
      <h3 id="model-choice">{AGENT_SETTINGS_COPY.model.heading}</h3>

      {/*
        MAR-874, widened by MAR-885. Four states, one line each, and at most
        one press.

        The section used to open with whichever headline
        `lib/ai/model-choice.ts` had composed, follow it with a paragraph of
        detail, a second sentence about what is in force, a standing dropdown
        and a button that contacts a provider — all before anybody had decided
        to change anything. What a person opening this stage wants from it is
        one line: *which model does this talk with*. The four arms below each
        answer that in a sentence and offer the one thing there is to do.

        - **Waiting for your key.** `settings.adopt` — the agent declares a
          provider, holds no key, and DASH already holds a fleet key for that
          same provider. One button, and it asks for nothing.
        - **Talks with your default.** `in_force`, plus *Change*, which opens
          today's picker.
        - **Needs a provider.** The view's own headline and its next action,
          which is a link rather than a button, because the step is on another
          page.
        - **Cannot talk**, and **no model needed** — the view's headline, with
          no action for either reason `describeNoChoice` itself offers
          (`next_action` is null for both). The "cannot talk" words are
          `describeNoChoice`'s and stay that way deliberately: they say the
          agent either arranges its own model or names a service DASH cannot
          ask, *because the manifest does not distinguish those two* — and a
          sentence here asserting the agent was built without a model would be
          this stage guessing at exactly the thing that module refuses to
          guess.

          `no_model_needed` used to draw nothing here at all — see the
          removed early return this comment used to sit above. That made a
          plan with no model step the one agent in a fleet with no model row,
          which read as this section being broken rather than as an honest
          "nothing to choose". It still offers no control *about this agent*,
          because there genuinely is none; what it offers instead is the one
          action anywhere near this sentence — building a different agent
          that can be asked something, on Add agent's assistant path
          (MAR-879). That is not a fix for this agent and the link says so by
          where it goes rather than by claiming otherwise.
      */}
      {adoptable !== null ? (
        <ModelAdoption
          adopt={adoptable}
          busy={busy}
          canAct={canAct}
          detail={settings.detail}
          onAdopt={(target) => void adopt(target)}
        />
      ) : settings.can_choose ? (
        <>
          <p className="settings-state model-in-force wrap">{settings.in_force}</p>
          {canAct ? (
            changing ? (
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
              <div className="button-row">
                <button
                  type="button"
                  className="button-secondary"
                  disabled={busy}
                  onClick={() => {
                    setChanging(true);
                  }}
                >
                  {AGENT_SETTINGS_COPY.model.change}
                </button>
              </div>
            )
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
      ) : (
        <>
          <p className="settings-state wrap">{settings.headline}</p>
          {settings.next_action === null ? null : (
            <p className="model-next wrap">{settings.next_action}</p>
          )}
          {/*
            MAR-885. The one door near a plan that needs no model at all: not a
            fix for this agent (there is nothing wrong with it), and not drawn
            for either of the other two no-choice reasons, which already carry
            their own `next_action` or, for "cannot talk", genuinely have none.
          */}
          {settings.reason === "no_model_needed" ? (
            <p className="model-next wrap">
              <Link href="/settings/add-agent?path=assistant">
                {AGENT_SETTINGS_COPY.model.build_with_assistant}
              </Link>
            </p>
          ) : null}
        </>
      )}

      {/* The rest, behind the one word (MAR-874). `detail` is the trusted
          side's explanation of the state above, and the per-step levels are the
          second question this component's own header says nobody has to open.
          The adoptable arm draws its own Why? inside `ModelAdoption`, because
          its explanation is about the press rather than about the steps. */}
      {adoptable !== null ? null : (
        <WhyDisclosure>
          <p className="muted wrap">{settings.detail}</p>
          <ModelSteps
            steps={settings.steps}
            canAct={canAct && settings.can_choose}
            inForce={!settings.can_choose || settings.steps_in_force}
            note={settings.can_choose ? settings.steps_note : null}
            linkLabel={settings.can_choose ? settings.steps_link_label : null}
            busy={busy}
            onSetLevel={(step, level) => void setLevel(step, level)}
          />
        </WhyDisclosure>
      )}
    </section>
  );
}

/**
 * The one state on this row that has a press and costs nothing (MAR-874,
 * ADR 0013 moment 2).
 *
 * ## The journey this exists for
 *
 * A person builds an agent with the assistant. It declares `model_provider`,
 * because every plugin-built agent does now. They already gave DASH an
 * OpenRouter key months ago, for their other agents. They open the new agent,
 * ask it something, and are told it has no model — and the way to fix that was
 * to find the Connections page, find this agent's row on it, and press Connect
 * there.
 *
 * That press is unchanged and is still the one that runs. What is new is that
 * it is offered *here*, where the question is asked. Unfindable is the same as
 * missing, and this is the same key, the same command and the same audit row.
 *
 * ## What the sentence promises, and what it does not
 *
 * It promises that pressing asks for nothing and contacts nobody, which is
 * exactly what `adoptFleetCredential` does: it reuses a consent DASH already
 * holds rather than opening a second consent screen, on the argument that
 * making somebody re-approve what they have already approved teaches them to
 * click through consent screens.
 *
 * It promises nothing about whether the key still works. That is the fleet
 * card's to say, and a sentence here implying a live key would be this stage
 * vouching for something it never read.
 */
function ModelAdoption({
  adopt,
  busy,
  canAct,
  detail,
  onAdopt,
}: {
  adopt: { connection_id: string; field_id: string; provider_label: string };
  busy: boolean;
  canAct: boolean;
  /** `describeNoChoice`'s own account of the no-key state, behind the Why?. */
  detail: string;
  onAdopt: (target: { connection_id: string; field_id: string }) => void;
}): ReactNode {
  return (
    <>
      <p className="settings-state wrap">
        {AGENT_SETTINGS_COPY.model.adopt_headline(adopt.provider_label)}
      </p>
      {canAct ? (
        <div className="button-row">
          <button
            type="button"
            className="button-primary"
            disabled={busy}
            onClick={() => {
              onAdopt({ connection_id: adopt.connection_id, field_id: adopt.field_id });
            }}
          >
            {busy
              ? AGENT_SETTINGS_COPY.model.adopt_pending
              : AGENT_SETTINGS_COPY.model.adopt_action}
          </button>
        </div>
      ) : (
        /* Said rather than drawn disabled, the same call every other control on
           this stage makes: a greyed button here would read as a claim about
           this agent, and the true statement is about which window this is. */
        <p className="muted wrap">
          Open the installed DASH app to let this agent use your key.
        </p>
      )}
      <WhyDisclosure>
        <p className="muted wrap">{AGENT_SETTINGS_COPY.model.adopt_detail}</p>
        <p className="muted wrap">{detail}</p>
      </WhyDisclosure>
    </>
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
export function ModelPicker({
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
