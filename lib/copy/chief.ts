/**
 * What the chief says about the agent in the middle (MAR-612).
 *
 * Henrik's third view puts the chief under the cards: *"under the 3 cards we
 * have the chief. iF Chatting with the cheif he brings the agent we are talking
 * about yo the center."*
 *
 * ## The chief's job, which `docs/design-brief.md` already decided
 *
 * > A non-technical user should never have to read the fleet grid to answer "is
 * > my thing working". They should be able to ask, and get a sentence.
 *
 * That is the whole of this module. It gives the sentence — for the agent in the
 * middle, without being asked, from facts the card beside it already holds.
 *
 * ## What this is not, said plainly because the name collides
 *
 * **This is not the Chief chat.** MAR-419 is that, it is unbuilt, and it is
 * blocked on a fleet-wide selection over MAR-545's completion layer
 * (`docs/mar-545-handoff.md`). Nothing here calls a model, spends a key, or
 * takes a question. When MAR-419 lands it replaces the band's action with a real
 * input; until then the band's action is the one true thing in reach — the
 * per-agent Ask that MAR-545 already shipped on the agent's own workspace.
 *
 * So there is no dead input anywhere in this feature, which is `ask.tsx`'s
 * standing rule and the reason that component's union has no arm for one.
 *
 * ## It invents nothing, and the shape is what enforces that
 *
 * Every string this returns either comes in already worded or is a fixed
 * literal. The chief has no clock, no store and no fifth fact — MAR-547's ruling
 * against `CPU LOAD 87%` applies hardest to a character that appears to be
 * talking, because a sentence in a speech position is the easiest place in an
 * interface to smuggle a claim nobody can source.
 *
 * In particular the chief never rewords a glance chip. `lib/copy/glance.ts` owns
 * those four sentences and this picks one and quotes it, so there is no second
 * copy of "needs your approval" free to soften.
 */

import type { GlanceChip } from "./glance";

export interface ChiefFacts {
  /** The agent in the middle, by the user's own name for it. */
  agent: string;
  /**
   * How many times it has worked, **already worded** by
   * `describeRunCount` — the fleet card's own sentence, passed in rather than
   * rebuilt. Two copies of "Not run yet" is two copies that can disagree the day
   * somebody improves one of them.
   */
  runs: string;
  /**
   * The card's glance chips, in `lib/views/glance.ts` order. Never empty — see
   * `GLANCE_ALL_CLEAR` for why a card with nothing to report still carries one.
   */
  glance: readonly GlanceChip[];
}

export interface ChiefLine {
  /** Who the chief is talking about. The card's own name for the agent. */
  agent: string;
  /**
   * The sentence. The most pressing thing true of this agent, in the words the
   * surface that owns that fact already chose.
   */
  says: string;
  /** The second line: DASH's record of whether this agent has ever worked. */
  runs: string;
  /**
   * What the action under the chief says.
   *
   * Names the agent, because the chief is standing under a row of them and "Ask"
   * alone would be a button whose object is a scroll position.
   */
  action: string;
}

/**
 * Which chip the chief speaks, when a card carries more than one.
 *
 * `lib/copy/glance.ts` has three tones and states what they mean: **amber means
 * something is waiting on you, blue means there is something new to read, grey
 * means neither.** The chief has one sentence and so has to rank them, and the
 * ranking is that scale read top to bottom — which is the same priority
 * `lib/views/fleet-motion.ts` already settled for the bottom strip, where
 * *waiting outranks working* because the person is what the agent is blocked on.
 *
 * Two vocabularies for one fleet must not disagree about what matters most, so
 * this is that one written down a second time rather than a second time decided.
 */
const TONE_ORDER = ["warn", "accent", "muted"] as const;

/**
 * The chief's line about one agent.
 *
 * Returns `null` for an agent with no chips at all. That state is not supposed
 * to exist — `AgentRow.glance` is documented as never empty — and the honest
 * answer to a card DASH could not fill in is for the chief to say nothing rather
 * than to reassure. The band draws its own quiet state in that case.
 */
export function describeChief(facts: ChiefFacts): ChiefLine | null {
  const spoken = pickChip(facts.glance);
  if (spoken === null) {
    return null;
  }
  return {
    agent: facts.agent,
    /*
     * `meaning`, not `label`. The label is two or three words sized for a chip
     * beside four others; the chief has one line and a reader looking at it
     * rather than scanning a row, so it says the whole sentence — which is the
     * same reason `GlanceChip.meaning` is rendered under the chips rather than
     * hidden in a tooltip.
     */
    says: spoken.meaning,
    runs: facts.runs,
    action: `Ask ${facts.agent}`,
  };
}

/**
 * The most pressing chip, or `null` when there are none.
 *
 * Stable within a tone: the first chip of the winning tone, in the order
 * `lib/views/glance.ts` built them, so the chief's sentence does not reshuffle
 * between renders that read the same store.
 */
function pickChip(glance: readonly GlanceChip[]): GlanceChip | null {
  for (const tone of TONE_ORDER) {
    const found = glance.find((chip) => chip.tone === tone);
    if (found !== undefined) {
      return found;
    }
  }
  return null;
}

/**
 * What the band says when there is no agent to stand under.
 *
 * The spotlight is reachable with an empty fleet only for as long as it takes
 * the agents read to come back, and `app/page.tsx` draws its own empty state
 * below — so this is deliberately not a second "nothing here yet" with its own
 * advice. It says where the chief is and stops.
 */
export const CHIEF_WAITING = "The chief is waiting for an agent to talk about.";

/**
 * The chief's accessible name.
 *
 * A `role="img"` on the glyph rather than nothing, and it is the one avatar-ish
 * thing in DASH that is named. `OAvatarProps.label` argues against announcing a
 * costume because a costume is an agent's recognition and never a fact about it;
 * this is the opposite case — the chief is not a costume, it is the speaker, and
 * a sentence attributed to nobody is a sentence a screen reader reads as the
 * page's own voice.
 */
export const CHIEF_NAME = "The chief";
