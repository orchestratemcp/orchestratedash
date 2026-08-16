/**
 * What the chief says when you ask it something (MAR-648, from MAR-419).
 *
 * `lib/copy/chief.ts` is the band's *unprompted* line — one sentence about the
 * agent in the middle, given without being asked. This is the other half: the
 * words for a conversation, now that the band has a composer in it.
 *
 * Its own module rather than more of that one, for the reason
 * `lib/copy/agent-page.ts` is six objects instead of one: a copy gate walks
 * exported constants, and a module that grew a second audience would be a module
 * where the fleet band's four sentences and the chat's twelve are checked as one
 * undifferentiated bag. They are read in different places by people asking
 * different questions.
 *
 * ## The chief's words and an author's words are never the same kind of thing
 *
 * Inherited verbatim from MAR-419's draft, because it is the rule that matters
 * most here. An agent's `goal` is a sentence **its author wrote**, and the
 * moment DASH repeats it inside its own reply a reader cannot tell which of the
 * two is DASH speaking. That is usually discussed as a model-safety problem; it
 * binds with no model at all.
 *
 * So nothing here interpolates author-supplied text into a sentence. Author text
 * travels beside the copy in `quoted`, the renderer attributes it, and
 * `tests/chief-chat-copy.test.ts` asserts that no composed sentence contains it.
 *
 * ## No component ids in prose
 *
 * `lib/copy/identifiers.ts`'s rule binds here too: `public_feed_fetch` is a
 * value, not a word. The undeclared reply has to name what the fleet *can* do,
 * and it does that by handing the ids back in `values` for the renderer to set
 * as values — the same treatment every other identifier in DASH gets, and the
 * reason the plain-language walk over this module passes at all.
 */

/**
 * One thing the chief says, and the author text (if any) beside it.
 *
 * `quoted` and `values` are separate fields rather than one, because they are
 * rendered differently and for opposite reasons: `quoted` is prose somebody else
 * wrote and is attributed, `values` are identifiers nobody wrote and are set in
 * monospace. Folding them together would put an author's sentence in a `<code>`
 * or a component id in a blockquote.
 */
export interface ChiefSentence {
  sentence: string;
  /** Author-supplied text this sentence refers to, never part of it. */
  quoted: string | null;
  /**
   * Identifiers the sentence refers to, for the renderer to set as values.
   *
   * Empty rather than null when there are none, so a caller that maps over this
   * does not have to branch — an empty list is already the "nothing to show"
   * case.
   */
  values: readonly string[];
}

/* ---------------------------------------------------------------------- *
 * The composer
 * ---------------------------------------------------------------------- */

export const CHIEF_CHAT_COPY = {
  /** The room's heading, and the composer's accessible name. */
  heading: "Ask the chief",
  label: "Ask the chief about your fleet",
  /**
   * The placeholder, and it is doing real work.
   *
   * Two examples rather than an invitation, because the chief answers two
   * different kinds of question and a person cannot guess that from a box. The
   * first is a standing question it answers itself; the second is one it hands
   * to an agent. Somebody who types either gets the shape of the thing back.
   */
  placeholder: "What needs me? Or: who reads the news?",
  submit: "Ask",
  /**
   * The scrollback's heading.
   *
   * "This session" rather than "History", because that is the true claim — see
   * `scope` below.
   */
  thread_heading: "Asked this session",
  /** On the reply, so the chief's words are attributable to the chief. */
  speaker: "The chief",
  /**
   * Above the person's own words in the scrollback (MAR-659).
   *
   * Visible rather than the announcement-only prefix `speaker` started as: a
   * returning reader scanning a room with several turns in it should be able
   * to tell who said which paragraph at a glance, not only by a screen reader
   * or by the accent colour alone.
   */
  you: "You",
  /** The link out of a hand-off, into the one surface that can answer. */
  open_chat: "Ask it there",
  /** Closes the room and puts the fleet back. Never clears the box. */
  close: "Back to the fleet",
} as const;

/**
 * What the chief can answer, what it cannot, and what it keeps.
 *
 * On the surface rather than discovered, which is MAR-536's rule for the host
 * wizard's unwired button applied to a box that looks exactly like every other
 * chat box a person has used. Three true statements, and the third is the one
 * nobody would think to ask:
 *
 * **It costs nothing**, because it asks no model. That is worth saying beside a
 * composer whose twin on the agent page carries a spend estimate — a person who
 * has read that one will reasonably assume this one charges too.
 *
 * **Its answers are not kept**, and that is a design decision rather than a
 * missing feature. ADR 0012 argues that a conversation which forgets everything
 * when the page closes is not one, and stores every agent question for that
 * reason. The chief's answers are statements about how the fleet is doing *now*;
 * a stored one would be a sentence that was true last Tuesday sitting in a
 * scrollback looking like a sentence about today. Re-asking is free and gives
 * the current answer.
 *
 * ## Why this leads with the reset rather than burying it (MAR-659)
 *
 * Henrik hit the consequence of the paragraph above directly: he asked the chief
 * something, navigated away and came back to a thread with nothing in it, and it
 * read as broken. ADR 0022 decision 6 is the argument that the session-only
 * choice was against undated re-presentation, not against storage, and that this
 * packet — the shape half — owes the emptiness a plain reason rather than a fix
 * to what MAR-648 decided. So the sentence a returning reader lands on says the
 * true, specific thing that just happened to them (leaving the page cleared it)
 * before it explains what the chief is for, because that is the question a blank
 * box actually raises.
 */
export function describeChiefScope(): { headline: string; meaning: string } {
  return {
    headline: "Nothing said here is saved",
    meaning:
      "Leaving this page, or closing DASH, clears this chat — it does not keep one, so an " +
      "empty thread when you come back is expected, not a lost conversation. I can tell you " +
      "how your agents are doing, because I read the same records their cards do. I cannot " +
      "tell you what one of them found — that is its own to answer, and I will say which one " +
      "to ask. It costs nothing to ask, and what I say is true of right now, so ask again " +
      "whenever you like.",
  };
}

/* ---------------------------------------------------------------------- *
 * The four replies
 * ---------------------------------------------------------------------- */

/**
 * How the fleet is doing.
 *
 * The lead-in only. The counted sentence under it is `describeFleetSummary`'s
 * and every line below that is a glance chip's own `meaning` — quoted, never
 * reworded, which is `describeChief`'s standing rule and the reason two surfaces
 * cannot come to disagree about what "needs your approval" means.
 */
export function describeStanding(demands: number): ChiefSentence {
  return {
    sentence:
      demands === 0
        ? "Here is where your fleet stands. Nothing is waiting on you."
        : demands === 1
          ? "Here is where your fleet stands. One agent is waiting on you:"
          : `Here is where your fleet stands. ${String(demands)} agents are waiting on you:`,
    quoted: null,
    values: [],
  };
}

/**
 * One agent declares this subject, so the chief hands over.
 *
 * It says *set up for* rather than *knows about*, and the distinction is the
 * whole basis of the routing: DASH read what the author declared this agent is
 * for, not what it has actually collected. An agent set up to read the news that
 * has never run declares the subject and holds nothing, and the sentence that
 * promised knowledge would be wrong about it.
 */
export function describeRouted(title: string, goal: string): ChiefSentence {
  return {
    sentence: `${title} is the one set up for that. Here is what its author says it does:`,
    quoted: goal,
    values: [],
  };
}

/**
 * Several declare it equally well.
 *
 * It asks rather than choosing. A chief that broke the tie itself would be
 * expressing a confidence it does not have, and the person is the only one who
 * knows which they meant.
 */
export function describeAmbiguous(titles: readonly string[]): ChiefSentence {
  return {
    sentence:
      `${String(titles.length)} of your agents are set up for that, and nothing they declare ` +
      `separates them. Which did you mean?`,
    quoted: null,
    values: [],
  };
}

/**
 * Nobody declares it.
 *
 * The wording is the load-bearing part. It says what DASH *looked at* — the
 * declarations, not the names and not what an agent happened to do once — so a
 * person who disagrees knows where to go and change it. And it never suggests an
 * agent might manage anyway, which is MAR-419's *"must not improvise a plan that
 * no agent declared it can execute"* in the one place a user would read it.
 *
 * The standing rides along underneath rather than being replaced by this, which
 * is `ChiefReply`'s own note: somebody who asked the chief anything at all is
 * standing on a page about how their fleet is doing, and an answer that was only
 * a refusal would send them away with less than they arrived with.
 */
export function describeUndeclared(capabilities: readonly string[]): ChiefSentence {
  if (capabilities.length === 0) {
    return {
      sentence:
        "None of your agents has declared what it can do, so there is nothing I can point " +
        "you at for that. Here is where the fleet stands instead:",
      quoted: null,
      values: [],
    };
  }
  return {
    sentence:
      "Nothing your agents declare covers that, so I am not going to send you to one and " +
      "hope. Between them, this is everything they are set up to do:",
    quoted: null,
    values: [...capabilities],
  };
}

/**
 * Why this agent, in the person's own words back to them.
 *
 * The matched words are the person's, not the manifest's — `routeRequest`
 * intersects the two and these are the overlap, so every one of them is a word
 * that was typed into the box. Showing them is what makes a wrong route
 * correctable: somebody who sees *"you asked about news"* under an agent they
 * did not mean knows immediately which word to change.
 */
export function describeMatch(matched: readonly string[]): ChiefSentence {
  return {
    sentence: "You asked about:",
    quoted: null,
    values: [...matched],
  };
}
