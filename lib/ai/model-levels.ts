/**
 * What capability floor each of an agent's steps needs, read from the manifest
 * (MAR-583).
 *
 * The MCP emitter writes `planned_route[].default_model_level` for every step
 * that needs AI, using a closed vocabulary of **levels rather than model names**.
 * ADR-MAR-583 in the OrchestrateKIT-MCP repository argues the choice and this
 * module is DASH's half of it: model names age and belong to one provider, while
 * "this step needs a cheap model / a standard one / the best one available" is a
 * fact about the agent that stays true when the catalogue changes underneath it.
 *
 * ## Why a pure reader sits beside the schema
 *
 * The same two reasons `lib/panel-spec.ts` states, and it is the same trade.
 * `lib/contracts.ts` compiles the schema files with `node:fs`, so Ajv cannot be
 * reached from the renderer chunk that draws the model picker; and a schema's
 * account of a failed enum names nothing a person could act on. So this module
 * has **no imports at all**, carries the vocabulary by value, and returns typed
 * answers.
 *
 * The obvious cost is a second source of truth, and it is paid the way MAR-555
 * paid it rather than waved at: `tests/model-levels.test.ts` runs one corpus of
 * planned routes through both the compiled v2 schema and this reader and
 * requires the same verdict, so a level added to one and not the other turns the
 * file red.
 *
 * ## Absence is a fact, not a gap
 *
 * A step with no `default_model_level` declared **needs no model**. That is what
 * the emitter means by omitting it, and this module never fills it in with a
 * placeholder: `stepsNeedingAModel` returns fewer entries rather than entries
 * carrying a null level, so nothing downstream can accidentally offer somebody a
 * model choice for a step that reads a file.
 */

/* ---------------------------------------------------------------------- *
 * The vocabulary
 * ---------------------------------------------------------------------- */

/**
 * Every level an author may declare, weakest first.
 *
 * Ordered, and the order is load-bearing rather than cosmetic: "the strongest
 * level this plan asks for" is what decides whether one chosen model is enough
 * for the whole agent, and a set with no order could not answer it.
 *
 * Closed by value here and in the emitter, for `AI_PROVIDER_IDS`'s reason:
 * widening what a manifest can say about what DASH should run is a diff somebody
 * reads, not a predicate that quietly matches more next month.
 */
export const DEFAULT_MODEL_LEVELS = ["cheap", "standard", "frontier"] as const;

export type DefaultModelLevel = (typeof DEFAULT_MODEL_LEVELS)[number];

/** Whether a value is one of the three levels. For a stored or emitted string. */
export function isDefaultModelLevel(value: unknown): value is DefaultModelLevel {
  return typeof value === "string" && (DEFAULT_MODEL_LEVELS as readonly string[]).includes(value);
}

/**
 * How strong a level is, as a number, for comparison only.
 *
 * Not exported as the level's identity — nothing renders it and nothing stores
 * it. `strongestLevel` is the one caller, and it exists so that the comparison
 * lives in this module rather than being re-derived from array indices by
 * whoever needs it next.
 */
function rank(level: DefaultModelLevel): number {
  return DEFAULT_MODEL_LEVELS.indexOf(level);
}

/** The strongest of some levels, or null when there are none. */
export function strongestLevel(
  levels: readonly DefaultModelLevel[],
): DefaultModelLevel | null {
  let strongest: DefaultModelLevel | null = null;
  for (const level of levels) {
    if (strongest === null || rank(level) > rank(strongest)) {
      strongest = level;
    }
  }
  return strongest;
}

/* ---------------------------------------------------------------------- *
 * Reading a plan
 * ---------------------------------------------------------------------- */

/**
 * The shape this module reads. Deliberately narrow: a planned-route entry and
 * nothing else about a manifest, so a caller holding any manifest version can
 * pass its route without this module knowing which version it came from.
 */
export interface PlannedRouteStep {
  step: number;
  component_id: string;
  model_tier?: string;
  default_model_level?: string;
}

/** One step that needs a model, with the level its author declared for it. */
export interface ModelStep {
  step: number;
  component_id: string;
  level: DefaultModelLevel;
}

/**
 * Every step in this plan that needs a model, in step order.
 *
 * Driven by `default_model_level` and **not** by `model_tier`, which is the
 * decision worth stating. Both fields describe the same underlying fact and an
 * older manifest carries only the second, so it is tempting to fall back to it.
 * That fallback is refused: `model_tier` is the planner's internal grading and
 * has four members including `none`, while a level is a declaration made *for
 * DASH* with three. Translating one into the other here would put the emitter's
 * mapping table in two repositories, which is exactly what ADR-MAR-583 moved out
 * of DASH's hands by emitting the level in the first place.
 *
 * The consequence is stated rather than hidden: an agent exported before that
 * emitter shipped declares no levels, so DASH offers it no per-step choice and
 * says so. Re-exporting the agent is the fix, and it is a sentence somebody can
 * act on rather than a guess DASH made on their behalf.
 *
 * A step whose declared level is not one of the three is dropped, for
 * `readLivenessCheck`'s reason: a value this build cannot interpret should read
 * as the absence of a declaration, which a person can act on, rather than as a
 * fourth level every renderer then needs a branch for.
 */
export function stepsNeedingAModel(route: readonly PlannedRouteStep[]): ModelStep[] {
  const steps: ModelStep[] = [];
  for (const entry of route) {
    if (!isDefaultModelLevel(entry.default_model_level)) {
      continue;
    }
    steps.push({
      step: entry.step,
      component_id: entry.component_id,
      level: entry.default_model_level,
    });
  }
  return steps.sort((a, b) => a.step - b.step);
}

/**
 * Whether this plan needs a language model at all, on the *older* evidence.
 *
 * `model_tier` above `none`, which every manifest version carries. This is the
 * question `lib/connections.ts` has asked since MAR-383 to derive its
 * model-provider row, and it is deliberately separate from `stepsNeedingAModel`:
 * that one answers "which steps can somebody choose a model for", this one
 * answers "would this agent be broken without one". A manifest exported before
 * MAR-583 answers yes to the second and produces nothing for the first, and the
 * deploy refusal depends on being able to tell those apart.
 */
export function planNeedsAModel(route: readonly PlannedRouteStep[]): boolean {
  return route.some((entry) => typeof entry.model_tier === "string" && entry.model_tier !== "none");
}

/* ---------------------------------------------------------------------- *
 * Words
 * ---------------------------------------------------------------------- */

/**
 * What a level is called on screen.
 *
 * Not the stored word. `cheap` is accurate and reads as a judgment about
 * somebody's work; what a person is choosing is how much capability the step
 * gets, so the labels name that. They are here rather than in `lib/copy/` for
 * the reason `AI_PROVIDER_IDS`'s labels are on the profile: a label that could
 * drift from the value it labels belongs beside it.
 */
export function levelLabel(level: DefaultModelLevel): string {
  switch (level) {
    case "cheap":
      return "Small and cheap";
    case "standard":
      return "Balanced";
    case "frontier":
      return "The best available";
  }
}

/** One sentence saying what asking for this level means. */
export function levelMeaning(level: DefaultModelLevel): string {
  switch (level) {
    case "cheap":
      return "This step pulls facts out of text that is already in front of it, so a small model does it as well as a large one and costs far less.";
    case "standard":
      return "This step has to weigh things up rather than copy them across, which a mid-sized model handles and a very small one starts to get wrong.";
    case "frontier":
      return "This step plans or writes something new, which is where small models fall down sharply, so it asks for the strongest model you have.";
  }
}

/** Every sentence this module can produce, for the copy sweep. */
export function everyLevelSentence(): string[] {
  return DEFAULT_MODEL_LEVELS.flatMap((level) => [levelLabel(level), levelMeaning(level)]);
}
