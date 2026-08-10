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
  describeChoiceAvailable,
  describeInForce,
  describeNoChoice,
  describeRunModel,
  describeRunModelDetail,
  describeStepsNotInForce,
  resolveModelSteps,
  type NoModelChoiceReason,
  type ResolvedModelStep,
} from "../ai/model-choice";
import {
  isDefaultModelLevel,
  levelLabel,
  levelMeaning,
  planNeedsAModel,
  stepsNeedingAModel,
  type PlannedRouteStep,
} from "../ai/model-levels";
import { aiKeyConnections, type AiKeyConnectionView } from "../ai/connection-view";
import { readAgentModelChoice, readStepLevelOverrides, readRunModel } from "../ai/model-store";
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
  const steps = resolved.map(toStepView);

  if (declared.length === 0 && !planNeedsAModel(route)) {
    return noChoice("no_model_needed", null, steps);
  }

  const card = pickCard(aiKeyConnections(agent, manifest));
  if (card === null) {
    return noChoice("no_provider_key", null, steps);
  }
  if (!card.held) {
    return noChoice("no_key_held", card.provider_label, steps);
  }

  const choice = readAgentModelChoice(agent);
  const sentence = describeChoiceAvailable(card.provider_label, declared.length);
  const named = choice.kind === "one_model" ? choice.model_id : null;

  return {
    can_choose: true,
    provider_id: card.provider_id,
    provider_label: card.provider_label,
    connection_id: card.connection_id,
    field_id: card.field_id,
    headline: sentence.headline,
    detail: sentence.detail,
    chosen_model_id: named,
    in_force: describeInForce(choice, resolved),
    steps,
    // The step controls are drawn either way and said to be set aside, rather
    // than hidden: a control whose stored settings still exist but which nothing
    // on screen mentions is how somebody comes back in a month to an agent
    // behaving in a way the page does not explain.
    steps_in_force: named === null,
    steps_note: named === null ? null : describeStepsNotInForce(named),
  };
}

function noChoice(
  reason: NoModelChoiceReason,
  providerLabel: string | null,
  steps: ModelStepView[],
): AgentModelSettingsView {
  const sentence = describeNoChoice(reason, providerLabel);
  return {
    can_choose: false,
    reason: sentence.reason,
    headline: sentence.headline,
    detail: sentence.detail,
    next_action: sentence.next_action,
    steps,
  };
}

function toStepView(step: ResolvedModelStep): ModelStepView {
  return {
    step: step.step,
    component_id: step.component_id,
    level: step.level,
    label: levelLabel(step.level),
    meaning: levelMeaning(step.level),
    declared: step.declared,
    declared_label: levelLabel(step.declared),
    overridden: step.overridden,
  };
}

/** A key DASH holds beats one it does not, so the picker lands on a live list. */
function pickCard(cards: readonly AiKeyConnectionView[]): AiKeyConnectionView | null {
  return cards.find((card) => card.held) ?? cards[0] ?? null;
}

/* ---------------------------------------------------------------------- *
 * Run rows
 * ---------------------------------------------------------------------- */

/**
 * What one run was set to use, or null.
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
): RunModelView | null {
  if (route === undefined || (!planNeedsAModel(route) && stepsNeedingAModel(route).length === 0)) {
    return null;
  }
  const record = readRunModel(agent, runId);
  const label = describeRunModel(record);
  const detail = describeRunModelDetail(record);
  return label === null || detail === null ? null : { label, detail };
}

/** The level this planned step declared, in words, or null for a fixed step. */
export function stepLevelLabel(level: unknown): string | null {
  return isDefaultModelLevel(level) ? levelLabel(level) : null;
}
