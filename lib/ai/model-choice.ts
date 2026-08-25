/**
 * Which model an agent uses, as a decision a person made (MAR-583).
 *
 * Two questions, kept apart because they have different owners:
 *
 * 1. **What does each step need?** The agent's author answered that, per step,
 *    in `planned_route[].default_model_level`. `lib/ai/model-levels.ts` reads it.
 * 2. **Which model does that become?** The person running the agent answers
 *    that, and this module is their answer.
 *
 * Pure, with no store and no network. `lib/ai/model-store.ts` persists what is
 * decided here and `lib/views/build.ts` projects it; a test drives every state
 * with three plain objects.
 *
 * ## Absence is the recommended answer, and that is deliberate
 *
 * A person who never opens this control gets `match_each_step`: every step runs
 * at the level its author declared for it. There is no row until somebody
 * chooses otherwise, so "nobody has touched this" and "somebody chose the
 * default" are the same state and DASH does not have to tell them apart. The
 * same argument `ai_key_checks` makes for having no row until a provider is
 * asked.
 *
 * ## What DASH will not say
 *
 * **What any of this costs.** Not an estimate, not a per-token price, not a
 * comparison. MAR-299 owns cost, and it owns it because a number DASH made up
 * about somebody else's bill is worse than no number — a person who is told an
 * agent costs "about a cent a run" and finds four dollars on their statement has
 * been misled by DASH, not by the provider. So every sentence below is about
 * *capability*: cheaper models are described as smaller, and the reason to pick
 * one is that the step does not need more. When actual numbers exist, they join
 * onto the run rows this module already records against.
 *
 * **Which model actually ran.** DASH makes no completion call — MAR-582's
 * recorded boundary is that the key layer has one operation and it lists models
 * — so DASH has never observed a model doing an agent's work. What it records
 * per run is *its own setting at the moment the run started*, which it did
 * observe, and every sentence says so in those words. `agent_deploys` keeps the
 * same discipline about somebody else's server.
 */

import {
  DEFAULT_MODEL_LEVELS,
  strongestLevel,
  levelLabel,
  type DefaultModelLevel,
  type ModelStep,
} from "./model-levels";

/* ---------------------------------------------------------------------- *
 * The choice
 * ---------------------------------------------------------------------- */

/**
 * What a person decided for one agent.
 *
 * Two members and no third. There is no "cheapest available" or "whatever is
 * fastest" option, because DASH would have to rank somebody else's catalogue to
 * honour one, and a ranking DASH invented is exactly the made-up number the
 * header refuses.
 */
export type AgentModelChoice =
  /**
   * Every step runs at the level its author declared. The default, and what an
   * agent with no stored row is in.
   */
  | { kind: "match_each_step" }
  /** One named model for the whole agent, whatever any step declared. */
  | { kind: "one_model"; provider_id: string; model_id: string };

/** The choice an agent with no stored row is in. */
export function matchEachStep(): AgentModelChoice {
  return { kind: "match_each_step" };
}

/* ---------------------------------------------------------------------- *
 * The fleet default (MAR-642)
 * ---------------------------------------------------------------------- */

/**
 * One model DASH falls back to, for an agent nobody has configured.
 *
 * Henrik's 2026-08-15 ruling, in two halves that are both load-bearing:
 *
 * 1. **It is what a new agent's unset steps resolve to.** Before this there was
 *    no fleet-wide answer at all — model was per agent per step, and an agent
 *    imported this morning had no model until somebody opened its Settings
 *    stage and picked one. `describeUnavailable`'s `no_model_chosen` is what
 *    that cost: a freshly imported agent could not be asked a question.
 * 2. **It never overrides an explicit per-agent choice.** An agent that has
 *    chosen keeps what it chose when the default changes, which is why this is
 *    a *fallback* read in one function rather than a value copied into agents.
 *
 * The provider travels with the model because a model id means nothing without
 * one: `moonshotai/kimi-k2` is an OpenRouter name, and presenting it to
 * Anthropic would be DASH asking a provider for something it never offered. See
 * `applyFleetDefault`, which is the only place that check happens.
 */
export interface FleetModelDefault {
  /** DASH's own registry id — `openrouter`, `anthropic`, `openai`. */
  provider_id: string;
  model_id: string;
}

/* ---------------------------------------------------------------------- *
 * The level map (MAR-654, ADR 0011 amendment 1)
 * ---------------------------------------------------------------------- */

/**
 * The person's answer to *which model does this level mean*, per provider.
 *
 * Three rows at most per provider, and zero on a DASH nobody has configured. The
 * value is a `FleetModelDefault` rather than a bare model id so that every entry
 * carries the provider it came from, which lets `applyFleetDefault` apply one
 * provider check to rules 2 and 3 instead of two — see `sameProvider`. A model id
 * that arrived beside one provider cannot be presented to another by accident,
 * because nothing here ever separates the pair.
 *
 * **DASH writes no row into this and ships none.** ADR 0011 decision 1 refuses a
 * ranking DASH invents over somebody else's catalogue, and a second copy of the
 * emitter's `model_tier` table; a map whose every row was chosen by the person
 * out of a list their own key returned is neither of those things.
 */
export type LevelModelMap = ReadonlyMap<DefaultModelLevel, FleetModelDefault>;

/**
 * Which rung of the ladder answered.
 *
 * A **value** rather than a comment, and it replaces
 * `EffectiveModelChoice.from_default` — a boolean that could only ever express
 * two of the four. Every sentence about a resolved model is worded from this, the
 * AI tab's level rows are worded from it, and `run_step_models.resolved_by` stores
 * it. So a fall back to the fleet default is something a person can read rather
 * than something they would have to infer from a model id being the same on two
 * screens.
 */
export type ModelResolvedBy =
  /** The agent's own pin. Rule 1, and it can never be reached around. */
  | "agent_pin"
  /** The person's row for (this agent's provider, this step's level). Rule 2. */
  | "level_map"
  /** DASH's default model, when it is the same provider. Rule 3. */
  | "fleet_default"
  /** Nothing answered. `no_model_chosen`, now reachable per step. Rule 4. */
  | "none";

/**
 * What the ladder needs to know about one step, when it is asked about a step.
 *
 * Null everywhere the question is not about one — the chat answers from saved
 * reports and is *not one of an agent's steps* — and a null `level` for a step
 * whose plan declared none. Both resolve identically: the ladder skips rule 2 and
 * lands on the default or on nothing, which is the behaviour every caller had
 * before this amendment.
 */
export interface StepLadder {
  /** The level in force: the plan's declaration, or the person's override. */
  level: DefaultModelLevel | null;
  /** The person's rows. Only an entry naming this agent's provider can match. */
  level_models: LevelModelMap;
}

/**
 * What is in force, and which rung said so.
 *
 * `resolved_by` exists so a surface can say *which* — "you chose this", "this is
 * what your Balanced steps run on" and "this is what DASH uses unless an agent
 * says otherwise" are three different facts about the same model id, and a person
 * who cannot tell them apart cannot predict what changing any of the three will
 * do to this agent.
 *
 * Nothing persists this pair as a pair. `run_models` records the resolved
 * `choice` and `run_step_models` records `resolved_by` per step, because what a
 * run started under is a model *and*, since A1.5, the rule that produced it — by
 * the time anybody reads those rows the map and the default may both be something
 * else.
 */
export interface EffectiveModelChoice {
  choice: AgentModelChoice;
  resolved_by: ModelResolvedBy;
}

/**
 * Fold the person's level map and DASH's default onto one agent's own choice, for
 * one step.
 *
 * The whole precedence rule, in one pure function, so that the six places that
 * read a model — the agent's Settings stage, the AI tab, the chat, the broker's
 * spend path, the run record and the deploy bundle — cannot each have their own
 * idea of it. A1.2 names a fourth rung as this amendment's standing cost and
 * mitigates it the way this module already does: one function, six callers, no
 * second opinion.
 *
 * Four rules, in order, per step:
 *
 * 1. **An agent that chose wins.** Always, whatever anything else says. This is
 *    the half Henrik stated twice, and it is first here so it cannot be reached
 *    around.
 * 2. **The person's row for (this agent's provider, this step's level).** New in
 *    A1.1. The level is `resolveModelSteps`' answer, so a person's
 *    `agent_step_levels` override participates exactly as it does today — and the
 *    agent's own request never names it, which is the whole safety argument of
 *    `BrokerDeps.readModelChoice`.
 * 3. **DASH's default**, when it is the same provider. MAR-642, unchanged.
 * 4. **Nothing.** `no_model_chosen`, and now reachable per step: a plan declaring
 *    `frontier`, no row for it and no default, is an agent whose synthesis step
 *    cannot spend — said in those words, on that step's own row.
 *
 * Rule 2 sits above rule 3 because it is the more specific statement about this
 * step, and rule 3 describes itself as the whole-agent answer ("the model new
 * agents use… unless an agent says otherwise").
 *
 * **A gap is filled by the default and is never silent.** A person who maps only
 * `frontier` gets their frontier steps on that model and everything else on the
 * default they already chose — which is what they meant, and refusing a level
 * with no row would take a freshly imported agent back to the state MAR-642 was
 * built to end. What makes it not-silent is `resolved_by`.
 *
 * **A provider DASH cannot name matches nothing.** `agentProviderId` is the
 * provider DASH would actually ask for this agent, resolved from its manifest. A
 * row naming OpenRouter cannot answer an agent whose plan reaches Anthropic — the
 * request would carry a model id that provider never published — and null means
 * the caller does not know which provider this agent uses. DASH does not guess
 * which account gets billed. One check, applied to rules 2 and 3 alike.
 */
export function applyFleetDefault(
  agentChoice: AgentModelChoice,
  fleetDefault: FleetModelDefault | null,
  agentProviderId: string | null,
  step: StepLadder | null = null,
): EffectiveModelChoice {
  if (agentChoice.kind === "one_model") {
    return { choice: agentChoice, resolved_by: "agent_pin" };
  }

  const mapped =
    step === null || step.level === null
      ? null
      : sameProvider(step.level_models.get(step.level) ?? null, agentProviderId);
  if (mapped !== null) {
    return { choice: named(mapped), resolved_by: "level_map" };
  }

  const fallback = sameProvider(fleetDefault, agentProviderId);
  if (fallback !== null) {
    return { choice: named(fallback), resolved_by: "fleet_default" };
  }
  return { choice: agentChoice, resolved_by: "none" };
}

/** The row, but only when it names the provider DASH would ask for this agent. */
function sameProvider(
  row: FleetModelDefault | null,
  agentProviderId: string | null,
): FleetModelDefault | null {
  return row === null || agentProviderId === null || row.provider_id !== agentProviderId
    ? null
    : row;
}

function named(row: FleetModelDefault): AgentModelChoice {
  return { kind: "one_model", provider_id: row.provider_id, model_id: row.model_id };
}

/**
 * One step, with what its author asked for and what is in force.
 *
 * `declared` and `level` are both present even when they agree, so a surface can
 * say "this is the plan's own answer" without inferring it from an equality
 * check it might get backwards.
 */
export interface ResolvedModelStep extends ModelStep {
  /** The level the manifest declared. Never changes with a person's choice. */
  declared: DefaultModelLevel;
  /** True when a person set this step's level to something else. */
  overridden: boolean;
}

/**
 * Fold a person's per-step overrides onto what the manifest declared.
 *
 * An override naming a step this manifest no longer has is dropped rather than
 * appended. A manifest is re-imported whenever its author publishes, and a plan
 * that lost a step should not leave a control on screen pointing at nothing —
 * `aiKeyConnections` drops a vault entry for an undeclared field for the same
 * reason, and states it: the manifest is the list of what to show.
 */
export function resolveModelSteps(
  steps: readonly ModelStep[],
  overrides: ReadonlyMap<number, DefaultModelLevel>,
): ResolvedModelStep[] {
  return steps.map((step) => {
    const override = overrides.get(step.step);
    return {
      ...step,
      declared: step.level,
      level: override ?? step.level,
      overridden: override !== undefined && override !== step.level,
    };
  });
}

/**
 * One step, and what it resolves to right now (MAR-654).
 *
 * The shape the run record freezes, the agent page's per-step sentence is worded
 * from, and the deploy bundle carries. It is `applyFleetDefault` run once per
 * step and never a second resolution, which is the point: a page showing a
 * different model from the one the broker hands out would be worse than no page.
 */
export interface StepModelResolution {
  step: number;
  component_id: string;
  /** The level in force: the plan's declaration, or the person's override. */
  level: DefaultModelLevel;
  /** Both null exactly when `resolved_by` is `none`. */
  provider_id: string | null;
  model_id: string | null;
  resolved_by: ModelResolvedBy;
}

/**
 * Every step of a plan, run through the ladder.
 *
 * Takes the already-resolved steps rather than a manifest and a map of
 * overrides, so the one place a *level* is decided stays `resolveModelSteps` — a
 * second resolution here would be free to disagree with the one the person is
 * looking at on screen. `bundledModelChoice` takes them for the same reason.
 */
export function resolveStepModels(
  steps: readonly ResolvedModelStep[],
  agentChoice: AgentModelChoice,
  fleetDefault: FleetModelDefault | null,
  agentProviderId: string | null,
  levelModels: LevelModelMap,
): StepModelResolution[] {
  return steps.map((step) => {
    const effective = applyFleetDefault(agentChoice, fleetDefault, agentProviderId, {
      level: step.level,
      level_models: levelModels,
    });
    const choice = effective.choice;
    return {
      step: step.step,
      component_id: step.component_id,
      level: step.level,
      provider_id: choice.kind === "one_model" ? choice.provider_id : null,
      model_id: choice.kind === "one_model" ? choice.model_id : null,
      resolved_by: effective.resolved_by,
    };
  });
}

/* ---------------------------------------------------------------------- *
 * What the surface is allowed to offer
 * ---------------------------------------------------------------------- */

/**
 * Why there is no model to choose, when there is not.
 *
 * A closed set, in `ConnectFlowRefusal`'s shape and for its reason: a control
 * that is absent with no sentence beside it is a dead end the surface cannot
 * describe. Every member below has a sentence in `describeNoChoice`.
 */
export type NoModelChoiceReason =
  /** The plan has no step that needs a language model. Nothing to decide. */
  | "no_model_needed"
  /**
   * The plan needs a model and this agent declares no connection DASH can ask
   * for a model list — either it arranges its own, or it names a service outside
   * `lib/ai/providers.ts`. The sentence covers both because the manifest does not
   * distinguish them and DASH must not guess which one it is looking at.
   */
  | "no_provider_key"
  /** There is a connection DASH could ask, and no key in the vault yet. */
  | "no_key_held";

export interface NoModelChoice {
  can_choose: false;
  reason: NoModelChoiceReason;
  headline: string;
  detail: string;
  /** Null exactly when there is nothing for the person to do. */
  next_action: string | null;
}

export interface ModelChoiceAvailable {
  can_choose: true;
  provider_id: string;
  provider_label: string;
  connection_id: string;
  headline: string;
  detail: string;
  next_action: string | null;
}

export type ModelChoiceStanding = NoModelChoice | ModelChoiceAvailable;

/**
 * What DASH can say when there is no model to pick.
 *
 * Each of the three blames the right thing. `no_model_needed` blames nobody and
 * offers nothing to do. `no_provider_key` describes an arrangement rather than a
 * fault — an agent that manages its own model is a perfectly ordinary agent, and
 * sending its owner off to connect something would send them looking for a
 * screen that could not help — and it says both of the things it might be,
 * because the manifest does not distinguish them. `no_key_held` is the one with
 * a real next step.
 */
export function describeNoChoice(
  reason: NoModelChoiceReason,
  providerLabel: string | null,
): NoModelChoice {
  switch (reason) {
    case "no_model_needed":
      return {
        can_choose: false,
        reason,
        headline: "This agent does not use a language model",
        detail:
          "Every step in its plan does something fixed — fetching, reading, writing a file — " +
          "so there is no model to choose and nothing here would change what it does.",
        next_action: null,
      };

    case "no_provider_key":
      return {
        can_choose: false,
        reason,
        headline: "DASH does not choose this agent's model",
        detail:
          "Its plan needs a language model, and DASH is not what decides which one. Either the " +
          "agent is set up with its own, or it names a service DASH has not been built to ask. " +
          "Either way there is no list of models DASH could show you, and it will not invent one.",
        next_action: null,
      };

    case "no_key_held":
      return {
        /*
         * "your … key" rather than "a … key", and the packaged capture is what
         * caught it: the first run photographed "Connect a OpenRouter key" at
         * every width. All three providers DASH brokers happen to start with a
         * vowel sound, so an article chosen by hand would be wrong for all of
         * them and a rule that picked one would be wrong for the first provider
         * that does not. "Your" is correct for every name and is the more
         * accurate word anyway — the key is one from the person's own account.
         */
        can_choose: false,
        reason,
        headline: `Connect your ${providerLabel ?? "provider"} key to choose a model`,
        detail:
          "This agent's plan needs a language model, and DASH holds no key for the service it " +
          "named. Until it does there is nothing to choose between — DASH will not offer you a " +
          "menu it has not been able to ask for.",
        next_action: "Connect the key on the Connections page",
      };
  }
}

/**
 * What DASH says once there really is a choice to make.
 *
 * The detail names what the default does, because the default is what almost
 * everybody should leave it on and a control whose recommended setting is
 * unexplained is a control people change for no reason.
 */
export function describeChoiceAvailable(
  providerLabel: string,
  stepCount: number,
): { headline: string; detail: string } {
  return {
    headline: `Choose which ${providerLabel} model this agent uses`,
    detail:
      stepCount === 0
        ? "This agent was exported before its steps could say what they need, so DASH has no " +
          "per-step answer for it. Pick one model and every step that needs one will use it."
        : stepCount === 1
          ? "One step in this agent's plan needs a model. Left as it is, that step runs at the " +
            "level its plan asked for; name a model instead and it uses that one."
          : `${String(stepCount)} steps in this agent's plan need a model, and they do not all ` +
            "need the same strength. Left as it is, each runs at the level its plan asked for; " +
            "name a model instead and every one of them uses that.",
  };
}

/* ---------------------------------------------------------------------- *
 * What is in force, in one sentence
 * ---------------------------------------------------------------------- */

/**
 * What DASH would use right now, said plainly.
 *
 * The one sentence a person reads to know where they stand, and it is written to
 * be true whether or not they have ever opened the control. It names the model
 * when a model is named and describes the levels when it is not; it never
 * reports a level as though it were a model, because the whole point of a level
 * is that no model has been picked yet.
 */
export function describeInForce(
  effective: EffectiveModelChoice,
  steps: readonly ResolvedModelStep[],
  /** The same steps run through the ladder. Empty exactly when `steps` is. */
  resolutions: readonly StepModelResolution[] = [],
): string {
  const choice = effective.choice;
  if (effective.resolved_by === "agent_pin" && choice.kind === "one_model") {
    return `Every step that needs a model uses ${choice.model_id}.`;
  }

  if (steps.length === 0) {
    /*
     * MAR-642's second sentence, and it survives here and only here: an agent
     * whose plan declares no levels has nothing per-step to say, so what it runs
     * on really is one whole-agent setting that moves when the default moves. A
     * person reading it is looking at something they change on the AI tab, and a
     * surface that printed the pinned sentence for this state would make that
     * invisible until it surprised somebody.
     */
    return choice.kind === "one_model"
      ? `Every step that needs a model uses ${choice.model_id}, which is the model DASH uses ` +
          "unless an agent says otherwise. Pick one below to pin this agent to it."
      : "DASH has no per-step answer for this agent, so nothing here is set.";
  }

  /*
   * MAR-654. The sentence names models rather than levels as soon as any level
   * resolves to one, because that is what the person is now able to decide. The
   * level sentences below are what is left when nothing resolves — which is
   * every DASH before somebody mapped a row or set a default, unchanged.
   */
  const models = [
    ...new Set(
      resolutions.flatMap((one) => (one.model_id === null ? [] : [one.model_id])),
    ),
  ];
  const unanswered = resolutions.filter((one) => one.resolved_by === "none").length;
  const answered = resolutions.length - unanswered;

  if (models.length === 1) {
    const only = String(models[0]);
    if (unanswered === 0) {
      return steps.length === 1
        ? `The one step that needs a model uses ${only}.`
        : `All ${String(steps.length)} steps that need a model use ${only}.`;
    }
    return (
      `${String(answered)} of this agent's ${String(steps.length)} steps use ${only}, and ` +
      `${unanswered === 1 ? "one has" : `${String(unanswered)} have`} no model at all. Each ` +
      "step below says which."
    );
  }
  if (models.length > 1) {
    return (
      `${String(steps.length)} steps need a model and they do not all get the same one — ` +
      `${String(models.length)} models between them` +
      `${unanswered === 0 ? "" : `, and ${String(unanswered)} with none at all`}. ` +
      "Each step below says which."
    );
  }

  const strongest = strongestLevel(steps.map((step) => step.level));
  const distinct = new Set(steps.map((step) => step.level));
  if (distinct.size === 1 && strongest !== null) {
    return steps.length === 1
      ? `The one step that needs a model asks for: ${levelLabel(strongest).toLowerCase()}.`
      : `All ${String(steps.length)} steps that need a model ask for the same thing: ${levelLabel(strongest).toLowerCase()}.`;
  }
  return (
    `${String(steps.length)} steps need a model and they ask for different strengths — ` +
    `the most demanding wants ${levelLabel(strongest ?? "frontier").toLowerCase()}.`
  );
}

/**
 * The sentence under the step disclosure when it is not in force.
 *
 * Returned rather than the disclosure being hidden, because hiding a control
 * whose settings still exist is how somebody comes back in a month and finds an
 * agent behaving in a way nothing on screen explains.
 */
export function describeStepsNotInForce(modelId: string): string {
  /*
   * MAR-654 took the second branch away, and the removal is the point.
   *
   * MAR-642 needed two sentences here because DASH's default *also* set the
   * levels aside — every step ran on one model whatever any level declared — so
   * the escape had to name the AI tab rather than this dropdown. A1.6 ends that:
   * a level with a row now beats the default, so an unpinned agent's levels are
   * live and decide something. This sentence is now reachable for exactly one
   * reason, which is the one it names.
   */
  return (
    `These are set aside while every step uses ${modelId}. They come back into force if you ` +
    "go back to matching each step."
  );
}

/**
 * Where a level is turned into a model (MAR-654, A1.6).
 *
 * A constant rather than a sentence composed on the page, for this module's own
 * rule — every sentence a person can reach here comes from the trusted side — and
 * because it is a promise about a control: it has to name the surface that
 * actually holds the map, and one place holding the words is one place to change
 * if that ever moves.
 */
export const LEVEL_MAP_LINK_LABEL = "Choose what each kind of step runs on";

/**
 * The picker's first option, which is the one almost nobody should change.
 *
 * It is not a fixed string, and that is MAR-642's doing. "Match each step to
 * what it needs" was the complete truth while nothing else could answer for an
 * agent that had chosen nothing; with a default set, leaving this alone means
 * using the default, and an option that still promised per-step matching would
 * be describing the state this agent is *not* in.
 */
export function describeUnpinnedOption(fleetDefault: FleetModelDefault | null): string {
  return fleetDefault === null
    ? "Match each step to what it needs"
    : `Use DASH's default — ${fleetDefault.model_id}`;
}

/* ---------------------------------------------------------------------- *
 * The AI tab (MAR-642)
 * ---------------------------------------------------------------------- */

/** What the AI tab says above the one dropdown on it. */
export interface FleetDefaultCopy {
  headline: string;
  detail: string;
  /** Where the setting stands, in one sentence. Never a promise about a run. */
  in_force: string;
}

/**
 * What DASH's default model is, said on the page that sets it.
 *
 * Three states and each says something different about what happens next. The
 * unset state is not an empty state — it is the state every DASH ships in — so
 * it describes the behaviour a person already has rather than scolding them for
 * not having chosen.
 *
 * **No sentence here claims a run will use this.** The default reaches an agent
 * that has chosen nothing *and* whose plan reaches the same provider; an agent
 * with its own model keeps it, and one that reaches a different provider is
 * untouched. So `in_force` says what the setting is and what it is for, and the
 * agent's own Settings stage — where the manifest is open and the provider is
 * known — is the only surface that says what any particular agent will use.
 */
export function describeFleetDefault(
  providerLabel: string | null,
  modelId: string | null,
  /** How many providers DASH holds a key for right now. */
  keysHeld: number,
): FleetDefaultCopy {
  const headline = "The model new agents use";
  const detail =
    "An agent that has not been given a model of its own uses this one. Choosing a model on " +
    "an agent's own page always wins, and changing this never moves an agent that has chosen.";

  if (modelId === null || providerLabel === null) {
    return {
      headline,
      detail,
      in_force:
        keysHeld === 0
          ? "No default yet. Add a key below and DASH can offer you the models it reaches."
          : "No default yet. Until you pick one, each agent is on whatever its own page says, " +
            "and an agent that says nothing runs each step at the strength its plan asked for.",
    };
  }

  return {
    headline,
    detail,
    in_force: `${modelId}, through your ${providerLabel} key.`,
  };
}

/* ---------------------------------------------------------------------- *
 * The level map on the AI tab (MAR-654, A1.6)
 * ---------------------------------------------------------------------- */

/**
 * What the three rows sit under.
 *
 * The section exists because the greyed per-step control on an agent's page was
 * honest and useless: it offered a *level*, and nothing in DASH turned a level
 * into a model. This is where that turning happens, and the detail says whose
 * decision it is — because the whole of the amendment is that the map is the
 * person's and DASH still ranks nothing.
 *
 * **Three rows and not three per agent.** Said here rather than left implicit:
 * the level vocabulary is fleet-wide by construction, so a person who maps
 * `Balanced` once has answered it for every agent whose plan asks for it, and the
 * per-agent escape is pinning that agent — which the detail points at.
 */
export function describeLevelModels(providerLabel: string | null): FleetDefaultCopy {
  return {
    headline: "What each kind of step runs on",
    detail:
      "Every agent's plan says how hard each of its steps is, and DASH does not decide what " +
      "that means — you do, here, once, for all of them. Leave a row empty and steps of that " +
      "kind use the default above. An agent that must run on something else can be pinned to " +
      "one model on its own page, which always wins.",
    in_force:
      providerLabel === null
        ? "Add a key below and DASH can offer you the models it reaches."
        : `Rows you set here are asked for through your ${providerLabel} key.`,
  };
}

/**
 * What one level row says when it has no model, or null when it has one.
 *
 * A1.6's three states, and the two written here are the ones that are not simply
 * a model id. Both name what actually happens rather than reporting an absence:
 * a level nobody has mapped is not broken, it is a level answered by the setting
 * one section up — and when there is no setting one section up either, the
 * consequence is a step that cannot run, said in those words rather than left for
 * somebody to discover at the end of a run.
 */
export function describeLevelModelRow(
  modelId: string | null,
  fleetDefaultModelId: string | null,
): string | null {
  if (modelId !== null) {
    return null;
  }
  return fleetDefaultModelId === null
    ? "No model chosen, and no default either. A step that asks for this cannot run."
    : `No model chosen. Steps that ask for this use ${fleetDefaultModelId}, DASH's default model.`;
}

/**
 * The line under one step's declared strength on the agent's own page (A1.6).
 *
 * The answer to *unfindable is the same as missing*: the map is in one place, and
 * every step that depends on it says which rung answered and where that rung is
 * set. Four sentences for the ladder's four rules, so a person can tell "you
 * chose this for Balanced steps" from "this is what everything unmapped falls
 * back to" without comparing two model ids on two screens.
 */
export function describeStepModel(resolution: StepModelResolution): string {
  const level = levelLabel(resolution.level).toLowerCase();
  switch (resolution.resolved_by) {
    case "agent_pin":
      return `Runs on ${String(resolution.model_id)}, the model this agent is pinned to.`;
    case "level_map":
      return `Runs on ${String(resolution.model_id)}, which you chose for ${level} steps.`;
    case "fleet_default":
      return (
        `Runs on ${String(resolution.model_id)}, DASH's default model. Nothing is set for ` +
        `${level} steps yet.`
      );
    case "none":
      return (
        `Nothing answers this step: no model is set for ${level} steps and DASH has no ` +
        "default. It cannot run until one of those is chosen."
      );
  }
}

/** What the keys section of the AI tab says, per how many are connected. */
export function describeKeysHeld(held: number, offered: number): string {
  if (held === 0) {
    return offered === 1
      ? "DASH holds no key yet. One service, and a key from it is what lets your agents think."
      : `DASH holds no key yet. ${String(offered)} services can give you one, and a key from ` +
          "any of them is what lets your agents think.";
  }
  if (held === offered) {
    return held === 1
      ? "DASH holds your key for the one service it can use."
      : `DASH holds a key for all ${String(offered)} services it can use.`;
  }
  return held === 1
    ? `DASH holds 1 key. ${String(offered - held)} more can be added.`
    : `DASH holds ${String(held)} keys. ${String(offered - held)} more can be added.`;
}

/**
 * What *See what {service} offers* produced, in one line (MAR-742).
 *
 * ## Why this is a function and not three string literals
 *
 * Because it *was* three string literals, and one of the three renderers did
 * not have them. `ModelDefault` on the AI tab and `ModelChoice` on an agent's
 * page both drew this sentence inline; `ChiefModelPicker` in the chief's
 * composer drew nothing at all, and rendered its outcome **only when the ask
 * failed** — so both states that are not failures were silent. Henrik pressed
 * the button on 2026-08-24, the catalogue came back, and nothing on screen
 * changed: the evidence addendum's second defect.
 *
 * That is a trap this codebase has hit before — two renderers drawing one
 * thing, and a fix applied to one of them. A shared sentence makes the silence
 * structurally impossible rather than fixed once: a fourth picker cannot be
 * written without either calling this or visibly choosing not to.
 *
 * ## Why an empty list is its own branch
 *
 * Because it is the state that looks exactly like nothing having happened. A
 * provider that names no models leaves the dropdown holding what it held
 * before, so without a sentence the person has pressed a button and been told
 * nothing — indistinguishable from the button being broken. "Answered, and
 * named nothing" is a real answer, and says so.
 *
 * `models` is null before anything has been asked, which is not the same as an
 * empty list: null is DASH having no answer, `[]` is the provider's answer.
 */
export function describeCatalogueResult(service: string, models: readonly string[] | null): string {
  if (models === null) {
    return (
      `DASH will present the key it holds to ${service} and list what that key can reach. ` +
      "It keeps no copy of the list."
    );
  }
  if (models.length === 0) {
    return `${service} answered, and named nothing this key can reach.`;
  }
  return (
    `${String(models.length)} to choose from, as ${service} answered a moment ago. ` +
    "DASH keeps no copy of the list."
  );
}

/* ---------------------------------------------------------------------- *
 * What travels in a deploy bundle (MAR-583)
 * ---------------------------------------------------------------------- */

/**
 * The choice, as a document that can go on a server.
 *
 * **Configuration and never a credential.** There is no key in this shape and
 * there is no field one could be put in: what travels is which model the person
 * picked and what each step asked for, which is a setting, and the key stays in
 * this computer's vault. `produceAgentFolderBundle` refuses the deploy outright
 * for the case where that difference would matter — see its own note.
 *
 * Levels are frozen into it rather than left to be re-read from the manifest on
 * the far side. The manifest travels in the same bundle, so re-reading would
 * agree today; freezing them means the document says what DASH resolved,
 * including a person's overrides, which the manifest does not know about.
 */
export interface BundledModelChoice {
  agent_id: string;
  choice: AgentModelChoice["kind"];
  /** Set exactly when `choice` is `one_model`. */
  provider_id: string | null;
  model_id: string | null;
  steps: Array<{ step: number; level: DefaultModelLevel }>;
  /**
   * What each level means to this person, frozen (MAR-654).
   *
   * Carried for the reason `steps` is carried rather than re-read: the far side
   * has the manifest and could recompute a level, and it has nothing at all that
   * could recompute a person's map. Only rows naming this agent's own provider
   * travel, because a row for another provider is not part of this agent's
   * answer and would be a fact about the person's other keys sitting in a file on
   * somebody's server.
   *
   * Still configuration and still never a credential: `MODEL_KEY_STAYS_HOME_REFUSAL`
   * is what fires when the arrangement means these names could not be reached
   * anyway, and it now names three models it could not reach instead of one.
   */
  level_models: Array<{ level: DefaultModelLevel; provider_id: string; model_id: string }>;
}

/**
 * The document, from what DASH resolved.
 *
 * Pure, and it takes the resolved steps rather than a manifest, so the one place
 * a level is decided stays `resolveModelSteps` — a second resolution here would
 * be free to disagree with the one the person is looking at on screen.
 */
export function bundledModelChoice(
  agentId: string,
  choice: AgentModelChoice,
  steps: readonly ResolvedModelStep[],
  /** The person's rows for this agent's provider. Empty on an unconfigured DASH. */
  levelModels: LevelModelMap = new Map(),
): BundledModelChoice {
  return {
    agent_id: agentId,
    choice: choice.kind,
    provider_id: choice.kind === "one_model" ? choice.provider_id : null,
    model_id: choice.kind === "one_model" ? choice.model_id : null,
    steps: steps.map((step) => ({ step: step.step, level: step.level })),
    level_models: [...levelModels.entries()]
      .map(([level, row]) => ({
        level,
        provider_id: row.provider_id,
        model_id: row.model_id,
      }))
      .sort((a, b) => DEFAULT_MODEL_LEVELS.indexOf(a.level) - DEFAULT_MODEL_LEVELS.indexOf(b.level)),
  };
}

/**
 * Why a bundle was refused over its model, in DASH's own words.
 *
 * Exported as a constant for `MANIFEST_ONLY_DEPLOY_REFUSAL`'s reason: it reaches
 * the audited command result, a test pins it by value, and a sentence composed
 * where the refusal happens is a sentence that gets reworded by the next person
 * who touches that function.
 *
 * It says the *smaller true thing*. Not "this agent cannot run there" — DASH has
 * no idea what is on that server — but "the key DASH holds is not going, so the
 * copy DASH would put there has nothing to reach a model with". That is a fact
 * about what DASH does, which is the only kind of claim `lib/server-card.ts`
 * lets DASH make about somebody else's machine.
 */
export const MODEL_KEY_STAYS_HOME_REFUSAL =
  "This agent's plan needs a language model, and the key for it is one DASH keeps in this " +
  "computer's vault. DASH does not send keys to a server, so the copy it would put there " +
  "would have no way to reach a model. Nothing was sent.";

/* ---------------------------------------------------------------------- *
 * The run record
 * ---------------------------------------------------------------------- */

/**
 * One step of one run, as DASH resolved it at first sight of that run (A1.5).
 *
 * A `run_step_models` row. Frozen with the `run_models` row beside it and never
 * revised, so somebody who changes a level map halfway through a run cannot
 * change what an already-started run reports it began under.
 */
export interface RunStepModel {
  step: number;
  level: DefaultModelLevel;
  provider_id: string;
  model_id: string;
  resolved_by: ModelResolvedBy;
}

/**
 * What DASH's setting was, as one of three things (MAR-654).
 *
 * `AgentModelChoice` plus one member, and the member is what A1.5 adds: a
 * setting that was a **table** rather than a model. `matched` names its provider
 * and no model id, because "the setting was a table" is not a model id and must
 * not be squeezed into a column shaped for one; the models are the `steps`
 * beside it, one row per step that resolved to something.
 *
 * No new member joins `AgentModelChoice` itself — A1.3's rule. That type is what
 * a *person chose*, and a person still chooses between two things. This one is
 * what DASH *resolved*, which is a different question with a third answer.
 */
export type RunModelSetting =
  | AgentModelChoice
  | { kind: "matched"; provider_id: string; steps: readonly RunStepModel[] };

/**
 * What DASH's setting was when one run started.
 *
 * Stored per run and never revised — see `lib/ai/model-store.ts` for why the
 * first observation wins. `recorded_at` is DASH's own clock, so this is a fact
 * DASH witnessed rather than one an agent reported.
 */
export interface RunModelRecord {
  choice: RunModelSetting;
  recorded_at: string;
}

/** Distinct models a setting names, in step order. Empty for `match_each_step`. */
export function settingModels(setting: RunModelSetting): string[] {
  if (setting.kind === "one_model") {
    return [setting.model_id];
  }
  if (setting.kind !== "matched") {
    return [];
  }
  return [...new Set(setting.steps.map((step) => step.model_id))];
}

/**
 * The two things DASH can know about a run's model, kept apart.
 *
 * They are different **kinds** of fact and are carried separately for ADR 0005's
 * reason, which is the same argument `broker_lapses` makes about an attempt
 * nobody adjudicated: a thing DASH observed and a thing somebody told DASH are
 * not interchangeable, and keeping them apart in the data model rather than only
 * in the copy is what stops a careless renderer merging them.
 *
 * - `setting` is DASH's own record of what it was configured to do. DASH wrote
 *   it, from its own clock, at the moment it first saw the run.
 * - `reported` is what the **run itself said**, in `model` on its own events.
 *   That field has been in telemetry v1 since the contract was frozen and no
 *   surface in DASH had ever drawn it; MAR-583 is the first thing that needs it.
 *   It is the agent's claim about its own past, from a process DASH does not sit
 *   inside — which makes it the *better* answer to "which model ran" and still
 *   not an observation DASH made.
 *
 * **There is still no cost here, and that is now a choice about this surface
 * rather than about DASH.** Telemetry v1 also carries `cost_usd`. MAR-583 left
 * it unread because MAR-299 needed a story about whose number that is; MAR-545
 * settled it — DASH shows amounts other people stated and says who — and
 * `lib/views/ask.ts` reads the field, attributing the total to the agent that
 * reported it.
 *
 * This type stays free of it anyway. It answers "which model ran", and folding
 * an amount in because the field happened to be next to `model` is exactly how
 * an unattributed number reaches a screen — the sentence that says whose figure
 * it is has to travel with the figure, and there is nowhere here to put one.
 */
export interface RunModelStanding {
  setting: RunModelRecord | null;
  /** Distinct models the run reported, in the order its events named them. */
  reported: readonly string[];
}

/**
 * What a run row says about its model.
 *
 * Short, because it goes in a list beside a status and a time. The long form is
 * `describeRunModelDetail`, which the run's own page has room for.
 *
 * The run's own report wins when there is one, because it is the answer to the
 * question actually being asked — *which model ran* — while the setting answers
 * *what DASH would have told it to use*. When there is none, the setting is what
 * DASH has, and the detail says whose fact it is either way.
 *
 * **Never a cost.** There is no field here for one and there will not be until
 * MAR-299 has numbers it can say whose they are.
 */
export function describeRunModel(standing: RunModelStanding): string | null {
  if (standing.reported.length === 1) {
    return standing.reported[0] ?? null;
  }
  if (standing.reported.length > 1) {
    return `${String(standing.reported.length)} models`;
  }
  if (standing.setting === null) {
    return null;
  }
  /*
   * MAR-654. The `"N models"` branch above was written for the reported side and
   * had nothing to draw on this one, because a setting was one model or it was
   * nothing. A1.5 makes it reachable from both: a setting that was a table names
   * as many models as the person's map and DASH's default between them resolved.
   */
  const models = settingModels(standing.setting.choice);
  if (models.length === 1) {
    return models[0] ?? null;
  }
  return models.length > 1 ? `${String(models.length)} models` : "Matched to each step";
}

/**
 * The same fact, with whose fact it is.
 *
 * Every branch names its source. DASH did not watch a model answer — it makes no
 * completion call — so a sentence that said "this run used X" without saying who
 * says so would be DASH reporting somebody else's claim in its own voice, which
 * is the failure `lib/server-card.ts` exists to avoid one machine along.
 *
 * The disagreement branch is the one worth having. A run that reported a model
 * DASH was not set to use is a real and interesting event — a agent ignoring its
 * configuration, or a configuration changed after the run — and reporting only
 * one of the two would hide it.
 */
export function describeRunModelDetail(standing: RunModelStanding): string | null {
  const setting = standing.setting;
  const resolved = setting === null ? [] : settingModels(setting.choice);

  if (standing.reported.length > 0) {
    const said =
      standing.reported.length === 1
        ? `used ${String(standing.reported[0])}`
        : `used ${String(standing.reported.length)} different models across its steps`;
    /*
     * MAR-654. An equality became a comparison, because the left side stopped
     * being one model. A model DASH resolved that the run never named is the
     * interesting case either way — an agent ignoring its configuration, or a
     * configuration changed after the run — and it is reported rather than
     * resolved, which is decision 4's rule and is unchanged.
     */
    const unmet = resolved.filter((id) => !standing.reported.includes(id));
    const mismatch =
      unmet.length === 0
        ? ""
        : resolved.length === 1
          ? ` DASH was set to give it ${String(unmet[0])}, so the two do not agree.`
          : ` DASH had resolved ${listModels(resolved)} for its steps, and it did not name ` +
            `${listModels(unmet)}, so the two do not agree.`;
    return (
      `This run reported that it ${said}. That is the agent's own account of its work — DASH ` +
      `does not sit between this agent and its provider, so it is repeating what it was told ` +
      `rather than something it watched.${mismatch}`
    );
  }

  if (setting === null) {
    return null;
  }
  if (resolved.length === 1) {
    return (
      `When this run started, this agent was set to use ${String(resolved[0])}. The run itself ` +
      "said nothing about which model it used, and DASH does not sit between this agent and " +
      "its provider — so this is DASH's record of the setting and not a report of what happened."
    );
  }
  if (resolved.length > 1) {
    /*
     * MAR-654. The setting was a table, so the sentence names what each kind of
     * step was resolved to rather than one model. Still DASH's own record of its
     * own setting, and still not a report of what happened.
     */
    return (
      `When this run started, DASH had a model for each kind of step this agent's plan asks ` +
      `for: ${listModels(resolved)}. The run itself said nothing about which of them it used, ` +
      "and DASH does not sit between this agent and its provider — so this is DASH's record of " +
      "the setting and not a report of what happened."
    );
  }
  return (
    "When this run started, this agent was set to match each step to the level its plan asked " +
    "for. The run itself said nothing about which model it used, and DASH holds no record of " +
    "it: DASH does not sit between this agent and its provider."
  );
}

/** Model ids in a sentence, as a list a person reads rather than a JSON array. */
function listModels(models: readonly string[]): string {
  if (models.length <= 1) {
    return String(models[0] ?? "");
  }
  return `${models.slice(0, -1).join(", ")} and ${String(models[models.length - 1])}`;
}

/* ---------------------------------------------------------------------- *
 * The copy sweep
 * ---------------------------------------------------------------------- */

/** Every sentence this module can produce, for the plain-language check. */
export function everyModelChoiceSentence(): string[] {
  const reasons: NoModelChoiceReason[] = ["no_model_needed", "no_provider_key", "no_key_held"];
  const steps: ResolvedModelStep[] = [
    { step: 1, component_id: "a", level: "cheap", declared: "cheap", overridden: false },
    { step: 2, component_id: "b", level: "frontier", declared: "standard", overridden: true },
  ];
  const named: AgentModelChoice = {
    kind: "one_model",
    provider_id: "openrouter",
    model_id: "a-model",
  };
  /** The unpinned, unanswered agent every DASH ships with. */
  const unresolved: EffectiveModelChoice = { choice: matchEachStep(), resolved_by: "none" };
  const resolution = (
    step: number,
    modelId: string | null,
    resolvedBy: ModelResolvedBy,
  ): StepModelResolution => ({
    step,
    component_id: `c${String(step)}`,
    level: "standard",
    provider_id: modelId === null ? null : "openrouter",
    model_id: modelId,
    resolved_by: resolvedBy,
  });
  /** MAR-654. A setting that was a table: two steps, two models. */
  const matchedSetting: RunModelSetting = {
    kind: "matched",
    provider_id: "openrouter",
    steps: [
      {
        step: 3,
        level: "cheap",
        provider_id: "openrouter",
        model_id: "a-model",
        resolved_by: "fleet_default",
      },
      {
        step: 4,
        level: "standard",
        provider_id: "openrouter",
        model_id: "b-model",
        resolved_by: "level_map",
      },
    ],
  };

  return [
    ...reasons.flatMap((reason) => {
      const sentence = describeNoChoice(reason, "OpenRouter");
      return [
        sentence.headline,
        sentence.detail,
        ...(sentence.next_action === null ? [] : [sentence.next_action]),
      ];
    }),
    ...[0, 1, 2].flatMap((count) => {
      const sentence = describeChoiceAvailable("OpenRouter", count);
      return [sentence.headline, sentence.detail];
    }),
    describeInForce(unresolved, []),
    describeInForce(unresolved, steps.slice(0, 1)),
    describeInForce(unresolved, steps),
    describeInForce(unresolved, [{ ...steps[1]!, level: "frontier" }]),
    describeStepsNotInForce("a-model"),
    /*
     * MAR-642's branches, every one of them, and MAR-654's beside them. The gate
     * only ever sees a string a fixture reaches — the lesson MAR-620 wrote down
     * about an optional field no fixture populated — and each of these is a
     * *second* branch of a function whose first branch was already swept, which
     * is precisely the shape that ships unchecked.
     */
    describeInForce({ choice: named, resolved_by: "agent_pin" }, steps),
    describeInForce({ choice: named, resolved_by: "fleet_default" }, []),
    // One model for every step, two models across them, and each of those with a
    // step the ladder could not answer at all.
    ...[
      [resolution(3, "a-model", "fleet_default"), resolution(4, "a-model", "fleet_default")],
      [resolution(3, "a-model", "fleet_default"), resolution(4, "b-model", "level_map")],
      [resolution(3, "a-model", "fleet_default"), resolution(4, null, "none")],
      [
        resolution(3, "a-model", "fleet_default"),
        resolution(4, "b-model", "level_map"),
        resolution(5, null, "none"),
      ],
    ].map((resolutions) =>
      describeInForce(
        { choice: named, resolved_by: "fleet_default" },
        resolutions.map((one) => ({
          step: one.step,
          component_id: one.component_id,
          level: one.level,
          declared: one.level,
          overridden: false,
        })),
        resolutions,
      ),
    ),
    describeUnpinnedOption(null),
    describeUnpinnedOption({ provider_id: "openrouter", model_id: "a-model" }),
    ...[
      describeFleetDefault(null, null, 0),
      describeFleetDefault(null, null, 1),
      describeFleetDefault("OpenRouter", "a-model", 1),
    ].flatMap((copy) => [copy.headline, copy.detail, copy.in_force]),
    ...[
      [0, 1],
      [0, 3],
      [1, 1],
      [3, 3],
      [1, 3],
      [2, 3],
    ].map(([held, offered]) => describeKeysHeld(held as number, offered as number)),
    /*
     * MAR-654's own branches, every one of them, on MAR-620's terms: the gate
     * only ever sees a string a fixture reaches, and each of these is a branch of
     * a function whose other branches were already swept — precisely the shape
     * that ships unchecked.
     */
    ...[describeLevelModels(null), describeLevelModels("OpenRouter")].flatMap((copy) => [
      copy.headline,
      copy.detail,
      copy.in_force,
    ]),
    describeLevelModelRow(null, null) ?? "",
    describeLevelModelRow(null, "a-model") ?? "",
    ...(
      [
        { resolved_by: "agent_pin", model_id: "a-model" },
        { resolved_by: "level_map", model_id: "a-model" },
        { resolved_by: "fleet_default", model_id: "a-model" },
        { resolved_by: "none", model_id: null },
      ] as const
    ).map((rung) =>
      describeStepModel({
        step: 3,
        component_id: "c",
        level: "standard",
        provider_id: rung.model_id === null ? null : "openrouter",
        model_id: rung.model_id,
        resolved_by: rung.resolved_by,
      }),
    ),
    ...(
      [
        { setting: { choice: named, recorded_at: "2026-08-10T09:00:00Z" }, reported: [] },
        {
          setting: { choice: matchEachStep(), recorded_at: "2026-08-10T09:00:00Z" },
          reported: [],
        },
        { setting: null, reported: ["a-model"] },
        { setting: null, reported: ["a-model", "b-model"] },
        // The disagreement branch: DASH was set to give it one model and the run
        // said it used another.
        {
          setting: { choice: named, recorded_at: "2026-08-10T09:00:00Z" },
          reported: ["b-model"],
        },
        // MAR-654. The setting was a table — the `"N models"` branch, now
        // reachable from the left column — reported and unreported, agreeing and
        // not. The last is the case A1.5 calls the interesting one: DASH resolved
        // two models for two steps and the run named neither.
        { setting: { choice: matchedSetting, recorded_at: "2026-08-10T09:00:00Z" }, reported: [] },
        {
          setting: { choice: matchedSetting, recorded_at: "2026-08-10T09:00:00Z" },
          reported: ["a-model", "b-model"],
        },
        {
          setting: { choice: matchedSetting, recorded_at: "2026-08-10T09:00:00Z" },
          reported: ["c-model"],
        },
      ] satisfies RunModelStanding[]
    ).flatMap((standing) => [
      describeRunModel(standing) ?? "",
      describeRunModelDetail(standing) ?? "",
    ]),
  ];
}
