/**
 * What the Chief says (MAR-419).
 *
 * Every sentence DASH speaks in the conversation is composed here, for the
 * reason `lib/copy/recovery.ts` exists: both hosts must hand the renderer the
 * same words, and a page that built its own would be a second place for a
 * refusal to be softened.
 *
 * ## The Chief's words and an agent's words are never the same kind of thing
 *
 * MAR-419's hard part is that agent-produced content is data, not instructions.
 * That obligation is usually discussed as a model-safety problem, and it has a
 * plain-language half that applies with no model at all: an agent's `goal` is a
 * sentence **its author wrote**, and the moment DASH repeats it inside its own
 * reply, a reader cannot tell which of the two is DASH speaking.
 *
 * So nothing in this module ever interpolates author-supplied text into a
 * sentence. Author text travels beside the copy, in its own field, and
 * `app/chief/page.tsx` renders it quoted and attributed. `describeRouted`
 * returns `quoted` separately from `sentence` for exactly this reason, and
 * `tests/chief-copy.test.ts` asserts that no composed sentence contains it.
 *
 * ## Plain language, and no component ids in prose
 *
 * `lib/copy/identifiers.ts`'s rule binds here too: `public_feed_fetch` is a
 * value, not a word, so it is never dropped into a sentence. The refusal below
 * needs to name what the fleet *can* do, and it does that by handing the ids
 * back as a list the renderer sets as values — the same treatment every other
 * identifier in DASH gets.
 */

/** One thing the Chief says, and the author text (if any) that sits beside it. */
export interface ChiefSentence {
  sentence: string;
  /**
   * Author-supplied text this sentence refers to, never part of it.
   *
   * Null when there is none. The renderer quotes and attributes whatever is
   * here; nothing composed above ever contains it.
   */
  quoted: string | null;
  /**
   * Identifiers the sentence refers to, for the renderer to set as values.
   *
   * Empty rather than null when there are none, because a caller that maps over
   * this should not have to branch — the list being empty is already the
   * "nothing to show" case.
   */
  values: readonly string[];
}

/** The Chief has handed the request to one agent. */
export function describeRouted(agent: string, goal: string): ChiefSentence {
  return {
    sentence: `${agent} is the one agent set up for this. Here is what its author says it does:`,
    quoted: goal,
    values: [agent],
  };
}

/**
 * Two or more agents declare the work equally well.
 *
 * It asks rather than choosing. A Chief that broke the tie itself would be
 * expressing a confidence it does not have, and the person is the only one who
 * knows which they meant.
 */
export function describeAmbiguous(agents: readonly string[]): ChiefSentence {
  return {
    sentence:
      `${String(agents.length)} agents are set up for this and nothing in what they declare ` +
      `separates them. Which did you mean?`,
    quoted: null,
    values: [...agents],
  };
}

/**
 * Nobody declared it.
 *
 * The wording is the load-bearing part. It says what DASH *looked at* — the
 * declarations, not the names and not what an agent happened to do once — so a
 * person who disagrees knows where to go and change it. And it never suggests
 * an agent might manage anyway, which is MAR-419's "must not improvise a plan
 * that no agent declared it can execute" in the one place a user would read it.
 */
export function describeNobody(capabilities: readonly string[]): ChiefSentence {
  if (capabilities.length === 0) {
    return {
      sentence:
        "No agent here has declared what it can do, so there is nothing I can hand this to. " +
        "Add an agent and I will be able to route work to it.",
      quoted: null,
      values: [],
    };
  }
  return {
    sentence:
      "No agent here declares anything that covers this, so I am not going to hand it to one " +
      "and hope. Between them, this is everything your agents are set up to do:",
    quoted: null,
    values: [...capabilities],
  };
}

/** Nothing was typed, or nothing in it was a word worth matching on. */
export function describeEmpty(): ChiefSentence {
  return {
    sentence: "Tell me what you want done and I will say which of your agents is set up for it.",
    quoted: null,
    values: [],
  };
}

/**
 * What this Chief cannot do, said on the surface rather than discovered.
 *
 * MAR-419 describes a Chief that acts through the audited command channel. This
 * slice routes and refuses and **runs nothing**, and the surface says so where
 * the running would have happened — the same honesty MAR-536 applies to the
 * host wizard's unwired Next button, and the same reason: a control that looks
 * like it will act and does not is worse than one that says it will not.
 */
export function describeChiefLimits(): { headline: string; meaning: string } {
  return {
    headline: "I can say who, not do it",
    meaning:
      "I read what each of your agents was set up to do and tell you which one fits. " +
      "Starting it is still yours to do, from that agent's own page, where you can see " +
      "what it is about to touch.",
  };
}

/**
 * The three quantities in the side rail, worded (MAR-419).
 *
 * The concept screen this surface follows has CPU and memory meters on it, and
 * MAR-528 refuses that layer by name: no invented metrics. Every number here is
 * one DASH already holds and already renders somewhere else, so a reader can go
 * and check it — which is the difference between a side rail and a dashboard
 * that is decoration.
 *
 * "Agents connected" and not "running agents", deliberately. The concept says
 * running; DASH's agents view carries no live per-agent run state, and a count
 * labelled "running" that actually meant "registered" would be exactly the kind
 * of number this project has spent several issues removing.
 */
export function describeFleetCounts(counts: {
  agents: number;
  waiting: number;
  last_evidence_at: string | null;
}): Array<{ label: string; value: string; meaning: string }> {
  return [
    {
      label: "Agents connected",
      value: String(counts.agents),
      meaning: "Agents DASH holds a manifest for. Not a count of how many are running.",
    },
    {
      label: "Waiting for you",
      value: String(counts.waiting),
      meaning: "Approvals and choices in your work inbox right now.",
    },
    {
      label: "Evidence last pulled",
      value: counts.last_evidence_at === null ? "Never" : counts.last_evidence_at,
      meaning:
        counts.last_evidence_at === null
          ? "DASH has not read run evidence from anywhere yet."
          : "When DASH last read run evidence, in its own records.",
    },
  ];
}
