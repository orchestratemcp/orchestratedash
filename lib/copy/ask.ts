/**
 * Everything the conversation says, in one file (MAR-545).
 *
 * The rule this directory keeps: a sentence composed in a component is a
 * sentence the copy sweep does not see. So the chat's component draws fields and
 * writes none of its own words, and every string a person reads while asking an
 * agent a question is here, where `tests/copy-ask.test.ts` can hold all of them
 * to `lib/copy/identifiers.ts` at once.
 *
 * ## The word this feature must never use
 *
 * **Artifact.** MAR-545's own acceptance is "someone who has never heard the
 * word *artifact* asks their news agent a question and reads the answer", and
 * the surface is the first one in DASH built entirely for a person who does not
 * know DASH's vocabulary. There is no run id, no artifact id and no
 * connection id anywhere in this file. What an agent saved is *what it has
 * saved*, a digest is *a report*, and a run is not mentioned at all — a person
 * asking what their agent found is not thinking about runs, so introducing the
 * idea in the answer would be DASH teaching its filing system to somebody who
 * came for the news.
 *
 * ## The word this feature must never guess
 *
 * An **amount**. Every figure with a currency symbol in it that DASH shows about
 * a question was stated by the provider that charged it, and `describeAmount`
 * is the only function here that formats one. There is no rate table, no
 * multiplication and no conversion: see `AnswerCharge` in `lib/ai/ask.ts` for
 * the argument, and `docs/adr/0012-talking-to-an-agent.md` for the decision.
 */

import type { AnswerCharge, SelectionBasis } from "../ai/ask";
import type { Recovery } from "./recovery";

/** Headline plus supporting line, the shape every other copy module returns. */
export interface AskSentence {
  headline: string;
  detail: string;
}

/* ---------------------------------------------------------------------- *
 * Money
 * ---------------------------------------------------------------------- */

/**
 * An amount somebody else charged, as a person reads it.
 *
 * Four decimal places rather than two, because two is a lie about this
 * particular number: a question answered by a small model costs a fraction of a
 * cent, and `$0.00` beside a real charge reads as free. A figure too small to
 * write in four places is said in words rather than rounded to zero, for the
 * same reason.
 *
 * Trailing zeros are kept past the cent so that two answers' costs line up when
 * they are read down a column — `$0.0030` and `$0.0031` compare at a glance and
 * `$0.003` and `$0.0031` do not.
 *
 * The dollar sign is the provider's currency and not the reader's, which the
 * sentences below say out loud once rather than hiding in a symbol.
 */
export function describeAmount(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) {
    return "an amount DASH could not read";
  }
  if (usd === 0) {
    return "nothing";
  }
  if (usd < 0.0001) {
    return "less than $0.0001";
  }
  return usd >= 0.01 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`;
}

/** A count of words-ish units a provider charged for, worded. */
function describeTokens(count: number): string {
  return count === 1 ? "1 piece of text" : `${count.toLocaleString("en-US")} pieces of text`;
}

/* ---------------------------------------------------------------------- *
 * Before the question runs
 * ---------------------------------------------------------------------- */

/**
 * What DASH knows about the cost of a question it has not asked yet.
 *
 * Three facts, and each of them is something DASH either decided itself or was
 * told by a provider. `items` and `available` are counts DASH made from its own
 * store; `past_questions`, `past_total_usd` and `past_typical_usd` are sums and
 * medians **of amounts providers stated**, which is why a sum of nothing is null
 * rather than zero.
 */
export interface AskEstimateFacts {
  /**
   * The most saved things this question could send.
   *
   * A **ceiling DASH set**, not a prediction of what a particular question will
   * select — the page cannot know that without the saved items themselves, and
   * shipping every headline to the renderer on a five-second poll to compute a
   * number would cost more than the number is worth. What was actually selected
   * is reported afterwards, beside the answer, where it is a fact instead of a
   * guess.
   */
  items: number;
  /** How many the agent has saved in total. */
  available: number;
  /** Whether this provider states what an answer cost. */
  provider_states_cost: boolean;
  provider_label: string;
  /** How many questions have been answered on this agent already. */
  past_questions: number;
  /** What those cost in total, when the provider priced them. Null otherwise. */
  past_total_usd: number | null;
  /** The middle of what they cost, for a comparison a person can use. */
  past_typical_usd: number | null;
}

/**
 * What sending this question will do, before somebody presses the button.
 *
 * The headline is about **size**, not money, and that ordering is the decision.
 * Size is the thing DASH knows for certain and the thing a person can change —
 * a narrower question sends fewer reports — so it leads. Money follows, and only
 * ever by quoting what this provider has already charged on this agent.
 *
 * There is deliberately no predicted amount for a first question. DASH does not
 * hold anybody's prices, so a number there would have to be invented, and an
 * invented number about money is worse than no number at all.
 */
export function describeEstimate(facts: AskEstimateFacts): AskSentence {
  const scope =
    facts.items >= facts.available
      ? `Everything this agent has saved — ${countThings(facts.available)} — goes with your question.`
      : `Up to ${countThings(facts.items)} of the ${String(facts.available)} this agent has saved go with your question, whichever ones match it.`;

  if (!facts.provider_states_cost) {
    return {
      headline: scope,
      detail:
        `${facts.provider_label} charges your own account for this and does not say what it charged, ` +
        `so DASH cannot show you an amount. It will show you how much was read and written instead, ` +
        `and your ${facts.provider_label} account is where the bill is.`,
    };
  }

  if (facts.past_questions === 0 || facts.past_typical_usd === null) {
    return {
      headline: scope,
      detail:
        `This is the first question here, so there is nothing to compare it with yet. ` +
        `${facts.provider_label} charges your own account at its own rate and tells DASH what it charged, ` +
        `which you will see as soon as the answer arrives.`,
    };
  }

  const typical = describeAmount(facts.past_typical_usd);
  const total =
    facts.past_total_usd === null ? null : describeAmount(facts.past_total_usd);
  return {
    headline: scope,
    detail:
      `A question here has usually cost ${typical}, going by what ${facts.provider_label} charged for ` +
      `the ${countQuestions(facts.past_questions)} before this one` +
      (total === null ? "." : `, ${total} in all.`),
  };
}

function countThings(count: number): string {
  return count === 1 ? "1 saved thing" : `${String(count)} saved things`;
}

function countQuestions(count: number): string {
  return count === 1 ? "1 question" : `${String(count)} questions`;
}

/* ---------------------------------------------------------------------- *
 * After it runs
 * ---------------------------------------------------------------------- */

/**
 * What the answer cost, said by whoever actually knows.
 *
 * Two shapes and they are different claims, not two wordings of one. A provider
 * that states an amount is quoted and named — "OpenRouter charged" — because the
 * reader's next question is who to check it against. A provider that states none
 * gets a sentence about size with no figure in it and an explicit note that DASH
 * is not withholding a number it has.
 */
export function describeCharge(charge: AnswerCharge, providerLabel: string): string {
  const read = charge.tokens_in === null ? null : describeTokens(charge.tokens_in);
  const written = charge.tokens_out === null ? null : describeTokens(charge.tokens_out);
  const size =
    read === null || written === null
      ? null
      : `${read} went, ${written} came back`;

  if (charge.amount_usd !== null) {
    return size === null
      ? `${providerLabel} charged ${describeAmount(charge.amount_usd)} for this answer.`
      : `${providerLabel} charged ${describeAmount(charge.amount_usd)} for this answer: ${size}.`;
  }
  if (!charge.provider_states_cost) {
    return size === null
      ? `${providerLabel} does not tell DASH what an answer cost, so this one is on your ${providerLabel} bill without a figure here.`
      : `${size}. ${providerLabel} does not tell DASH what that cost, so the figure is on your ${providerLabel} bill rather than here.`;
  }
  // Stated by the profile, absent from this reply. Reported as the gap it is
  // rather than shown as free, which is the one wrong answer available.
  return size === null
    ? `${providerLabel} did not say what this answer cost.`
    : `${size}. ${providerLabel} usually says what an answer cost and did not say this time.`;
}

/**
 * Which saved things this answer was built from, and why those.
 *
 * Sits above the answer, and the `newest` case is the one worth reading twice.
 * Somebody asked about a subject their agent has never covered, and the answer
 * was built from this week's reports instead — so the sentence says so before
 * the answer does, rather than letting the person work it out from an answer
 * that talks about something else.
 *
 * Deliberately says nothing about how many things the agent has saved *in
 * total*. That number changes every time the agent runs, and an old answer
 * carrying today's total would be a sentence that quietly rewrites itself: "9 of
 * the 47" today and "9 of the 300" in a month, about the same nine.
 */
export function describeSelection(
  basis: SelectionBasis,
  terms: readonly string[],
  chosen: number,
): string {
  if (chosen === 0) {
    // Reachable for a question that failed before anything was selected, and it
    // has to be its own sentence: a packaged screenshot caught the count case
    // rendering "the newest 0 saved things went instead", which is not English
    // and is not true either.
    return "Nothing saved went with this question.";
  }
  switch (basis) {
    case "nothing_saved":
      return "There was nothing saved to answer from.";
    case "matched":
      return `${countThings(chosen)} that mention ${listTerms(terms)} went with this question.`;
    case "newest":
      return terms.length === 0
        ? `Nothing in particular was asked about, so the newest ${countThings(chosen)} went with this question.`
        : `Nothing saved mentions ${listTerms(terms)}, so the newest ${countThings(chosen)} went instead.`;
  }
}

function quoteTerm(term: string): string {
  return `“${term}”`;
}

function listTerms(terms: readonly string[]): string {
  const quoted = terms.map(quoteTerm);
  if (quoted.length <= 1) {
    return quoted[0] ?? "what was asked about";
  }
  return `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1] ?? ""}`;
}

/**
 * What the agent says its own runs have cost (MAR-583's unread field, MAR-299).
 *
 * `cost_usd` has been on every telemetry v1 run event since the contract was
 * frozen, and until now nothing in DASH read it. MAR-583 found the same thing
 * about `model` beside it, drew that one, and left this one alone on purpose,
 * with a test asserting over the source that nothing read it: MAR-299 owns spend
 * and needed an answer to *whose number is this* before any surface repeated
 * one.
 *
 * The answer this feature settled is the reason the field can be read now, and
 * it is a rule rather than an exception: **DASH shows amounts other people
 * stated, and says who.** A question's cost is the provider's figure and is
 * attributed to the provider; this is the **agent's own figure about its own
 * past**, from a process DASH does not sit inside, and the sentence attributes
 * it to the agent in as many words. That is ADR 0005's shape — one thing DASH
 * did, one thing DASH was told — applied to money, and the two live side by side
 * on the same surface precisely so the difference is visible rather than
 * explained.
 *
 * Null when no run reported one, which is every agent whose runs say nothing
 * about cost. A zero would claim the runs were free.
 */
export function describeReportedRunSpend(
  total: number | null,
  runs: number,
  agent: string,
): string | null {
  if (total === null || runs === 0) {
    return null;
  }
  const counted = runs === 1 ? "1 run" : `${String(runs)} runs`;
  return (
    `${agent} reports that its own work has cost ${describeAmount(total)} across ${counted}. ` +
    "That is the agent's own figure about itself, not something DASH watched."
  );
}

/* ---------------------------------------------------------------------- *
 * When there is nothing to ask with
 * ---------------------------------------------------------------------- */

/**
 * Why this agent cannot be asked anything, and what to do about it.
 *
 * **Never a dead input.** MAR-545 says so directly, and it is the same rule
 * `ConnectFlowRefusal` keeps: a control that does nothing and says nothing is
 * worse than no control, because the person is left to guess whether they broke
 * it. Every member below has a next action, and the two that need one carry the
 * flow that performs it.
 */
export type AskUnavailableReason =
  /** This agent declares no model provider at all. Nothing to connect. */
  | "no_provider"
  /** It declares one and DASH holds no key for it. */
  | "no_key"
  /**
   * A key is connected and no model has been named (MAR-583's consequence).
   *
   * An agent left on *match each step* has a level per step and no model name
   * anywhere, and a level is not something DASH can ask a provider under. So
   * this is the one refusal here created by a decision rather than by an
   * absence, and its sentence has to carry that decision's own good news: a
   * question about saved reports is summarising, which is the cheapest kind of
   * work, so the smallest model the key reaches is a fine answer.
   */
  | "no_model_chosen"
  /** It has saved nothing, so there is nothing to answer from. */
  | "nothing_saved";

export function describeUnavailable(
  reason: AskUnavailableReason,
  context: { agent: string; service: string | null },
): Recovery {
  const { agent, service } = context;
  switch (reason) {
    case "no_provider":
      return {
        headline: `${agent} has no way to answer questions.`,
        meaning:
          "Answering a question needs a model, and this agent's description does not name one. " +
          "Everything else on this page works as it did.",
        next_action: `Nothing to do here. Whoever built ${agent} would have to give it one.`,
        actor: "dash",
      };
    case "no_key":
      return {
        headline: `${agent} can answer questions once ${service ?? "its model provider"} is connected.`,
        meaning:
          "It uses your own account to answer, so DASH needs the key before it can ask anything. " +
          "Questions are charged to that account at whatever it charges.",
        next_action: `Connect ${service ?? "its model provider"}.`,
        actor: "user",
      };
    case "no_model_chosen":
      return {
        headline: `${agent} has not been told which model to answer with.`,
        meaning:
          "Its steps each say how strong a model they need, and answering a question is not one of its steps — " +
          "so DASH has nothing to ask under until a model is named. Answering from saved reports is summarising, " +
          "which is the cheapest kind of work, so the smallest one your key reaches will do.",
        next_action: "Pick a model further up this page.",
        actor: "user",
      };
    case "nothing_saved":
      return {
        headline: `${agent} has not saved anything yet.`,
        meaning:
          "Questions here are answered from what this agent has found and kept, and it has kept nothing so far. " +
          "Nothing has been charged to your account.",
        next_action: `Run ${agent} once, then come back and ask.`,
        actor: "user",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * When a question does not get answered
 * ---------------------------------------------------------------------- */

/**
 * Why a question failed, for the person who asked it.
 *
 * Separate from `describeBrokerRefusal`, which words the same codes for somebody
 * reading a connection's history about what an *agent* did. This one is read by
 * the person who typed the question a second ago, so it is in the second person
 * and it always says whether they were charged — which is the first thing
 * anybody wants to know when something that costs money fails.
 */
export function describeAskFailure(
  reason: AskFailureReason,
  context: { service: string },
): Recovery {
  const { service } = context;
  switch (reason) {
    case "not_connected":
      return {
        headline: `${service} is not connected.`,
        meaning: "DASH had nothing to ask with, so nothing was sent and nothing was charged.",
        next_action: `Connect ${service}.`,
        actor: "user",
      };
    case "key_refused":
      return {
        headline: `${service} would not accept the key DASH holds.`,
        meaning:
          "It was deleted or replaced in your own account. Nothing was asked and nothing was charged, " +
          "and asking again will not help until there is a new key.",
        next_action: `Put a new key in for ${service}.`,
        actor: "user",
      };
    case "too_many":
      return {
        headline: "That is more questions than DASH will ask in one go.",
        meaning:
          "DASH limits how quickly it will spend your money, and this one was refused before anything was sent. " +
          "Nothing was charged.",
        next_action: "Wait a moment and ask again.",
        actor: "dash",
      };
    case "provider_unavailable":
      return {
        headline: `DASH could not reach ${service}.`,
        meaning: "This computer may be offline, or the service may be having trouble. Nothing was charged.",
        next_action: "Try again in a minute.",
        actor: "elsewhere",
      };
    case "provider_refused":
      return {
        headline: `${service} turned the question down.`,
        meaning:
          "It gave a reason DASH does not pass on, because a service's error text is not something DASH will " +
          "put in front of you as if it were DASH speaking. The most common causes are a model your key cannot " +
          "use and an account that has run out of credit.",
        next_action: `Check the model this agent is set to use, and your balance at ${service}.`,
        actor: "user",
      };
    case "answer_lost":
      // The worst outcome this feature has, and the only one where the person is
      // out of pocket with nothing at all: the provider answered and charged,
      // and DASH could not write the row. Said plainly rather than reported as a
      // failed question, because "it did not work" would be false about the
      // charge — and the amount is gone with the row, so the sentence cannot
      // name one.
      return {
        headline: `${service} answered, and DASH could not keep the answer.`,
        meaning:
          "Something went wrong writing to this computer's own records after the answer arrived. " +
          "You were charged for it, and DASH cannot show you what it said or what it cost.",
        next_action: "Ask again. If it keeps happening, this is a fault in DASH.",
        actor: "dash",
      };
    case "empty_answer":
      return {
        headline: `${service} answered with nothing.`,
        meaning:
          "The question went and a reply came back with no text in it. If a charge was made for that, it is shown beside this.",
        next_action: "Ask again, in fewer words if you can.",
        actor: "elsewhere",
      };
    case "dash_error":
      return {
        headline: "DASH could not ask the question.",
        meaning: "Something went wrong on this computer before anything was sent, and nothing was charged.",
        next_action: "Try again. If it keeps happening, this is a fault in DASH.",
        actor: "dash",
      };
  }
}

export type AskFailureReason =
  | "not_connected"
  | "answer_lost"
  | "key_refused"
  | "too_many"
  | "provider_unavailable"
  | "provider_refused"
  | "empty_answer"
  | "dash_error";

/* ---------------------------------------------------------------------- *
 * The surface's own furniture
 * ---------------------------------------------------------------------- */

/**
 * The standing sentences of the chat: what it is, and what it is not.
 *
 * The second is the one that earns its place. A person watching an agent that
 * can draft mail and reach their accounts is entitled to wonder whether typing
 * "delete all of these" into a chat box will do something, and the honest answer
 * — that this box answers questions and cannot make the agent do anything — is
 * more reassuring than any amount of care about what the input accepts.
 */
export const ASK_HEADING = "Ask about what it found";

export function describeAskPurpose(agent: string): AskSentence {
  return {
    headline: `Ask ${agent} about anything it has saved.`,
    detail:
      "It answers from its own saved reports and nothing else. It cannot be told to do anything here — " +
      "this asks questions and gets answers back, and the answers are shown to you and used for nothing else.",
  };
}

/** The placeholder in the box. A real question, so the first one is easy to write. */
export const ASK_PLACEHOLDER = "What have you found about…?";

/** What the button says, and what it says while it is waiting. */
export const ASK_SUBMIT = "Ask";
export const ASK_WORKING = "Asking…";

/** The heading over the list of saved things an answer was built from. */
export const ASK_SOURCES_HEADING = "What this answer used";

/**
 * The composer's own visible name (MAR-659).
 *
 * MAR-646 tried `describeAskPurpose`'s full sentence here once and reverted it
 * — "one sentence in two places on one screen" — because the thread already
 * draws that sentence directly above this bar on the Chat stage. This is
 * shorter and says a different thing: not what the conversation is for, but
 * who it is with, which is the fact the fleet's own composer (MAR-659, beside
 * this one) needed to start saying out loud too. Two composers share a
 * grammar; neither said its subject before this.
 *
 * `agent` is `null` for the one caller that has not resolved a display name
 * yet — the render tests that compose `AskComposer` directly — and falls back
 * to the bar's own former label rather than rendering nothing.
 */
export function describeChatSubject(agent: string | null): string {
  return agent === null ? "Message this agent" : `Message ${agent}`;
}

/* ---------------------------------------------------------------------- *
 * The composer's settings row (MAR-648)
 * ---------------------------------------------------------------------- */

/**
 * What the model indicator says beside the model's own id.
 *
 * Two sentences for the two things `EffectiveModelChoice.from_default` can mean,
 * and they are different claims rather than two wordings of one. The first is
 * about a decision somebody took on this agent; the second is about a decision
 * they took once, elsewhere, that reaches this agent because nobody has taken the
 * first. Somebody who changes the fleet default needs to know which of these
 * they are looking at to predict what will happen here.
 *
 * Neither contains the model id. It arrives beside them as a value —
 * `AskModelView`'s own note says why an id is never dropped into a sentence.
 */
export function describeAskModel(fromDefault: boolean): string {
  return fromDefault
    ? "This is the model DASH uses when an agent has not been given one of its own."
    : "This is the model you chose for this agent.";
}

/** Where to change it. A destination, so it reads as one. */
export const ASK_MODEL_CHANGE = "Change in Settings";

/**
 * The label on the settings row itself.
 *
 * "Asking under" and not "Model", because the row sits under a box somebody is
 * about to type a question into and the useful reading is the whole phrase —
 * *asking under `claude-sonnet-5`*. A bare "Model:" would be a form field on a
 * thing that is not a form.
 */
export const ASK_MODEL_LABEL = "Asking under";

/* ---------------------------------------------------------------------- *
 * While a question is in flight (MAR-648)
 * ---------------------------------------------------------------------- */

/**
 * The activity line, and every word of it is defensible.
 *
 * Henrik asked for feedback while the model thinks: *"It could be in text,
 * currently reading xxx and/or a loader."* MAR-648 states the rule that governs
 * what that line may say — **only steps DASH is actually performing** — and this
 * function is where that rule is kept or broken.
 *
 * ## Why there is one step here and not four
 *
 * `performAskAction` reads the agent's saved reports, chooses which of them to
 * send, asks the provider and writes the row. Four real steps. **The renderer
 * cannot see any of them.** The preload bridge is `invoke`-only — ADR 0001's
 * narrow-preload obligation, and there is no `ipcRenderer.on` anywhere in
 * `electron/` — so a question is one awaited round trip with no progress on it.
 *
 * A component that animated through those four names would therefore be reciting
 * a script, not reporting. It would be right about the order and wrong about the
 * timing every single time, and "currently reading your saved reports" shown
 * while the provider is already answering is exactly the fabrication MAR-648
 * calls *a lie with a spinner on it*.
 *
 * So the line states the operation that is genuinely in flight, which is asking
 * this model, and it stays true for the whole of it. The elapsed count beside it
 * is the renderer's own clock and is therefore the one thing here it can measure
 * first-hand.
 *
 * ## The real steps are still shown — afterwards
 *
 * `describeSelection` prints DASH's actual record of which reports were chosen
 * and why, the moment the answer lands. That is the honest place for a step
 * report: after it has happened, from a record, rather than as a prediction
 * dressed as an observation.
 *
 * When a step channel exists, this is the function that gains an argument.
 */
export function describeAskActivity(elapsedSeconds: number): string {
  return elapsedSeconds < 1
    ? "Asking…"
    : `Asking… ${String(Math.floor(elapsedSeconds))}s`;
}

/**
 * The activity line's accessible name, which names the model.
 *
 * The model id is set as a value in the visible row and cannot travel inside
 * this sentence for `AskModelView`'s reason — but a live region announces a
 * string, and "Asking…" alone would tell somebody who cannot see the row
 * strictly less than the row tells everybody else.
 *
 * So the id is the whole of `model` and the words around it are fixed. That is
 * the same shape `describeRunOnHost` uses for a machine name, and it keeps the
 * announced sentence and the drawn row saying one thing.
 */
export const ASK_ACTIVITY_LABEL = "Question in progress";

/**
 * Where the conversation lives, said once on the surface.
 *
 * A person typing a question into something that reaches a third party deserves
 * to know which parts stay here. Questions and answers are kept in DASH's own
 * store on this computer; the question and the saved reports it selected are
 * what goes to the provider; nothing else does.
 */
export const ASK_CUSTODY =
  "Your questions and the answers stay on this computer. What goes to the provider is your question " +
  "and the saved reports listed under each answer, and nothing else about you or your other agents.";
