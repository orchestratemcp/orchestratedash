/**
 * A connection, as four answers (MAR-533).
 *
 * Henrik, 2026-08-07, about the page this replaces: *"the current connection
 * page makes no sense to me right now."* That is a UX verdict from the product's
 * own first user, on the page the whole trust story runs through.
 *
 * The page it lands on was not badly built; it was built to answer a different
 * question. MAR-383 asked for a **checklist** — "what does this agent still need
 * connecting?" — so the rows are grouped by *who holds the credential*, which is
 * DASH's own taxonomy, and the permission card sits underneath the buttons as
 * detail. A person who has already connected everything opens that page and
 * finds an inventory sorted by a distinction they have no reason to care about.
 *
 * So this module answers the four questions a person actually arrives with, in
 * the order they arrive in:
 *
 * 1. **What can this reach?**
 * 2. **On whose account?**
 * 3. **Since when?**
 * 4. **What has it actually been used for?**
 *
 * Pure, and it renders nothing — the shape `lib/host-connect.ts` established.
 * `lib/views/build.ts` owns what the store says; this owns what it means and how
 * it is said; `app/_components/connection-card.tsx` owns where it sits.
 *
 * ## The novice test this is written against
 *
 * *Could someone who has never heard of OAuth look at this page and say what
 * DASH is allowed to do?*
 *
 * That rules out the word itself, and it rules out more than the word. It rules
 * out any sentence whose truth the reader has to take on trust — which is why
 * `describeParties` below is three checkable facts rather than a reassurance,
 * and why `unrequestedOperations` was added upstream so the second of them could
 * be shown failing as well as passing.
 */

import type { BrokerCapabilityView, BrokerRowView, ConnectionRowWithCredential } from "./views/types";
import { plainDay, plainMoment } from "./copy/when";

/* ---------------------------------------------------------------------- *
 * 1. What can this reach?
 * ---------------------------------------------------------------------- */

/**
 * Where one action stands, as the intersection of three parties.
 *
 * PROJECT_STATE.md has recorded since MAR-458 that *"a grant is the intersection
 * of three parties: DASH implements it, the manifest declared it, the provider
 * issued it"*. Until now that sentence was true in `lib/broker/execute.ts` and
 * invisible on the screen — the card rendered one flat list and the reader had
 * no way to tell which of the three was doing the work.
 *
 * Four states, because the three parties fail in three distinguishable ways and
 * succeed in one:
 *
 * - `allowed` — all three agree. This can happen.
 * - `awaiting_you` — DASH built it and the agent asked for it, and there is no
 *   grant from the provider yet. The next action is a sign-in.
 * - `not_issued` — DASH built it, the agent asked for it, the user has signed
 *   in, and the provider did not issue this one. **This is the interesting
 *   state**: it is what a partial consent looks like, and a card that merged it
 *   into `awaiting_you` would tell somebody to sign in again to fix something
 *   signing in again does not fix.
 * - `not_asked_for` — DASH offers this and this agent never asked. It is not a
 *   gap and it is not pending; it is the strongest thing on the card, because it
 *   is DASH naming an action it has and is not using.
 */
export type CapabilityStanding = "allowed" | "awaiting_you" | "not_issued" | "not_asked_for";

export interface StandingCapability {
  id: string;
  label: string;
  access: BrokerCapabilityView["access"];
  /**
   * What a write leaves behind or a spend costs, from the operation itself. Null
   * for a read (MAR-469, MAR-545).
   */
  consequence: string | null;
  standing: CapabilityStanding;
}

/**
 * Every action on this connection, each with where it stands.
 *
 * Requested first, in the manifest's own order, then the ones nobody asked for.
 * A person scanning this card is looking for what *can* happen, and burying it
 * under a list of what cannot would be a page about DASH rather than about their
 * agent.
 */
export function capabilityStandings(broker: BrokerRowView): StandingCapability[] {
  const issued = new Set((broker.receipt?.capabilities ?? []).map((one) => one.id));
  const signedIn = broker.receipt !== null;

  const withStanding = (
    capability: BrokerCapabilityView,
    standing: CapabilityStanding,
  ): StandingCapability => ({
    id: capability.id,
    label: capability.label,
    access: capability.access,
    consequence: capability.consequence,
    standing,
  });

  return [
    ...broker.requested.map((capability) =>
      withStanding(
        capability,
        issued.has(capability.id) ? "allowed" : signedIn ? "not_issued" : "awaiting_you",
      ),
    ),
    ...broker.not_requested.map((capability) => withStanding(capability, "not_asked_for")),
  ];
}

/**
 * What one standing says, in two parts.
 *
 * `label` is the chip. `meaning` is the sentence under it, and it exists because
 * a chip alone is a word a novice has to guess at — "not issued" means nothing
 * without "you signed in and did not give this one".
 *
 * A test asserts the four meanings are four distinct strings, which is the
 * assertion a collapse into "unavailable" would fail. Same argument
 * `lib/copy/recovery.ts` makes about credentials and MAR-434 makes about a
 * missing output.
 */
export function describeStanding(standing: CapabilityStanding): {
  label: string;
  meaning: string;
} {
  switch (standing) {
    case "allowed":
      return {
        label: "allowed",
        meaning: "This agent can do this right now.",
      };
    case "awaiting_you":
      return {
        label: "waiting for you",
        meaning: "The agent has asked for this and nobody has signed in yet, so it cannot.",
      };
    case "not_issued":
      return {
        label: "you did not give this one",
        meaning:
          "You signed in and this was left out, so it cannot. Signing in again is where you would change that.",
      };
    case "not_asked_for":
      return {
        label: "nobody asked for this",
        meaning:
          "DASH can do this and this agent never asked, so it cannot — whatever you sign in to.",
      };
  }
}

/* ---------------------------------------------------------------------- *
 * The three parties, as the hero
 * ---------------------------------------------------------------------- */

export interface GrantParty {
  /** What has to be true, as a statement rather than a term of art. */
  claim: string;
  /** Whether it is true for this connection right now. */
  holds: boolean;
  /** What it means when it does not. Null when it does. */
  otherwise: string | null;
}

/**
 * The three-party intersection, drawn.
 *
 * Deliberately **per connection rather than per action**: three ticks against
 * every capability on a card is a grid nobody reads, and the thing a person
 * needs to take away is the *rule*, once. The per-action detail is the standing
 * chip above, which is the same three facts applied one at a time.
 *
 * Each claim is checkable from data on this card, which is what stops this being
 * a diagram of a policy. The last sentence — that a change takes effect on the
 * agent's next request rather than at its next restart — is the one thing here
 * that a reader cannot verify from the screen, and it is the single most useful
 * fact on the page, so it is stated separately as `timing` rather than smuggled
 * in as a fourth tick.
 */
export function describeParties(broker: BrokerRowView, service: string): {
  heading: string;
  parties: GrantParty[];
  timing: string;
} {
  const built = broker.requested.length > 0 || broker.not_requested.length > 0;
  const asked = broker.requested.length > 0;
  const issued = broker.receipt !== null;

  return {
    heading: "Three things have to agree",
    parties: [
      {
        claim: "DASH has built the action",
        holds: built,
        otherwise: built
          ? null
          : `DASH has no actions for ${service} at all, so nothing here can happen through DASH.`,
      },
      {
        claim: "This agent asked for it",
        holds: asked,
        otherwise: asked
          ? null
          : "This agent asked for none of them, so signing in would grant it nothing.",
      },
      {
        claim: `You allowed it on your ${service} account`,
        holds: issued,
        otherwise: issued ? null : "Nobody has signed in yet.",
      },
    ],
    timing:
      "If any one of the three stops being true, this stops on the agent's very next request — " +
      "not the next time it restarts.",
  };
}

/* ---------------------------------------------------------------------- *
 * 2 & 3. On whose account, and since when
 * ---------------------------------------------------------------------- */

export interface AccountAnswer {
  /** The account, as the provider named it, or an honest absence. */
  account: string;
  /** "since 6 August 2026", or null when there is no grant to date. */
  since: string | null;
  /** Who holds the sign-in — the fact that changes what every line above means. */
  custody: string;
}

/**
 * Whose account this reaches, and since when.
 *
 * The custody sentence leads on the rendered card for ADR 0002's reason: it is
 * the fact that changes what everything else means. "DASH holds the sign-in and
 * the agent never receives it" is the difference between a list of capabilities
 * that is a boundary and one that is a promise.
 *
 * `account` is never invented. A provider that named no account gets a sentence
 * saying so, because "your account" would be DASH asserting something it was not
 * told — and on the one page whose whole job is saying what DASH knows.
 */
export function describeAccount(broker: BrokerRowView): AccountAnswer {
  const receipt = broker.receipt;
  return {
    account:
      receipt === null
        ? "No account yet"
        : (receipt.account_hint ?? "An account the provider did not name"),
    since: receipt === null ? null : (plainDay(receipt.granted_at) ?? "a date DASH cannot read"),
    custody: broker.custody_sentence,
  };
}

/* ---------------------------------------------------------------------- *
 * 4. What has it actually been used for?
 * ---------------------------------------------------------------------- */

export interface UseAnswer {
  /** The one line: how many times, and how it went. */
  headline: string;
  /** When it was last used, in words. Null when it never has been. */
  last_used: string | null;
  /** True when at least one recent call was refused — the rows worth opening. */
  has_refusals: boolean;
  /** What DASH records and, more importantly, what it does not. */
  limit: string;
}

/**
 * What this connection has actually been used for.
 *
 * A count and a verdict rather than a list, with the list one click away. The
 * old card put the history behind a disclosure labelled "What it has done (7)",
 * which is a number with no sign attached — seven allowed reads and seven
 * refusals look identical from the outside, and only one of them is worth
 * opening.
 *
 * The `limit` sentence is not a footnote. It is the reason a person can believe
 * the rest: DASH records which action was asked for and when, and never what was
 * searched for or anything out of a message. A page that showed a usage count
 * without saying what is behind it invites exactly the wrong inference about how
 * much DASH is reading.
 */
export function summariseUse(broker: BrokerRowView): UseAnswer {
  const allowed = broker.recent.filter((entry) => entry.decision === "allowed").length;
  const refused = broker.recent.length - allowed;
  const limit =
    "DASH records which action was asked for and when. It never records what was searched for, " +
    "and never anything out of a message.";

  if (broker.recent.length === 0) {
    return {
      headline:
        broker.receipt === null
          ? "Nothing yet, because nothing is connected."
          : "Connected, and this agent has not used it yet.",
      last_used: null,
      has_refusals: false,
      limit,
    };
  }

  const times = (count: number): string => `${String(count)} time${count === 1 ? "" : "s"}`;
  const headline =
    refused === 0
      ? `Used ${times(allowed)}. Nothing was refused.`
      : allowed === 0
        ? `Asked ${times(refused)}, and DASH refused every one.`
        : `Used ${times(allowed)}, and DASH refused ${times(refused)}.`;

  const lastUsed = broker.receipt?.last_used_at ?? null;

  return {
    headline,
    last_used: lastUsed === null ? null : (plainMoment(lastUsed) ?? "a time DASH cannot read"),
    has_refusals: refused > 0,
    limit,
  };
}

/* ---------------------------------------------------------------------- *
 * The contrast that teaches the page
 * ---------------------------------------------------------------------- */

export type ConnectionProof = "dash_brokered" | "handed_over" | "agent_holds" | "held_elsewhere";

/**
 * What DASH can and cannot show you about this connection — the answer that
 * differs most between two rows on the same page, and the one nothing said.
 *
 * The old page grouped rows under "Connect through DASH", "Kept with the agent"
 * and "Managed elsewhere", which is a taxonomy of *custody*. Custody is the
 * cause; this is the consequence, and the consequence is what a person is
 * actually deciding about. Two connections can both be "connected" and one of
 * them has a receipt of every call while the other has nothing at all, for ever.
 *
 * `handed_over` is the case worth being blunt about. DASH holds the credential
 * *and gives it to the agent*, so from that moment DASH's records stop: it can
 * say what it handed over and not one thing about what was done with it. It
 * looks the most like the brokered case on every other axis, and it is the
 * furthest from it on this one.
 */
export function classifyProof(row: ConnectionRowWithCredential): ConnectionProof {
  if (row.broker !== null) {
    return "dash_brokered";
  }
  if (row.ownership === "external") {
    return "held_elsewhere";
  }
  if (row.dash_can_hold) {
    return "handed_over";
  }
  return "agent_holds";
}

export function describeProof(kind: ConnectionProof, service: string): {
  label: string;
  can: string;
  cannot: string;
} {
  switch (kind) {
    case "dash_brokered":
      return {
        label: "DASH is in the middle",
        can: `DASH makes each ${service} request itself and keeps a record of every one.`,
        cannot: "It cannot see anything the agent does outside these actions.",
      };
    case "handed_over":
      return {
        label: "DASH keeps it, the agent uses it",
        can: `DASH holds this sign-in for you and hands it to the agent when it runs.`,
        cannot: `From that moment DASH is not involved: it cannot narrow what the agent does with ${service}, and cannot show you what it did.`,
      };
    case "agent_holds":
      return {
        label: "The agent holds it",
        can: "DASH shows this so the list is complete.",
        cannot: `DASH never holds this sign-in, cannot take it away, and cannot show you what the agent did with ${service}.`,
      };
    case "held_elsewhere":
      return {
        label: "Held somewhere else",
        can: "DASH shows this so the list is complete.",
        cannot: `This is kept in another program. DASH neither stores nor checks it, and cannot show you what was done with ${service}.`,
      };
  }
}

/* ---------------------------------------------------------------------- *
 * The page's own summary
 * ---------------------------------------------------------------------- */

/**
 * The one sentence at the top of the page, counted rather than asserted.
 *
 * It leads with the split that matters and is the page's thesis in a line: some
 * of these DASH can account for and some it cannot. Both numbers come from
 * `classifyProof`, so the sentence cannot drift from the cards under it.
 */
export function summarisePage(rows: ConnectionRowWithCredential[]): string {
  if (rows.length === 0) {
    return "No agent here has asked to reach anything outside this computer.";
  }
  const brokered = rows.filter((row) => classifyProof(row) === "dash_brokered").length;
  const rest = rows.length - brokered;
  const connections = `${String(rows.length)} connection${rows.length === 1 ? "" : "s"}`;

  if (brokered === 0) {
    return `${connections}. DASH cannot show you what was done with any of them — each card says why.`;
  }
  if (rest === 0) {
    return `${connections}, and DASH makes every request itself, so it can show you what happened.`;
  }
  return (
    `${connections}. DASH makes the requests for ${String(brokered)} of them and can show you what happened; ` +
    `for the other ${String(rest)} it cannot, and each card says why.`
  );
}

/**
 * Every sentence this module can produce, for the copy sweep.
 *
 * Derived from the unions rather than written out, so a state added without
 * being added here is a state the plain-language check never sees — the shape
 * `lib/host-connect.ts`'s `everyConnectSentence` established, and it caught two
 * sentences in this module before they shipped.
 */
export const CAPABILITY_STANDINGS = [
  "allowed",
  "awaiting_you",
  "not_issued",
  "not_asked_for",
] as const satisfies readonly CapabilityStanding[];

export const CONNECTION_PROOFS = [
  "dash_brokered",
  "handed_over",
  "agent_holds",
  "held_elsewhere",
] as const satisfies readonly ConnectionProof[];
