/**
 * Which model an agent uses, joined from four places (MAR-583).
 *
 * The manifest says what each step needs, `lib/ai/model-store.ts` says what the
 * person chose, `lib/ai/connection-view.ts` says whether DASH holds a key it
 * could ask, and `lib/ai/model-choice.ts` says all of it in sentences. This
 * module is the join and nothing else — it writes no sentence of its own, which
 * is the split `lib/views/glance.ts` states for itself and keeps for the same
 * reason: a sentence composed on the read path is a sentence the copy sweep does
 * not see.
 *
 * **Reads the store**, so it must never be imported by a page — the rule
 * `lib/views/build.ts` states for itself. A page imports the types.
 */

import {
  applyFleetDefault,
  describeChoiceAvailable,
  describeInForce,
  describeNoChoice,
  describeRunModel,
  describeRunModelDetail,
  describeStepModel,
  describeStepsNotInForce,
  describeUnpinnedOption,
  matchEachStep,
  resolveModelSteps,
  resolveStepModels,
  LEVEL_MAP_LINK_LABEL,
  type NoModelChoiceReason,
  type ResolvedModelStep,
  type RunModelStanding,
  type StepModelResolution,
} from "../ai/model-choice";
import { isModelId } from "../broker/operations";
import {
  isDefaultModelLevel,
  levelLabel,
  levelMeaning,
  planNeedsAModel,
  stepsNeedingAModel,
  type PlannedRouteStep,
} from "../ai/model-levels";
import { aiKeyConnections, pickAiKeyCard } from "../ai/connection-view";
import {
  readAgentModelChoice,
  readFleetLevelModels,
  readFleetModelDefault,
  readStepLevelOverrides,
  readRunModel,
} from "../ai/model-store";
import type { ConnectionSourceManifest } from "../connections";
import type { AgentModelSettingsView, ModelStepView, RunModelView } from "./types";

/**
 * The manifest shape this module needs. A planned route and whatever
 * `aiKeyConnections` reads, which is the Agent DOM's connection block.
 */
export type ModelSourceManifest = ConnectionSourceManifest & {
  planned_route?: readonly PlannedRouteStep[];
};

/**
 * What this agent is set to use, ready to draw.
 *
 * ## Which connection is asked, when there is more than one
 *
 * The first card holding a key, or the first card. An agent declaring two model
 * providers is legitimate and rare, and the alternative — a picker per provider
 * — would put a second dropdown on the page for a case almost nobody has, at the
 * cost of making the common case read as a choice between things. The headline
 * names the provider being asked, so nothing is hidden: a person with two keys
 * can see which one the list came from.
 */
export function buildAgentModelSettings(
  agent: string,
  manifest: ModelSourceManifest,
): AgentModelSettingsView {
  const route = manifest.planned_route ?? [];
  const declared = stepsNeedingAModel(route);
  const overrides = readStepLevelOverrides(agent);
  const resolved = resolveModelSteps(declared, overrides);

  if (declared.length === 0 && !planNeedsAModel(route)) {
    return noChoice("no_model_needed", null, resolved);
  }

  const card = pickAiKeyCard(aiKeyConnections(agent, manifest));
  if (card === null) {
    return noChoice("no_provider_key", null, resolved);
  }
  if (!card.held) {
    return noChoice("no_key_held", card.provider_label, resolved);
  }

  /*
   * MAR-642, widened by MAR-654. What this agent runs on: its own pin, then the
   * person's level map, then DASH's default.
   *
   * `card.provider_id` is the provider DASH would actually ask for this agent —
   * the one `pickAiKeyCard` just resolved from its manifest — so neither a
   * default nor a level row naming a different service reaches it. That check is
   * `applyFleetDefault`'s, applied once to both, and is not repeated here.
   *
   * The three rows are read here and the ladder applied twice from them: once
   * with no step, for the whole-agent question the picker is bound to, and once
   * per step. Two reads of one row set rather than two resolutions — the
   * precedence itself is expressed exactly once, in `applyFleetDefault`.
   */
  const pinned = readAgentModelChoice(agent);
  const fleetDefault = readFleetModelDefault();
  const levelModels = readFleetLevelModels(card.provider_id);
  const effective = applyFleetDefault(pinned, fleetDefault, card.provider_id);
  const fromDefault = effective.resolved_by === "fleet_default";
  const resolutions = resolveStepModels(
    resolved,
    pinned,
    fleetDefault,
    card.provider_id,
    levelModels,
  );
  const sentence = describeChoiceAvailable(card.provider_label, declared.length);
  /*
   * The agent's own row, separately, because two fields below mean two
   * different things. `chosen_model_id` is what *this agent* was pinned to and
   * drives the picker's value; `in_force` is what will run, which may be the
   * default or a level's own model. Reading one from the other would either show
   * the default as a choice nobody made or hide the fact that a model is in
   * force at all.
   */
  const pinnedModel = pinned.kind === "one_model" ? pinned.model_id : null;

  return {
    can_choose: true,
    provider_id: card.provider_id,
    provider_label: card.provider_label,
    connection_id: card.connection_id,
    field_id: card.field_id,
    headline: sentence.headline,
    detail: sentence.detail,
    chosen_model_id: pinnedModel,
    in_force: describeInForce(effective, resolved, resolutions),
    from_default: fromDefault,
    // Read again rather than carried off `effective`: what the option should say
    // depends on whether a default *exists*, not on whether it reached this
    // agent. An agent on another provider still needs the option to promise the
    // per-step matching it will actually get.
    unpinned_option: describeUnpinnedOption(fleetDefault),
    steps: resolved.map((step, index) => toStepView(step, resolutions[index] ?? null)),
    /*
     * MAR-654, A1.6. Live unless *this agent* is pinned.
     *
     * It used to be `named === null` over the **effective** choice, so DASH's
     * default greyed the levels out on every agent that had not chosen — which
     * is the control Henrik found greyed on the scout and the defect this
     * amendment exists to end. A level now beats the default, so an unpinned
     * agent's levels decide something and the control is real.
     */
    steps_in_force: pinnedModel === null,
    steps_note: pinnedModel === null ? null : describeStepsNotInForce(pinnedModel),
    steps_link_label: LEVEL_MAP_LINK_LABEL,
  };
}

/**
 * The arm for every agent there is nothing to choose for.
 *
 * The steps are still drawn — an agent's declared levels are worth reading even
 * when DASH cannot offer a model — and every one of them resolves to `none`,
 * which is the truth: there is no key, no provider, or no model in the plan, so
 * nothing on the ladder can answer. `resolveStepModels` says that rather than
 * this function inventing a row, and a null provider is what makes it say it.
 */
function noChoice(
  reason: NoModelChoiceReason,
  providerLabel: string | null,
  steps: readonly ResolvedModelStep[],
): AgentModelSettingsView {
  const sentence = describeNoChoice(reason, providerLabel);
  const resolutions = resolveStepModels(steps, matchEachStep(), null, null, new Map());
  return {
    can_choose: false,
    reason: sentence.reason,
    headline: sentence.headline,
    detail: sentence.detail,
    next_action: sentence.next_action,
    steps: steps.map((step, index) => toStepView(step, resolutions[index] ?? null)),
  };
}

function toStepView(
  step: ResolvedModelStep,
  resolution: StepModelResolution | null,
): ModelStepView {
  const answer: StepModelResolution = resolution ?? {
    step: step.step,
    component_id: step.component_id,
    level: step.level,
    provider_id: null,
    model_id: null,
    resolved_by: "none",
  };
  return {
    step: step.step,
    component_id: step.component_id,
    level: step.level,
    label: levelLabel(step.level),
    meaning: levelMeaning(step.level),
    declared: step.declared,
    declared_label: levelLabel(step.declared),
    overridden: step.overridden,
    resolved_model_id: answer.model_id,
    resolved_by: answer.resolved_by,
    resolved_note: describeStepModel(answer),
  };
}

/* ---------------------------------------------------------------------- *
 * Run rows
 * ---------------------------------------------------------------------- */

/**
 * What one run used, as far as anybody can say, or null.
 *
 * Two sources joined, and `RunModelStanding` is where the argument for keeping
 * them apart lives: DASH's own setting at the moment it first saw the run, and
 * whatever the run itself reported in `model` on its events.
 *
 * **`reported` is read from the events, and this is the first thing in DASH to
 * read that field.** It has been in telemetry v1 since the contract was frozen.
 * Nothing drew it, so an agent that dutifully reported which model it used had
 * that fact land in the store and stay there — which is the same class of defect
 * as MAR-457's artifact buffer that no caller drained.
 *
 * Null for a run DASH has no record of, **and null for an agent whose plan needs
 * no model at all** — which is the line this function exists to draw. The write
 * path records a row for every run it sees, deliberately, because deciding on
 * ingest would mean parsing a manifest on the hot path. Deciding here is both
 * cheaper and more honest: the manifest is already open, and it is the manifest
 * as it stands now that says whether a model was ever part of this agent's work.
 *
 * The consequence is stated rather than hidden. An agent whose plan *gained* a
 * model step after a run finished will show that run's recorded setting, because
 * the row is real and the plan now says a model is involved. That is DASH
 * reporting what it recorded, which is the only thing it ever has to report.
 */
export function buildRunModel(
  agent: string,
  runId: string,
  route: readonly PlannedRouteStep[] | undefined,
  events: readonly { model?: string }[] = [],
): RunModelView | null {
  if (route === undefined || (!planNeedsAModel(route) && stepsNeedingAModel(route).length === 0)) {
    return null;
  }
  const standing: RunModelStanding = {
    setting: readRunModel(agent, runId),
    reported: reportedModels(events),
  };
  const label = describeRunModel(standing);
  const detail = describeRunModelDetail(standing);
  return label === null || detail === null ? null : { label, detail };
}

/**
 * Distinct models a run's own events named, in the order they named them.
 *
 * Distinct because a run reports one per step and a plan can run the same model
 * six times; the question is which models were involved, not how many events
 * mentioned one. Order preserved rather than sorted, because the first model a
 * run names is the one it started on, which is the more useful of the two
 * orderings when the list is truncated to a count.
 *
 * A model id an agent reported is checked with `isModelId` like every other one:
 * it arrives from a process DASH does not control, over the ingest boundary, and
 * `run_events` validates the field's *type* and not its shape.
 */
function reportedModels(events: readonly { model?: string }[]): string[] {
  const seen = new Set<string>();
  for (const event of events) {
    if (typeof event.model === "string" && isModelId(event.model)) {
      seen.add(event.model);
    }
  }
  return [...seen];
}

/** The level this planned step declared, in words, or null for a fixed step. */
export function stepLevelLabel(level: unknown): string | null {
  return isDefaultModelLevel(level) ? levelLabel(level) : null;
}
