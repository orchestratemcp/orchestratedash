/**
 * Whether a model provider still accepts the key DASH holds, and — the harder
 * half — how honestly DASH says so (MAR-582).
 *
 * ## The discipline this borrows, and why it is the same problem
 *
 * `lib/server-card.ts` is about a machine somebody else owns: DASH keeps no
 * record of what is deployed there, so every sentence it produces is worded as
 * *a report with an age*, never as a fact DASH holds. `not_checked` is its own
 * state rather than a cheerful default, because a page that renders "nothing is
 * running" for a server nobody has asked is making a claim out of an absence.
 *
 * A provider key is the same problem with a different owner. DASH holds a string
 * and the provider decides what it is worth, at the moment it is presented and
 * not before. So:
 *
 * - **`not_checked` is a state**, and it is the state every key is in the
 *   instant after it is pasted. It is not "probably fine".
 * - **Nothing is claimed without a `checked_at`.** A card that said "this key
 *   works" with no date would be reporting an observation as a property, and the
 *   person reading it cannot tell a check from a minute ago from one from March.
 * - **A reachability failure is not a verdict on the key.** `unreachable` says
 *   DASH could not ask. Rounding it into "your key is bad" is the failure
 *   `lib/connection-actions.ts` avoids for OAuth — "a network failure leaves the
 *   state alone rather than telling a user offline on a train that their access
 *   was taken away" — and it would be the same lie here.
 *
 * ## What a check does not establish
 *
 * That the agent will succeed. A key that can list models may still have no
 * credit, no access to the model an agent asks for, or a spending cap. DASH asks
 * the cheapest question with an unambiguous answer, and every sentence below is
 * scoped to exactly that question rather than to the outcome a person cares
 * about. Claiming more would be the same over-reach the API-key `test` sentence
 * was written to avoid in MAR-383.
 *
 * Pure, and it renders nothing. `lib/ai/store.ts` persists the record and the
 * Connections page draws what is here.
 */

import { plainMoment } from "../copy/when";

/* ---------------------------------------------------------------------- *
 * The states
 * ---------------------------------------------------------------------- */

/**
 * Where a key stands, as far as DASH has actually observed.
 *
 * Five, and the split between the last three is the one that earns its keep:
 * they are three different next actions. A refused key needs a new key; an
 * unreachable provider needs waiting; a provider that answered something DASH
 * did not understand needs neither and should not send a person hunting for a
 * fault that is not theirs.
 */
export type AiLivenessState =
  /** DASH has never asked. Every key starts here, including one pasted a second ago. */
  | "not_checked"
  /** The provider answered and listed models for this key. */
  | "live"
  /** The provider answered and would not accept the key. Needs a person. */
  | "key_refused"
  /** DASH could not reach the provider at all. Says nothing about the key. */
  | "unreachable"
  /** The provider answered with something DASH could not read as an answer. */
  | "provider_error";

/**
 * One recorded observation.
 *
 * `checked_at` is null exactly when the state is `not_checked`, which is what
 * makes "no claim without a date" a property of the type rather than a rule a
 * renderer has to remember.
 *
 * `model_count` is a number and never a list. The names of the models a key can
 * reach are provider content — ADR 0002 invariant 7 — and a durable table of
 * them would be a record nobody asked DASH to keep, in the shape
 * `broker_audit.result_count` already refuses.
 */
export interface AiLivenessRecord {
  state: AiLivenessState;
  checked_at: string | null;
  model_count: number | null;
}

/** The state every connection is in before anything has asked. */
export function notChecked(): AiLivenessRecord {
  return { state: "not_checked", checked_at: null, model_count: null };
}

/* ---------------------------------------------------------------------- *
 * The probe's own result
 * ---------------------------------------------------------------------- */

/**
 * What one attempt to ask a provider produced.
 *
 * Separate from the record so that the impure side — which holds a live key —
 * hands back a small value with no credential in it, and this pure side decides
 * what it means. The classification is here rather than beside the fetch for the
 * reason `lib/broker/grant.ts` keeps policy out of `lib/broker/store.ts`: a
 * decision made where the secret is, is a decision no test can reach without a
 * secret.
 */
export interface AiProbeOutcome {
  /** The provider's status code, or null when nothing answered. */
  status: number | null;
  /** How many models the answer listed, or null when it did not list any. */
  model_count: number | null;
  /**
   * The ids the answer listed, when DASH asked for them (MAR-583).
   *
   * **On the outcome and deliberately not on the record.** An outcome is one
   * moment's answer, held in memory for as long as it takes to hand to whoever
   * asked; `AiLivenessRecord` is a durable row, and which models a key can reach
   * is the provider's own content (ADR 0002 invariant 7) — a table of them would
   * be a record nobody asked DASH to keep, which is the same refusal
   * `broker_audit.result_count` makes. `classifyProbe` drops this field on the
   * floor, and `tests/model-choice.test.ts` asserts that it does.
   *
   * Null when nothing was asked for or nothing readable came back, which is not
   * the same as an empty array: an empty array is a provider saying this key
   * reaches no models, and null is DASH having no answer to report.
   */
  model_ids?: readonly string[] | null;
}

/**
 * Classify one attempt.
 *
 * 401 and 403 are the key's verdict and nothing else is. Every other status —
 * including 429 and every 5xx — is `provider_error`, deliberately: a rate limit
 * is the provider declining to answer *today's* question, and reporting it as a
 * refused key would tell a person to go and replace a key that is fine.
 *
 * A null status is `unreachable`, which is the one branch that must not be
 * merged upward. It is the offline-on-a-train case.
 */
export function classifyProbe(outcome: AiProbeOutcome, at: string): AiLivenessRecord {
  if (outcome.status === null) {
    return { state: "unreachable", checked_at: at, model_count: null };
  }
  if (outcome.status === 401 || outcome.status === 403) {
    return { state: "key_refused", checked_at: at, model_count: null };
  }
  if (outcome.status >= 200 && outcome.status < 300 && outcome.model_count !== null) {
    return { state: "live", checked_at: at, model_count: outcome.model_count };
  }
  return { state: "provider_error", checked_at: at, model_count: null };
}

/* ---------------------------------------------------------------------- *
 * What the surface says
 * ---------------------------------------------------------------------- */

export interface AiLivenessSentence {
  headline: string;
  detail: string;
  /** Null exactly when there is nothing for the person to do about it. */
  next_action: string | null;
}

/**
 * When an observation was made, in words, or a sentence saying it cannot be
 * read.
 *
 * `plainMoment` returns null for anything it cannot parse, and the fallback says
 * so rather than echoing the stored string — which would put the exact machine
 * spelling `lib/copy/when.ts` exists to remove back on the screen. Same shape as
 * `describeAdded`.
 */
function whenChecked(checkedAt: string): string {
  const moment = plainMoment(checkedAt);
  return moment === null ? "at a time DASH cannot read" : moment;
}

/**
 * What DASH can say about this key, given the standing it has.
 *
 * Every branch that makes a claim carries the moment it was observed, inside the
 * sentence rather than beside it. A date in a separate field is a date a
 * renderer can drop, and the sentence left behind would be the unqualified claim
 * this whole module exists to avoid.
 */
export function describeLiveness(
  record: AiLivenessRecord,
  providerLabel: string,
): AiLivenessSentence {
  switch (record.state) {
    case "not_checked":
      return {
        headline: `DASH has not checked this key with ${providerLabel}`,
        detail:
          `DASH holds the key and has not yet asked ${providerLabel} whether it accepts it. ` +
          "Holding a key and having a working one are different things, and DASH will not " +
          "claim the second until it has asked.",
        next_action: "Check it whenever you want to know",
      };

    case "live": {
      const counted =
        record.model_count === null
          ? ""
          : record.model_count === 1
            ? " and offered it 1 model"
            : ` and offered it ${String(record.model_count)} models`;
      return {
        headline: `${providerLabel} accepted this key when DASH last checked`,
        detail:
          `${providerLabel} answered DASH${counted}, ${whenChecked(record.checked_at ?? "")}. ` +
          "That is all DASH asked: whether the key is accepted. It does not tell you the " +
          "account has credit, or that a particular model is available to it.",
        next_action: null,
      };
    }

    case "key_refused":
      return {
        headline: `${providerLabel} would not accept this key`,
        detail:
          `DASH presented the key ${whenChecked(record.checked_at ?? "")} and ${providerLabel} ` +
          "turned it down. A key that has been deleted or replaced in your account looks " +
          "exactly like this, and no amount of retrying changes it.",
        next_action: `Make a new key in your ${providerLabel} account and connect it here`,
      };

    case "unreachable":
      return {
        headline: `DASH could not reach ${providerLabel}`,
        detail:
          `DASH tried ${whenChecked(record.checked_at ?? "")} and got no answer at all. This ` +
          "says nothing about the key — it says DASH could not ask. Being offline looks like " +
          "this, and so does the provider being down.",
        next_action: "Check again when you are back online",
      };

    case "provider_error":
      return {
        headline: `${providerLabel} answered DASH with something it could not read`,
        detail:
          `DASH asked ${whenChecked(record.checked_at ?? "")} and got an answer that was ` +
          "neither an acceptance nor a refusal. Being asked to slow down looks like this, and " +
          "so does a fault at the provider. DASH is not treating it as a verdict on the key.",
        next_action: "Check again in a while",
      };
  }
}

/**
 * Every state, for the copy sweep and for exhaustiveness.
 *
 * Derived from the union rather than written out, so a state added without being
 * added here is one the plain-language check never sees — the shape
 * `everyConnectSentence` established and `everyServerCardSentence` repeats.
 */
export const AI_LIVENESS_STATES = [
  "not_checked",
  "live",
  "key_refused",
  "unreachable",
  "provider_error",
] as const satisfies readonly AiLivenessState[];

/** Every sentence this module can produce, for the copy test. */
export function everyLivenessSentence(): string[] {
  const records: AiLivenessRecord[] = [
    notChecked(),
    { state: "live", checked_at: "2026-08-09T14:14:37Z", model_count: 1 },
    { state: "live", checked_at: "2026-08-09T14:14:37Z", model_count: 312 },
    { state: "live", checked_at: "not a time", model_count: null },
    { state: "key_refused", checked_at: "2026-08-09T14:14:37Z", model_count: null },
    { state: "unreachable", checked_at: "2026-08-09T14:14:37Z", model_count: null },
    { state: "provider_error", checked_at: "2026-08-09T14:14:37Z", model_count: null },
  ];

  return records.flatMap((record) => {
    const sentence = describeLiveness(record, "OpenRouter");
    return [
      sentence.headline,
      sentence.detail,
      ...(sentence.next_action === null ? [] : [sentence.next_action]),
    ];
  });
}
