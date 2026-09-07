/**
 * What the Connections page says about the periods it cannot account for
 * (MAR-877, UX-3; MAR-467 and ADR 0005 unchanged underneath).
 *
 * ## What was on the page, and why it was the wrong way round
 *
 * The page opened with one block per agent — *"AI-NEWS-SCOUT-4 — There is 1
 * period DASH cannot account for"*, five of them on Henrik's machine — and the
 * first service appeared below all five. Every one of those blocks was true and
 * every one of them was already folded; what was not folded was the *list of
 * them*, so a page whose subject is the accounts a person connects opened with
 * five headings about times DASH was closed.
 *
 * MAR-467's argument for putting lapses first was about somebody who came here
 * because an agent did less than they expected, and it is still right for that
 * person. It is not an argument for five headings: one line with the same two
 * numbers reaches that person just as well and reaches everybody else without
 * standing in front of what they came for. So the block becomes one summary and
 * the per-agent detail moves inside it, and it moves **below** the services,
 * which is what the page is called.
 *
 * Nothing is deleted. Every period, every window and every qualifier is still
 * drawn, one row per agent, behind one disclosure.
 */

/**
 * The one line that replaces the stack of blocks.
 *
 * Two numbers, because they answer different questions: how much DASH could not
 * account for, and how widely it is spread. One agent with four gaps and four
 * agents with one each are different situations and a single count would read
 * the same for both.
 */
export function describeLapseSummary(periods: number, agents: number): string {
  if (periods <= 0 || agents <= 0) {
    return "";
  }
  const periodPart = periods === 1 ? "1 period" : `${String(periods)} periods`;
  if (agents === 1) {
    return `DASH cannot account for ${periodPart} for one agent.`;
  }
  return `DASH cannot account for ${periodPart} across ${String(agents)} agents.`;
}

/**
 * The caveat, moved verbatim from `BrokerLapseNotice` and said once.
 *
 * It was under every one of the five blocks. It is one fact about all of them,
 * so it is said once, at the top of the one disclosure that now holds them.
 */
export const LAPSES_ARE_NOT_DECISIONS =
  "These are not decisions. They are times an agent may have asked for something and " +
  "DASH was not in a position to answer or to record it.";

/** One agent's row inside the disclosure. */
export function describeAgentLapseCount(count: number): string {
  return count === 1 ? "1 period" : `${String(count)} periods`;
}

/**
 * Where the shared-sign-in consequence is explained (MAR-877).
 *
 * The sentence itself is `describeSharedGrant`'s and is not touched here — it
 * is composed beside the grant that shares, so the page cannot soften a
 * consequence that lands on an agent the reader is not looking at. What this
 * names is the heading it sits under at the moment of authorization, so that a
 * person meets it once, where the decision is, rather than above every service
 * on the page.
 */
export function authorizationHeading(signIn: boolean): string {
  return signIn ? "Before you sign in" : "Before you add this key";
}

/**
 * Every sentence this module can produce, for the plain-language check.
 *
 * The counts are enumerated across the singular and the plural of both numbers
 * rather than at one value: they are four different sentences and a gate that
 * read one of them would be a quarter of a gate.
 */
export function everySettingsConnectionsSentence(): string[] {
  const sentences = [
    LAPSES_ARE_NOT_DECISIONS,
    authorizationHeading(true),
    authorizationHeading(false),
  ];
  for (const periods of [0, 1, 2, 9]) {
    for (const agents of [0, 1, 2, 5]) {
      sentences.push(describeLapseSummary(periods, agents));
    }
  }
  for (const count of [1, 2, 9]) {
    sentences.push(describeAgentLapseCount(count));
  }
  return sentences.filter((sentence) => sentence !== "");
}
