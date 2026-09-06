/**
 * The interview, as a pure state machine over ordinary values (MAR-876).
 *
 * `scaffold.ts` is the model this file follows: it decides, it touches no disk,
 * and the tests assert on what it returns. `agent-tools.ts` reads and writes the
 * draft file; `server.ts` is transport. The split matters more here than
 * anywhere else in this package, because the thing being added is a
 * *conversation*, and a conversation implemented inside an IO boundary is a
 * conversation nobody can test.
 *
 * ## There is no model in here, and that is the design
 *
 * The obvious way to turn "keep an eye on AI news for me" into a scaffold
 * request is to ask a model. This server must not: ADR 0032 decision 7 says it
 * holds no credential, reaches no provider and spends nothing, and a server
 * that quietly acquired an LLM call would be a connection DASH brokers rather
 * than a tool a coding agent holds.
 *
 * So the parsing here is explicit, small and deliberately literal — a URL is a
 * URL, "every morning" is a daily trigger, "Slack" is a word this template
 * cannot honour. **An ambiguous parse becomes a question, never a guess.** The
 * intelligence in the loop is the host assistant, which reads the person's
 * words and hands them here; this module's job is to decide what is still
 * unknown and to refuse to invent it.
 *
 * ## Why the questions are mostly about what DASH cannot do
 *
 * The template this tool scaffolds is bounded and the bound is narrow: it
 * fetches feeds listed in `sources.json`, composes a brief, writes a digest,
 * and runs when a person asks. It does not post anywhere, browse anything,
 * write a document, or act on the person's behalf. Somebody who asks for "an
 * agent that watches my competitors and Slacks me" is asking for two things,
 * one of which does not exist, and the failure mode this interview exists to
 * prevent is the one where they find that out after the agent is installed and
 * silent.
 *
 * Every question therefore offers the supported answer as the default *and*
 * the popular unsupported ones by name, so choosing one produces an honest
 * `unsupported` note with the nearest thing that does work — rather than a
 * promise the first run breaks.
 *
 * ## Intent is not activation
 *
 * A person who says "every morning" gets a manual-run agent whose README and
 * goal record that they wanted a daily run, and a recap sentence saying the
 * schedule is switched on in DASH after the first run. Nothing here sets a
 * schedule, connects a webhook, or deploys anything: ADR 0003's manual-first
 * rule and ADR 0032 decision 2's consent boundary both survive the new door.
 */

import { FEED_FETCH_COMPONENT, DIGEST_WRITE_COMPONENT } from "../../../lib/agent-sources";
import { isLocalTime } from "../../../lib/schedule/plan";
import { AI_PROVIDER_IDS, type AiProviderId } from "../../../lib/ai/providers";

import {
  BRIEF_COMPOSE_COMPONENT,
  deriveAgentId,
  scaffoldManifest,
  TEMPLATE_SOURCES,
  type FeedSource,
} from "./scaffold";

/* ---------------------------------------------------------------------- *
 * The shape of a conversation
 * ---------------------------------------------------------------------- */

export type QuestionId =
  | "outcome"
  | "sources"
  | "result_format"
  | "trigger"
  | "autonomy"
  | "destination"
  | "cloud";

/**
 * The order the questions are asked in, and it is the order the issue names:
 * outcome, sources, result format, trigger, autonomy, destination, and the
 * cloud question only when something earlier made it relevant.
 *
 * Outcome first because everything else can be read out of a good answer to it
 * and then skipped. Cloud last because asking a person where a thing should
 * live before they have said what it does is asking them to design.
 */
const ORDER: readonly QuestionId[] = [
  "outcome",
  "sources",
  "result_format",
  "trigger",
  "autonomy",
  "destination",
  "cloud",
];

/**
 * The one pair asked together.
 *
 * "When should it run" and "what may it do on its own" are the same subject
 * from the person's side — both are *how it behaves while you are not looking*
 * — and answering one without the other invites the answer nobody means
 * ("every morning" + "act for me"). Every other question stands alone, because
 * two unrelated questions in one turn is how a form feels.
 */
const PAIRED_WITH: Partial<Record<QuestionId, QuestionId>> = { trigger: "autonomy" };

export interface InterviewOption {
  value: string;
  label: string;
  /** Marked so a host with a native chooser can pre-select it. */
  default?: boolean;
  /**
   * Present, and `false`, on an option this template cannot honour. The host
   * still shows it: an unsupported answer is how a person finds out, and
   * hiding it produces a silent disappointment after installation instead.
   */
  supported?: boolean;
}

export interface InterviewQuestion {
  id: QuestionId;
  prompt: string;
  kind: "choice" | "text" | "confirm";
  options?: InterviewOption[];
  /** One sentence saying why this is being asked. Shown, not logged. */
  why: string;
  /** True when free text is a valid answer alongside any options. */
  free_text: boolean;
  /** The answer already held, when this question is being asked again. */
  current?: string;
}

/** Something the person asked for that this template cannot do. */
export interface UnsupportedNote {
  /** What they asked for, in their own terms. */
  asked: string;
  /** Why it is not possible here. Never an apology, never a promise. */
  why_not: string;
  /** The closest thing that does work, so the answer is not just "no". */
  nearest_supported: string;
}

/** Everything one interview knows. Serialised verbatim as the draft file. */
export interface InterviewDraft {
  draft_id: string;
  created_at: string;
  updated_at: string;
  /** Question id (and `agent_name` / `model_provider`) to the answer given. */
  answers: Record<string, string>;
  /** Answered question ids, oldest first, so `back` knows what to undo. */
  answered_order: QuestionId[];
}

export type InterviewAction = "next" | "back" | "recap" | "reset";

/* ---------------------------------------------------------------------- *
 * The questions
 * ---------------------------------------------------------------------- */

/** The only shape of result this template produces. */
const SUPPORTED_RESULT = "roundup_and_summary";

/** Manual is what a scaffolded agent actually is. Everything else is intent. */
const SUPPORTED_TRIGGER = "manual";

/** The trigger DASH itself can be switched to later, once, per day. */
const INTENT_TRIGGER = "daily";

/** It collects and shows you. It is not allowed to do anything else. */
const SUPPORTED_AUTONOMY = "tell_me";

const QUESTIONS: Record<QuestionId, Omit<InterviewQuestion, "current">> = {
  outcome: {
    id: "outcome",
    prompt: "In your own words, what do you want this agent to keep an eye on for you?",
    kind: "text",
    free_text: true,
    why: "Everything else can usually be read out of this answer, so the fuller it is the fewer questions there are.",
  },
  sources: {
    id: "sources",
    prompt:
      "Which sites should it read? Paste their feed addresses, one per line. " +
      'Answer "the usual" to start with the Hacker News front page.',
    kind: "text",
    free_text: true,
    why: "This agent reads addresses you give it. It cannot search for a site or browse one that has no feed.",
  },
  result_format: {
    id: "result_format",
    prompt: "What should it hand you after each run?",
    kind: "choice",
    free_text: true,
    why: "There is one shape this agent produces, and the other answers here are things it cannot do — worth knowing now rather than after it is installed.",
    options: [
      {
        value: SUPPORTED_RESULT,
        label: "A roundup of everything it found, plus a short summary that cites it",
        default: true,
        supported: true,
      },
      {
        value: "document",
        label: "A written document or report file, like a Word file or a PDF",
        supported: false,
      },
      { value: "spreadsheet", label: "A spreadsheet or a CSV", supported: false },
    ],
  },
  trigger: {
    id: "trigger",
    prompt: "When should it run?",
    kind: "choice",
    free_text: true,
    why: "A new agent always starts idle and runs when you press Run. Anything else is written down as what you wanted and switched on by you afterwards.",
    options: [
      {
        value: SUPPORTED_TRIGGER,
        label: "Only when I ask it to",
        default: true,
        supported: true,
      },
      {
        value: INTENT_TRIGGER,
        label: "Once a day, at a time I choose",
        supported: true,
      },
      { value: "hourly", label: "Every hour, or every few hours", supported: false },
      { value: "weekly", label: "Once a week", supported: false },
      { value: "on_event", label: "Whenever something happens somewhere else", supported: false },
    ],
  },
  autonomy: {
    id: "autonomy",
    prompt: "And how much should it do on its own?",
    kind: "choice",
    free_text: true,
    why: "This agent reads and writes inside its own folder. Anything that reaches out to another service is not something it can do.",
    options: [
      {
        value: SUPPORTED_AUTONOMY,
        label: "Just collect it and show me. I will decide what to do",
        default: true,
        supported: true,
      },
      { value: "ask_first", label: "Do things for me, but ask me first", supported: false },
      { value: "act", label: "Act on it without asking", supported: false },
    ],
  },
  destination: {
    id: "destination",
    prompt: "Where do you want to see the results?",
    kind: "choice",
    free_text: true,
    why: "Two of these work today. The rest are things DASH cannot send to, and the answer says what to use instead.",
    options: [
      {
        value: "dash",
        label: "On this agent's page in DASH",
        default: true,
        supported: true,
      },
      { value: "file", label: "As a file saved in the agent's own folder", supported: true },
      { value: "discord", label: "As a Discord message", supported: true },
      { value: "slack", label: "In Slack", supported: false },
      { value: "email", label: "By email", supported: false },
      { value: "post", label: "Posted somewhere public", supported: false },
    ],
  },
  cloud: {
    id: "cloud",
    prompt: "Should it keep working while this computer is off?",
    kind: "choice",
    free_text: true,
    why: "You asked for something that happens while you are not watching, so it matters where the agent lives.",
    options: [
      {
        value: "this_computer",
        label: "This computer is fine. Nothing runs while it is off",
        default: true,
        supported: true,
      },
      { value: "server", label: "It should run on a server, all the time", supported: false },
    ],
  },
};

/* ---------------------------------------------------------------------- *
 * What is still unknown
 * ---------------------------------------------------------------------- */

/**
 * Is this question worth asking, given what is already answered?
 *
 * Only `cloud` is conditional, and the condition is the issue's: ask about a
 * host only when the person has asked for something that happens without them
 * — a daily run, or an alert that has to arrive somewhere.
 */
export function isApplicable(id: QuestionId, answers: Record<string, string>): boolean {
  if (id !== "cloud") {
    return true;
  }
  return answers["trigger"] === INTENT_TRIGGER || answers["destination"] === "discord";
}

/** Every question that still has no answer, in order. */
export function remainingQuestions(draft: InterviewDraft): QuestionId[] {
  return ORDER.filter(
    (id) => isApplicable(id, draft.answers) && draft.answers[id] === undefined,
  );
}

export function isReady(draft: InterviewDraft): boolean {
  return remainingQuestions(draft).length === 0;
}

/**
 * The next one or two questions.
 *
 * Never more than two, and the second only when it is `PAIRED_WITH` the first.
 * A tool that returned "here are the six things I need" would have rebuilt the
 * form this interview exists instead of.
 */
export function nextQuestions(draft: InterviewDraft): InterviewQuestion[] {
  const remaining = remainingQuestions(draft);
  if (remaining.length === 0) {
    return [];
  }

  const first = remaining[0]!;
  const asked: QuestionId[] = [first];
  const partner = PAIRED_WITH[first];
  if (partner !== undefined && remaining.includes(partner)) {
    asked.push(partner);
  }

  return asked.map((id) => {
    const question: InterviewQuestion = { ...QUESTIONS[id], free_text: QUESTIONS[id].free_text };
    const held = draft.answers[id];
    return held === undefined ? question : { ...question, current: held };
  });
}

/* ---------------------------------------------------------------------- *
 * Reading a free-text answer
 * ---------------------------------------------------------------------- */

/** A source the person named by name rather than by address. */
const NAMED_SOURCES: readonly { match: RegExp; source: FeedSource }[] = [
  {
    // The one named source this package can honour without inventing an
    // address for somebody else's website: it is already the template's own
    // default, so the URL is a fact about this repository rather than a guess
    // about the internet. Every other site has to arrive as an address.
    match: /\b(hacker\s?news|hn)\b/i,
    source: TEMPLATE_SOURCES[0]!,
  },
];

/** What a person types when they mean "whatever you have". */
const DEFAULT_SOURCE_ANSWERS = /^(the usual|default|defaults|whatever|anything|you (pick|choose))$/i;

const URL_PATTERN = /https?:\/\/[^\s,;"'<>)\]]+/gi;

export interface ParsedSources {
  sources: FeedSource[];
  /** Entries that named something with no address behind it. */
  unreadable: string[];
}

/**
 * Turn a sources answer into feed entries, by rule and never by inference.
 *
 * A bare address is assumed to be RSS, which is a stated assumption rather
 * than a hidden one: the recap says so in words, and a first run against
 * something that is not a feed reports it. The alternative — refusing every
 * address whose format cannot be proven from its spelling — would refuse most
 * real feeds, because most of them live at an ordinary path.
 *
 * `Name - address` and `Name: address` are honoured, because the manifest's
 * source name is what a person reads and an address is not a name.
 */
export function parseSources(answer: string): ParsedSources {
  const trimmed = answer.trim();
  if (trimmed.length === 0 || DEFAULT_SOURCE_ANSWERS.test(trimmed)) {
    return { sources: [...TEMPLATE_SOURCES], unreadable: [] };
  }

  const sources: FeedSource[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();

  for (const line of trimmed.split(/[\n,;]+/)) {
    const entry = line.trim();
    if (entry.length === 0) {
      continue;
    }

    const urls = entry.match(URL_PATTERN) ?? [];
    for (const url of urls) {
      const address = url.replace(/[.)\]]+$/, "");
      if (seen.has(address)) {
        continue;
      }
      seen.add(address);
      sources.push({
        name: sourceName(entry, address, urls.length === 1),
        url: address,
        format: feedFormat(address),
      });
    }

    // Checked even when the same line carried an address: one sentence can
    // name a site and paste a feed, and dropping the named one would scaffold
    // an agent watching fewer things than the person asked for.
    const named = NAMED_SOURCES.find((candidate) => candidate.match.test(entry));
    if (named !== undefined && !seen.has(named.source.url)) {
      seen.add(named.source.url);
      sources.push({ ...named.source });
    }

    if (urls.length === 0 && named === undefined) {
      unreadable.push(entry);
    }
  }

  return { sources, unreadable };
}

/**
 * The sources, written back out as the answer a person would have typed.
 *
 * `readOpening` stores this rather than the sentence it read them out of, and
 * the reason is a bug this file had before it did: re-reading prose at recap
 * time reports every clause that was not a source ("every morning at 7") as a
 * source it could not reach, and the recap fills up with complaints about
 * words nobody offered as an address. Storing the reading rather than the
 * sentence means the recap re-reads a list, and `parseSources` round-trips it.
 */
export function serializeSources(sources: readonly FeedSource[]): string {
  return sources.map((source) => `${source.name} - ${source.url}`).join("\n");
}

/**
 * A readable name for a source given only its address.
 *
 * `Name - https://...` wins when the person wrote one. Otherwise the first
 * label of the host, capitalised: "Techcrunch", not "techcrunch.com" and never
 * the whole address. `SKILL.md` is explicit that a source name is what a
 * person reads and never a URL, and a table of raw addresses is the thing that
 * makes a panel unreadable.
 */
function sourceName(entry: string, address: string, alone: boolean): string {
  // Only when the whole line is exactly `Label - address`. A looser rule reads
  // the first half of a sentence as a name, and "read the Hacker News front
  // page and" is not what anybody wants written in a manifest.
  const labelled = alone
    ? /^\s*(.{1,60}?)\s*[-\u2013:|]\s*https?:\/\/\S+\s*$/.exec(entry)
    : null;
  if (labelled !== null && !/^https?:/i.test(labelled[1] ?? "")) {
    return labelled[1]!.trim();
  }

  let host: string;
  try {
    host = new URL(address).hostname;
  } catch {
    return "A source you named";
  }
  const label = host.replace(/^www\./i, "").split(".")[0] ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The three the template's fetcher knows, decided from the address alone. */
function feedFormat(address: string): FeedSource["format"] {
  if (/hn\.algolia\.com/i.test(address)) {
    return "hn_algolia";
  }
  if (/atom/i.test(address)) {
    return "atom";
  }
  return "rss";
}

/* ---------------------------------------------------------------------- *
 * Reading the opening answer
 * ---------------------------------------------------------------------- */

interface OpeningPhrase {
  question: QuestionId;
  value: string;
  match: RegExp;
}

/**
 * The whole of this server's language understanding, written out.
 *
 * Each entry claims one thing: *if these words appear, the person said this*.
 * They are deliberately narrow. A phrase that could mean two answers to the
 * same question makes that question ambiguous, and an ambiguous question is
 * asked rather than answered — see `readOpening`.
 */
const OPENING_PHRASES: readonly OpeningPhrase[] = [
  // Trigger.
  { question: "trigger", value: "daily", match: /\b(every|each)\s+(morning|day|evening|night)\b/i },
  { question: "trigger", value: "daily", match: /\bdaily\b/i },
  { question: "trigger", value: "hourly", match: /\b(every|each)\s+(hour|few hours)\b|\bhourly\b/i },
  { question: "trigger", value: "weekly", match: /\b(every|each)\s+week\b|\bweekly\b/i },
  {
    question: "trigger",
    value: "manual",
    match: /\bonly when i\b|\bwhen(ever)? i (ask|press|run|say)\b|\bon demand\b|\bmanually\b/i,
  },
  {
    question: "trigger",
    value: "on_event",
    match: /\bwhenever (something|anything|a new)\b|\bas soon as\b|\bin real ?time\b/i,
  },

  // Destination.
  { question: "destination", value: "discord", match: /\bdiscord\b/i },
  { question: "destination", value: "slack", match: /\bslack\b/i },
  { question: "destination", value: "email", match: /\be-?mails? me\b|\bby e-?mail\b|\bemail it\b/i },
  {
    question: "destination",
    value: "post",
    match: /\b(post|tweet|publish) (it|them|about)\b|\bto (twitter|x|linkedin|mastodon|bluesky)\b/i,
  },
  { question: "destination", value: "file", match: /\bsave (it|them) (to|as) a file\b|\bas a file\b/i },
  { question: "destination", value: "dash", match: /\bin dash\b|\bon its page\b/i },

  // Result format.
  {
    question: "result_format",
    value: SUPPORTED_RESULT,
    match: /\b(summar(y|ise|ize|ies)|round-?up|digest|brief|headlines|list of)\b/i,
  },
  {
    question: "result_format",
    value: "document",
    match: /\b(a )?(pdf|word (doc|document)|google doc|report file|write-?up)\b/i,
  },
  { question: "result_format", value: "spreadsheet", match: /\b(spreadsheet|csv|excel|google sheet)\b/i },

  // Autonomy.
  {
    question: "autonomy",
    value: SUPPORTED_AUTONOMY,
    match: /\bjust (tell|show|let) me\b|\bi(')?ll decide\b|\blet me decide\b|\bnothing else\b/i,
  },
  {
    question: "autonomy",
    value: "ask_first",
    match: /\bask me first\b|\bcheck with me\b|\bwith my approval\b/i,
  },
  {
    question: "autonomy",
    value: "act",
    match: /\b(act|reply|respond|buy|order|book|sign up) (on|to|for) (it|them|my|me)\b|\bon my behalf\b|\bwithout asking\b/i,
  },
];

/** A provider the person named, so the recap can say which key would cover it. */
const PROVIDER_PHRASES: readonly { match: RegExp; value: AiProviderId }[] = [
  { match: /\b(anthropic|claude)\b/i, value: "anthropic" },
  { match: /\b(openai|chat ?gpt|gpt-?[45])\b/i, value: "openai" },
  { match: /\bopenrouter\b/i, value: "openrouter" },
];

export interface OpeningReading {
  /** Answers the words settled, ready to merge. */
  answers: Record<string, string>;
  /**
   * Questions the words touched more than one way. These are deliberately
   * *not* answered: two readings of the same sentence is the case where a
   * guess is most confident and most wrong.
   */
  ambiguous: QuestionId[];
}

/**
 * Read a free-text opening answer into whatever it settles, and nothing more.
 *
 * The rule that makes this safe is one line long: a question matched by two
 * different values is left unanswered and recorded as ambiguous. "Every
 * morning, or whenever I ask" names two triggers; a server that picked one
 * would be choosing for the person, in silence, on the answer that decides
 * whether the agent ever runs by itself.
 */
export function readOpening(text: string): OpeningReading {
  const found = new Map<QuestionId, Set<string>>();
  for (const phrase of OPENING_PHRASES) {
    if (phrase.match.test(text)) {
      const values = found.get(phrase.question) ?? new Set<string>();
      values.add(phrase.value);
      found.set(phrase.question, values);
    }
  }

  const answers: Record<string, string> = {};
  const ambiguous: QuestionId[] = [];
  for (const [question, values] of found) {
    if (values.size === 1) {
      answers[question] = [...values][0]!;
    } else {
      ambiguous.push(question);
    }
  }

  const time = readTime(text);
  if (time !== null && answers["trigger"] === INTENT_TRIGGER) {
    answers["trigger_time"] = time;
  }

  // The reading, not the sentence. See `serializeSources`.
  const parsed = parseSources(text);
  if (parsed.sources.length > 0) {
    answers["sources"] = serializeSources(parsed.sources);
  }

  const provider = PROVIDER_PHRASES.filter((candidate) => candidate.match.test(text));
  if (provider.length === 1) {
    answers["model_provider"] = provider[0]!.value;
  }

  return { answers, ambiguous: ambiguous.sort() };
}

/**
 * A time of day, as `HH:MM`, or null.
 *
 * `isLocalTime` is `lib/schedule/plan.ts`'s, not a second parser: DASH decides
 * what a schedule time is, and a copy of that judgement here could accept a
 * string the schedule store would later refuse. Anything this function builds
 * that DASH would not accept is discarded rather than carried.
 */
export function readTime(text: string): string | null {
  const explicit = /\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
  if (explicit !== null) {
    let hour = Number(explicit[1]);
    const minute = explicit[2] ?? "00";
    const meridiem = explicit[3]?.toLowerCase();
    if (meridiem === "pm" && hour < 12) {
      hour += 12;
    }
    if (meridiem === "am" && hour === 12) {
      hour = 0;
    }
    const candidate = `${String(hour).padStart(2, "0")}:${minute}`;
    return isLocalTime(candidate) ? candidate : null;
  }
  if (/\b(every|each)\s+morning\b/i.test(text)) {
    return DEFAULT_SCHEDULE_TIME;
  }
  if (/\b(every|each)\s+(evening|night)\b/i.test(text)) {
    return "18:00";
  }
  return null;
}

/** What "once a day" means when nobody said a time. Stated in the recap. */
export const DEFAULT_SCHEDULE_TIME = "08:00";

/* ---------------------------------------------------------------------- *
 * Merging answers
 * ---------------------------------------------------------------------- */

/** Answer keys that are not questions: editable in the recap, never asked. */
const FREE_KEYS = new Set(["agent_name", "trigger_time", "model_provider"]);

function isQuestionId(key: string): key is QuestionId {
  return (ORDER as readonly string[]).includes(key);
}

export interface MergeResult {
  draft: InterviewDraft;
  /** Question ids the opening answer touched two ways. */
  ambiguous: QuestionId[];
  /** Keys that were not questions and were not one of the free keys. */
  ignored: string[];
}

/**
 * Fold new answers into a draft.
 *
 * Three things happen here and each is a rule the acceptance criteria name.
 *
 * 1. **An answer to `outcome` is read for the others.** A fully specified
 *    request answers five questions in one sentence, and re-asking them is the
 *    "skip answered questions" criterion failing.
 * 2. **An answer already held is overwritten in place**, keeping its position
 *    in `answered_order`. Changing an answer is an ordinary thing to do and
 *    must not reorder the interview.
 * 3. **Answers to questions that stopped applying are dropped.** Somebody who
 *    moves from "once a day" back to "only when I ask" is no longer being
 *    asked where it should live, so an answer to that is stale state that
 *    would otherwise reach the recap and say something nobody agreed to.
 */
export function mergeAnswers(
  draft: InterviewDraft,
  incoming: Record<string, string>,
  now: Date,
): MergeResult {
  const answers = { ...draft.answers };
  const order = [...draft.answered_order];
  const ignored: string[] = [];
  let ambiguous: QuestionId[] = [];

  const record = (key: string, value: string): void => {
    answers[key] = value;
    if (isQuestionId(key) && !order.includes(key)) {
      order.push(key);
    }
  };

  for (const [key, value] of Object.entries(incoming)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }
    if (!isQuestionId(key) && !FREE_KEYS.has(key)) {
      ignored.push(key);
      continue;
    }
    record(key, value.trim());
  }

  const opening = incoming["outcome"];
  if (typeof opening === "string" && opening.trim().length > 0) {
    const reading = readOpening(opening);
    ambiguous = reading.ambiguous;
    for (const [key, value] of Object.entries(reading.answers)) {
      // Never over-writes something the person said explicitly this turn or
      // earlier: a reading of prose loses to an answer.
      if (answers[key] === undefined || key === "outcome") {
        if (key !== "outcome") {
          record(key, value);
        }
      }
    }
  }

  // Rule 3. Recomputed against the merged answers, not the incoming ones.
  for (const id of ORDER) {
    if (answers[id] !== undefined && !isApplicable(id, answers)) {
      delete answers[id];
    }
  }
  if (answers["trigger"] !== INTENT_TRIGGER) {
    delete answers["trigger_time"];
  }

  return {
    draft: {
      ...draft,
      answers,
      answered_order: order.filter((id) => answers[id] !== undefined),
      updated_at: now.toISOString(),
    },
    ambiguous,
    ignored,
  };
}

/**
 * Undo the most recent answer so it is asked again.
 *
 * Only the last one, and any new `answers` in the same call are ignored: a
 * step backwards that also wrote something forwards is a call whose result
 * nobody can predict from reading it.
 */
export function stepBack(draft: InterviewDraft, now: Date): InterviewDraft {
  const order = [...draft.answered_order];
  const undone = order.pop();
  if (undone === undefined) {
    return draft;
  }
  const answers = { ...draft.answers };
  delete answers[undone];
  if (undone === "trigger") {
    delete answers["trigger_time"];
  }
  for (const id of ORDER) {
    if (answers[id] !== undefined && !isApplicable(id, answers)) {
      delete answers[id];
    }
  }
  return {
    ...draft,
    answers,
    answered_order: order.filter((id) => answers[id] !== undefined),
    updated_at: now.toISOString(),
  };
}

export function resetDraft(draft: InterviewDraft, now: Date): InterviewDraft {
  return { ...draft, answers: {}, answered_order: [], updated_at: now.toISOString() };
}

/* ---------------------------------------------------------------------- *
 * What this template cannot do
 * ---------------------------------------------------------------------- */

/**
 * Every unsupported thing the current answers ask for.
 *
 * Derived, never accumulated. A note kept from an answer that has since been
 * changed is a recap telling somebody they cannot have a thing they stopped
 * asking for, and the `back` and change-an-answer cases would both produce
 * one. Deriving it means a changed answer changes the notes with it, for free.
 */
export function unsupportedFor(answers: Record<string, string>): UnsupportedNote[] {
  const notes: UnsupportedNote[] = [];
  const add = (note: UnsupportedNote): void => {
    if (!notes.some((held) => held.asked === note.asked)) {
      notes.push(note);
    }
  };

  const result = answers["result_format"];
  if (result === "document") {
    add({
      asked: "A written document or report file",
      why_not:
        "DASH holds an agent's output as a roundup and a summary it can show and check. Nothing in it writes a Word file, a PDF or a shared document.",
      nearest_supported:
        "The summary it writes after each run, which you can read on its page and copy anywhere you like.",
    });
  }
  if (result === "spreadsheet") {
    add({
      asked: "A spreadsheet or a CSV",
      why_not: "This agent writes a roundup and a summary. It has no step that produces a table file.",
      nearest_supported:
        "The table on the agent's page, which lists every item it found with its source and date.",
    });
  }

  const trigger = answers["trigger"];
  if (trigger === "hourly") {
    add({
      asked: "Running every hour",
      why_not: "DASH schedules an agent once a day, at a time you pick. There is no shorter interval.",
      nearest_supported: "Once a day at a time you choose, plus pressing Run whenever you want it sooner.",
    });
  }
  if (trigger === "weekly") {
    add({
      asked: "Running once a week",
      why_not: "DASH schedules an agent once a day. There is no weekly setting.",
      nearest_supported: "Once a day, or leaving it to you to press Run on the day you want it.",
    });
  }
  if (trigger === "on_event") {
    add({
      asked: "Running whenever something happens somewhere else",
      why_not: "Nothing outside DASH can wake this agent up. It runs when you press Run, or on a daily schedule you switch on.",
      nearest_supported: "Once a day at a time you choose.",
    });
  }

  const autonomy = answers["autonomy"];
  if (autonomy === "ask_first" || autonomy === "act") {
    add({
      asked: autonomy === "act" ? "Acting on what it finds without asking" : "Doing things for you after asking",
      why_not:
        "This agent reads the sources you gave it and writes inside its own folder. It has no step that reaches any other service, so there is nothing for it to do on your behalf.",
      nearest_supported: "Collecting what it finds and showing it to you, so you decide what happens next.",
    });
  }

  const destination = answers["destination"];
  if (destination === "slack") {
    add({
      asked: "Sending results to Slack",
      why_not: "DASH has no Slack connection. Nothing it holds can send a message there.",
      nearest_supported:
        "A Discord message, once you connect Discord under Settings, or the results on the agent's own page in DASH.",
    });
  }
  if (destination === "email") {
    add({
      asked: "Sending results by email",
      why_not: "DASH does not send email.",
      nearest_supported:
        "A Discord message, once you connect Discord under Settings, or the results on the agent's own page in DASH.",
    });
  }
  if (destination === "post") {
    add({
      asked: "Posting results somewhere public",
      why_not:
        "Nothing this agent does reaches out to another service, and DASH will not post on your behalf.",
      nearest_supported: "The results on the agent's own page, which you can read and share yourself.",
    });
  }

  if (answers["cloud"] === "server") {
    add({
      asked: "Running on a server all the time",
      why_not:
        "An agent built here runs on this computer. Nothing runs while the computer is off.",
      nearest_supported:
        "Leaving it on this computer. It keeps running after you close the DASH window, as long as the computer is on.",
    });
  }

  return notes;
}

/* ---------------------------------------------------------------------- *
 * The recap, and the request behind it
 * ---------------------------------------------------------------------- */

export interface RecapRouteStep {
  step: number;
  /** The manifest's own `planned_route[].component_id`, not a paraphrase. */
  component_id: string;
  /** What that step is, for somebody who is not going to read the manifest. */
  does: string;
}

export interface InterviewRecap {
  /** What it will be called in DASH. Editable before anything is written. */
  name: string;
  /** Its id, and its folder name. Derived from the name. */
  agent_id: string;
  /** The one sentence the manifest carries as the agent's goal. */
  summary: string;
  collects: string[];
  how_often: string;
  where_results_go: string;
  /** Plain sentences. Every one of them is a thing it will not do. */
  will_not_do: string[];
  route: RecapRouteStep[];
  /** Which provider its optional model connection names, and what that means. */
  model_provider: string;
  model_provider_note: string;
}

export interface ScaffoldRequestPlan {
  directory: string;
  name: string;
  display_name: string;
  summary: string;
  sources: FeedSource[];
  model_provider?: AiProviderId;
}

export type InterviewPlan =
  | { ok: true; recap: InterviewRecap; scaffold_request: ScaffoldRequestPlan }
  | { ok: false; problem: string; remaining: QuestionId[] };

/**
 * What each of the template's three steps is, in one sentence each.
 *
 * Keyed off the same constants `scaffoldManifest` builds the route from, never
 * off the strings spelled out again here. They were spelled out again here
 * once, and two of the three sentences silently became "a step this agent
 * runs" — the recap kept working, kept passing its tests, and stopped saying
 * anything. A registry id and a person's sentence about it are exactly the
 * pair `lib/agent-sources.ts` warns is a hazard to restate.
 */
const ROUTE_SENTENCES: Record<string, string> = {
  [FEED_FETCH_COMPONENT]: "Reads each of the sources you listed.",
  [BRIEF_COMPOSE_COMPONENT]:
    "Writes a short summary of what came in, citing the items it is talking about.",
  [DIGEST_WRITE_COMPONENT]: "Saves the whole roundup, with every item's own address kept.",
};

/**
 * Turn a finished interview into the recap and the exact scaffold arguments.
 *
 * The recap's `route` is read out of `scaffoldManifest`'s own `planned_route`
 * rather than written here. That is the acceptance criterion "route matches
 * telemetry" made structural: `lib/analyze.ts` grades a run by matching its
 * executed steps to that array by exact `component_id`, so a recap that
 * described the steps in its own words could tell somebody the agent does
 * something the telemetry will later call drift. Reading the manifest means
 * the two cannot disagree, and `tests/interview-plan.test.ts` pins it.
 */
export function planFromDraft(
  draft: InterviewDraft,
  directory: string,
  now: Date,
): InterviewPlan {
  const remaining = remainingQuestions(draft);
  if (remaining.length > 0) {
    return {
      ok: false,
      problem:
        "The interview is not finished, so there is nothing to build yet. Call dash_agent_interview again and ask what it returns.",
      remaining,
    };
  }

  const answers = draft.answers;
  const displayName = answers["agent_name"] ?? deriveDisplayName(answers["outcome"] ?? "");
  const agentId = deriveAgentId(displayName);
  if (agentId.length === 0) {
    return {
      ok: false,
      problem:
        `"${displayName}" has nothing in it that can be used as an agent name. Send an agent_name answer with a short name made of letters and digits.`,
      remaining: [],
    };
  }

  const parsed = parseSources(answers["sources"] ?? "");
  const sources = parsed.sources.length > 0 ? parsed.sources : [...TEMPLATE_SOURCES];
  const summary = composeSummary(answers, sources);

  let modelProvider: AiProviderId | undefined;
  const namedProvider = answers["model_provider"];
  if (namedProvider !== undefined && (AI_PROVIDER_IDS as readonly string[]).includes(namedProvider)) {
    modelProvider = namedProvider as AiProviderId;
  }

  const request: ScaffoldRequestPlan = {
    directory,
    name: agentId,
    display_name: displayName,
    summary,
    sources,
    ...(modelProvider === undefined ? {} : { model_provider: modelProvider }),
  };

  const manifest = scaffoldManifest({
    directory,
    agent_id: agentId,
    display_name: displayName,
    summary,
    sources,
    now,
    model_provider: modelProvider,
  });

  const willNotDo = unsupportedFor(answers).map(
    (note) => `${note.asked}: ${note.why_not} Instead: ${note.nearest_supported}`,
  );
  for (const sentence of ALWAYS_TRUE_LIMITS) {
    willNotDo.push(sentence);
  }
  for (const entry of parsed.unreadable) {
    willNotDo.push(
      `"${entry}" was not added, because this agent reads feed addresses and cannot look a site up by name. Add its feed address and it will be read like the others.`,
    );
  }

  return {
    ok: true,
    scaffold_request: request,
    recap: {
      name: displayName,
      agent_id: agentId,
      summary,
      collects: sources.map((source) => source.name),
      how_often: howOften(answers),
      where_results_go: whereResultsGo(answers),
      will_not_do: willNotDo,
      route: routeFromManifest(manifest),
      model_provider: modelProvider ?? "openrouter",
      model_provider_note:
        "This is only which provider the agent's optional model connection names, so the same key can cover it. No key is asked for here and none is stored. You hand it one in DASH, or not at all.",
    },
  };
}

/**
 * What a step with no sentence gets.
 *
 * Exported so `tests/interview-plan.test.ts` can assert it never appears: a
 * fallback that is allowed to be silently correct is a fallback that hides a
 * route the recap has stopped describing.
 */
export const UNDESCRIBED_STEP = "A step this agent runs.";

/** True of every agent this template builds, whatever the answers were. */
const ALWAYS_TRUE_LIMITS: readonly string[] = [
  "It starts idle. Nothing runs until you press Run in DASH.",
  "It reads the addresses you gave it and writes inside its own folder. It reaches nothing else and changes nothing anywhere.",
];

function routeFromManifest(manifest: Record<string, unknown>): RecapRouteStep[] {
  const route = manifest["planned_route"];
  if (!Array.isArray(route)) {
    return [];
  }
  return route.map((entry) => {
    const step = entry as { step: number; component_id: string };
    return {
      step: step.step,
      component_id: step.component_id,
      does: ROUTE_SENTENCES[step.component_id] ?? UNDESCRIBED_STEP,
    };
  });
}

/**
 * A name, out of the sentence somebody typed.
 *
 * Lossy and editable, and the recap exists partly so it can be corrected in
 * one press. What it must not be is a raw identifier or a truncated URL, so it
 * takes words the person used, drops the framing they wrapped them in, and
 * stops at the first clause that is about scheduling or delivery rather than
 * subject.
 */
export function deriveDisplayName(outcome: string): string {
  let text = outcome.trim().replace(/\s+/g, " ");
  for (const lead of LEADING_PHRASES) {
    text = text.replace(lead, "").trim();
  }
  const cut = text.search(TRAILING_CLAUSE);
  if (cut > 0) {
    text = text.slice(0, cut);
  }
  const words = text
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^\p{L}\p{N} .&+-]/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 5);
  const name = words
    .join(" ")
    .replace(/[.\-&+]+$/, "")
    // A name that ends in a conjunction is a sentence that was cut, and it is
    // what "read the Hacker News front page and give me..." leaves behind.
    .replace(/\s+(and|or|with|to|for|in|at|on|the|a|an|plus)$/i, "")
    .trim();
  if (name.length === 0) {
    return "News watch";
  }
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Framing to take off the front, in this order.
 *
 * The temporal clause is first because people put it first — "every morning at
 * 7, read the..." — and a name derived before it is stripped reads "Every
 * morning at 7 read", which is what this list looked like until a hand-driven
 * session produced exactly that.
 */
const LEADING_PHRASES: readonly RegExp[] = [
  /^(please\s+)?(every|each)\s+(morning|day|evening|night|week)(\s+(at|by)\s+\d{1,2}(:\d{2})?\s*(am|pm)?)?\s*[,:]?\s*/i,
  /^(please\s+)?(can you\s+)?(i want\s+|i'?d like\s+|i need\s+)?(you to\s+)?(build|make|create|set up)\s+(me\s+)?(an?\s+)?agent\s+(that|to|which)\s+/i,
  /^(please\s+)?(keep an eye on|keep track of|keep up with|watch out for)\s+/i,
  /^(please\s+)?(watch|monitor|track|follow|check|read|collect|gather|scan)(es|s)?\s+/i,
  /^(tell me about|let me know about|show me|find me)\s+/i,
  /^(the|a|an)\s+/i,
];

const TRAILING_CLAUSE =
  /\s+(and|then|,)?\s*(every|each|daily|once a|for me|please|and (post|send|put|tell|alert|message|e-?mail|save|share)s?|in discord|to discord|to slack|by e-?mail|on my behalf)\b/i;

/** The one sentence the manifest carries, built from the answers. */
function composeSummary(answers: Record<string, string>, sources: readonly FeedSource[]): string {
  const names = sources.map((source) => source.name);
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  const wanted =
    answers["trigger"] === INTENT_TRIGGER
      ? " You asked for it once a day, which you switch on in DASH after its first run."
      : "";
  return `Reads ${list} and writes a roundup of what it found with a short summary of it.${wanted}`;
}

function howOften(answers: Record<string, string>): string {
  if (answers["trigger"] !== INTENT_TRIGGER) {
    return "Only when you press Run. It never starts by itself.";
  }
  const time = answers["trigger_time"] ?? DEFAULT_SCHEDULE_TIME;
  return (
    `You asked for once a day at ${time}. It is built to run only when you press Run, and that daily time ` +
    "is written down as what you wanted. You switch the schedule on in DASH yourself, after you have seen a run work."
  );
}

function whereResultsGo(answers: Record<string, string>): string {
  const destination = answers["destination"];
  if (destination === "discord") {
    return (
      "On this agent's page in DASH. To get a Discord message as well, connect Discord under " +
      "Settings once the agent is added; the agent itself sends nothing."
    );
  }
  if (destination === "file") {
    return "On this agent's page in DASH, and as a file saved in the agent's own folder.";
  }
  return "On this agent's page in DASH, where the roundup, the summary and every item it found are shown.";
}
