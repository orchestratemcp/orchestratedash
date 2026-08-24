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
 * **This is not the Chief chat.** MAR-648 is that (`app/_components/chief-chat.tsx`),
 * and it long ago replaced the standing "Ask {agent}" link this module used to
 * hand the band — MAR-696 removed that link along with the chat's own submit
 * button, leaving nothing here that draws a control at all. Nothing in this
 * module calls a model, spends a key, or takes a question; it only writes the
 * one sentence the band says about the agent in the middle, unprompted.
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
import type { FleetCardStatus } from "./fleet-status";

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
   * surface that owns that fact already chose — except the all-clear case,
   * where `says` is the fixed "All clear." and the chip's own sentence moves
   * to `note` (MAR-639). See `note` below.
   */
  says: string;
  /**
   * The all-clear chip's full sentence, behind an `InfoNote`, or `null` for
   * every other chip (MAR-639).
   *
   * `lib/copy/info-note.ts`'s `splitGlance` already makes this exact call for
   * the card's own chips — an absence, read once and never needed again, is
   * the one sentence in this vocabulary that moves. The four demands keep
   * their whole sentence on `says` untouched, for `splitGlance`'s own reason:
   * each one carries the part the chip's two words cannot.
   */
  note: string | null;
  /** The second line: DASH's record of whether this agent has ever worked. */
  runs: string;
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
  /*
   * MAR-639. The one chip whose sentence is an absence rather than a demand —
   * `lib/copy/info-note.ts`'s own distinction, applied here the way
   * `splitGlance` already applies it to the card. "All clear." is the fact;
   * the four answered "no"s behind it are documentation, not a decision this
   * sentence position needs to carry every time a healthy agent is centred.
   */
  const isAllClear = spoken.question === "all_clear";
  return {
    agent: facts.agent,
    /*
     * `meaning`, not `label`, for every chip but this one. The label is two or
     * three words sized for a chip beside four others; the chief has one line
     * and a reader looking at it rather than scanning a row, so it says the
     * whole sentence — which is the same reason `GlanceChip.meaning` is
     * rendered under the chips rather than hidden in a tooltip.
     */
    says: isAllClear ? "All clear." : spoken.meaning,
    note: isAllClear ? spoken.meaning : null,
    runs: facts.runs,
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
 * What the band says when the fleet is empty (MAR-742 roadmap item 2).
 *
 * Reachable now on purpose: Henrik, 2026-08-24, *"Chief is our orchestrator
 * and he should always be reachable and active"* — a fresh DASH with no agents
 * still opens the chief's room, and a standing question ("how's my fleet")
 * lands here. `app/page.tsx` still draws its own "Nothing here yet" onboarding
 * card above the fleet, so this sentence does not have to repeat that card's
 * job — it names how to add an agent because a person asking the chief
 * directly should not have to scroll up to find out, the same reasoning
 * `describeChiefNoModel` already applies to a missing model.
 */
export const CHIEF_WAITING =
  "Your fleet is empty — no agents added yet. Choose \"Try a sample agent\" from the menu " +
  "button at the top left of the window, or add one you built yourself from Settings.";

/**
 * What the band says when nothing is selected, summarising the fleet instead
 * of naming one agent (MAR-639).
 *
 * Henrik's own example, verbatim: *"2 need you, 1 working."* Built from the
 * same per-card status every portrait is now tinted by
 * (`lib/copy/fleet-status.ts`), so the two vocabularies cannot disagree about
 * what "needs you" or "working" means — a second count derived a different
 * way would be a second definition of both words.
 *
 * `statuses` is one entry per agent in the fleet, `null` for a card with none
 * of the four statuses (a never-run agent with nothing waiting). Empty falls
 * through to `CHIEF_WAITING`, which is this function's only invented string —
 * every other sentence it returns is built from a count.
 */
export function describeFleetSummary(statuses: readonly (FleetCardStatus | null)[]): string {
  if (statuses.length === 0) {
    return CHIEF_WAITING;
  }
  const needsYou = statuses.filter((status) => status === "needs_input").length;
  const working = statuses.filter((status) => status === "working").length;
  const parts = [
    needsYou === 0 ? null : needsYou === 1 ? "1 needs you" : `${String(needsYou)} need you`,
    working === 0 ? null : `${String(working)} working`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "Nothing needs you right now." : `${parts.join(", ")}.`;
}

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
