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

/**
 * What is in force for one agent, and whose decision it was.
 *
 * `from_default` exists so a surface can say *which* — "you chose this" and
 * "this is what DASH uses unless you say otherwise" are different facts about
 * the same model id, and a person who cannot tell them apart cannot predict
 * what changing the default will do to this agent.
 *
 * Nothing persists this pair. `run_models` records the resolved `choice`,
 * because what a run started under is a model and not a provenance — a run that
 * ran on the default ran on that model, and by the time anybody reads the row
 * the default may be something else.
 */
export interface EffectiveModelChoice {
  choice: AgentModelChoice;
  /** True exactly when `choice` names a model this agent did not choose itself. */
  from_default: boolean;
}

/**
 * Fold the fleet default onto one agent's own choice.
 *
 * The whole precedence rule, in one pure function, so that the five places that
 * read a model — the agent's Settings stage, the chat, the broker's spend path,
 * the run record and the deploy bundle — cannot each have their own idea of it.
 *
 * Three rules, in order:
 *
 * 1. **An agent that chose wins.** Always, whatever the default says. This is
 *    the half Henrik stated twice, and it is first here so it cannot be reached
 *    around.
 * 2. **A default of another provider does not apply.** `agentProviderId` is the
 *    provider DASH would actually ask for this agent, resolved from its
 *    manifest. A default naming OpenRouter cannot answer an agent whose plan
 *    reaches Anthropic — the request would carry a model id that provider never
 *    published — so the honest answer for that agent is the one it had before a
 *    default existed. Null means the caller does not know which provider this
 *    agent uses, and an unknown provider is not a match: DASH does not guess
 *    which account gets billed.
 * 3. **Otherwise the default is what runs.**
 */
export function applyFleetDefault(
  agentChoice: AgentModelChoice,
  fleetDefault: FleetModelDefault | null,
  agentProviderId: string | null,
): EffectiveModelChoice {
  if (agentChoice.kind === "one_model") {
    return { choice: agentChoice, from_default: false };
  }
  if (
    fleetDefault === null ||
    agentProviderId === null ||
    fleetDefault.provider_id !== agentProviderId
  ) {
    return { choice: agentChoice, from_default: false };
  }
  return {
    choice: {
      kind: "one_model",
      provider_id: fleetDefault.provider_id,
      model_id: fleetDefault.model_id,
    },
    from_default: true,
  };
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
  choice: AgentModelChoice,
  steps: readonly ResolvedModelStep[],
  fromDefault = false,
): string {
  if (choice.kind === "one_model") {
    /*
     * MAR-642. The same model, and whose decision it was.
     *
     * Said here rather than left to the page, because the two sentences differ
     * in what they predict: a person reading the first can change this agent
     * and nothing else, and a person reading the second is looking at a
     * setting that moves when they change the default on the AI tab. A surface
     * that printed one sentence for both states would make the second
     * invisible until it surprised somebody.
     */
    return fromDefault
      ? `Every step that needs a model uses ${choice.model_id}, which is the model DASH uses ` +
          "unless an agent says otherwise. Pick one below to pin this agent to it."
      : `Every step that needs a model uses ${choice.model_id}.`;
  }
  if (steps.length === 0) {
    return "DASH has no per-step answer for this agent, so nothing here is set.";
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
export function describeStepsNotInForce(modelId: string, fromDefault = false): string {
  /*
   * MAR-642. The second sentence is a promise about a control, so it has to be
   * true of the control it is under. "Go back to matching each step" is what
   * the picker's first option did before a default existed; with one set, that
   * option lands on the default and these stay set aside — so the escape it
   * names is the AI tab rather than this dropdown.
   */
  return fromDefault
    ? `These are set aside while every step uses ${modelId}, DASH's default model. They come ` +
        "back into force if you clear the default on the AI tab."
    : `These are set aside while every step uses ${modelId}. They come back into force if you ` +
        "go back to matching each step.";
}

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
): BundledModelChoice {
  return {
    agent_id: agentId,
    choice: choice.kind,
    provider_id: choice.kind === "one_model" ? choice.provider_id : null,
    model_id: choice.kind === "one_model" ? choice.model_id : null,
    steps: steps.map((step) => ({ step: step.step, level: step.level })),
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
 * What DASH's setting was when one run started.
 *
 * Stored per run and never revised — see `lib/ai/model-store.ts` for why the
 * first observation wins. `recorded_at` is DASH's own clock, so this is a fact
 * DASH witnessed rather than one an agent reported.
 */
export interface RunModelRecord {
  choice: AgentModelChoice;
  recorded_at: string;
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
  return standing.setting.choice.kind === "one_model"
    ? standing.setting.choice.model_id
    : "Matched to each step";
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
  const named = setting?.choice.kind === "one_model" ? setting.choice.model_id : null;

  if (standing.reported.length > 0) {
    const said =
      standing.reported.length === 1
        ? `used ${String(standing.reported[0])}`
        : `used ${String(standing.reported.length)} different models across its steps`;
    const mismatch =
      named !== null && !standing.reported.includes(named)
        ? ` DASH was set to give it ${named}, so the two do not agree.`
        : "";
    return (
      `This run reported that it ${said}. That is the agent's own account of its work — DASH ` +
      `does not sit between this agent and its provider, so it is repeating what it was told ` +
      `rather than something it watched.${mismatch}`
    );
  }

  if (setting === null) {
    return null;
  }
  if (named !== null) {
    return (
      `When this run started, this agent was set to use ${named}. The run itself said nothing ` +
      "about which model it used, and DASH does not sit between this agent and its provider — " +
      "so this is DASH's record of the setting and not a report of what happened."
    );
  }
  return (
    "When this run started, this agent was set to match each step to the level its plan asked " +
    "for. The run itself said nothing about which model it used, and DASH holds no record of " +
    "it: DASH does not sit between this agent and its provider."
  );
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
    describeInForce(matchEachStep(), []),
    describeInForce(matchEachStep(), steps.slice(0, 1)),
    describeInForce(matchEachStep(), steps),
    describeInForce(matchEachStep(), [{ ...steps[1]!, level: "frontier" }]),
    describeStepsNotInForce("a-model"),
    /*
     * MAR-642's branches, every one of them. The gate only ever sees a string a
     * fixture reaches — the lesson MAR-620 wrote down about an optional field no
     * fixture populated — and each of these is a *second* branch of a function
     * whose first branch was already swept, which is precisely the shape that
     * ships unchecked.
     */
    describeInForce(named, steps, true),
    describeStepsNotInForce("a-model", true),
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
      ] satisfies RunModelStanding[]
    ).flatMap((standing) => [
      describeRunModel(standing) ?? "",
      describeRunModelDetail(standing) ?? "",
    ]),
  ];
}
