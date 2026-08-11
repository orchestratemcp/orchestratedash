/**
 * What a server said it had, and what DASH remembers sending there
 * (MAR-606, ADR 0015).
 *
 * ## The question nothing in DASH could answer
 *
 * MAR-489's attended run, 2026-08-10, Henrik's own words:
 *
 * > *"There are two paths to putting an agent on a server. Both seems to work.
 * > But I could put the same agent two times on the server. And there is no way
 * > to see what agents are acctually on the server. As far as i can tell."*
 *
 * He was right, and the outcome was benign — the host held one bundle, because
 * the second install replaced the first, and DASH held one `agent_deploys` row
 * for the same reason. Nothing on any screen said so. DASH had been told the
 * bundle's name by the server and discarded it in `electron/main.ts` before
 * anything could draw it, so the one surface that could have answered him
 * counted to one and stayed silent about what it counted.
 *
 * ## Two sources, and keeping them apart is the whole job
 *
 * There are two accounts of what is on a server and they are not the same kind
 * of thing, so no sentence here blends them:
 *
 * - **What DASH sent** — `agent_deploys`, durable, and permanently true. DASH
 *   did push those bytes on that date. ADR 0010 owns this half.
 * - **What the server named** — a sighting, taken at one instant, going stale
 *   from the moment it arrives. ADR 0015 owns this half.
 *
 * The interesting sentences are the ones where the two disagree, and they are
 * the reason this module exists rather than a formatter: an agent DASH sent that
 * the server did not name, and an agent the server named that DASH never sent.
 * Both are things a person needs to see and neither source can state alone.
 *
 * ## The bound, in one line
 *
 * **Every sentence about a sighting carries the moment it was taken, or it is
 * not written.** Present tense about somebody else's machine stays permanently
 * unavailable — see ADR 0015 for the list. `at` is not decoration here; it is
 * the entire licence, which is why it is a required argument and never
 * defaulted.
 *
 * Pure, and it renders nothing. It imports only `./copy/when`, so it reaches the
 * renderer bundle — the rule `lib/deploy/receipt.ts`'s header explains, and the
 * reason `lib/store.ts` is nowhere near this file.
 */

import { plainMoment } from "./copy/when";
import type { HostAgentSighting } from "./host-connect";

/* ---------------------------------------------------------------------- *
 * One agent, on one server
 * ---------------------------------------------------------------------- */

/**
 * Where one agent stands on one server, as far as anybody can tell.
 *
 * Named after the evidence rather than after the agent's condition, and that is
 * the point of every name in the union: `seen_running` is a thing DASH observed,
 * `sent_only` is a thing DASH did, and neither is a claim about what is true
 * now. There is deliberately no `running`.
 */
export type AgentOnHost =
  /** The server named it and said it had a live process for it. */
  | "seen_running"
  /** The server named it and said it did not. Installed, and stopped. */
  | "seen_stopped"
  /**
   * DASH sent it here and the server did not name it when asked.
   *
   * Not "it was removed". A server can be rebuilt, a folder replaced by hand, a
   * bundle cleared out — DASH sent bytes once and did not acquire a
   * subscription to their fate. The copy says what happened: DASH asked, and it
   * was not in the answer.
   */
  | "sent_not_seen"
  /** DASH sent it here and has not asked since. The honest opening state. */
  | "sent_not_asked"
  /**
   * The server named something DASH has no record of sending.
   *
   * Worth surfacing rather than filtering. It is what a second copy of DASH,
   * a hand-installed bundle, or a forgotten-and-reconnected server looks like,
   * and a page that quietly dropped it would be hiding the one entry its reader
   * cannot account for.
   */
  | "seen_unsent";

export interface AgentHostStanding {
  /** What the person calls this server. Their words, so it is content. */
  server: string;
  /** The agent's name as DASH knows it, or as the server named it. */
  agent: string;
  standing: AgentOnHost;
  /** The whole sentence, complete on its own and carrying its own moment. */
  sentence: string;
  /**
   * Two or three words for a chip.
   *
   * Lowercase in the document — `app/globals.css` uppercases `.chip`, which is
   * typography rather than content, and what a screen reader says is what is in
   * the DOM. A harness grepping for chip copy must read the document and not
   * `innerText`, which returns the uppercased form.
   */
  chip: string;
  /** Emerald only for a live sighting. See `hostStandingTone`. */
  tone: "ok" | "warn" | "muted";
}

/**
 * How loudly a standing is drawn.
 *
 * `seen_running` is the one place in DASH's card surfaces that earns the success
 * colour, and `lib/copy/glance.ts` says why it is otherwise reserved: emerald
 * means *a live, healthy thing*, and a fleet card is a record of an agent at
 * rest with nothing live to report. A sighting is the exception that comment
 * anticipated — it is DASH having just looked at a running process on a machine
 * and being told yes.
 *
 * It is still not a promise. The sentence beside it carries the moment, and the
 * colour fades from meaning the instant the reader notices the clock — which is
 * the correct behaviour and the reason the moment is mandatory.
 */
function hostStandingTone(standing: AgentOnHost): "ok" | "warn" | "muted" {
  switch (standing) {
    case "seen_running":
      return "ok";
    case "seen_stopped":
    case "seen_unsent":
      return "warn";
    case "sent_not_seen":
      return "warn";
    case "sent_not_asked":
      return "muted";
  }
}

/**
 * The sentence for one agent on one server.
 *
 * `at` is the moment the server answered and is required. Passing null is the
 * honest "nothing has been asked" case and produces the one standing that makes
 * no claim about the server at all — it cannot be used to strip the timestamp
 * off a sighting, because a sighting with a null moment is not a sentence this
 * function will write.
 */
export function describeAgentOnHost(input: {
  agent: string;
  server: string;
  /** What the server said about this agent, or null if it did not name it. */
  seen: HostAgentSighting | null;
  /** When DASH sent it here, as a person would say it, or null if it never did. */
  sent_on: string | null;
  /** When the server answered, or null when nothing has asked it. */
  at: string | null;
}): AgentHostStanding {
  const { agent, server, seen, sent_on: sentOn } = input;
  const moment = input.at === null ? null : plainMoment(input.at);
  /*
   * "asked on", not "asked at". `plainMoment` already ends in a clock time, so
   * "at" produced "when DASH asked at 11 August 2026 at 11:37" in the first
   * captured frame — one preposition too many, and only visible in a picture.
   */
  const asked = moment === null ? null : `when DASH asked on ${moment}`;

  const standing: AgentOnHost =
    seen === null
      ? asked === null
        ? "sent_not_asked"
        : sentOn === null
          ? // Nothing sent and nothing seen: this agent has no business being on
            // this server's list at all, and the caller filters it out. Kept
            // total rather than throwing — a copy function is not the place to
            // decide a caller's list is wrong.
            "sent_not_asked"
          : "sent_not_seen"
      : seen.running
        ? "seen_running"
        : "seen_stopped";

  const unsent = seen !== null && sentOn === null;

  return {
    server,
    agent,
    standing: unsent ? "seen_unsent" : standing,
    chip: unsent
      ? "not sent from here"
      : standing === "seen_running"
        ? "seen running"
        : standing === "seen_stopped"
          ? "seen stopped"
          : standing === "sent_not_seen"
            ? "not on it"
            : "not asked",
    tone: hostStandingTone(unsent ? "seen_unsent" : standing),
    sentence: unsent
      ? // The entry nobody can account for, said plainly. "Which DASH has no
        // record of sending" is a statement about DASH's record and not an
        // accusation about the server.
        `${server} named ${agent} ${String(asked)}, and DASH has no record of sending it there.`
      : standing === "seen_running"
        ? `${server} reported ${agent} running ${String(asked)}.`
        : standing === "seen_stopped"
          ? `${server} reported ${agent} installed and not running ${String(asked)}.`
          : standing === "sent_not_seen"
            ? `DASH sent ${agent} to ${server} on ${String(sentOn)}, and ${server} did not name it ${String(asked)}.`
            : sentOn === null
              ? `DASH has not asked ${server} what is on it.`
              : `DASH sent ${agent} to ${server} on ${sentOn}, and has not asked ${server} what is on it since.`,
  };
}

/* ---------------------------------------------------------------------- *
 * One agent, on a fleet card
 * ---------------------------------------------------------------------- */

/**
 * The hosting indicator on a fleet card (MAR-606).
 *
 * > *"AN agent that is hosted online should have like an icon or somthing on
 * > its fleet card."* — Henrik, MAR-489 attended run
 *
 * ## The chip names the server, and that is deliberate
 *
 * `describeAgentOnHost` above produces chips like *"seen running"*, which is
 * right on a server card where the server is the heading. On a fleet card the
 * server is the new information, and a chip that said only "seen running" would
 * be a card telling somebody their agent is running *somewhere*.
 *
 * It also means the chip is never colour alone. `seen running` is drawn in the
 * success tone and `sent to` is not — but the two say different words as well as
 * wearing different colours, so the card is readable by somebody who cannot
 * tell them apart.
 *
 * ## Why there is an indicator before any check
 *
 * `sent to Hostinger` is the cold-start state and is the one most people will
 * see: a window that has just opened has checked nothing. It is drawn in the
 * muted tone and it is not a claim about the machine — it is ADR 0010's own
 * permitted sentence, *"DASH last sent this agent to marketing-vps on 7
 * August."* Without it the card would be blank until somebody visited another
 * page, which is the same as not answering the question.
 */
export interface AgentHostingIndicator {
  chip: string;
  tone: "ok" | "warn" | "muted";
  /** The whole sentence, carrying the moment. Rendered under the chip. */
  sentence: string;
}

/**
 * What a fleet card says about where this agent is, or null when DASH has never
 * sent it anywhere — which is almost every agent, and draws nothing.
 */
export function describeAgentHosting(input: {
  agent: string;
  server: string;
  seen: HostAgentSighting | null;
  sent_on: string | null;
  at: string | null;
}): AgentHostingIndicator | null {
  if (input.sent_on === null) {
    /*
     * No deploy record, so this card has nothing to say. A server naming an
     * agent DASH never sent there is a real state and it is the *server*
     * card's to report — see `describeWhatIsOnHost`. Saying it here would tell
     * somebody their agent is on a machine DASH has no record of sending it
     * to: alarming, unactionable from this page, and one bundle-id collision
     * away from being wrong.
     */
    return null;
  }
  const row = describeAgentOnHost(input);
  const chip =
    row.standing === "seen_running"
      ? `seen running on ${input.server}`
      : row.standing === "seen_stopped"
        ? `seen stopped on ${input.server}`
        : row.standing === "sent_not_seen"
          ? `not on ${input.server}`
          : `sent to ${input.server}`;
  return { chip, tone: row.tone, sentence: row.sentence };
}

/* ---------------------------------------------------------------------- *
 * One server, all of it
 * ---------------------------------------------------------------------- */

/**
 * Everything on one server, from both accounts, reconciled.
 *
 * The union of what the server named and what DASH remembers sending, so an
 * entry missing from either side is visible rather than silently absent. That
 * union is the answer to Henrik's question: the same agent sent twice appears
 * **once**, because `agent_deploys` holds one row per (agent, host) and the
 * server holds one bundle per agent — and a surface listing it once is the
 * first thing in DASH that says so.
 *
 * Sorted so the sightings come first and the unaccounted-for entries last,
 * which is the order somebody reads them in: what is here, then what is not.
 */
export function describeWhatIsOnHost(input: {
  server: string;
  /** What the server named, or null when nothing has asked it. */
  seen: readonly HostAgentSighting[] | null;
  /** What DASH sent here, newest first. */
  sent: readonly { agent: string; sent_on: string | null }[];
  at: string | null;
}): AgentHostStanding[] {
  const seen = input.seen ?? [];
  const names = new Set<string>([
    ...seen.map((one) => one.agent_id),
    ...input.sent.map((one) => one.agent),
  ]);

  const rows = [...names].map((agent) =>
    describeAgentOnHost({
      agent,
      server: input.server,
      seen: seen.find((one) => one.agent_id === agent) ?? null,
      sent_on: input.sent.find((one) => one.agent === agent)?.sent_on ?? null,
      at: input.at,
    }),
  );

  const order: Record<AgentOnHost, number> = {
    seen_running: 0,
    seen_stopped: 1,
    seen_unsent: 2,
    sent_not_seen: 3,
    sent_not_asked: 4,
  };
  return rows.sort(
    (a, b) => order[a.standing] - order[b.standing] || a.agent.localeCompare(b.agent),
  );
}

/**
 * The line above that list.
 *
 * Counted rather than asserted, the rule `summariseServers` was fixed to obey in
 * MAR-605 — and here the count is of two different things at once, so it names
 * which is which rather than adding them up.
 */
export function summariseWhatIsOnHost(rows: readonly AgentHostStanding[]): string {
  if (rows.length === 0) {
    return "DASH has not put anything on this server, and this server has not named anything.";
  }
  const running = rows.filter((row) => row.standing === "seen_running").length;
  const asked = rows.some((row) => row.standing !== "sent_not_asked");
  if (!asked) {
    return rows.length === 1
      ? "DASH has sent 1 agent here. Check this server to see what is on it now."
      : `DASH has sent ${String(rows.length)} agents here. Check this server to see what is on it now.`;
  }
  return running === 0
    ? "This server named nothing as running when DASH last asked."
    : running === 1
      ? "This server named 1 agent as running when DASH last asked."
      : `This server named ${String(running)} agents as running when DASH last asked.`;
}

/* ---------------------------------------------------------------------- *
 * The sweep
 * ---------------------------------------------------------------------- */

/**
 * Every sentence this module can produce, for the copy test.
 *
 * Derived from the standing union rather than written out, the shape
 * `everyConnectSentence` established: a standing added without being added here
 * is one the plain-language check never sees.
 */
export function everyHostSightingSentence(): string[] {
  const at = "2026-08-10T21:14:37Z";
  const rows = [
    // Every branch of `describeAgentOnHost`, reached by the inputs that produce
    // it rather than by naming the standing directly.
    describeAgentOnHost({ agent: "News Scout", server: "Hostinger", seen: { agent_id: "News Scout", running: true }, sent_on: "10 August 2026", at }),
    describeAgentOnHost({ agent: "News Scout", server: "Hostinger", seen: { agent_id: "News Scout", running: false }, sent_on: "10 August 2026", at }),
    describeAgentOnHost({ agent: "News Scout", server: "Hostinger", seen: null, sent_on: "10 August 2026", at }),
    describeAgentOnHost({ agent: "News Scout", server: "Hostinger", seen: null, sent_on: "10 August 2026", at: null }),
    describeAgentOnHost({ agent: "News Scout", server: "Hostinger", seen: null, sent_on: null, at: null }),
    describeAgentOnHost({ agent: "Weather Watch", server: "Hostinger", seen: { agent_id: "Weather Watch", running: true }, sent_on: null, at }),
  ];
  return [
    ...rows.flatMap((row) => [row.sentence, row.chip]),
    summariseWhatIsOnHost([]),
    summariseWhatIsOnHost(rows.filter((row) => row.standing === "sent_not_asked")),
    summariseWhatIsOnHost(rows.filter((row) => row.standing === "seen_stopped")),
    summariseWhatIsOnHost(rows.filter((row) => row.standing === "seen_running")),
    summariseWhatIsOnHost(rows),
  ];
}
