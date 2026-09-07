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
  /**
   * The composer's accessible name (MAR-659; carried as an `aria-label`
   * since MAR-742 roadmap item 1 rather than a visible line of its own — see
   * `scope` below for the words a sighted reader now sees instead).
   */
  label: "Ask the chief about your fleet",
  /**
   * The scope chip's own visible word (MAR-742 roadmap item 1).
   *
   * The proposal's own default was the fuller `FLEET · 5 AGENTS`; Henrik's
   * ruling on it was shorter — just this word, matched by the agent's own
   * name on that page's equivalent chip (`describeChatSubject`). `.chip`
   * uppercases it on screen; `label` above stays the fuller sentence, still
   * reachable as the chip's `title` and as its accessible name.
   */
  scope: "Fleet",
  /** The model chip's own label word (MAR-742 roadmap item 1) — DASH's own
   *  vocabulary, meant to shout, which is why one short word has no
   *  long-label problem at any width. */
  model_chip_label: "Model",
  /**
   * The companion chip beside the model chip when the chief is asking under
   * the fleet default rather than its own pin (MAR-742 roadmap item 1).
   *
   * `describeChiefModelLine`'s own distinction, moved on screen rather than
   * only into a `title`: `hidden text is still in the markup` is the trap a
   * `title`-only rendering of this fact would be, because whether a question
   * follows the fleet default or a separate pin is a fact that changes what
   * changing the fleet default here will do — not detail a reader opts into.
   */
  fleet_default_chip: "Fleet default",
  /** The no-model chip's own visible words (MAR-742 roadmap item 1),
   *  replacing the standing `no_model` sentence as the chip's visible text —
   *  the fuller sentence stays reachable as the chip's `title`. */
  no_model_chip: "No model",
  /**
   * The placeholder, and it is doing real work.
   *
   * Two examples rather than an invitation, because the chief answers two
   * different kinds of question and a person cannot guess that from a box. The
   * first is a standing question it answers itself; the second is one it hands
   * to an agent. Somebody who types either gets the shape of the thing back.
   *
   * MAR-696 removed the submit button — Henrik's own words, "No button." — and
   * the trailing "Press Enter to ask." was, until MAR-742 roadmap item 1, the
   * only place left saying how to send a question. It is replaced rather than
   * simply deleted: the composer's own footer now carries a standing `↵ to
   * ask` hint (`composer.tsx`), which is where the reference on the issue puts
   * its key hints, and that hint needs no copy entry — it is chrome, the same
   * treatment the `↵` glyph itself already gets — so this string is free to go
   * back to naming only what a question can be about.
   */
  placeholder: "What needs me? Or: who reads the news?",
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

  /* -------------------------------------------------------------------- *
   * MAR-659, ADR 0023: the chief can now ask a model, and keeps what it said
   * -------------------------------------------------------------------- */

  /**
   * Above the frozen briefing rows under an answer.
   *
   * *Read* rather than *used* or *sources*: these are facts DASH pulled off its
   * own cards a moment before it asked, and the heading has to be a claim DASH
   * can stand behind whatever the answer above it says. "What this answer is
   * based on" would be a claim about the model's reasoning, which nobody can
   * check.
   */
  receipt_heading: "What I read before answering",
  /**
   * The link from a citation to the report it came out of (MAR-744).
   *
   * Deliberately not the agent's name. The name is already in the line above it
   * — `ChiefCitationView.where` says who found this — and repeating it as the
   * link text would print the same words twice on one row, which is the defect
   * MAR-609 took a Status tile off the agent page for.
   */
  citation_report_link: "Open the report",
  /**
   * The receipt under an answer that used no records at all (decision 7).
   *
   * The structural half of what keeps small talk from becoming speculation. A
   * person can see per turn whether the chief was speaking from records or being
   * polite — and an answer making a claim about the fleet under this line is a
   * defect anybody can spot.
   */
  receipt_empty: "Nothing from your records was used for this one.",
  /**
   * On a stored turn whose frozen facts no longer match DASH's records.
   *
   * It says the fleet moved, and deliberately **not** that the answer is wrong.
   * DASH compared two of its own records and found them different; whether that
   * makes the sentence above it false is a judgement DASH cannot make and does
   * not attempt.
   */
  stale: "Your fleet has changed since this was written.",
  /** The scrollback's heading, once it survives leaving the page. */
  thread_kept_heading: "This conversation",
  /**
   * Where a paid turn shows what it cost, on a turn that cost nothing.
   *
   * `describeCharge` is not called for one of these, because there is no
   * provider whose number it could be quoting — see `ChiefTurnView.charge`. A
   * zero here would be DASH making its own claim about money, which is the one
   * thing no surface in this product does.
   */
  free: "Answered from your own records. No model was asked and nothing was charged.",
  /** The activity line's accessible name, `ASK_ACTIVITY_LABEL`'s shape. */
  activity_label: "Question in progress",

  /* -------------------------------------------------------------------- *
   * MAR-696: incorporated into the page, with an X and a clear button
   * -------------------------------------------------------------------- */

  /** The collapse control's accessible name, open only. */
  collapse: "Close the chief's conversation",
  /**
   * The clear control's own visible label.
   *
   * Short on purpose: every `<button>` in this system renders upper-case
   * (`app/globals.css`'s shared button rule) and a full sentence shouted in
   * caps reads as an alarm rather than a description — the label stays a
   * label and the honest scope moves to `clear_detail`, an attribute a
   * sighted reader can still reach (`title`) rather than one only announced.
   */
  clear: "Clear",
  /**
   * The clear control's fuller, honest scope — `title`, not the visible
   * label. Says exactly what it does and no more: `chief_messages` is the
   * chief's own memory and an audit surface (MAR-673); this button empties
   * what is drawn on screen and leaves that table alone, which is a real
   * distinction from `chief.clear`'s own "delete the whole conversation" and
   * has to read as one.
   */
  clear_detail: "Clears what's shown here — the chief still remembers this conversation",
  /**
   * The no-model chip's fuller sentence — its `title` now (MAR-742 roadmap
   * item 1), not a standing line of its own; `no_model_chip` above is what a
   * sighted reader sees.
   */
  no_model: "No model set yet.",
  /** The link out of `no_model`, to the one place a fleet default is set. */
  no_model_link: "Set one in Settings",
  /** The swap panel's own way back to the fleet default. */
  swap_default: "Use the fleet default",
} as const;

/**
 * What the chief can answer, what it cannot, and what it costs.
 *
 * On the surface rather than discovered, which is MAR-536's rule for the host
 * wizard's unwired button applied to a box that looks exactly like every other
 * chat box a person has used.
 *
 * ## Both of the promises this used to make have stopped being true (MAR-659)
 *
 * The version before ADR 0023 said two things that were correct when they were
 * written and are now false, and that ADR named this function as the one that
 * has to be rewritten with it:
 *
 * - *"It costs nothing to ask."* The chief could not reach a model, so it could
 *   not spend. It can now, and a person deserves to read that before they type
 *   rather than after they are charged.
 * - *"Nothing said here is saved."* The thread was cleared by leaving the page.
 *   It is kept now, in DASH's own store on this computer, until the person
 *   clears it.
 *
 * ## Two things are still true and both are load-bearing
 *
 * **The standing question is still free.** `answerChief` runs first and answers
 * from records with no model, no charge and no latency, which is why the
 * sentence below separates the two rather than quoting one price for the box.
 *
 * **The chief still cannot tell you what an agent found.** That is the
 * hand-off, unchanged: the briefing carries counts and titles, never the text of
 * anything an agent saved, which is also what keeps a chief question from
 * costing what an agent question costs.
 */
export function describeChiefScope(): { headline: string; meaning: string } {
  return {
    headline: "I read your own records, and I keep what we say",
    meaning:
      "Ask me how your agents are doing and I answer from the same records their cards are " +
      "drawn from — that part is free and instant. Anything else I put to your model provider, " +
      "with those same facts attached, and your own account is charged for it; underneath every " +
      "answer I show you exactly which facts I read. I cannot tell you what one of your agents " +
      "found — that is its own to answer, and I will say which one to ask. This conversation is " +
      "kept on this computer until you clear it.",
  };
}

/**
 * The chief with no model to ask (MAR-659, ADR 0023 decision 4).
 *
 * The shipped state on a DASH where nobody has set a fleet default, which is
 * every DASH today: `fleet_model_default` has no row, so there is no provider,
 * so there is no manifest, so the broker would refuse with `unknown_connection`
 * before it touched a vault.
 *
 * Said plainly rather than approximated. Three things it deliberately does not
 * do:
 *
 * - It does **not** fall back to an agent's pinned model. The chief is not an
 *   agent, and spending under a setting somebody made about their news scout
 *   would be DASH choosing on their behalf — ADR 0012 decision 4.
 * - It does **not** disable the box. The standing question still works without a
 *   model, and greying out a composer that answers half the questions people ask
 *   would be a dead input where a working one is.
 * - It does **not** name a model to pick. Which one to set is Henrik's decision
 *   and the ADR makes a recommendation to him; a sentence here naming one would
 *   be DASH taking it.
 */
export function describeChiefNoModel(): { headline: string; meaning: string } {
  return {
    headline: "I can read your records, but I cannot write you a sentence yet",
    meaning:
      "Answering in my own words means putting your question to a model provider, and DASH has " +
      "no default model set — so there is nothing for me to ask, and nothing has been charged. " +
      "I can still tell you how your fleet is standing, which I read straight off your agents' " +
      "own cards. Set a default on the AI tab in Settings and I can answer the rest.",
  };
}

/**
 * Under the composer, always: whose choice the chief is asking under
 * (MAR-696, ADR 0023 amendment 1).
 *
 * The model id itself is not in this sentence — `lib/copy/identifiers.ts`'s
 * rule, restated for a model id rather than a component id: it is a value,
 * set beside the sentence in `<code>`, the same treatment
 * `describeChiefReceipt`'s charge line already gives one.
 */
export function describeChiefModelLine(own: boolean): string {
  return own ? "The chief's own model:" : "Asking under DASH's fleet default:";
}

/**
 * The decisions chip's own words (MAR-742 roadmap item 1, §4.5).
 *
 * Absorbed from `app/page.tsx`'s own `<p class="fleet-decisions-note">`,
 * unchanged in substance — same singular/plural split, same destination
 * (`/decisions`) — moved from a full-width link under the fleet into the
 * chip row above the composer. `text` is short, for the chip; `title` keeps
 * the fuller sentence the link used to say outright, reachable rather than
 * lost.
 */
export function describeDecisionsChip(total: number): { text: string; title: string } {
  return total === 1
    ? { text: "1 decision", title: "1 decision recorded — see the log" }
    : { text: `${String(total)} decisions`, title: `${String(total)} decisions recorded — see the log` };
}

/* ---------------------------------------------------------------------- *
 * A model-written answer, and what DASH puts around it (MAR-659)
 * ---------------------------------------------------------------------- */

/**
 * What is in flight, while it is.
 *
 * `describeAskActivity`'s rule, restated for this room rather than imported so
 * the two can say different true things: the preload bridge is `invoke`-only, so
 * a question is one awaited round trip and the steps inside it are invisible
 * from the renderer. A line that animated through their names would be reciting
 * a script — right about the order, wrong about the timing, every time.
 *
 * So: the operation genuinely in flight, and a clock the component read itself.
 * The model id is set beside this as a value, never inside the sentence.
 *
 * There is deliberately no loader on the standing answer. That one is a pure
 * function of props this render already holds and returns before the next frame,
 * and a spinner over a synchronous read is the same fabrication MAR-648 forbids
 * wearing the opposite costume.
 */
export function describeChiefActivity(elapsedSeconds: number): string {
  return elapsedSeconds < 1
    ? "Asking your model…"
    : `Asking your model… ${String(Math.floor(elapsedSeconds))}s`;
}

/**
 * Under a model-written answer, above the rows DASH actually sent.
 *
 * The sentence that makes the receipt worth reading. It says where the rows come
 * from — DASH's own records, listed by DASH — and it says the thing the receipt
 * cannot fix, which ADR 0023 insists is named in copy rather than papered over:
 * a model can attribute a fact to the wrong agent or leave one out, and a
 * person's defence against that is the list itself.
 */
export function describeChiefReceipt(rows: number): ChiefSentence {
  if (rows === 0) {
    return { sentence: CHIEF_CHAT_COPY.receipt_empty, quoted: null, values: [] };
  }
  return {
    sentence:
      rows === 1
        ? "I wrote that from one agent's record, listed below exactly as I read it. Check what " +
          "I said against it — the list is mine, the wording above is the model's."
        : `I wrote that from ${String(rows)} agents' records, listed below exactly as I read ` +
          "them. Check what I said against them — the list is mine, the wording above is the " +
          "model's.",
    quoted: null,
    values: [],
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
 *
 * `fleetSize` (MAR-742 roadmap item 2) is what tells the empty-capabilities arm
 * below which of two different facts it is looking at: an empty fleet has no
 * agent to have declared anything, and *"none of your agents has declared what
 * it can do"* would be a claim about agents that are not there. Both fall
 * through the same `capabilities.length === 0` branch — `declaredCapabilities`
 * returns `[]` either way — so the count is the only thing that can tell them
 * apart without a second `ChiefReply` arm to carry the same distinction.
 */
export function describeUndeclared(
  capabilities: readonly string[],
  fleetSize = 1,
): ChiefSentence {
  if (capabilities.length === 0) {
    if (fleetSize === 0) {
      // Deliberately does not say "empty" itself — `standingText` always
      // appends `describeFleetSummary`'s own sentence underneath (`CHIEF_WAITING`
      // for this exact state), and repeating the one new fact this reply has to
      // give in two adjacent sentences would read as a stutter rather than as
      // two different things DASH is telling the person.
      return {
        sentence: "There is nothing I can point you at for that yet. Here is where things stand:",
        quoted: null,
        values: [],
      };
    }
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
