/**
 * Everything DASH says about a digest a model grouped, and about one it did not
 * (MAR-619).
 *
 * The rule this directory keeps: a sentence composed in a component is a
 * sentence the copy sweep does not see. `DigestBody` draws fields and writes
 * none of its own words, and every string a person reads about the summarising
 * is here, where `tests/copy-curation.test.ts` can hold all of them to
 * `lib/copy/identifiers.ts` at once.
 *
 * ## The register is the Ask panel's, because it is the same situation
 *
 * `describeUnavailable` in `lib/copy/ask.ts` had to say four different versions
 * of *"this cannot happen right now, and here is the one thing that would
 * change that"* about a model an agent could not reach. This says the same
 * thing about the same model on a different surface, so it returns the same
 * `Recovery` and keeps the same three properties: it never blames the reader,
 * it always names the actual next move, and it says whether money changed
 * hands. MAR-619's issue puts it directly — *"the spend disclosures
 * (`ask.blocked.meaning`'s register) apply to the digest step's copy as well"*.
 *
 * ## What stays on the surface, and what goes behind the note
 *
 * `lib/copy/info-note.ts` asks one question of every sentence: **does this
 * change what the person would decide, right now, on this screen?** Applied
 * here it separates two things that look alike:
 *
 * - *A model wrote these groupings; the items and their links are DASH's own
 *   record.* Decision-changing, and stays. It is the sentence that tells a
 *   reader how much of what they are looking at to trust, and a reader who
 *   thinks DASH verified the grouping is a reader who has been misled.
 * - *How DASH stopped the model inventing an item.* Mechanism. It is reassuring,
 *   it is true, and nobody's next move depends on it, so it goes behind the
 *   note — the same direction that module's own header argues for, and the same
 *   inversion: the limit stays, the reassurance moves.
 *
 * ## The amounts this module does not name
 *
 * None, and that is deliberate rather than an omission. A curated digest costs
 * money, and what it cost is a figure only the provider can state — see
 * `AnswerCharge` and `describeAmount`, which are the only place in DASH a
 * currency figure is formatted, and which are reached through the run's own
 * reported spend rather than through anything here. This module says *that*
 * running the agent spends; it never says how much, because DASH does not know
 * before the fact and has no rate card to guess with.
 */

import type { CurationRefusal } from "../contracts";
import type { Recovery } from "./recovery";

/* ---------------------------------------------------------------------- *
 * A digest a model grouped
 * ---------------------------------------------------------------------- */

/**
 * The heading over the model's own grouping.
 *
 * Not "Summary" and not "AI summary". "What this adds up to" is the question a
 * person came to the digest with, and it is the one thing the flat list of
 * headlines underneath cannot answer for them.
 */
export const CURATED_HEADING = "What this adds up to";

/** The heading over items the grouping left out. Never a chip and never an error. */
export const CURATED_REMAINDER_HEADING = "Everything else it found";

/**
 * Who wrote the grouping, said once, on the surface.
 *
 * The load-bearing sentence of this whole feature and the reason it is not
 * behind the note. Everything else on a digest is DASH's record of what an
 * agent reported; the group titles and their sentences are a model's *reading*
 * of that, and the difference matters to somebody deciding whether to act on
 * what they just read.
 *
 * It names the model when the provider said which one answered, and does not
 * when it did not — ADR 0011's shape, where a run carries the agent's own
 * report of its model rather than an observation DASH made. `model` is
 * therefore attributed in as many words rather than stated flatly.
 */
export function describeCuratedBy(model: string | null): string {
  const who =
    model === null
      ? "A model grouped these and wrote the lines above each group."
      : `A model grouped these and wrote the lines above each group — the provider says it was ${model}.`;
  /*
   * The second sentence is the boundary, and it is on the surface rather than
   * behind a note for a reason that overrode the plan.
   *
   * `lib/copy/info-note.ts`'s rule would put the mechanism — how DASH stops a
   * model inventing an item — one hover away, and the first draft did exactly
   * that. The packaged capture caught what that costs: `DigestBody` renders
   * inside the declarative panel, ADR 0008 bars **any** control from that
   * region, and `InfoNote` is a `<button>`. The harness counted two per frame
   * and reported them.
   *
   * The fix is not to render one surface differently from the other — that is
   * the two-renderers trap in a new costume. It is to keep the one clause of
   * the mechanism that changes what a reader does with what they are looking at
   * (these items are the agent's, not the model's) and drop the rest, which was
   * reassurance. Nothing is hidden anywhere; a sentence was shortened.
   */
  return (
    `${who} Every headline, link and date below is what the agent itself collected, ` +
    "not something the model wrote."
  );
}

/* ---------------------------------------------------------------------- *
 * A digest nothing grouped
 * ---------------------------------------------------------------------- */

/**
 * Why this digest was not summarised, and what would change that.
 *
 * One `Recovery` per reason, and the six are kept apart because they lead six
 * different places — the discipline `lib/copy/recovery.ts` states for itself:
 * a module that collapsed "you have not connected a provider" into "something
 * went wrong" would send a person looking for a fault instead of a button.
 *
 * Every one of them says what happened to their money, because that is the
 * first thing anybody wants to know about a feature that spends it, and five
 * of the six get to say the good version: nothing was charged.
 *
 * ## `service` is never given a possessive, and that is a rule
 *
 * It is a **name where one is known and a description where one is not** — the
 * caller passes "OpenRouter" or it passes "its model provider" — so every
 * sentence here has to read with either. `your ${service} bill` reads fine with
 * the first and produces *"your your model provider bill"* with the second,
 * which is what the packaged capture caught on the first frame of this feature:
 * **"It uses your own your model provider account to do it."**
 *
 * So the service is named where a bare name reads — *"once OpenRouter is
 * connected"*, *"OpenRouter would not answer"* — and everything possessive is
 * said about the **account** instead: *"your own account"*, *"your own bill
 * with that service"*. `describeUnavailable` in `lib/copy/ask.ts` arrived at
 * exactly this shape for exactly this reason, and `everyCurationSentence`
 * sweeps both the named and the unnamed form so a new sentence that breaks the
 * rule fails a test rather than a screenshot.
 */
export function describeNotCurated(
  reason: CurationRefusal,
  context: { agent: string; service: string },
): Recovery {
  const { agent, service } = context;
  switch (reason) {
    case "no_model_connection":
      // Not a fault, and the wording works hard not to read as one. This is
      // every agent somebody scaffolded by hand, and the digest they are
      // looking at is exactly the digest their agent was built to produce.
      return {
        headline: `${agent} was not built to summarise what it finds.`,
        meaning:
          "It collects the news and lists it, which is what it does. Nothing here needs fixing and " +
          "nothing has been charged to any account.",
        next_action: `Nothing to do. Whoever built ${agent} would have to give it a model provider.`,
        actor: "dash",
      };

    case "not_connected":
      return {
        headline: `${agent} can summarise what it finds once ${service} is connected.`,
        // No possessive in front of `service` here or in the two below, and
        // that is a rule rather than a phrasing preference — see the note on
        // `describeNotCurated` itself. `describeUnavailable` in
        // `lib/copy/ask.ts` reached the same shape for the same reason: it
        // names the service where a bare name reads and says "your own
        // account" where one would not.
        meaning:
          "It uses your own account to do it, so DASH needs the key before it can ask anything. " +
          "Nothing was sent and nothing was charged, and everything below is what it found either way.",
        next_action: `Connect ${service}.`,
        actor: "user",
      };

    case "no_model_chosen":
      // MAR-583's consequence, on a second surface. The reassurance in the
      // last sentence is the same one `describeUnavailable` gives the chat and
      // is worth repeating: a person choosing a model for the first time does
      // not know whether the cheap one will be good enough, and here it is.
      return {
        headline: `${agent} has not been told which model to summarise with.`,
        meaning:
          "DASH does not pick one on your behalf, so it had nothing to ask under and nothing was " +
          "charged. Grouping headlines is the cheapest kind of work, so the smallest model your " +
          "key reaches will do.",
        next_action: `Pick a model on ${agent}'s page.`,
        actor: "user",
      };

    case "needs_a_person":
      // ADR 0016's refusal as a person reads it. The tone is deliberately flat:
      // this is the system working, and a run that started some other way
      // producing a plain digest is the designed outcome rather than a
      // degradation somebody should worry about.
      return {
        headline: "This run was not one you asked for, so nothing was paid to summarise it.",
        meaning:
          "Using a model costs money from your own account, so DASH pays for it only while a run " +
          "you started is going. This digest is complete; it just was not grouped.",
        next_action: `Press Run now on ${agent}'s page to get a summarised one.`,
        actor: "user",
      };

    case "refused":
      // The one reason DASH cannot promise nothing was charged, and it must not
      // pretend otherwise. A provider that turns a request down usually bills
      // nothing for it, and "usually" is not a claim to make about somebody's
      // money — so the last sentence says what DASH actually knows, which is
      // that it was told no amount, and points at the only record that would
      // settle it.
      return {
        headline: `${service} would not answer, so this digest was not summarised.`,
        meaning:
          "It gave a reason DASH does not pass on, because a service's error text is not something " +
          "DASH will put in front of you as if it were DASH speaking. The usual causes are a model " +
          "your key cannot use and an account that has run out of credit. DASH was told no amount, " +
          "so if that attempt was charged at all it is on your own bill with that service.",
        next_action: `Check the model ${agent} is set to use, and your balance with ${service}.`,
        actor: "user",
      };

    case "unreadable":
      // The only one where the money is gone, and it says so first. Everything
      // `describeAskFailure`'s `answer_lost` argues applies: "it did not work"
      // would be false about the charge.
      return {
        headline: `${service} answered, and there was no summary DASH could read in it.`,
        meaning:
          "The digest below is complete and every item is where it came from. If that answer was " +
          "charged for, it is on your own bill with that service, and DASH cannot show you what it said.",
        next_action: `Run ${agent} again. If it keeps happening, this is a fault in DASH.`,
        actor: "dash",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * Before the run, where the press happens
 * ---------------------------------------------------------------------- */

/**
 * What pressing Run now will spend, said where the press happens (MAR-619).
 *
 * ADR 0016's disclosure obligation in one sentence. The allowance is opened by
 * this press and by nothing else, so this is the only place in DASH where a
 * person is told, before the fact, that starting an agent can cost them money.
 *
 * Null for every agent that cannot spend, which is nearly all of them —
 * including the sample on a machine where no key is connected. An
 * unconditional warning about money would be a warning about nothing on most
 * screens, and a warning that is usually about nothing is one people stop
 * reading; `describeFleetReach` refuses an unconditional sentence for the same
 * reason.
 *
 * **No amount, and the sentence says why rather than leaving a gap.** DASH
 * cannot know what a run will cost before it runs — two of the three providers
 * never say afterwards either — so naming a figure would mean inventing one,
 * which is the thing `describeAmount` exists to refuse. What DASH can honestly
 * promise is the shape of the bound: one press, one summary.
 */
export function describeRunSpend(context: {
  agent: string;
  /**
   * The provider this agent would spend at, or null when it would not.
   *
   * Nullable on the way *in* rather than a decision the caller makes before
   * calling, so that "does this agent spend?" is answered once, by whoever
   * resolved the connection, and cannot be answered differently by two
   * surfaces that both draw a Run button.
   */
  service: string | null;
}): string | null {
  const { agent, service } = context;
  if (service === null) {
    return null;
  }
  return (
    `Running ${agent} sends what it finds to ${service} to be summarised, and your own ${service} ` +
    `account is charged for that at whatever it charges. One press pays for one summary — ` +
    `${agent} cannot use a model except while a run you started is going.`
  );
}

/* ---------------------------------------------------------------------- *
 * The copy sweep
 * ---------------------------------------------------------------------- */

/**
 * Every sentence this module can produce, for the plain-language check.
 *
 * Derived from the union rather than written out, so a reason added without
 * being added here is one the copy gate never sees — the shape
 * `everyConnectSentence` established and `CONNECT_FLOW_REFUSALS` repeats.
 */
export const CURATION_REFUSALS = [
  "no_model_connection",
  "not_connected",
  "no_model_chosen",
  "needs_a_person",
  "refused",
  "unreadable",
] as const satisfies readonly CurationRefusal[];

export function everyCurationSentence(): string[] {
  const sentences: string[] = [
    CURATED_HEADING,
    CURATED_REMAINDER_HEADING,
    describeCuratedBy(null),
    describeCuratedBy("a-model"),
  ];
  const spend = describeRunSpend({ agent: "AI News Scout", service: "OpenRouter" });
  if (spend !== null) {
    sentences.push(spend);
  }
  /*
   * Both forms of `service`, because the two fail differently.
   *
   * A brand name is what a reader usually sees and is the easy case. The
   * description is what a surface passes when it could not resolve one, and it
   * is where a possessive turns into "your your model provider bill" — see the
   * rule on `describeNotCurated`. Sweeping only the first would leave the
   * second to a screenshot, which is how it was found in the first place.
   */
  for (const service of ["OpenRouter", "its model provider"]) {
    for (const reason of CURATION_REFUSALS) {
      const recovery = describeNotCurated(reason, { agent: "AI News Scout", service });
      sentences.push(recovery.headline, recovery.meaning, recovery.next_action);
    }
  }
  return sentences;
}
