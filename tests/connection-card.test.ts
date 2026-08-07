/**
 * A connection, as four answers (MAR-533).
 *
 * `lib/connection-card.ts` decides what a connection *means* — where each action
 * stands, which of the three parties in a grant is doing the work, and what DASH
 * can and cannot prove about it. This drives all of that without a browser.
 *
 * The assertions that matter are the distinctness ones. Every collapse this
 * module exists to prevent — four standings into "unavailable", four custody
 * situations into "connected" — is a change that would leave the page still
 * rendering and still wrong, and only a test comparing the strings can see it.
 */

import { describe, expect, it } from "vitest";

import {
  CAPABILITY_STANDINGS,
  CONNECTION_PROOFS,
  capabilityStandings,
  classifyProof,
  describeAccount,
  describeParties,
  describeProof,
  describeStanding,
  summarisePage,
  summariseUse,
} from "../lib/connection-card";
import { plainDay } from "../lib/copy/when";
import type { BrokerRowView, ConnectionRowWithCredential } from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

/* ---------------------------------------------------------------------- *
 * Fixtures
 * ---------------------------------------------------------------------- */

const SEARCH = { id: "gmail.search", label: "Search your mail", access: "read" as const, consequence: null };
const READ = {
  id: "gmail.message.read",
  label: "Read one message you point it at",
  access: "read" as const,
  consequence: null,
};
const DRAFT = {
  id: "gmail.draft.create",
  label: "Save a reply in your drafts",
  access: "write" as const,
  consequence: "A draft will be sitting in your Drafts folder, and anybody with your mailbox open can send it.",
};

function broker(overrides: Partial<BrokerRowView> = {}): BrokerRowView {
  return {
    custody_sentence: "DASH holds this sign-in and the agent never receives it.",
    client_sentence: null,
    requested: [SEARCH, READ],
    not_requested: [DRAFT],
    wider_permission_sentence: null,
    dash_closed_sentence: null,
    receipt: null,
    recent: [],
    ...overrides,
  };
}

function row(overrides: Partial<ConnectionRowWithCredential> = {}): ConnectionRowWithCredential {
  return {
    connection_id: "mail",
    service: "Gmail",
    provider: "google-gmail",
    purpose: "Read meeting requests and write you a reply to look at.",
    capabilities: [],
    ownership: "dash",
    ownership_confirmed: true,
    source: "declared_connection",
    requires_secret_input: false,
    validation_behavior: "test",
    dash_can_hold: true,
    field_id: "mail_token",
    masked_hint: null,
    delivered_to_agent: false,
    credential_kind: "oauth",
    broker: broker(),
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- *
 * 1. What can this reach?
 * ---------------------------------------------------------------------- */

describe("where each action stands", () => {
  it("is waiting for you before anybody has signed in", () => {
    const standings = capabilityStandings(broker());
    expect(standings.map((one) => [one.id, one.standing])).toEqual([
      ["gmail.search", "awaiting_you"],
      ["gmail.message.read", "awaiting_you"],
      ["gmail.draft.create", "not_asked_for"],
    ]);
  });

  it("separates a partial consent from never having signed in", () => {
    /*
     * The load-bearing case, and the reason four states exist rather than two.
     *
     * A user who signed in and left one permission out is in a different place
     * from one who has not signed in at all: the first needs to sign in *again*,
     * and telling them so is only possible if the two are distinguishable. A
     * card that merged them would send somebody to press a button that does not
     * fix what they are looking at.
     */
    const standings = capabilityStandings(
      broker({
        receipt: {
          account_hint: "someone@example.com",
          granted_at: "2026-08-06T09:00:00.000Z",
          last_used_at: null,
          capabilities: [SEARCH],
        },
      }),
    );
    expect(standings.map((one) => one.standing)).toEqual([
      "allowed",
      "not_issued",
      "not_asked_for",
    ]);
  });

  it("puts what the agent asked for before what it did not", () => {
    // A person scanning this card is looking for what *can* happen. Burying it
    // under a list of what cannot would be a page about DASH rather than about
    // their agent.
    const standings = capabilityStandings(broker());
    const firstUnasked = standings.findIndex((one) => one.standing === "not_asked_for");
    const lastAsked = standings.map((one) => one.standing).lastIndexOf("awaiting_you");
    expect(lastAsked).toBeLessThan(firstUnasked);
  });

  it("carries a write's consequence through unchanged", () => {
    // MAR-469's sentence must survive the redesign: a write's label is a verb
    // phrase, and what will be sitting in the mailbox afterwards is the part
    // somebody needs before approving.
    const draft = capabilityStandings(broker()).find((one) => one.id === "gmail.draft.create");
    expect(draft?.consequence).toBe(DRAFT.consequence);
    expect(draft?.access).toBe("write");
  });

  it("gives the four standings four distinct meanings", () => {
    const meanings = CAPABILITY_STANDINGS.map((standing) => describeStanding(standing).meaning);
    expect(new Set(meanings).size).toBe(CAPABILITY_STANDINGS.length);
    const labels = CAPABILITY_STANDINGS.map((standing) => describeStanding(standing).label);
    expect(new Set(labels).size).toBe(CAPABILITY_STANDINGS.length);
  });
});

/* ---------------------------------------------------------------------- *
 * The three parties
 * ---------------------------------------------------------------------- */

describe("the three parties in a grant", () => {
  it("is three claims, and each one can be false", () => {
    const { parties } = describeParties(broker(), "Gmail");
    expect(parties).toHaveLength(3);
    expect(parties.map((party) => party.holds)).toEqual([true, true, false]);
  });

  it("says what a false claim means, and says nothing when it is true", () => {
    // A tick with no explanation is a diagram of a policy. Each party that does
    // not hold has to lead somewhere.
    for (const party of describeParties(broker(), "Gmail").parties) {
      expect(party.holds ? party.otherwise : (party.otherwise ?? "")).toBeTruthy;
      if (party.holds) {
        expect(party.otherwise).toBeNull();
      } else {
        expect(party.otherwise).not.toBeNull();
      }
    }
  });

  it("reports the agent asking for nothing as a false claim rather than an empty list", () => {
    const { parties } = describeParties(
      broker({ requested: [], not_requested: [SEARCH, READ, DRAFT] }),
      "Gmail",
    );
    expect(parties[1]?.holds).toBe(false);
    expect(parties[1]?.otherwise).toContain("signing in would grant it nothing");
  });

  it("states the timing, which is the one thing on the card nothing else can show", () => {
    // "It is re-resolved on every call, so disconnecting takes effect on an
    // agent's next request rather than at its next restart" has been true in
    // `lib/broker/execute.ts` since MAR-458 and has never been on a screen.
    expect(describeParties(broker(), "Gmail").timing).toContain("very next request");
  });
});

/* ---------------------------------------------------------------------- *
 * 2 & 3. On whose account, and since when
 * ---------------------------------------------------------------------- */

describe("whose account, and since when", () => {
  it("invents no account when the provider named none", () => {
    const answer = describeAccount(
      broker({
        receipt: {
          account_hint: null,
          granted_at: "2026-08-06T09:00:00.000Z",
          last_used_at: null,
          capabilities: [SEARCH],
        },
      }),
    );
    expect(answer.account).toBe("An account the provider did not name");
    expect(answer.account).not.toContain("your");
  });

  it("dates the grant in words rather than as an instant", () => {
    const answer = describeAccount(
      broker({
        receipt: {
          account_hint: "someone@example.com",
          granted_at: "2026-08-06T09:00:00.000Z",
          last_used_at: null,
          capabilities: [],
        },
      }),
    );
    expect(answer.since).toBe(plainDay("2026-08-06T09:00:00.000Z"));
    expect(answer.since).not.toMatch(/[TZ]/);
  });

  it("has no date at all before a grant, rather than a placeholder one", () => {
    expect(describeAccount(broker()).since).toBeNull();
  });
});

/* ---------------------------------------------------------------------- *
 * 4. What has it been used for?
 * ---------------------------------------------------------------------- */

describe("what it has been used for", () => {
  const used = (allowed: number, refused: number): BrokerRowView =>
    broker({
      receipt: {
        account_hint: "someone@example.com",
        granted_at: "2026-08-06T09:00:00.000Z",
        last_used_at: "2026-08-07T11:30:00.000Z",
        capabilities: [SEARCH, READ],
      },
      recent: [
        ...Array.from({ length: allowed }, (_, at) => ({
          label: "Search your mail",
          decision: "allowed" as const,
          refusal_headline: null,
          result_count: 3,
          decided_at: `2026-08-07T10:0${String(at)}:00.000Z`,
          undelivered: false,
        })),
        ...Array.from({ length: refused }, (_, at) => ({
          label: "Save a reply in your drafts",
          decision: "refused" as const,
          refusal_headline: "This agent asked to do something it was not allowed to do.",
          result_count: null,
          decided_at: `2026-08-07T11:0${String(at)}:00.000Z`,
          undelivered: false,
        })),
      ],
    });

  it("distinguishes a clean history from one with refusals in the headline itself", () => {
    /*
     * The old card's disclosure said "What it has done (7)", which is a number
     * with no sign attached: seven allowed reads and seven refusals looked
     * identical from the outside, and only one of them is worth opening.
     */
    expect(summariseUse(used(7, 0)).headline).toBe("Used 7 times. Nothing was refused.");
    expect(summariseUse(used(5, 2)).headline).toBe("Used 5 times, and DASH refused 2 times.");
    expect(summariseUse(used(0, 3)).headline).toBe("Asked 3 times, and DASH refused every one.");
  });

  it("flags refusals so the disclosure can say what is behind it", () => {
    expect(summariseUse(used(5, 2)).has_refusals).toBe(true);
    expect(summariseUse(used(5, 0)).has_refusals).toBe(false);
  });

  it("separates never connected from connected and unused", () => {
    // Two very different situations with the same empty history. One needs a
    // sign-in and the other needs nothing at all.
    expect(summariseUse(broker()).headline).toContain("nothing is connected");
    expect(
      summariseUse(
        broker({
          receipt: {
            account_hint: "someone@example.com",
            granted_at: "2026-08-06T09:00:00.000Z",
            last_used_at: null,
            capabilities: [SEARCH],
          },
        }),
      ).headline,
    ).toContain("has not used it yet");
  });

  it("always says what DASH records and what it does not", () => {
    // A usage count with nothing behind it invites exactly the wrong inference
    // about how much DASH is reading.
    for (const answer of [summariseUse(broker()), summariseUse(used(2, 1))]) {
      expect(answer.limit).toContain("never records what was searched for");
    }
  });
});

/* ---------------------------------------------------------------------- *
 * The contrast that teaches the page
 * ---------------------------------------------------------------------- */

describe("what DASH can prove about a connection", () => {
  it("classifies the four cases from what the row actually says", () => {
    expect(classifyProof(row())).toBe("dash_brokered");
    expect(classifyProof(row({ broker: null }))).toBe("handed_over");
    expect(classifyProof(row({ broker: null, dash_can_hold: false }))).toBe("agent_holds");
    expect(
      classifyProof(row({ broker: null, dash_can_hold: false, ownership: "external" })),
    ).toBe("held_elsewhere");
  });

  it("gives the four cases four distinct answers to what DASH cannot show", () => {
    const cannots = CONNECTION_PROOFS.map((kind) => describeProof(kind, "Gmail").cannot);
    expect(new Set(cannots).size).toBe(CONNECTION_PROOFS.length);
  });

  it("is blunt about the case that looks most like the brokered one", () => {
    /*
     * `handed_over` is the trap. DASH holds the credential *and gives it to the
     * agent*, so it looks identical to the brokered case on every axis except
     * the only one that matters: from the moment it is handed over, DASH's
     * records stop.
     */
    const handed = describeProof("handed_over", "Gmail");
    expect(handed.cannot).toContain("cannot show you what it did");
    expect(handed.cannot).toContain("cannot narrow");
  });
});

describe("the page's own summary", () => {
  it("counts rather than reassures", () => {
    expect(summarisePage([row(), row({ connection_id: "b", broker: null })])).toBe(
      "2 connections. DASH makes the requests for 1 of them and can show you what happened; " +
        "for the other 1 it cannot, and each card says why.",
    );
  });

  it("says so plainly when DASH is in the middle of none of them", () => {
    expect(summarisePage([row({ broker: null })])).toContain("cannot show you what was done");
  });

  it("has an empty state that is not a failure", () => {
    expect(summarisePage([])).toBe(
      "No agent here has asked to reach anything outside this computer.",
    );
  });
});

/* ---------------------------------------------------------------------- *
 * The novice test, as a copy sweep
 * ---------------------------------------------------------------------- */

describe("every sentence this page can produce is plain language", () => {
  it("passes the guided-path identifier scan", () => {
    /*
     * Swept from the unions rather than from a list somebody remembered to
     * update — the shape `lib/host-connect.ts`'s `everyConnectSentence`
     * established. A standing or a proof added without being added to its
     * `as const` array below is one this scan never sees, and both arrays are
     * `satisfies` their own union, so adding a member without adding it there is
     * a compile error rather than a silent gap.
     */
    const parts = [
      ...CAPABILITY_STANDINGS.flatMap((standing) => {
        const copy = describeStanding(standing);
        return [copy.label, copy.meaning];
      }),
      ...CONNECTION_PROOFS.flatMap((kind) => {
        const copy = describeProof(kind, "Gmail");
        return [copy.label, copy.can, copy.cannot];
      }),
      ...(() => {
        const parties = describeParties(broker({ requested: [], not_requested: [] }), "Gmail");
        return [
          parties.heading,
          parties.timing,
          ...parties.parties.flatMap((party) => [party.claim, party.otherwise ?? ""]),
        ];
      })(),
      summariseUse(broker()).headline,
      summariseUse(broker()).limit,
      summarisePage([]),
      summarisePage([row()]),
      summarisePage([row(), row({ connection_id: "b", broker: null })]),
      describeAccount(broker()).account,
    ];
    expectPlainLanguage(parts);
  });

  it("prints no machine instant anywhere", () => {
    // The defect that made this module necessary: the page shipped
    // `2026-08-07T13:58:28.037Z` onto the screen four times per lapse row.
    const dated = describeAccount(
      broker({
        receipt: {
          account_hint: "someone@example.com",
          granted_at: "2026-08-06T09:00:00.000Z",
          last_used_at: "2026-08-07T11:30:00.000Z",
          capabilities: [],
        },
      }),
    );
    const use = summariseUse(
      broker({
        receipt: {
          account_hint: null,
          granted_at: "2026-08-06T09:00:00.000Z",
          last_used_at: "2026-08-07T11:30:00.000Z",
          capabilities: [],
        },
        recent: [
          {
            label: "Search your mail",
            decision: "allowed",
            refusal_headline: null,
            result_count: 1,
            decided_at: "2026-08-07T11:30:00.000Z",
            undelivered: false,
          },
        ],
      }),
    );
    for (const part of [dated.since ?? "", use.last_used ?? ""]) {
      expect(part).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(part.length).toBeGreaterThan(0);
    }
  });
});
