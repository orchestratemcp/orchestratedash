/**
 * The six nouns DASH names its sections with, in one place (MAR-879).
 *
 * ## The defect this exists against
 *
 * The same thing is called three names in three rooms. What a run produced is
 * "Generated assets" on an agent's page, "Latest output" on its card and
 * "Results" in the plan everybody agreed to; the computers an agent can run on
 * are "Servers" on the tab and "Remote machines" in the heading one click
 * later. None of that was decided — it accumulated, one surface at a time, and
 * every one of those decisions looked local and reasonable while it was being
 * made. A person who has learned a word in one room then has to learn it again
 * in the next, which is exactly the tax MAR-879 was filed to remove.
 *
 * ## Why a module and not a style note
 *
 * A convention nothing checks is a convention that has already drifted; the
 * repository has the scar (`every*Sentence` helpers that no test ever called).
 * So this is not advice. `SECTION_NOUNS` is the canon, `RETIRED_NOUNS` names
 * every phrase that lost, and `tests/copy-nouns.test.ts` reads the source of
 * every copy module and every page and holds the count of retired phrases to a
 * recorded baseline. A new one fails. A removed one also fails, saying so, so
 * that the baseline can only ever get smaller.
 *
 * ## Why this module renames nothing by itself
 *
 * MAR-879's lane owns the Add agent flow and the Agents page. `agent-page.ts`,
 * `panel.ts` and the Servers page — where the two surviving retired phrases
 * live — belong to other packets that were merging in parallel, and a rename
 * landing in three lanes at once is how a wave produces conflicts instead of
 * agents. So the canon is written down, the drift is pinned at today's count,
 * and `BASELINE` in the test is the exact worklist for whoever renames them.
 *
 * Pure and import-free, for `lib/copy/add-agent.ts`'s reason: a `"use client"`
 * tree renders these, and a Node builtin dragged into the browser bundle is how
 * the packaged renderer stopped hydrating once already.
 */

/** A section noun, and the question a person is asking when they look for it. */
export interface SectionNoun {
  /** The word on screen. Capitalised as a heading, because that is how it is used. */
  noun: string;
  /**
   * What is under it, in one sentence a novice could have written.
   *
   * Not a definition of the noun — a statement of what the person will find,
   * which is the only thing that makes one of six words the right one to press.
   */
  means: string;
}

/**
 * The six, and the order is the order a run is read in.
 *
 * Results, Sources and Activity describe one run from the outside in: what it
 * produced, what it stood on, what it did. Connections, Channels and Servers
 * describe what an agent is allowed to reach, where its news comes out, and
 * which computer it runs on. Nothing else in DASH is a section noun; a seventh
 * entry here should have to argue for itself.
 */
export const SECTION_NOUNS = {
  /**
   * MAR-875's word, and it beat "Generated assets" and "Outputs" on the same
   * ground: it says what the thing is *for* rather than how it was made.
   */
  results: {
    noun: "Results",
    means: "What this agent produced, newest first.",
  },
  /**
   * The count belongs in the label — `PANEL_SOURCES_SUMMARY` already renders
   * "Sources (7)" — because a disclosure that hides an unknown quantity is one
   * nobody opens.
   */
  sources: {
    noun: "Sources",
    means: "Where the facts in a result came from, each one openable.",
  },
  activity: {
    noun: "Activity",
    means: "What the agent did, step by step, while it was working.",
  },
  connections: {
    noun: "Connections",
    means: "The services this agent is allowed to reach, and whether it can.",
  },
  /**
   * "Channels" over "Notifications", and the distinction is the reason: a
   * channel is a place with two directions — DASH sends alerts to it and a
   * person can talk back through it — where a notification is only ever
   * something that arrived. Settings still has a tab called Notifications
   * (`app/_data/routes.ts`), which is recorded in `RETIRED_NOUNS` rather than
   * renamed here; see this module's header for why.
   */
  channels: {
    noun: "Channels",
    means: "Where DASH sends news, and where you can talk to it from.",
  },
  servers: {
    noun: "Servers",
    means: "The computers an agent can run on when it is not this one.",
  },
} as const satisfies Record<string, SectionNoun>;

export type SectionNounKey = keyof typeof SECTION_NOUNS;

/**
 * Every phrase that lost, and the noun it lost to.
 *
 * The key is matched literally against source text, case-sensitively, because
 * these are headings rather than prose: "generated assets" in the middle of a
 * sentence is somebody explaining, and "Generated assets" is a section still
 * carrying the old name.
 */
export const RETIRED_NOUNS = {
  /**
   * `lib/copy/agent-page.ts` still heads the run outputs with it, and
   * `lib/copy/panel.ts` points at that heading by name. Both belong to the
   * agent detail page, which MAR-875 and MAR-878 were both editing while this
   * was written.
   */
  "Generated assets": "results",
  /**
   * The Servers page's own `<h1>`. The tab that reaches it says "Servers", so
   * a person arrives at a page whose title is a word they did not press.
   */
  "Remote machines": "servers",
} as const satisfies Record<string, SectionNounKey>;

export type RetiredNoun = keyof typeof RETIRED_NOUNS;

/** The canonical noun a retired phrase should become. */
export function canonicalNounFor(retired: RetiredNoun): string {
  return SECTION_NOUNS[RETIRED_NOUNS[retired]].noun;
}

/**
 * Every sentence in this module, for the plain-language gate.
 *
 * The nouns themselves are included as well as the glosses. A section noun is
 * read by a person, so it is held to the same rule as everything else DASH
 * says — which is what stops a future seventh entry being an identifier.
 */
export function everyNounSentence(): string[] {
  return Object.values(SECTION_NOUNS).flatMap((entry) => [entry.noun, entry.means]);
}
