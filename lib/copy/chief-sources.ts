/**
 * What the chief says about the things it read and the things it fetched
 * (MAR-744).
 *
 * `lib/copy/chief-chat.ts` next door holds what the chief says about the
 * *fleet*. These are the sentences for the two tools: what was read out of the
 * agents' own reports, what was fetched from the public sources, and — the half
 * this file exists for — **what could not be**.
 *
 * ## Honest failure, in the issue's own words
 *
 * Item 4 asks for *"honest 'I can't reach that' instead of generic refusals"*,
 * and every sentence below that describes a failure names three things: what
 * DASH tried, what happened, and what the person can do next. A chief that says
 * "something went wrong" is a chief somebody stops asking.
 *
 * The hardest of them is `describeChiefFoundNoSources`, because it is the one
 * that is easiest to write dishonestly. *"I could not find anything"* implies
 * DASH searched the internet; what actually happened is that DASH searched
 * **three** named places, and saying which is the difference between a person
 * concluding there is no news and a person concluding they should look
 * somewhere else.
 *
 * ## No identifiers, and no addresses
 *
 * `lib/copy/identifiers.ts`' rule. A source's **name** is what a person reads —
 * `FeedSource.name`'s own comment, *"never a URL, so a list of these is a list
 * of names"* — and the address lives on the citation, where DASH renders it as a
 * link rather than printing it into a sentence.
 *
 * Pure: no store, no clock, no React. Every export is swept by
 * `tests/chief-sources-copy.test.ts`, which calls each function rather than
 * reading the constants, because a template that interpolated an id would be
 * invisible to a walk over strings.
 */

import type { ChiefSentence } from "./chief-chat";

/* ---------------------------------------------------------------------- *
 * What was read out of the fleet's own reports
 * ---------------------------------------------------------------------- */

/**
 * Under an answer built from the agents' own saved items.
 *
 * Says how many and from where, so the list underneath has a sentence that
 * accounts for it — `describeChiefReceipt`'s job for the briefing rows, done for
 * the other kind of receipt.
 *
 * `matched` and `newest` get different sentences and that is the point. An
 * answer built from the newest items when somebody asked about tariffs has to
 * admit it found no tariffs, which is `SelectionBasis`' own rule and the reason
 * the basis is stored on the turn rather than recomputed.
 */
export function describeChiefItemsRead(
  basis: "matched" | "newest" | "nothing_saved",
  shown: number,
  terms: readonly string[],
): ChiefSentence {
  if (basis === "nothing_saved") {
    return {
      sentence:
        "Your agents have not saved anything yet, so there is nothing of theirs for me to read. " +
        "Run one and I will have its report to answer from next time.",
      quoted: null,
      values: [],
    };
  }
  const counted = shown === 1 ? "1 thing" : `${String(shown)} things`;
  if (basis === "newest") {
    return {
      sentence:
        terms.length === 0
          ? `Read from the ${counted} your agents saved most recently.`
          : `Nothing your agents saved mentions what you asked about, so I read the ${counted} ` +
            "they saved most recently instead.",
      quoted: null,
      values: [...terms],
    };
  }
  return {
    sentence: `Read from the ${counted} your agents saved that mention what you asked about.`,
    quoted: null,
    values: [...terms],
  };
}

/**
 * The answer when there is no model and the reading is all DASH can offer.
 *
 * Not an apology. DASH did the work — it found the items and it is showing every
 * one of them — and what is missing is only the paragraph a model would have
 * written over them. `describeChiefNoModel` says the rest.
 */
export function describeChiefItemsOnly(shown: number): ChiefSentence {
  const counted = shown === 1 ? "this" : `these ${String(shown)}`;
  return {
    sentence:
      `Here is what your agents have saved that answers this — ${counted}, newest first. ` +
      "I cannot write it up in my own words until DASH has a model to ask, but the reports " +
      "themselves are all here.",
    quoted: null,
    values: [],
  };
}

/* ---------------------------------------------------------------------- *
 * What was fetched
 * ---------------------------------------------------------------------- */

/**
 * Under an answer built from a fresh search of the public sources.
 *
 * Names the sources that answered, because *"I found six things"* is a claim
 * about the internet and *"Google News and Hacker News listed six things"* is a
 * claim about what DASH actually did.
 */
export function describeChiefFetched(
  found: number,
  answered: readonly string[],
  missed: readonly string[],
): ChiefSentence {
  const counted = found === 1 ? "1 thing" : `${String(found)} things`;
  const where = listOf(answered);
  const opening =
    answered.length === 0
      ? `I searched for this just now and turned up ${counted}.`
      : `I searched ${where} for this just now and turned up ${counted}.`;
  return {
    sentence:
      missed.length === 0
        ? opening
        : `${opening} ${listOf(missed)} did not answer this time, so there may be more than this.`,
    quoted: null,
    values: [],
  };
}

/**
 * When every source was reached and none of them listed anything.
 *
 * The honest version, and see this file's header on why it is worded the way it
 * is: DASH searched three named places, not "the internet", and a person told
 * the difference can decide for themselves whether to believe there is no news.
 */
export function describeChiefFoundNoSources(searched: readonly string[]): ChiefSentence {
  return {
    sentence:
      `I searched ${listOf(searched)} for that and none of them listed anything. ` +
      "Those three are the only places I can reach on my own — if it would be somewhere else, " +
      "that is a job for an agent with the right source in its list rather than for me.",
    quoted: null,
    values: [],
  };
}

/**
 * When DASH could not reach any of them.
 *
 * Told apart from the sentence above, because *"nothing was published"* and
 * *"I could not get through"* send a person to two completely different places
 * and only one of them is worth retrying.
 */
export function describeChiefSourcesUnreachable(missed: readonly string[]): ChiefSentence {
  return {
    sentence:
      `I could not reach ${listOf(missed)} just now, so I have nothing new to show you for that. ` +
      "It is usually the connection or the source having a bad minute — ask me again shortly and " +
      "I will try them again.",
    quoted: null,
    values: [],
  };
}

/**
 * When the person asked for sources and named no subject.
 *
 * A sentence they can act on rather than an answer to a question they did not
 * ask — `ChiefTool`'s `sources_without_topic` arm exists to make this reachable.
 */
export function describeChiefNoTopic(): ChiefSentence {
  return {
    sentence:
      "I can go and look for more on something, but I need to know what about. Tell me the " +
      "subject — a few words is plenty — and I will search my public sources for it.",
    quoted: null,
    values: [],
  };
}

/**
 * When the subject itself is one DASH will not search for.
 *
 * `topicFrom` refuses rather than strips, and this is why: a person who pasted
 * an address and got told *I found nothing about httpsexamplecom* would have
 * been given a false answer to a question DASH declined to ask. This says what
 * happened.
 */
export function describeChiefTopicRefused(): ChiefSentence {
  return {
    sentence:
      "I search my sources by subject, not by address, so I could not use that as a search. " +
      "Give me the subject in a few plain words and I will look it up.",
    quoted: null,
    values: [],
  };
}

/**
 * When this room cannot search at all.
 *
 * Reachable when a host supplies no `fetchSources`. It says which room can, so
 * the sentence is a direction rather than a wall — `describeAskFailure`'s shape
 * for a refusal that has somewhere to send somebody.
 */
export function describeChiefCannotSearch(): ChiefSentence {
  return {
    sentence:
      "I cannot go and look things up from here. Ask me the same thing in DASH on your computer " +
      "and I will search my public sources for it there.",
    quoted: null,
    values: [],
  };
}

/**
 * The three, as a person would say them.
 *
 * Serial comma and an "and" on the last, because these lists are read aloud in a
 * sentence rather than scanned in a column — `describeUndeclared`'s values are
 * the other treatment and they are identifiers, which these are not.
 */
function listOf(names: readonly string[]): string {
  if (names.length === 0) {
    return "my public sources";
  }
  if (names.length === 1) {
    return names[0] ?? "my public sources";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
}

/* ---------------------------------------------------------------------- *
 * One source, in the list under an answer
 * ---------------------------------------------------------------------- */

/**
 * What happened at one source, in words.
 *
 * Five outcomes and five sentences, because collapsing any two of them costs a
 * person something real: *reached and told nothing* and *could not be reached*
 * differ by whether retrying helps, and *not a feed* is the one that means the
 * source itself has changed under DASH rather than having a bad minute.
 *
 * No status codes and no addresses — a person reads a source's name and an
 * outcome, which is the whole of what they can act on.
 */
export function describeChiefSourceStatus(
  status: "ok" | "empty" | "unreachable" | "not_a_feed" | "refused",
  count: number,
): string {
  switch (status) {
    case "ok":
      return count === 1 ? "1 result" : `${String(count)} results`;
    case "empty":
      return "answered, nothing listed";
    case "unreachable":
      return "did not answer";
    case "not_a_feed":
      return "answered with something DASH could not read";
    case "refused":
      return "not searched";
  }
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Built by calling each function rather than by listing strings —
 * `everyChiefManifestSentence`'s shape, and its reason: a template that
 * interpolated an identifier would be invisible to a walk over constants while
 * being exactly the leak the identifier rule exists to catch. Every branch of
 * every function appears here, so a sentence added tomorrow inside an existing
 * one still has to be added to this list to stay covered — which is the
 * conversation this function is for.
 */
export function everyChiefSourcesSentence(): string[] {
  const sources = ["Google News", "Hacker News", "arXiv"];
  return [
    describeChiefItemsRead("nothing_saved", 0, []).sentence,
    describeChiefItemsRead("newest", 1, []).sentence,
    describeChiefItemsRead("newest", 4, ["tariffs"]).sentence,
    describeChiefItemsRead("matched", 1, ["tariffs"]).sentence,
    describeChiefItemsRead("matched", 6, ["tariffs", "steel"]).sentence,
    describeChiefItemsOnly(1).sentence,
    describeChiefItemsOnly(5).sentence,
    describeChiefFetched(1, sources, []).sentence,
    describeChiefFetched(6, sources.slice(0, 2), sources.slice(2)).sentence,
    describeChiefFetched(0, [], sources).sentence,
    describeChiefFoundNoSources(sources).sentence,
    describeChiefSourcesUnreachable(sources).sentence,
    describeChiefNoTopic().sentence,
    describeChiefTopicRefused().sentence,
    describeChiefCannotSearch().sentence,
    describeChiefSourceStatus("ok", 1),
    describeChiefSourceStatus("ok", 4),
    describeChiefSourceStatus("empty", 0),
    describeChiefSourceStatus("unreachable", 0),
    describeChiefSourceStatus("not_a_feed", 0),
    describeChiefSourceStatus("refused", 0),
  ];
}
