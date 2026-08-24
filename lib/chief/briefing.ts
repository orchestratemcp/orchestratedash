/**
 * What the chief is told about the fleet before it answers (MAR-659, ADR 0023
 * decision 5).
 *
 * ## The rule this replaces, and why the replacement is weaker on purpose
 *
 * `describeChief`'s standing rule is that fleet facts are quoted from DASH's own
 * records and never reworded. **That rule does not survive contact with "which
 * agents run local and which on the cloud", and saying it does would be the
 * failure.** "Never reworded" is a property of quoting *one* record; that
 * question is `describeFleetPlace` evaluated per agent and grouped. There is no
 * single record to quote.
 *
 * So the rule here is narrower and can actually be true:
 *
 * > **Every field on a briefing row is a string DASH already renders on a
 * > screen.**
 *
 * The title is `agentDisplayName`'s answer, as the card's heading. `place` is
 * `describeFleetPlace().label`, as the card's own two words. `standing` is a
 * glance chip's `meaning` verbatim, as the chip says it. `runs` is
 * `describeRunCount`'s sentence, which is why that function moved into
 * `lib/copy/fleet-status.ts`. `last_run` is `plainDay`'s date, as the card
 * prints it. `capabilities` are the declared component ids, which are values
 * rather than prose everywhere in DASH and stay values here.
 *
 * Nothing on a row is computed for the model's benefit, and nothing is
 * paraphrased on the way in. A row is a screenshot of a card, in words.
 *
 * ## The receipt is the same rows
 *
 * There is no second structure. What is sent is what is shown underneath the
 * answer and what is frozen into the transcript, so "the receipt lists what was
 * actually sent" is a consequence of there being one array rather than a claim
 * two code paths have to keep true.
 *
 * ## Pure
 *
 * No store, no clock, no React. The rows arrive as `AgentRow`s — the document
 * both hosts already build — so every case here is drivable by
 * `tests/chief-briefing.test.ts` with no database.
 */

import { describeFleetPlace, describeRunCount } from "../copy/fleet-status";
import { plainDay } from "../copy/when";
import type { AgentRow } from "../views/types";

/**
 * One agent, as the chief is told about it and as the receipt shows it back.
 *
 * One type for both directions. See this module's header on why there is not a
 * second one.
 */
export interface ChiefBriefingRow {
  /** The agent id. A value: it keys the row and links out, and never enters prose. */
  agent: string;
  /** `agentDisplayName`'s answer — the only name the chief may print. */
  title: string;
  /** `describeFleetPlace().label`: "Local" or "Cloud". */
  place: string;
  /** A glance chip's `meaning`, verbatim. Never empty — see `GLANCE_ALL_CLEAR`. */
  standing: string;
  /** `describeRunCount`'s sentence. */
  runs: string;
  /** `plainDay` of the last run DASH saw, or null when it has never seen one. */
  last_run: string | null;
  /** `planned_route[].component_id`, in declared order. Values, never labels. */
  capabilities: readonly string[];
}

/**
 * How many agents one briefing carries.
 *
 * ADR 0023 names this as an honest gap rather than a solved problem: the
 * briefing grows linearly with the fleet and is sent on every model-answered
 * question, so a fleet of forty is a cost story that decision does not have.
 * What it does have is a ceiling, so the cost is bounded by a number in this
 * file rather than by how many agents somebody happens to own — and a truncated
 * briefing is *visible*, because the receipt underneath the answer is the same
 * array and shows the same rows.
 *
 * Twenty-four is far above the fleet of one this ships against and far below a
 * request nobody can afford. Where to truncate a fleet of forty properly — by
 * relevance? by recency? — is a decision nobody has made, and taking it here
 * would be inventing an answer to a question the ADR deliberately left open.
 */
export const MAX_BRIEFING_AGENTS = 24;

/**
 * The rows for one question, from the fleet as the page already has it.
 *
 * The order is the caller's, untouched. `agentsView` sorts by name and the
 * fleet page may have filtered; either way the briefing and the cards behind it
 * are in the same order, which is what lets a person check one against the
 * other without re-sorting anything in their head.
 */
export function briefingFor(agents: readonly AgentRow[]): ChiefBriefingRow[] {
  return agents.slice(0, MAX_BRIEFING_AGENTS).map((agent) => ({
    agent: agent.name,
    title: agent.title,
    place: describeFleetPlace(agent.hosted_on).label,
    standing: mostPressing(agent),
    runs: describeRunCount(agent.run_count),
    last_run: agent.last_run_at === null ? null : plainDay(agent.last_run_at),
    capabilities: [...agent.capabilities],
  }));
}

/**
 * The one chip this agent's card leads with, as the chip words it.
 *
 * `lib/views/glance.ts`' own order — amber outranks blue — which is the same
 * scale `lib/copy/chief.ts` settled for the band's single line and
 * `demandsOf` uses for the standing answer, so the briefing and the two
 * surfaces beside it cannot come to disagree about what matters most.
 *
 * Unlike `demandsOf`, the all-clear chip is **kept**. That function is building
 * a list of agents waiting on somebody and "nothing needs you" would be noise in
 * it; this is a description of every agent, and an agent with nothing waiting is
 * a fact the answer to "how is my fleet doing" needs. The fallback is only
 * reached by a row with no chips at all, which `AgentRow.glance` documents as
 * impossible — and it says the smallest true thing rather than inventing a
 * standing.
 */
function mostPressing(agent: AgentRow): string {
  const chip =
    agent.glance.find((one) => one.tone === "warn") ??
    agent.glance.find((one) => one.tone === "accent") ??
    agent.glance[0];
  return chip?.meaning ?? "DASH has nothing recorded about how this agent is doing.";
}

/* ---------------------------------------------------------------------- *
 * What the model is sent
 * ---------------------------------------------------------------------- */

/**
 * What DASH says when a question carried no fleet facts at all (ADR 0023
 * decision 7).
 *
 * A greeting goes through the same model call with an empty briefing — **not**
 * through a table of canned greetings, which would be a second personality free
 * to drift from the first and is the exact shape MAR-547 forbids: a sentence in
 * a speech position with nothing behind it that a reader cannot tell from one
 * with a record behind it.
 *
 * So the briefing is never literally empty on the wire: it is this sentence,
 * which is DASH's own and says plainly that there is nothing. That keeps the
 * operation's own non-empty rule intact without a special case in it, and it
 * tells the model the true thing rather than leaving it to infer one from a
 * blank fence.
 *
 * `briefingFor` maps agents one row per agent (`MAX_BRIEFING_AGENTS` aside), so
 * `rows.length === 0` has exactly one cause in practice: the fleet has no
 * agents in it (MAR-742 roadmap item 2 — the chief is reachable with a fresh,
 * empty DASH now, where it never was before). The sentence says that plainly,
 * rather than the vaguer "records were not read for it" a decision-7 greeting
 * would have been just as honestly described by, because `CHIEF_SYSTEM_PROMPT`
 * answers only from what is here — a model that cannot tell "no agents" from
 * "not a fleet question" cannot say the one thing an empty-fleet question
 * actually needs: how to add one.
 */
export const EMPTY_BRIEFING =
  "This person's fleet has no agents in it yet — nothing has been added, run, or connected. " +
  "There is nothing to report about runs, approvals or connections. To add one: choose " +
  '"Try a sample agent" from the menu button at the top left of the window, or add one they ' +
  "built themselves from Settings.";

/**
 * The briefing as one string.
 *
 * Numbered and labelled rather than run together, `renderItem`'s reason: an
 * unlabelled blob invites a model to guess which part is the fact and which is
 * the claim. The numbers are the receipt's row order, so an answer that mentions
 * an agent can be checked against the row underneath it.
 *
 * A row's `agent` id is deliberately **not** sent. It is DASH's key for the row
 * and the thing the receipt links out on; a model given both a title and an
 * identifier will eventually write the identifier into a sentence, which is
 * `lib/copy/identifiers.ts`' rule broken by a model instead of by a person.
 */
export function renderBriefing(rows: readonly ChiefBriefingRow[]): string {
  if (rows.length === 0) {
    return EMPTY_BRIEFING;
  }
  return rows
    .map((row, index) => {
      const lines = [
        `[${String(index + 1)}] ${row.title}`,
        `Runs on: ${row.place}`,
        `Standing: ${row.standing}`,
        `Activity: ${row.runs}${row.last_run === null ? "" : `, last on ${row.last_run}`}`,
      ];
      if (row.capabilities.length > 0) {
        lines.push(`Declared steps: ${row.capabilities.join(", ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

/* ---------------------------------------------------------------------- *
 * Whether a stored turn still describes the fleet it was written about
 * ---------------------------------------------------------------------- */

/**
 * Has anything in this frozen receipt stopped being true?
 *
 * ADR 0023 decision 6. MAR-648's argument for a session-only scrollback was that
 * a chief answer is a statement about the fleet *now*, and a stored one would be
 * a sentence about last Tuesday sitting in a scrollback looking like a sentence
 * about today. **That is an argument against undated re-presentation, not
 * against storage** — and this is the difference: DASH compares two of its own
 * records and marks the turn when they disagree, so an old sentence cannot
 * impersonate a current one.
 *
 * Inside the facts-only rule, because what it reports is a fact DASH observed by
 * reading its own store twice. It is not a claim about whether the *answer* is
 * still right — a model could have said something that survives the fleet
 * changing, or something that was wrong when it was written — and the copy in
 * `lib/copy/chief-chat.ts` is careful to say the fleet changed rather than that
 * the answer is stale.
 *
 * An empty frozen receipt is never marked. A greeting made no claim about the
 * fleet, so there is nothing about it the fleet could contradict.
 */
export function fleetChangedSince(
  frozen: readonly ChiefBriefingRow[],
  now: readonly ChiefBriefingRow[],
): boolean {
  if (frozen.length === 0) {
    return false;
  }
  const current = new Map(now.map((row) => [row.agent, row]));
  if (current.size !== frozen.length) {
    // An agent added or removed since. Counted against the frozen rows rather
    // than against the whole fleet, because a briefing is capped at
    // `MAX_BRIEFING_AGENTS` and a fleet that grew past the cap would otherwise
    // report every old turn as changed forever.
    return true;
  }
  for (const row of frozen) {
    const today = current.get(row.agent);
    if (today === undefined || !sameRow(row, today)) {
      return true;
    }
  }
  return false;
}

/**
 * Two rows describing the same agent the same way.
 *
 * Field by field rather than by serialising both, so that adding a field to
 * `ChiefBriefingRow` is a compile error here rather than a silent widening of
 * what counts as a change. Every field is compared: each one is a sentence the
 * answer above could have been built on, and one that moved is one the answer
 * may now be wrong about.
 */
function sameRow(left: ChiefBriefingRow, right: ChiefBriefingRow): boolean {
  return (
    left.title === right.title &&
    left.place === right.place &&
    left.standing === right.standing &&
    left.runs === right.runs &&
    left.last_run === right.last_run &&
    left.capabilities.length === right.capabilities.length &&
    left.capabilities.every((one, index) => one === right.capabilities[index])
  );
}
