/**
 * What the chief says back (MAR-648, closing MAR-419's first half).
 *
 * Henrik: *"It doesn't matter if it is the chief (in fleet view) or a specific
 * agent. The chat is central and important."* So the chief's band grows a
 * composer, and a composer needs an answer for every press.
 *
 * ## The chief has no model, and this module is why that is not a shortfall
 *
 * `lib/chief/route.ts` records the two broker-side locks that put a model out of
 * the chief's reach today. What is left is not nothing: the chief already holds
 * every glance chip, every card status and every run count on the page it stands
 * on, and MAR-648's own constraint is that its answers are *"scoped to what the
 * chief can already speak about (fleet facts, glance chips)"*. A chief that
 * speculates breaks MAR-547's rule, and the way to be structurally unable to
 * speculate is to have nothing but records to speak from.
 *
 * So there are exactly two kinds of answer and no third:
 *
 * 1. **The fleet's standing**, quoted from `lib/copy/glance.ts` and
 *    `describeFleetSummary` — never reworded here, which is the rule
 *    `lib/copy/chief.ts` already keeps for the band's one-line version.
 * 2. **A hand-off**, when the question is about what an agent *found* rather
 *    than about the fleet. The chief cannot answer that and says who can, which
 *    is the one surface in DASH where that question is actually answerable and
 *    actually paid for.
 *
 * There is no arm that composes a sentence about an agent from anything other
 * than a record, and no arm that reaches a model. Both are absences a reader can
 * check by reading the union below.
 *
 * ## Route first, stand second, and the precedence is the whole design
 *
 * The tempting order is the other one: look for words about standing, fall back
 * to routing. It is wrong on the fleet DASH actually ships. `ai-agent-news`
 * declares the word *agent* in its own goal, so *"what's the latest ai agent
 * news"* — the single most likely question on a fleet of one — would be read as
 * a question about the fleet and answered with a status line.
 *
 * Routing first fixes that, because routing matches only what an author
 * **declared** and therefore only fires when a real agent really claims the
 * subject. `STANDING_WORDS` then overrides it, and is deliberately small and
 * high-precision: every word in it is one that essentially only appears when
 * somebody is asking how things are going, so *"what needs me"* cannot be
 * routed to an agent whose plan happens to mention needing something.
 *
 * ## Pure, and it must stay that way
 *
 * No store, no clock, no React. `lib/views/chief.ts` reads the records and this
 * decides what they mean, which is the split that lets every case below be
 * driven by `tests/chief-reply.test.ts` with no database — and the split
 * `tests/client-bundle.test.ts` requires, because the fleet page imports this
 * directly.
 */

import { describeFleetSummary } from "../copy/chief";
import type { FleetCardStatus } from "../copy/fleet-status";
import type { GlanceChip } from "../copy/glance";
import { declaredCapabilities, routeRequest, stem, words, type ChiefAgent } from "./route";

/**
 * One agent as the chief's chat sees it: what it is *for*, and how it is
 * *doing*.
 *
 * The two halves are kept visibly apart because only the first may reach
 * `routeRequest`. `asked` below projects this down to `ChiefAgent` explicitly
 * rather than passing the whole record through on structural typing — the
 * routing rule is "declared goals and capabilities, never telemetry", and a
 * projection is a mechanism where a convention would have been a promise.
 */
export interface ChiefFleetAgent extends ChiefAgent {
  /** `agentDisplayName`'s answer — the only name the chief may print. */
  title: string;
  /** The card's own chips, already worded. Never empty (`GLANCE_ALL_CLEAR`). */
  glance: readonly GlanceChip[];
  /** The card's status, or null for one with none of the four. */
  status: FleetCardStatus | null;
}

/**
 * One agent the chief names in a standing answer, with the chip that made it
 * worth naming.
 *
 * `meaning` is `GlanceChip.meaning` verbatim. The chief quotes and never
 * paraphrases, which is `describeChief`'s standing rule: two wordings of "needs
 * your approval" is one wording free to soften.
 */
export interface ChiefDemand {
  agent: string;
  title: string;
  label: string;
  meaning: string;
}

export type ChiefReply =
  /** Nothing was asked. The composer will not submit one, so this is a guard. */
  | { kind: "nothing_asked" }
  /**
   * How the fleet is doing, from the cards' own chips.
   *
   * `summary` is `describeFleetSummary`'s counted sentence and `demands` are the
   * chips that are demands — amber and blue, never the all-clear, because a
   * list of every agent that is fine is a list nobody asked for.
   */
  | { kind: "standing"; summary: string; demands: readonly ChiefDemand[] }
  /** One agent declares this subject. The chief hands over and says why. */
  | { kind: "routed"; agent: ChiefFleetAgent; matched: readonly string[] }
  /** Several declare it equally well. Naming them beats picking one. */
  | { kind: "ambiguous"; agents: readonly ChiefFleetAgent[]; matched: readonly string[] }
  /**
   * Nobody declares it, so the chief answers the question it *can* — the
   * standing — and names what the fleet actually declares.
   *
   * MAR-419: *"when no connected agent can do the thing, the Chief says so and
   * names what is missing. It must not improvise a plan that no agent declared
   * it can execute."* The standing rides along rather than replacing that,
   * because somebody who asked the chief anything at all is on a page about how
   * their fleet is doing.
   */
  | {
      kind: "undeclared";
      summary: string;
      demands: readonly ChiefDemand[];
      declared: readonly string[];
    };

/**
 * Words that mean the person is asking how things are going.
 *
 * Deliberately short. Every entry is a word that would be strange in a question
 * about a *topic* an agent covers, which is the property that lets it outrank a
 * declared match — see this module's header for the fleet-of-one case that
 * decided the precedence.
 *
 * Written in ordinary spelling and **run through `stem` at module load**, which
 * is the only arrangement that cannot drift: request words are stemmed on the
 * way in, so an entry stored unstemmed would silently never match. `status`
 * stems to `statu` — the stemmer strips one trailing `s` and does not care that
 * this one is not a plural — and writing `statu` here by hand would be a typo
 * nobody could tell from a fix. Stemming both sides with one function is what
 * makes that irrelevant, which is the same symmetry argument `stem`'s own note
 * makes about `invoices`.
 *
 * `failed` and `failing` are separate entries because `stem` normalises a
 * trailing `s` and nothing else. Widening it to real morphology would change
 * what it does to every manifest in the fleet, which is a much larger decision
 * than this list.
 */
const STANDING_WORDS: ReadonlySet<string> = new Set(
  [
    "approval",
    "broken",
    "error",
    "fail",
    "failed",
    "failing",
    "failure",
    "fleet",
    "health",
    "healthy",
    "need",
    "overdue",
    "problem",
    "standing",
    "status",
    "stuck",
    "waiting",
    "wrong",
  ].map(stem),
);

/** Whether this question is about how the fleet is doing. */
export function asksAboutStanding(question: string): boolean {
  return words(question)
    .map(stem)
    .some((word) => STANDING_WORDS.has(word));
}

/**
 * The chief's answer to one question.
 *
 * Total: every input produces a reply, and none of them is an apology. That is
 * `ask.tsx`'s rule about dead inputs applied to a box with no model behind it —
 * a composer whose worst case is "I could not understand that" would be a
 * composer somebody learns not to use.
 */
export function answerChief(
  question: string,
  fleet: readonly ChiefFleetAgent[],
): ChiefReply {
  const asked = words(question);
  if (asked.length === 0) {
    return { kind: "nothing_asked" };
  }

  const standing = (): { summary: string; demands: ChiefDemand[] } => ({
    summary: describeFleetSummary(fleet.map((agent) => agent.status)),
    demands: demandsOf(fleet),
  });

  if (asksAboutStanding(question)) {
    return { kind: "standing", ...standing() };
  }

  /*
   * The projection this module's header promises. `routeRequest` is handed the
   * three declared fields and nothing else, so no amount of future growth on
   * `ChiefFleetAgent` can put a run, a chip or a status into the corpus that
   * decides who a request goes to.
   */
  const declaredOnly: ChiefAgent[] = fleet.map((agent) => ({
    name: agent.name,
    goal: agent.goal,
    avatar: agent.avatar,
    capabilities: agent.capabilities,
  }));
  const routed = routeRequest(question, declaredOnly);

  if (routed.kind === "routed") {
    const agent = byName(fleet, routed.agent.name);
    return agent === null
      ? { kind: "undeclared", ...standing(), declared: declaredCapabilities(declaredOnly) }
      : { kind: "routed", agent, matched: routed.matched };
  }
  if (routed.kind === "ambiguous") {
    const agents = routed.agents
      .map((one) => byName(fleet, one.name))
      .filter((one): one is ChiefFleetAgent => one !== null);
    if (agents.length > 1) {
      return { kind: "ambiguous", agents, matched: routed.matched };
    }
  }
  return { kind: "undeclared", ...standing(), declared: declaredCapabilities(declaredOnly) };
}

/**
 * The agents with something waiting on the person, each with the chip that says
 * so.
 *
 * The all-clear chip is skipped rather than rendered quietly, which is the one
 * editorial decision in this module and `describeChief`'s own: `GLANCE_ALL_CLEAR`
 * exists so a *card* is never blank, and a chief that recited "nothing needs
 * you" once per healthy agent would bury the two that do under the ten that do
 * not. The count of healthy agents is already in `summary`.
 *
 * One chip per agent, the most pressing, in `lib/views/glance.ts`'s own order —
 * the same "amber outranks blue" scale `lib/copy/chief.ts` settled for the
 * band's single line, so the two cannot disagree about what matters most.
 */
function demandsOf(fleet: readonly ChiefFleetAgent[]): ChiefDemand[] {
  const demands: ChiefDemand[] = [];
  for (const agent of fleet) {
    const chip =
      agent.glance.find((one) => one.tone === "warn") ??
      agent.glance.find((one) => one.tone === "accent");
    if (chip === undefined || chip.question === "all_clear") {
      continue;
    }
    demands.push({
      agent: agent.name,
      title: agent.title,
      label: chip.label,
      meaning: chip.meaning,
    });
  }
  return demands;
}

function byName(
  fleet: readonly ChiefFleetAgent[],
  name: string,
): ChiefFleetAgent | null {
  return fleet.find((agent) => agent.name === name) ?? null;
}
