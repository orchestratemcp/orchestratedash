/**
 * What the chief says about the fleet (MAR-612, narrowed to fleet-only at
 * MAR-669).
 *
 * Henrik's third view puts the chief under the cards: *"under the 3 cards we
 * have the chief."* MAR-612 through MAR-648 had it speak about **the agent in
 * the middle** too — a status line plus an "Ask <agent>" action, both driven
 * by the card's own selection. Henrik's MAR-669 screenshot scribbles that
 * line out and, asked directly, confirmed it: *"remove the per-agent line
 * entirely. The chief band speaks about the fleet as a whole and nothing
 * else"* — station 11's *"when in fleet mode I want the chat to only be
 * chief mode,"* now applied to the unprompted line too.
 *
 * So this module is down to the fleet-wide summary, for whichever agent is or
 * is not selected. The per-agent sentence (`describeChief`, `ChiefLine`) and
 * its `AgentHosting` line moved with it — neither has a caller left, and this
 * repository's own convention is to delete rather than keep an export
 * nothing calls (MAR-642 packet 4's `DeployPanel`, MAR-660's
 * `OpenAgentButton`).
 *
 * The route to asking *one* agent is untouched: `lib/chief/route.ts`'s typed
 * question routing still names an agent and links to its own workspace, and
 * `app/_components/ask.tsx`'s `#ask-agent` section still lives there — this
 * module never owned either.
 *
 * ## It invents nothing
 *
 * `describeFleetSummary` is built from the same per-card status every
 * portrait is tinted by (`lib/copy/fleet-status.ts`), so the two vocabularies
 * cannot disagree about what "needs you" or "working" means. No clock, no
 * store: MAR-547's ruling against `CPU LOAD 87%` applies hardest to a
 * character that appears to be talking.
 */

import type { FleetCardStatus } from "./fleet-status";

/**
 * What the band says when the fleet is empty — the one state that is not
 * supposed to reach this band at all, since `app/page.tsx` draws its own
 * "nothing here yet" before `FleetList` ever mounts. Kept as the fallback of
 * last resort for `describeFleetSummary` below rather than deleted: the
 * honest answer to a state that should not exist is silence about *why*, not
 * a guess.
 */
export const CHIEF_WAITING = "The chief is waiting for an agent to talk about.";

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
