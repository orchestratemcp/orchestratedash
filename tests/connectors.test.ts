/**
 * Connections as connectors (MAR-570).
 *
 * Two verdicts from the product's own first user, one layer apart: MAR-383's
 * checklist "makes no sense to me right now", and MAR-533's rebuild of it is
 * "cluttered and a lot of text". Both are the same fault — a page organised by
 * DASH's bookkeeping rather than by a service somebody recognises.
 *
 * The assertions that carry weight here are the honesty ones, and they are all
 * about a tile refusing to average away a fact a person needs:
 *
 * - a connector that is connected for one agent and not the other is **not**
 *   connected, because a page saying otherwise tells somebody an agent works
 *   when it cannot;
 * - a connector DASH does not hold is not "not connected yet", because there is
 *   nothing to press and a button would be a dead control;
 * - the shared-grant sentence appears exactly where a sign-in really does fan
 *   out, and nowhere else.
 */

import { describe, expect, it } from "vitest";

import {
  buildConnectorTiles,
  connectorChip,
  describeDependents,
  describeSharedGrant,
  everyConnectorSentence,
  rollUpConnector,
  summariseConnectors,
} from "../lib/connectors";
import type {
  AgentConnections,
  BrokerRowView,
  ConnectionRowWithCredential,
} from "../lib/views/types";
import { expectPlainLanguage } from "./helpers/plain-language";

function broker(over: Partial<BrokerRowView> = {}): BrokerRowView {
  return {
    custody_sentence: "DASH holds this sign-in and the agent never receives it.",
    client_sentence: null,
    requested: [{ id: "gmail.search", label: "Search your mail", access: "read", consequence: null }],
    not_requested: [],
    wider_permission_sentence: null,
    dash_closed_sentence: null,
    receipt: null,
    recent: [],
    ...over,
  };
}

function row(over: Partial<ConnectionRowWithCredential> = {}): ConnectionRowWithCredential {
  return {
    connection_id: "mail",
    service: "Gmail",
    provider: "google-gmail",
    purpose: "Read the morning mail and write you a summary.",
    capabilities: [],
    ownership: "dash",
    ownership_confirmed: true,
    source: "declared_connection",
    requires_secret_input: false,
    validation_behavior: "test",
    dash_can_hold: true,
    field_id: "sign_in",
    masked_hint: null,
    delivered_to_agent: false,
    credential_kind: "oauth",
    broker: broker(),
    also_connects: [],
    ...over,
  };
}

function agent(
  name: string,
  rows: ConnectionRowWithCredential[],
  title: string = name,
): AgentConnections {
  return { name, title, avatar: "ninja", rows, lapses: [] };
}

/* ---------------------------------------------------------------------- *
 * The grouping
 * ---------------------------------------------------------------------- */

describe("what makes two agents one connector", () => {
  it("is the provider, not the connection id the author happened to pick", () => {
    /*
     * The load-bearing one. `connection_id` is a string each author chooses —
     * the shipped Gmail example calls it `gmail` and nothing stops the next one
     * calling it `mail` — so keying tiles on it would draw two Gmail tiles and
     * reintroduce the exact duplicate this page exists to kill.
     */
    const tiles = buildConnectorTiles([
      agent("News Scout", [row({ connection_id: "gmail" })]),
      agent("Meeting Assistant", [row({ connection_id: "mail" })]),
    ]);

    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.dependents.map((one) => one.agent)).toEqual([
      "News Scout",
      "Meeting Assistant",
    ]);
  });

  it("keeps two different services apart even on one authorization server", () => {
    // Gmail and Calendar are one Google and two consent decisions. Merging them
    // would be the page deciding a user meant more than they clicked.
    const tiles = buildConnectorTiles([
      agent("Meeting Assistant", [
        row({ connection_id: "gmail", provider: "google-gmail", service: "Gmail" }),
        row({ connection_id: "calendar", provider: "google-calendar", service: "Calendar" }),
      ]),
    ]);
    expect(tiles.map((one) => one.service)).toEqual(["Gmail", "Calendar"]);
  });

  it("names the tile from the service label rather than the provider id", () => {
    // `google-gmail` is machine vocabulary and `lib/copy/identifiers.ts` forbids
    // it on the guided path.
    const tiles = buildConnectorTiles([agent("News Scout", [row()])]);
    expect(tiles[0]?.service).toBe("Gmail");
    expect(tiles[0]?.provider).toBe("google-gmail");
  });
});

/* ---------------------------------------------------------------------- *
 * The rollup
 * ---------------------------------------------------------------------- */

describe("where a connector stands across the agents that need it", () => {
  it("is connected only when every agent that can be is", () => {
    const tiles = buildConnectorTiles([
      agent("News Scout", [row({ masked_hint: "h•••@example.com" })]),
      agent("Meeting Assistant", [row({ masked_hint: "h•••@example.com" })]),
    ]);
    expect(tiles[0]?.standing).toBe("connected");
  });

  it("says partly connected rather than averaging it away", () => {
    /*
     * The state a boolean would lose, and the one that most needs saying: a page
     * reporting "connected" here tells somebody an agent can work when it
     * cannot.
     */
    const tiles = buildConnectorTiles([
      agent("News Scout", [row({ masked_hint: "h•••@example.com" })]),
      agent("Meeting Assistant", [row({ masked_hint: null })]),
    ]);
    expect(tiles[0]?.standing).toBe("partly_connected");
    expect(connectorChip("partly_connected").tone).toBe("warn");
  });

  it("distinguishes nothing-connected from nothing-DASH-can-hold", () => {
    /*
     * Two different sentences with two different next actions. "Not connected"
     * invites a press; a connector the agents keep for themselves has nothing to
     * press, and drawing it as a gap would be the dead-control failure
     * `lib/workspace.ts` names.
     */
    const nothingYet = buildConnectorTiles([agent("News Scout", [row({ masked_hint: null })])]);
    const notOurs = buildConnectorTiles([
      agent("News Scout", [row({ dash_can_hold: false, field_id: null, broker: null })]),
    ]);
    expect(nothingYet[0]?.standing).toBe("not_connected");
    expect(notOurs[0]?.standing).toBe("not_dash_held");
    expect(connectorChip("not_dash_held").tone).toBe("muted");
  });

  it("does not count an agent DASH cannot hold against the ones it can", () => {
    /*
     * Otherwise a tile with one brokered agent and one that keeps its own
     * sign-in could never read as connected, whatever the person did — a total
     * that can never be reached is a progress bar that never fills.
     */
    const tiles = buildConnectorTiles([
      agent("News Scout", [row({ masked_hint: "h•••@example.com" })]),
      agent("Old Agent", [row({ dash_can_hold: false, field_id: null, broker: null })]),
    ]);
    expect(tiles[0]?.standing).toBe("connected");
  });

  it("never reports an empty tile as connected", () => {
    // On a page about what is safe to run, the one wrong answer is the
    // reassuring one.
    expect(rollUpConnector([])).toBe("not_dash_held");
  });
});

/* ---------------------------------------------------------------------- *
 * The sentences
 * ---------------------------------------------------------------------- */

describe("who needs this", () => {
  it("names the agents rather than counting them", () => {
    // "used by 2 agents" is a number a person then has to go and expand, and
    // the names are what makes "connect once" believable.
    const tiles = buildConnectorTiles([
      agent("News Scout", [row()]),
      agent("Meeting Assistant", [row()]),
    ]);
    expect(describeDependents(tiles[0] as never)).toBe(
      "Needed by News Scout and Meeting Assistant.",
    );
  });

  it("reads as a sentence for one, two and three", () => {
    const one = buildConnectorTiles([agent("News Scout", [row()])]);
    const three = buildConnectorTiles([
      agent("A", [row()]),
      agent("B", [row()]),
      agent("C", [row()]),
    ]);
    expect(describeDependents(one[0] as never)).toBe("Needed by News Scout.");
    expect(describeDependents(three[0] as never)).toBe("Needed by A, B and C.");
  });
});

describe("the disclosure that one sign-in serves two agents", () => {
  const shared = buildConnectorTiles([
    agent("News Scout", [row()]),
    agent("Meeting Assistant", [row()]),
  ]);

  it("names both agents and says each keeps its own record", () => {
    /*
     * The consequence a person should never discover later. It has to say more
     * than "this is shared": that they approve once, that DASH keeps a separate
     * record per agent so one can be disconnected without the other, and that
     * each agent still only gets what it asked for.
     */
    const sentence = describeSharedGrant(shared[0] as never) ?? "";
    expect(sentence).toContain("News Scout");
    expect(sentence).toContain("Meeting Assistant");
    expect(sentence).toContain("One sign-in connects");
    expect(sentence).toContain("disconnect one without the other");
    expect(sentence).toContain("only gets the actions it asked for");
  });

  it("says nothing at all when nothing is shared", () => {
    // A warning that is usually about nothing is one people stop reading.
    const alone = buildConnectorTiles([agent("News Scout", [row()])]);
    expect(describeSharedGrant(alone[0] as never)).toBeNull();
  });

  it("promises no sharing for a typed secret, because none happens", () => {
    /*
     * `findGrantSharers` fans out OAuth only: a typed key is a value handed to
     * DASH for a named agent, with no consent screen and no scopes. A tile that
     * claimed sharing here would be the page promising what the action will not
     * do.
     */
    const keys = buildConnectorTiles([
      agent("A", [row({ credential_kind: "secret", broker: null })]),
      agent("B", [row({ credential_kind: "secret", broker: null })]),
    ]);
    expect(describeSharedGrant(keys[0] as never)).toBeNull();
  });

  it("says nothing for a connector DASH cannot hold at all", () => {
    const theirs = buildConnectorTiles([
      agent("A", [row({ dash_can_hold: false, field_id: null, broker: null })]),
      agent("B", [row({ dash_can_hold: false, field_id: null, broker: null })]),
    ]);
    expect(describeSharedGrant(theirs[0] as never)).toBeNull();
  });
});

describe("the line above the tiles", () => {
  it("counts services, because that is the unit on screen now", () => {
    /*
     * `summarisePage` counted connections. Two agents needing Gmail is one tile
     * and would have been reported as two — a summary disagreeing with the thing
     * it summarises.
     */
    const tiles = buildConnectorTiles([
      agent("News Scout", [row()]),
      agent("Meeting Assistant", [row()]),
    ]);
    const line = summariseConnectors(tiles);
    expect(line).toContain("1 service");
    expect(line).toContain("connect it once");
  });

  it("says how many still need connecting rather than reassuring", () => {
    const tiles = buildConnectorTiles([
      agent("News Scout", [row({ masked_hint: null })]),
      agent("Other", [row({ provider: "synthetic-ledger", service: "Ledger" })]),
    ]);
    expect(summariseConnectors(tiles)).toContain("2 still need connecting");
  });

  it("is empty-safe and says the honest thing", () => {
    expect(summariseConnectors([])).toContain("No agent here");
  });

  it("counts as shared only what a sign-in would actually share", () => {
    /*
     * Found by photographing it. A model-provider tile is named by three agents
     * and DASH holds none of it, so counting dependents made the page say "you
     * connect each once" about a thing there is nothing to connect. A summary
     * may only claim what the tiles under it will do.
     */
    const tiles = buildConnectorTiles([
      agent("A", [row({ dash_can_hold: false, field_id: null, broker: null })]),
      agent("B", [row({ dash_can_hold: false, field_id: null, broker: null })]),
    ]);
    expect(summariseConnectors(tiles)).not.toContain("more than one agent");
  });
});

describe("the order of the tiles", () => {
  it("puts what a person can act on first", () => {
    /*
     * Found by photographing it. First-appearance order is agent order, which is
     * alphabetical, so a store whose first agent was `invoice-reviewer` opened
     * the page on two tiles DASH cannot connect and pushed Gmail below the fold
     * — MAR-576's defect on a different page.
     */
    const tiles = buildConnectorTiles([
      agent("Invoice Reviewer", [
        row({
          provider: "synthetic-ledger",
          service: "Invoice records",
          dash_can_hold: false,
          field_id: null,
          broker: null,
        }),
      ]),
      agent("News Scout", [row()]),
    ]);
    expect(tiles.map((one) => one.service)).toEqual(["Gmail", "Invoice records"]);
  });

  it("does not reorder tiles among themselves as they connect", () => {
    // A page that rearranged itself under the cursor after a sign-in would be
    // the "nothing moves without saying it did" rule broken at the worst moment.
    const before = buildConnectorTiles([
      agent("A", [row({ provider: "one", service: "One" })]),
      agent("B", [row({ provider: "two", service: "Two" })]),
    ]);
    const after = buildConnectorTiles([
      agent("A", [row({ provider: "one", service: "One", masked_hint: "x" })]),
      agent("B", [row({ provider: "two", service: "Two" })]),
    ]);
    expect(after.map((one) => one.service)).toEqual(before.map((one) => one.service));
  });
});

describe("every sentence this surface can produce", () => {
  it("is plain language", () => {
    const tiles = buildConnectorTiles([
      agent("News Scout", [row()]),
      agent("Meeting Assistant", [row()]),
    ]);
    expectPlainLanguage(everyConnectorSentence(tiles));
  });

  it("never prints the provider id a tile is keyed on", () => {
    /*
     * The tile groups on `google-gmail` and must never show it. Swept over the
     * module's whole output rather than the sentence somebody remembered — the
     * shape `everyServerCardSentence` is checked with.
     */
    const tiles = buildConnectorTiles([agent("News Scout", [row()])]);
    for (const sentence of everyConnectorSentence(tiles)) {
      expect(sentence).not.toContain("google-gmail");
    }
  });
});
