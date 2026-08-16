/**
 * What the browser supervision surface is allowed to claim (MAR-628, ADR 0019).
 *
 * ## The two sentences this module exists to stop
 *
 * **"This agent could only visit these sites."** False. An origin list limits
 * the browser DASH provides. The agent is an ordinary child process with an
 * ordinary network stack, and it can reach the internet by `fetch`, by a socket,
 * or by another browser entirely, none of which DASH sees. ADR 0019 requires
 * every surface to say *"DASH limited this browser run"* instead, and
 * `describeReach` in `lib/browser/origins.ts` is the one place that sentence is
 * written.
 *
 * **"Stop undid what it did."** Also false, and worse, because it is the
 * sentence a person most wants to be true at the moment they press it. Stop
 * destroys the view and refuses later commands. A request the browser already
 * sent has already arrived; a site may have recorded it, counted it, or acted on
 * it, and nothing local can reach back. ADR 0019: *"Revocation stops future
 * controller commands and tears down the controlled session; it cannot recall a
 * request already sent."*
 *
 * ## And one this module exists to keep
 *
 * The trail is a record of **what DASH asked its browser to do**. It is not
 * proof of what the site did with it. Every heading here is phrased from DASH's
 * side for that reason: "DASH opened", "DASH stopped", "DASH read" — never "the
 * site showed" or "the page returned", which would be DASH testifying about
 * somebody else's system.
 *
 * ## Rendering rules this file is held to
 *
 * Plain language, per `lib/copy/identifiers.ts`: no operation ids, no refusal
 * codes, no session ids in a sentence. `tests/copy-browser.test.ts` sweeps every
 * sentence this module can produce, derived from the unions rather than from a
 * list somebody maintains, so a refusal added without being described is still
 * seen.
 */

import type { BrowserRefusal } from "../browser/protocol";
import type { BrowserEndReason } from "../browser/session";

/**
 * The standing caveat, shown wherever a browser trail is.
 *
 * Unconditional, on `EvidenceNotice`'s terms: it is not a fault report and it
 * does not become truer when something goes wrong. A person reading a list of
 * pages DASH visited will conclude those are the pages the agent saw unless
 * something on the screen tells them otherwise, and nothing else on the screen
 * can.
 */
export interface BrowserNotice {
  headline: string;
  meaning: string;
  /**
   * True when this is a standing limit of the arrangement rather than something
   * that went wrong. Drives emphasis, never colour — `EvidenceNotice`'s rule:
   * a permanent honest caveat must not render in the same red as a failure.
   */
  standing: boolean;
}

export function browserNotice(): BrowserNotice {
  return {
    headline: "What this record covers",
    meaning:
      "This is what DASH asked its own browser to do, and what it stopped. It is not a " +
      "record of what those websites did afterwards, and it does not cover anything the " +
      "agent did on its own — an agent is an ordinary program and can reach the internet " +
      "by means DASH cannot see.",
    standing: true,
  };
}

/**
 * What the Stop control promises, in the words on the button's own explanation.
 *
 * Two sentences and the second one is the important half. Copy that stopped at
 * the first would be selling a person an undo they did not get.
 */
export function describeStop(): { label: string; meaning: string } {
  return {
    label: "Stop the browser",
    meaning:
      "DASH closes the browser it opened and refuses anything else this agent asks it to " +
      "do for the rest of this run. Pages it already asked for have already been asked " +
      "for, and stopping cannot take that back.",
  };
}

/**
 * The one-line promise made *before* a run, on the agent's own card.
 *
 * Present tense and about the session rather than about the agent, so it stays
 * true on the day somebody adds a second browser operation.
 */
export function describeEphemeralSession(): string {
  return (
    "The browser DASH opens for this agent starts empty and is thrown away when the run " +
    "ends. Nothing is signed in, nothing is remembered between runs, and DASH does not " +
    "type anything into a page."
  );
}

/** Why a session ended, for somebody reading a finished run. */
export function describeEnd(reason: BrowserEndReason): string {
  switch (reason) {
    case "stopped_by_person":
      return "You stopped it.";
    case "closed_by_agent":
      return "The agent finished with it.";
    case "run_ended":
      return "The run ended, so DASH closed it.";
  }
}

/**
 * What a person reads when DASH refused something the agent asked its browser
 * for.
 *
 * Written so that the ordinary ones do not read as alarms. Most refusals here
 * are an agent meeting a limit a person set, which is the system working —
 * copy that cried wolf on every one of them would train somebody to stop
 * reading the trail, which is the outcome that would make the whole surface
 * worthless. That is `describeReachRefusal`'s argument in `lib/mcp/reach.ts`,
 * applied to a browser.
 */
export function describeBrowserRefusal(refusal: BrowserRefusal): string {
  switch (refusal) {
    case "unknown_operation":
      return "The agent asked for something DASH's browser does not do at all.";
    case "browser_not_declared":
      return "This agent does not ask for a browser, so DASH has no list of addresses for it.";
    case "origin_not_allowed":
      return "The agent asked to go to an address that is not one this run was set up for.";
    case "revoked":
      return "You had already stopped the browser for this run.";
    case "no_session":
      return "The agent asked DASH to read a page when no page was open.";
    case "invalid_input":
      return "The agent asked for an address DASH could not read as a web address.";
    case "duplicate_request":
      return "The agent asked for the same thing twice, so DASH did it once.";
    case "rate_limited":
      return "The agent was asking for pages faster than DASH will open them.";
    case "page_unavailable":
      return "The page did not load. That is usually the website rather than the agent.";
    case "browser_error":
      return "Something went wrong inside DASH. This one is DASH's fault, not the agent's.";
  }
}

/**
 * What a person reads about requests a *page* made and DASH refused.
 *
 * Its own sentence rather than a refusal above, because nobody asked for these:
 * a script, a font or a redirect chose them, and presenting them in the agent's
 * voice would put a publisher's advertising network on an agent's conduct
 * record. See `BlockedRequestRow` for why they have a different shape too.
 */
export function describeBlocked(count: number): string {
  if (count === 0) {
    return "Every request the page made was to an address this run was set up for.";
  }
  return (
    `The page itself tried to load ${String(count)} ` +
    `${count === 1 ? "thing" : "things"} from somewhere else — usually adverts, fonts or ` +
    "trackers. DASH did not let its browser fetch them. The agent did not ask for these."
  );
}
