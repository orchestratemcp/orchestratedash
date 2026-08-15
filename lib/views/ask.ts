/**
 * The chat on an agent's page, joined from five places (MAR-545).
 *
 * The manifest says whether this agent has a model provider at all,
 * `lib/ai/connection-view.ts` says whether DASH holds a key for it,
 * `lib/ai/model-store.ts` says which model to ask under, `lib/store.ts` says
 * what the agent has saved, and `lib/ai/ask-store.ts` says what has already been
 * asked and what it cost. This module is the join and writes no sentence of its
 * own — `lib/copy/ask.ts` writes all of them, for the reason `lib/views/glance.ts`
 * states about itself: a sentence composed on the read path is a sentence the
 * copy sweep does not see.
 *
 * **Reads the store**, so it must never be imported by a page — the rule
 * `lib/views/build.ts` states for itself. A page imports the types.
 *
 * ## Why "which model" is suddenly a requirement
 *
 * MAR-583 gave an agent a per-step *level* — cheap, standard, frontier — and
 * deliberately no mapping from a level to a model name, because that mapping
 * belongs to the emitter's own ADR and a second copy in DASH would be the one
 * nobody updates. Nothing minded, because DASH made no completion call: it never
 * had to name a model to anybody.
 *
 * This is the first thing in DASH that does, and it cannot be answered by a
 * level. So an agent left on *match each step* has no name for DASH to ask
 * under, and the chat says so and points at the picker already on the same page
 * rather than choosing somebody's model for them. DASH does state the level of
 * its own question — see `describeUnavailable`'s wording for `no_model_chosen`:
 * answering from saved reports is summarising, which MAR-583's own argument puts
 * at the bottom of the scale, so a person can pick the cheapest thing their key
 * reaches without wondering whether it will be enough.
 */

import {
  MAX_ITEMS_PER_QUESTION,
  questionTerms,
  savedItems,
  type SavedItem,
} from "../ai/ask";
import {
  readExchanges,
  readSpendSummary,
  type AskExchange,
  type AskSpendSummary,
} from "../ai/ask-store";
import {
  aiKeyConnections,
  pickAiKeyCard,
  type AiKeyConnectionView,
} from "../ai/connection-view";
import { readEffectiveModelChoice } from "../ai/model-store";
import { aiProviderById } from "../ai/providers";
import {
  ASK_CUSTODY,
  ASK_HEADING,
  ASK_MODEL_CHANGE,
  ASK_PLACEHOLDER,
  ASK_SOURCES_HEADING,
  ASK_SUBMIT,
  ASK_WORKING,
  describeAmount,
  describeAskModel,
  describeAskFailure,
  describeAskPurpose,
  describeCharge,
  describeEstimate,
  describeReportedRunSpend,
  describeSelection,
  describeUnavailable,
  type AskFailureReason,
} from "../copy/ask";
import { plainMoment } from "../copy/when";
import type { ConnectionSourceManifest } from "../connections";
import { isDigestArtifact, type RunEvent } from "../contracts";
import { artifactRecordsForAgent } from "../store";
import type { AgentAskView, AskExchangeView } from "./types";

/**
 * How far back the chat looks for things to answer from.
 *
 * Wider than `PANEL_ARTIFACT_LIMIT`, because the two answer different questions:
 * a panel draws the newest report and this searches a history. Sixty reports of
 * a daily agent is two months, which is long enough for "everything you found
 * about X" to mean something and short enough that the read stays one indexed
 * query.
 */
export const ASK_ARTIFACT_LIMIT = 60;

/**
 * What this agent can be asked, and what it has been asked.
 *
 * The order of the refusals is the order a person would hit them, which is also
 * the order they can be fixed in: an agent with no provider at all is nobody's
 * to fix, a missing key is one click, a missing model choice is one click on the
 * same page, and an agent that has saved nothing needs a run.
 */
export function buildAgentAsk(
  agent: string,
  manifest: ConnectionSourceManifest,
  events: readonly RunEvent[] = [],
  /**
   * The author's `display_name`, for every sentence that names this agent.
   *
   * Separate from `agent`, which is the id the store and the flows are keyed by
   * — and separate because a packaged screenshot caught the two being one:
   * every sentence on the surface read "Ask answered about anything it has
   * saved", where `answered` was the agent's internal name. `lib/copy/identifiers.ts`
   * exists to keep exactly that off a guided path, and it cannot see it when the
   * value arrives at runtime.
   *
   * Defaulted to the id so a caller with nothing better is no worse off than
   * before, and `lib/views/build.ts` always has the real one.
   */
  title: string = agent,
): AgentAskView {
  const items = savedThingsForAgent(agent);
  const history = readExchanges(agent).map(toExchangeView);
  const reported = describeReportedRunSpend(...reportedRunSpend(events), title);

  const card = pickAiKeyCard(aiKeyConnections(agent, manifest));
  if (card === null) {
    return blocked(
      describeUnavailable("no_provider", { agent: title, service: null }),
      null,
      history,
      reported,
    );
  }
  if (!card.held) {
    return blocked(
      describeUnavailable("no_key", { agent: title, service: card.service }),
      card.connect,
      history,
      reported,
    );
  }

  /*
   * MAR-642. DASH's default counts as a model chosen, for this gate's purpose.
   *
   * The refusal below is the one a freshly imported agent used to hit: nothing
   * could be asked of it until somebody opened its Settings stage and picked a
   * model. A default is exactly the answer to that, so this reads the effective
   * choice — and `electron/ask-host.ts` reads the same one, through the same
   * function, so the page cannot offer a question main would then refuse.
   */
  const effective = readEffectiveModelChoice(agent, card.provider_id);
  const choice = effective.choice;
  if (choice.kind !== "one_model") {
    return blocked(
      describeUnavailable("no_model_chosen", { agent: title, service: card.service }),
      null,
      history,
      reported,
    );
  }
  if (items.length === 0) {
    return blocked(
      describeUnavailable("nothing_saved", { agent: title, service: card.service }),
      null,
      history,
      reported,
    );
  }

  const profile = aiProviderById(card.provider_id);
  const spend = readSpendSummary(agent);
  const statesCost = profile?.completion.prices_its_own_answer ?? false;

  return {
    can_ask: true,
    heading: ASK_HEADING,
    purpose: describeAskPurpose(title),
    custody: ASK_CUSTODY,
    placeholder: ASK_PLACEHOLDER,
    submit: ASK_SUBMIT,
    working: ASK_WORKING,
    sources_heading: ASK_SOURCES_HEADING,
    provider_label: card.provider_label,
    /*
     * MAR-648. The composer's settings row, from the choice this function has
     * already resolved for the gate above.
     *
     * Read once and used twice rather than read twice: the model the indicator
     * names and the model the gate accepted are the same fact, and a second
     * `readEffectiveModelChoice` here would be a second chance to draw a row
     * saying one thing while `electron/ask-host.ts` asks another.
     */
    model: {
      model_id: choice.model_id,
      from_default: effective.from_default,
      note: describeAskModel(effective.from_default),
      change_label: ASK_MODEL_CHANGE,
    },
    estimate: describeEstimate({
      items: Math.min(MAX_ITEMS_PER_QUESTION, items.length),
      available: items.length,
      provider_states_cost: statesCost,
      provider_label: card.provider_label,
      past_questions: spend.priced,
      past_total_usd: spend.total_usd,
      past_typical_usd: spend.typical_usd,
    }),
    ask: {
      agent_id: agent,
      connection_id: card.connection_id,
      field_id: card.field_id,
    },
    history,
    spent: describeSpent(spend, card.provider_label),
    reported,
  };
}

function blocked(
  recovery: ReturnType<typeof describeUnavailable>,
  connect: AiKeyConnectionView["connect"] | null,
  history: AskExchangeView[],
  reported: string | null,
): AgentAskView {
  return {
    can_ask: false,
    heading: ASK_HEADING,
    blocked: recovery,
    connect,
    history,
    sources_heading: ASK_SOURCES_HEADING,
    reported,
  };
}

/**
 * What this agent's own runs say they cost, and over how many runs (MAR-583's
 * unread field).
 *
 * **The first read of telemetry v1's `cost_usd` in DASH.** The argument for
 * reading it at all is on `describeReportedRunSpend`; what happens here is only
 * the arithmetic, and the arithmetic is a sum of figures agents stated rather
 * than a derivation of new ones.
 *
 * Counted per **run** and not per event, because a run reports a cost per step
 * and a total that counted events would say a six-step run was six runs. A run
 * that reported nothing is not counted at all, so an agent whose events carry no
 * cost gets a null rather than a total over a denominator of zero.
 *
 * Negative and non-finite values are dropped rather than clamped. A run
 * reporting a negative cost is a run reporting something DASH has no reading
 * for, and folding it into a total would let one bad event make an honest
 * number wrong.
 */
function reportedRunSpend(events: readonly RunEvent[]): [number | null, number] {
  const byRun = new Map<string, number>();
  for (const event of events) {
    const cost = event.cost_usd;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
      continue;
    }
    byRun.set(event.run_id, (byRun.get(event.run_id) ?? 0) + cost);
  }
  if (byRun.size === 0) {
    return [null, 0];
  }
  let total = 0;
  for (const amount of byRun.values()) {
    total += amount;
  }
  return [total, byRun.size];
}

/**
 * Every item this agent has saved, flattened.
 *
 * Digests only. A draft is a thing an agent *wrote*, not a thing it *found*, and
 * answering "what did you find about X" out of the agent's own drafts would be
 * quoting it back to itself. The union in `lib/contracts.ts` makes that a
 * decision somebody had to take rather than an oversight.
 */
export function savedThingsForAgent(agent: string): SavedItem[] {
  const records = artifactRecordsForAgent(agent, ASK_ARTIFACT_LIMIT);
  return savedItems(
    records
      .map((record) => record.artifact)
      .filter(isDigestArtifact)
      .map((artifact) => ({ artifact, run_id: artifact.run_id })),
  );
}

/**
 * What every question here has cost, or null.
 *
 * Null rather than "$0.00" when no provider has priced anything, which is the
 * whole discipline of this feature in one branch: DASH has no number, so DASH
 * shows no number.
 */
function describeSpent(spend: AskSpendSummary, providerLabel: string): string | null {
  if (spend.total_usd === null || spend.priced === 0) {
    return null;
  }
  const questions = spend.priced === 1 ? "1 question" : `${String(spend.priced)} questions`;
  return `${providerLabel} has charged ${describeAmount(spend.total_usd)} for the ${questions} asked here.`;
}

/**
 * One stored exchange as the page draws it.
 *
 * The sentences are composed here from stored facts rather than stored: what is
 * in the database is an enum, a count and an amount, and the words come from
 * `lib/copy/ask.ts` every time the page renders. So correcting a sentence
 * corrects it for every answer already on screen, which is what a copy module is
 * for — and a row written by an older build gets today's wording.
 */
function toExchangeView(exchange: AskExchange): AskExchangeView {
  const profile = aiProviderById(exchange.provider_id);
  const label = profile?.label ?? exchange.provider_id;
  return {
    id: exchange.id,
    question: exchange.question,
    asked: plainMoment(exchange.asked_at) ?? exchange.asked_at,
    answer: exchange.answer,
    failure:
      exchange.answer === null
        ? describeAskFailure(failureReason(exchange.failure), { service: label })
        : null,
    // The terms are re-derived from the question, which is a pure function of a
    // string DASH already has; the *basis* is read from the row, because that
    // one is not re-derivable — see the column's own note in `lib/db.ts`.
    selection: describeSelection(
      exchange.basis,
      questionTerms(exchange.question),
      exchange.citations.length,
    ),
    charge: describeCharge(
      {
        amount_usd: exchange.amount_usd,
        tokens_in: exchange.tokens_in,
        tokens_out: exchange.tokens_out,
        provider_states_cost: profile?.completion.prices_its_own_answer ?? false,
      },
      label,
    ),
    model: exchange.model_id,
    citations: exchange.citations.map((citation) => ({
      index: citation.index,
      headline: citation.headline,
      source_name: citation.source_name,
      item_url: citation.item_url,
      report_title: citation.report_title,
    })),
  };
}

/**
 * A stored failure string as one of the reasons that has a sentence.
 *
 * Anything unrecognised becomes `dash_error`, which is the honest reading of a
 * row this build cannot interpret: something went wrong on this computer, and
 * DASH cannot say what. It is also the only one of the seven that promises
 * nothing about whether a provider was reached, so it cannot make a false claim
 * about a charge.
 */
function failureReason(stored: string | null): AskFailureReason {
  const known: readonly AskFailureReason[] = [
    "not_connected",
    "answer_lost",
    "key_refused",
    "too_many",
    "provider_unavailable",
    "provider_refused",
    "empty_answer",
    "dash_error",
  ];
  return known.find((reason) => reason === stored) ?? "dash_error";
}
