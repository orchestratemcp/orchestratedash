/**
 * The chief's declared command set (MAR-744; MAR-419's analysis, arriving where
 * it was aimed).
 *
 * > *The chief's tool surface is the declared command set and nothing more. It
 * > cannot construct a command an adapter did not declare.*
 *
 * This file is that sentence. There are **three** things the chief can do with a
 * question and the union below is all of them; a question that matches none is a
 * question answered the way every chief question has been answered since ADR
 * 0023 — briefing, model, prose.
 *
 * ## The tools are dispatched by DASH, not chosen by the model
 *
 * This is the design decision worth the most scrutiny, so it is stated plainly
 * rather than left to be inferred from the absence of a tool-calling loop.
 *
 * The obvious way to build "the chief gets tools" in 2026 is to declare them to
 * the provider, let the model emit a tool call, run it, and feed the result
 * back. DASH does not do that, and the reason is not that it would be hard:
 *
 * - ADR 0023 decision 4 gives the chief **one** operation,
 *   `{provider}.chat.completion`. A tool-calling loop is a second request shape,
 *   a second projection, and a spend the person did not press for once per
 *   round trip. `runner/chief-broker.ts`' whole argument is that the chief's
 *   reach is a closed set of one, and a loop widens it structurally.
 * - The model would be **choosing** the tool's arguments. A topic chosen by a
 *   model that has just read a hostile headline is a fetch aimed by untrusted
 *   content — MAR-419's exact path, with the URL-building guard in
 *   `lib/chief/sources.ts` as the only thing left between it and a request.
 *
 * So the dispatch is deterministic and it reads the **person's own words**.
 * `answeredFromRecords` already establishes the pattern: DASH decides what kind
 * of question this is, does the reading itself, and the model's whole job is to
 * write prose over material DASH selected. The model never names a tool, never
 * names a topic, and never sees an address.
 *
 * What that costs is stated rather than designed around: a question phrased in a
 * way this file does not recognise gets the ordinary fleet answer instead of a
 * fetch, and the person's move is to say it differently. That is a worse chat
 * than a tool-calling loop on the days it misses, and it is the trade ADR 0023
 * takes everywhere else in the chief for the same reason.
 *
 * ## Pure
 *
 * No store, no clock, no fetch. Every case is a total function of a string,
 * which is what lets `tests/chief-tools.test.ts` drive the whole surface —
 * including the phrasings that must **not** fire a fetch — with nothing behind
 * it.
 */

import { topicFrom } from "./sources";

/**
 * What one question asks the chief to do, beyond answering it.
 *
 * A closed union of three. `outputs` and `sources` are the two tools; `none`
 * means the question needs neither, and the chief answers from the fleet
 * briefing as it always has.
 */
export type ChiefTool =
  /**
   * Read what the fleet has produced (issue items 1 and 2).
   *
   * One arm for both, because they are the same read. *"What did the scout find
   * today?"* selects by term and *"pull out the most current news"* has no term
   * to select by and falls to newest — `selectChiefMaterial` decides which, from
   * the same library, and says which arm it took.
   */
  | { kind: "outputs" }
  /**
   * Fetch the allowlisted public sources for a subject (issue item 3).
   *
   * The topic has already passed `topicFrom`, so a value of this type cannot
   * carry a string that would not build an address.
   */
  | { kind: "sources"; topic: string }
  /**
   * The person asked for more sources and named no subject DASH can search for.
   *
   * Its own arm rather than a `none`, because the two owe the person opposite
   * sentences: `none` is *here is your fleet*, and this is *I can do that, tell
   * me what about* — which is a sentence they can act on rather than an answer
   * to a question they did not ask.
   */
  | { kind: "sources_without_topic" }
  | { kind: "none" };

/* ---------------------------------------------------------------------- *
 * Asking for the fleet's own output
 * ---------------------------------------------------------------------- */

/**
 * Words that mean *read what my agents produced*.
 *
 * Deliberately about **output**, not about subjects. `asksAboutStanding`'s list
 * is next door and is about how agents are *doing*; this one is about what they
 * have *found*, and the two must not overlap — a question matching both would be
 * answered from records for free and never reach here, which is
 * `answerChiefQuestion`'s order and the right precedence.
 *
 * `news` is in it, and it is the word Henrik's own sentence turns on. So are the
 * verbs a person reaches for when they mean *show me*: found, find, report,
 * brief, digest, summary, headline.
 *
 * Written as singulars, and matched against a word **both as typed and with a
 * plural trimmed** — see `wordsOf`, which explains why trying only the trimmed
 * form missed `news` entirely. Deliberately no real morphology, which is the
 * same narrowness `STANDING_WORDS` accepts and for its reason.
 */
const OUTPUT_WORDS: ReadonlySet<string> = new Set([
  "article",
  "brief",
  "briefing",
  "collected",
  "coverage",
  "digest",
  "find",
  "finding",
  "found",
  "headline",
  "item",
  "news",
  "report",
  "roundup",
  "saved",
  "story",
  "summary",
  "write",
  "wrote",
]);

/* ---------------------------------------------------------------------- *
 * Asking for more sources
 * ---------------------------------------------------------------------- */

/**
 * The shapes of *"find more sources on X"*, as a person actually writes it.
 *
 * Patterns rather than a word set, because this tool needs a **subject** out of
 * the sentence and a bag of words cannot say where one starts. Each expression
 * has exactly one capture group and it is the topic; everything before it is the
 * request and everything after it is trimmed by `topicFrom`.
 *
 * The politeness prefix repeats — `(?:...)*` and not `(?:...)?` — because
 * *"could you please find more sources"* stacks two of them, and a single
 * optional prefix silently made that phrasing not a request at all.
 *
 * Anchored at the start of the trimmed question on purpose. *"Find more sources
 * about tariffs"* is a request; *"the article says to find more sources about
 * tariffs"* is a person quoting something, and a fetch triggered from the middle
 * of a sentence is a fetch a pasted headline could trigger. Anchoring is not a
 * boundary — `lib/chief/sources.ts` is — but it is the cheap half of one and it
 * costs nothing to keep.
 */
const SOURCE_REQUESTS: readonly RegExp[] = Object.freeze([
  /^(?:(?:can you|could you|would you|please)\s+)*(?:go and |go )?(?:find|get|fetch|look for|search for|dig up)\s+(?:me\s+)?(?:some\s+|any\s+|a few\s+)?(?:more\s+|new\s+|other\s+|additional\s+)?sources?\b(?:\s+(?:on|about|for|regarding|covering))?\s*(.*)$/iu,
  /^(?:(?:can you|could you|would you|please)\s+)*(?:search|look)\s+(?:the\s+)?(?:web|internet|online)\s*(?:for|on|about)?\s*(.*)$/iu,
  /^(?:(?:can you|could you|would you|please)\s+)*(?:find|get|fetch)\s+(?:me\s+)?more\s+(?:on|about)\s+(.*)$/iu,
]);

/**
 * Filler a person leaves on the front of a subject.
 *
 * Trimmed after the capture rather than inside the expressions above, because
 * every one of them would otherwise need the same three alternations bolted on
 * and one of the three would eventually be forgotten.
 */
const TOPIC_LEAD_IN = /^(?:the\s+|this\s+|that\s+|topic\s+of\s+|subject\s+of\s+)+/iu;

/**
 * Trailing politeness, and the trailing punctuation a question ends on.
 *
 * `topicFrom` refuses a `?`, so a question mark left on the end would turn every
 * properly punctuated request into *I will not search for that* — a refusal
 * produced by grammar rather than by content, which is the worst kind.
 */
const TOPIC_TAIL = /[\s?.!,;:]+$/u;

/**
 * Which of the three, for one question.
 *
 * Order matters and is the opposite of what reads naturally: **sources first**.
 * *"Find more sources about the news agent's findings"* contains `news` and
 * `finding`, and testing the output words first would answer it by re-reading
 * what DASH already has — which is precisely the thing the person just said was
 * not enough.
 */
export function chiefToolFor(question: string): ChiefTool {
  const asked = question.replace(/\s+/gu, " ").trim();
  if (asked.length === 0) {
    return { kind: "none" };
  }

  for (const pattern of SOURCE_REQUESTS) {
    const match = pattern.exec(asked);
    if (match === null) {
      continue;
    }
    const captured = (match[1] ?? "").replace(TOPIC_LEAD_IN, "").replace(TOPIC_TAIL, "");
    const topic = topicFrom(captured);
    return topic === null ? { kind: "sources_without_topic" } : { kind: "sources", topic };
  }

  return wordsOf(asked).some(([word, singular]) => OUTPUT_WORDS.has(word) || OUTPUT_WORDS.has(singular))
    ? { kind: "outputs" }
    : { kind: "none" };
}

/**
 * A question's words, each as written and again with a plural `s` trimmed.
 *
 * **Both**, and that pair is a bug fix rather than thoroughness. `stem` in
 * `lib/chief/reply.ts` trims a trailing `s` and nothing else, which is right for
 * the standing corpus and wrong for this one on the single most important word
 * in the packet: `news` stems to `new`, so a set containing `news` matched
 * *"pull out the most current news"* not at all — Henrik's own sentence, missed
 * by the tool built for it. `stories` stems to `storie` for the same reason.
 *
 * Trying both is the smallest fix that is right in both directions: `headlines`
 * still finds `headline`, and an uncountable noun still finds itself. The
 * alternative — real morphology — would change what the standing corpus routes
 * on for every manifest in the fleet, which is a much larger decision than this
 * list, and it is the reason `reply.ts`' own pair stays private and this one is
 * restated rather than shared.
 */
function wordsOf(question: string): [string, string][] {
  return question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .map((word) => [word, word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word]);
}
