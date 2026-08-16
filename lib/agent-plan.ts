/**
 * The plan a person can read before pressing anything (MAR-664).
 *
 * Henrik, testing the newly installed competitor scout: *"We can't see the
 * planned steps and decide what model each step use."* The manifest already
 * carries a six-step `planned_route` — every step with a `component_id`, a
 * `risk_level` and a `model_tier` — and DASH surfaced none of it. The header
 * spent its space on the goal prose instead, which is what
 * `app/_components/agent-header.tsx`'s About disclosure now replaces.
 *
 * ## Pure, so it can sit in the "use client" tree
 *
 * `lib/ai/model-levels.ts`'s reasons, restated for one more surface: `lib/
 * contracts.ts` compiles the schema files with `node:fs`, so nothing that
 * imports it as a value may be reached from a rendered component — see
 * `tests/client-bundle.test.ts`. This module reads the same
 * `planned_route[]` shape by declaring its own narrow slice of it, imports
 * only `lib/ai/model-levels.ts` (itself import-free), and touches no disk
 * and no store.
 *
 * ## The half this module refuses, and why
 *
 * ADR 0011 decision 1: *"A level is what an agent's author declares; a model
 * is what its owner chooses… DASH does not translate `model_tier` into a
 * level for a manifest that predates the emitter… a second copy \[of the
 * mapping\] here would be the one nobody updates."* `lib/broker/execute.ts`
 * quotes the same decision at the one place a model is actually chosen for a
 * spend: *"DASH translating a declared level into a model name is the exact
 * mapping ADR 0011 refuses to keep a second copy of."*
 *
 * So this module shows each step's declared strength truthfully and says,
 * once, what DASH does and does not do with it — never a specific model
 * per step, because there is no per-step model picker and no table that
 * would let one exist. Henrik's fuller ask, *"decide what model each step
 * use,"* is a request to reopen that ADR, not a gap this module can close by
 * inventing the mapping ADR 0011 declined to keep.
 */

import {
  isDefaultModelLevel,
  levelLabel,
  levelMeaning,
  type DefaultModelLevel,
} from "./ai/model-levels";

/* ---------------------------------------------------------------------- *
 * Reading a plan
 * ---------------------------------------------------------------------- */

export type PlanRiskLevel = "low" | "medium" | "high" | "critical";

/**
 * The shape this module reads. Deliberately narrow, `lib/ai/model-levels.
 * ts`'s `PlannedRouteStep` widened by `risk_level` — a caller holding any
 * manifest version can pass its route without this module knowing which
 * version it came from.
 */
export interface PlannedRouteStepFull {
  step: number;
  component_id: string;
  risk_level: PlanRiskLevel;
  model_tier?: string;
  default_model_level?: string;
}

/**
 * What one step says about its model, in a closed set rather than a
 * boolean and a nullable.
 *
 * `sentence` is composed here rather than in the component — `lib/ai/model-
 * choice.ts`'s rule, "every sentence comes from the trusted side" — so a page
 * cannot describe a step's standing differently from the process that
 * resolved it, and so the plain-language sweep can see every branch.
 */
export type StepModelStanding =
  | { kind: "no_model"; sentence: string }
  | { kind: "declared"; level: DefaultModelLevel; level_label: string; sentence: string }
  /**
   * The plan needs a model and does not say how much — an agent exported
   * before MAR-583's emitter shipped. `lib/ai/model-levels.ts` refuses to
   * fall back to `model_tier` for the level itself; this is the honest
   * sentence for the step that fallback would have covered.
   */
  | { kind: "undeclared"; sentence: string };

/** `.chip-{tone}`'s own vocabulary — reused rather than a second one invented here. */
export type RiskTone = "ok" | "warn" | "err";

export interface AgentPlanStep {
  step: number;
  component_id: string;
  risk_level: PlanRiskLevel;
  risk_label: string;
  /** Which of `.chip`'s existing tones this step's risk reads as. */
  risk_tone: RiskTone;
  model: StepModelStanding;
}

function riskLabel(level: PlanRiskLevel): string {
  switch (level) {
    case "low":
      return "Low risk";
    case "medium":
      return "Medium risk";
    case "high":
      return "High risk";
    case "critical":
      return "Critical risk";
  }
}

function riskTone(level: PlanRiskLevel): RiskTone {
  switch (level) {
    case "low":
      return "ok";
    case "medium":
      return "warn";
    case "high":
    case "critical":
      return "err";
  }
}

const NO_MODEL_SENTENCE = "This step does not use a language model.";

const UNDECLARED_SENTENCE =
  "This step needs a model, but this agent's plan predates the export that says how much. " +
  "Re-exporting the agent would add it.";

function stepModelStanding(entry: PlannedRouteStepFull): StepModelStanding {
  const needsModel = entry.model_tier !== undefined && entry.model_tier !== "none";
  if (!needsModel) {
    return { kind: "no_model", sentence: NO_MODEL_SENTENCE };
  }
  if (!isDefaultModelLevel(entry.default_model_level)) {
    return { kind: "undeclared", sentence: UNDECLARED_SENTENCE };
  }
  const level = entry.default_model_level;
  const label = levelLabel(level);
  return {
    kind: "declared",
    level,
    level_label: label,
    sentence: `Declared level: ${label}. ${levelMeaning(level)}`,
  };
}

/**
 * Every step this agent's plan declares, in step order — all of them, not
 * only the ones that need a model. `lib/ai/model-levels.ts`'s
 * `stepsNeedingAModel` answers "which steps can somebody choose a model
 * for"; this answers "what will this agent do", which is the question
 * Henrik asked and the narrower function cannot.
 */
export function describeAgentPlan(route: readonly PlannedRouteStepFull[]): AgentPlanStep[] {
  return [...route]
    .sort((a, b) => a.step - b.step)
    .map((entry) => ({
      step: entry.step,
      component_id: entry.component_id,
      risk_level: entry.risk_level,
      risk_label: riskLabel(entry.risk_level),
      risk_tone: riskTone(entry.risk_level),
      model: stepModelStanding(entry),
    }));
}

/**
 * The one sentence about what DASH does and does not do with a declared
 * level, said once for the whole plan rather than once per step.
 *
 * This is ADR 0011 stated for a reader who has not read the ADR: DASH shows
 * the plan's own answer truthfully and does not resolve it to a model
 * itself — see this module's own docblock for the decision it is quoting.
 */
export const AGENT_PLAN_MODEL_BOUNDARY =
  "DASH shows what each step's plan asked for, truthfully. It does not turn a declared level " +
  "into a specific model, and there is no per-step model picker. What you can set, on the " +
  "Settings stage, is whether every step runs at the level its plan declared or the whole agent " +
  "runs on one model you name instead.";

/** What DASH says when a manifest declares no steps at all. */
export const AGENT_PLAN_EMPTY_SENTENCE = "This agent's plan does not declare any steps.";

/**
 * Every sentence this module can produce, for the plain-language sweep.
 *
 * The sample ids are real-shaped (`public_source_fetch`, not `a`) on purpose:
 * a one-letter id could never trip the identifier scanner, and the claim this
 * module makes is that `component_id` never reaches a sentence — see
 * `tests/agent-plan.test.ts`.
 */
export function everyAgentPlanSentence(): string[] {
  const steps = describeAgentPlan([
    { step: 1, component_id: "public_source_fetch", risk_level: "low" },
    { step: 2, component_id: "signal_sort", risk_level: "medium", model_tier: "none" },
    {
      step: 3,
      component_id: "digest_curate",
      risk_level: "high",
      model_tier: "small",
      default_model_level: "cheap",
    },
    {
      step: 4,
      component_id: "deep_dive_synthesis",
      risk_level: "critical",
      model_tier: "frontier",
      default_model_level: "frontier",
    },
    // The undeclared branch: a plan that needs a model and predates the field
    // that says how much.
    { step: 5, component_id: "report_file_write", risk_level: "low", model_tier: "standard" },
  ]);
  return [
    ...steps.flatMap((step) => [step.risk_label, step.model.sentence]),
    AGENT_PLAN_MODEL_BOUNDARY,
    AGENT_PLAN_EMPTY_SENTENCE,
  ];
}
