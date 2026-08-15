/**
 * What is left before a new agent works, from facts DASH already holds
 * (MAR-609's rule, built by MAR-641).
 *
 * ## Why a checklist rather than the ordinary overview
 *
 * MAR-609's closing note is the one this module exists to honour: *"whatever is
 * built must be sized for the empty case first — that is the state every new
 * user meets."* The cockpit's Overview stage answers *what has this agent done*,
 * and on an agent that has done nothing that question has no answer — so on
 * that one agent the stage answers a different question, which is *what is left
 * before it can*.
 *
 * ## Every line is a recorded fact, and none of them is a tutorial step
 *
 * MAR-547's rule is that a mark is a fact the store holds. So this reads the
 * same fields the Settings stage reads and adds no state of its own: whether
 * DASH holds the agent (it does, or this page would not be drawing), whether a
 * model can be resolved for it, and whether it has ever run. There is
 * deliberately **no "choose a file" step**, even for an agent that declares
 * input roles: a chosen file lives in the runner's task workspace for the
 * length of one visit and is not a fact DASH can ever tick.
 *
 * ## The model line reads the field the picker reads (MAR-624)
 *
 * That issue is one need surfaced by three cards that did not acknowledge each
 * other, and its lasting instruction is that the agent page's model answer must
 * come from one place. `AgentModelSettingsView` is that place: `can_choose`
 * decides the tick, and the sentence under it is the view's own `in_force` —
 * never a sentence composed here, which would be a third surface with its own
 * opinion about the same key. MAR-646 removed the second one, which was a tile.
 *
 * Pure: no clock, no store, no disk. See `lib/views/agent-control.ts` for why
 * that matters on this page.
 */

import { AGENT_COCKPIT_COPY } from "../copy/agent-page";
import type { AgentModelSettingsView } from "./types";

export interface AgentChecklistStep {
  id: "added" | "model" | "first_run";
  /** What the step is, in three or four words. Never a sentence. */
  label: string;
  /** One sentence: what is true now, or what to do about it. */
  detail: string;
  done: boolean;
  /**
   * The way to finish this step, or null when there is nothing to press.
   *
   * `stage` is where the control actually lives, so the checklist never becomes
   * a second place to change a setting — it is a set of pointers into the
   * stages that already own these decisions.
   */
  action: { label: string; stage: "settings" | "run" } | null;
}

export interface AgentChecklistFacts {
  models: AgentModelSettingsView;
  /** How many runs this agent has published. Zero is the state this is for. */
  run_count: number;
  /** How many outputs DASH holds for it. Zero is the state this is for. */
  output_count: number;
}

/**
 * Whether this agent has anything to show yet.
 *
 * Both halves, because they fail apart: a run that produced nothing is still a
 * run worth reading in the Run stage, and an output whose run record has been
 * pruned is still the thing a person came for.
 */
export function isEmptyAgent(facts: AgentChecklistFacts): boolean {
  return facts.run_count === 0 && facts.output_count === 0;
}

/**
 * The checklist, in the order a person meets it.
 *
 * Two steps or three: the model line is **omitted entirely** for an agent whose
 * plan uses no model, rather than drawn as a satisfied tick. A tick beside
 * "it has a model" on an agent that needs none would teach a reader that DASH
 * has connected something for them, which is exactly the confusion MAR-624
 * names — and the omission is the product's settled answer rather than this
 * module's shortcut: `ModelChoice` draws nothing for the same agent, on the
 * grounds that a notice explaining an absence is DASH describing its own
 * internals at somebody who came to look at their agent. The Model tile was the
 * one surface that disagreed, and MAR-646 removed it.
 */
export function buildAgentChecklist(facts: AgentChecklistFacts): AgentChecklistStep[] {
  const copy = AGENT_COCKPIT_COPY.checklist;
  const steps: AgentChecklistStep[] = [
    {
      id: "added",
      label: copy.added.label,
      detail: copy.added.detail,
      done: true,
      action: null,
    },
  ];

  const { models } = facts;
  if (models.can_choose) {
    steps.push({
      id: "model",
      label: copy.model.label,
      /* The view's own sentence about what DASH would use right now. Empty only
         if a future view arm stops wording it, and the fallback is a statement
         of the same fact rather than a blank line. */
      detail: models.in_force.length > 0 ? models.in_force : copy.model.ready,
      done: true,
      action: null,
    });
  } else if (models.reason !== "no_model_needed") {
    steps.push({
      id: "model",
      label: copy.model.label,
      // The picker's own account of what is missing. This module does not
      // reword it: `AGENT_TILE_COPY.model_value` records what happens to a
      // surface that truncates somebody else's claim.
      detail: models.detail,
      done: false,
      action: { label: models.next_action ?? copy.model.action, stage: "settings" },
    });
  }

  steps.push({
    id: "first_run",
    label: copy.first_run.label,
    detail: copy.first_run.detail,
    done: facts.run_count > 0,
    action: facts.run_count > 0 ? null : { label: copy.first_run.action, stage: "run" },
  });

  return steps;
}
