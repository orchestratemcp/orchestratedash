/**
 * The four questions a fleet card answers, in words (MAR-586).
 *
 * Henrik, 2026-08-09: *"The fleet view should give us quick info about each
 * agent. For example. Has it new output? Does it need human approval? Does it
 * lack connections? Is it stale?"*
 *
 * ## Every chip is a recorded fact, and that is the constraint
 *
 * MAR-547's ruling stands and is the reason this module is shaped the way it is:
 * nothing like `CPU LOAD 87%` with no source behind it. So `describeGlance`
 * takes a `GlanceFacts` of plain numbers and timestamps that
 * `lib/views/glance.ts` read out of the store, and it has no way to invent one —
 * there is no clock in here, no store, and no default that turns an absent fact
 * into a cheerful claim. A question DASH cannot answer produces no chip rather
 * than a reassuring one.
 *
 * The one exception is deliberate and is the opposite of an invention: when all
 * four questions are answered "no", the card draws `GLANCE_ALL_CLEAR`. A card
 * with no chips at all cannot be told apart from a card DASH failed to fill in,
 * and "nothing needs you" is a thing worth learning about an agent you are
 * deciding to trust.
 *
 * ## Why the sentences live here rather than in the card
 *
 * The same reason `damage` is composed in `lib/views/build.ts` rather than in
 * `app/page.tsx`: two hosts hand the renderer this document — the packaged app's
 * read channel and the developer path's routes — and a page that built its own
 * sentence would be a second place for the claim to soften. It also puts every
 * user-facing string in this file under one plain-language test rather than
 * scattered through a component.
 *
 * Pure, with no imports beyond `./when`, so it reaches the renderer bundle.
 */

import { plainDay } from "./when";

/**
 * The four questions, by name.
 *
 * Named after what is *true of the agent* rather than after what the card draws,
 * so a chip's label can be rewritten without the code that routes it having to
 * change. `app/_components/glance-chips.tsx` maps each of these to the place
 * that answers it.
 */
export type GlanceQuestion = "new_output" | "needs_you" | "not_connected" | "overdue";

/**
 * How loudly a chip is drawn.
 *
 * Three values and no more, because three is what a person can learn at a
 * glance: **amber means something is waiting on you, blue means there is
 * something new to read, grey means neither.** `app/tokens.css` reserves emerald
 * for a live, healthy thing and this surface has none to report — a card is a
 * record of an agent at rest, so a green chip here would be the exact drift that
 * note warns about, where success colour stops meaning "healthy" and starts
 * meaning "the page rendered".
 *
 * Red is absent on purpose. Nothing on this card is a fault: an agent nobody has
 * connected yet and an agent that has not run are both ordinary states of an
 * ordinary setup, and spending the error colour on them would leave DASH nothing
 * to say a gate violation in.
 */
export type GlanceTone = "accent" | "warn" | "muted";

export interface GlanceChip {
  question: GlanceQuestion | "all_clear";
  /**
   * What the chip says. Two or three ordinary words.
   *
   * Uppercased by `app/globals.css` and lowercase in the document, which is the
   * rule `.chip` already states: caps are typography for DASH's own vocabulary,
   * and what is in the DOM is what a screen reader says.
   */
  label: string;
  /**
   * The whole sentence, complete on its own.
   *
   * Rendered under the chips rather than in a tooltip, for the reason
   * `BrokerCapabilityView.consequence` gives about a hover: a fact somebody has
   * to discover by pointing at something is a fact most people never read.
   */
  meaning: string;
  tone: GlanceTone;
}

/**
 * What the store said, before any of it is turned into a sentence.
 *
 * Every field is a count or an instant somebody else recorded.
 * `lib/views/glance.ts` is what fills it in and is the only place that touches a
 * database; this module cannot reach one and therefore cannot round a missing
 * answer up into a chip.
 */
export interface GlanceFacts {
  /**
   * Outputs DASH received since this agent's page was last opened.
   *
   * Counted against DASH's own clock at both ends — see `artifactArrivals` for
   * why an agent's own account of when it made something is the wrong half of
   * that comparison.
   */
  new_outputs: number;
  /** Everything this agent has ever produced. Only read when nobody has looked. */
  total_outputs: number;
  /**
   * True when nobody has opened this agent's page yet.
   *
   * Kept apart from `new_outputs` because the two produce different sentences
   * for the same number. "Three new things since you last looked" is false for
   * somebody who has never looked, and the honest version of it names that
   * instead of implying a visit that did not happen.
   */
  never_looked: boolean;
  /** Pending approvals addressed to this agent, whether or not their deadline has passed. */
  approvals: number;
  /** Pending choices. Counted apart from approvals — see `describeGlance`. */
  choices: number;
  /** How many of the two above have run out of time. */
  expired: number;
  /**
   * Declared requirements this agent is not connected for.
   *
   * MAR-569's own resolution, rolled up: a requirement counts here when its
   * standing is anything other than "DASH can do this right now".
   */
  unconnected: number;
  /**
   * Requirements naming a connection the same manifest never describes.
   *
   * `connection_not_declared`, counted separately because it is not something a
   * sign-in fixes. It is one document contradicting itself, and the sentence for
   * it has to send the reader somewhere else.
   */
  self_contradicting: number;
  /**
   * Set when this agent declares a schedule and has not run inside it.
   *
   * Null is the ordinary answer and means DASH has nothing to say — an agent
   * with a manual trigger, an agent whose schedule declares no interval, an
   * agent that has never run at all. None of those is overdue, and reporting
   * them as such would be inventing an expectation nobody declared.
   */
  overdue: {
    /** When DASH last saw it run. Null when it is overdue on some other evidence. */
    last_run_at: string | null;
    /** The interval its own manifest declared. Never DASH's guess at one. */
    every_seconds: number;
  } | null;
}

/** The chip a card draws when all four answers are "no". */
export const GLANCE_ALL_CLEAR: GlanceChip = {
  question: "all_clear",
  label: "nothing needs you",
  meaning:
    "DASH has nothing waiting for you on this agent: no new output since you last looked, " +
    "nothing to approve, nothing left to connect, and no run it has missed.",
  tone: "muted",
};

/**
 * "3 things", "1 thing".
 *
 * Spelled out rather than left as a bare number under a label, for
 * `describeRunCount`'s reason: "1 things" is the smallest possible way for a
 * surface to look unfinished, and a novice reading a card should never have to
 * assemble a fact out of a number and a word beside it.
 */
function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * How often this agent's own manifest says it expects to run, in words.
 *
 * Derived from the declared number of seconds rather than from the trigger's own
 * `label`, and that is a choice worth stating. The label is the author's free
 * text — "weekdays at 08:00 local time" — and DASH does not parse it, so a card
 * quoting it beside DASH's own overdue verdict would be putting somebody else's
 * sentence next to DASH's arithmetic and inviting the reader to assume the two
 * agree. The interval is the number the verdict was actually computed from.
 *
 * "About", every time. The declared interval is the longest gap DASH should
 * expect, not a promise about when the agent runs, and rounding it to the
 * nearest hour and calling it exact would be DASH overstating somebody else's
 * schedule.
 */
export function describeExpectedInterval(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) {
    return "about once a minute";
  }
  if (minutes < 60) {
    return `about once every ${String(minutes)} minutes`;
  }
  const hours = Math.round(seconds / 3600);
  if (hours === 1) {
    return "about once an hour";
  }
  if (hours < 24) {
    return `about once every ${String(hours)} hours`;
  }
  const days = Math.round(seconds / 86_400);
  if (days === 1) {
    return "about once a day";
  }
  if (days === 7) {
    return "about once a week";
  }
  // Days up to a fortnight, weeks beyond it. "About once every 11 days" is a
  // phrase somebody can hold in their head; "about once every 2 weeks" for the
  // same interval would be rounding a declared number by a fifth, which is more
  // than "about" is doing anywhere else in this function.
  if (days < 14) {
    return `about once every ${String(days)} days`;
  }
  const weeks = Math.round(days / 7);
  return `about once every ${String(weeks)} weeks`;
}

/**
 * The chips one card draws, in a fixed order.
 *
 * The order is **what the reader should do next**, and it is the same shape of
 * argument `rollUpStanding` makes about its precedence: something waiting on a
 * decision outranks something waiting on setup, which outranks something that
 * merely has not happened, which outranks good news. A card whose chips
 * reordered themselves by count would move the one that matters most every time
 * a number changed.
 *
 * Never empty. See `GLANCE_ALL_CLEAR`.
 */
export function describeGlance(facts: GlanceFacts): GlanceChip[] {
  const chips: GlanceChip[] = [];

  const waiting = facts.approvals + facts.choices;
  if (waiting > 0) {
    /*
     * One chip for both kinds, and the label says which.
     *
     * The issue names approvals, and a card that counted only those would be
     * silent about an agent stopped dead waiting for somebody to pick an
     * option — which is the same agent, equally stuck, for the same person.
     * Folding them into one count and letting the label name the stronger of
     * the two is what keeps the chip's promise ("something is waiting on you")
     * true without claiming an approval that is not there.
     */
    const live = waiting - facts.expired;
    chips.push({
      question: "needs_you",
      label: facts.approvals > 0 ? "needs your approval" : "needs your answer",
      meaning:
        live > 0
          ? `${count(live, "thing is", "things are")} waiting for you before this agent can carry on.`
          : `This agent asked you something and the time to answer ran out. Open it to start again.`,
      tone: "warn",
    });
  }

  if (facts.unconnected > 0 || facts.self_contradicting > 0) {
    const short = facts.unconnected + facts.self_contradicting;
    chips.push({
      question: "not_connected",
      label: "not connected",
      meaning:
        `This agent needs ${count(short, "thing", "things")} connected before it can do all of ` +
        `its work.` +
        (facts.self_contradicting > 0
          ? ` ${count(facts.self_contradicting, "one of them names a service", "some of them name services")} ` +
            `this agent's own setup does not describe, which no sign-in will fix — add the agent again ` +
            `from its own folder.`
          : ""),
      tone: "warn",
    });
  }

  if (facts.overdue !== null) {
    const every = describeExpectedInterval(facts.overdue.every_seconds);
    const day = facts.overdue.last_run_at === null ? null : plainDay(facts.overdue.last_run_at);
    chips.push({
      question: "overdue",
      label: "overdue",
      meaning:
        day === null
          ? `This agent expects to run ${every}, and DASH has no record of it running.`
          : `This agent expects to run ${every}, and DASH last saw it run on ${day}.`,
      tone: "warn",
    });
  }

  if (facts.new_outputs > 0) {
    chips.push({
      question: "new_output",
      label: "new output",
      meaning: facts.never_looked
        ? `This agent has made ${count(facts.total_outputs, "thing", "things")} and you have not opened its page yet.`
        : `${count(facts.new_outputs, "new thing", "new things")} since you last opened this agent.`,
      tone: "accent",
    });
  }

  return chips.length === 0 ? [GLANCE_ALL_CLEAR] : chips;
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Composed from facts rather than written out, so a chip added without being
 * added here is one the plain-language check never sees — the shape
 * `everyConnectSentence` established in `lib/host-connect.ts` and
 * `CONNECT_FLOW_REFUSALS` repeats in `lib/connection-requirements.ts`.
 *
 * The `never_looked` pair and the expired branch are both included because each
 * is a sentence no ordinary set of facts reaches: one needs a store nobody has
 * read from, the other a deadline that has passed.
 */
export function everyGlanceSentence(): string[] {
  const base: GlanceFacts = {
    new_outputs: 0,
    total_outputs: 0,
    never_looked: false,
    approvals: 0,
    choices: 0,
    expired: 0,
    unconnected: 0,
    self_contradicting: 0,
    overdue: null,
  };

  const scenes: GlanceFacts[] = [
    base,
    { ...base, new_outputs: 1, total_outputs: 1 },
    { ...base, new_outputs: 4, total_outputs: 9 },
    { ...base, new_outputs: 2, total_outputs: 2, never_looked: true },
    { ...base, new_outputs: 1, total_outputs: 1, never_looked: true },
    { ...base, approvals: 1 },
    { ...base, approvals: 2, choices: 1 },
    { ...base, choices: 1 },
    { ...base, approvals: 1, expired: 1 },
    { ...base, unconnected: 1 },
    { ...base, unconnected: 3 },
    { ...base, unconnected: 1, self_contradicting: 1 },
    { ...base, self_contradicting: 2 },
    { ...base, overdue: { last_run_at: "2026-08-06T09:00:00.000Z", every_seconds: 86_400 } },
    { ...base, overdue: { last_run_at: null, every_seconds: 3_600 } },
    { ...base, overdue: { last_run_at: "2026-08-01T09:00:00.000Z", every_seconds: 604_800 } },
  ];

  const sentences: string[] = [];
  for (const scene of scenes) {
    for (const chip of describeGlance(scene)) {
      sentences.push(chip.label, chip.meaning);
    }
  }
  return sentences;
}
