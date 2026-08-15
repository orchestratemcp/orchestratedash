/**
 * One list, keyed by service (MAR-642).
 *
 * `tests/service-row-render.test.tsx` drives what a row looks like. This drives
 * the merge itself, and most of it is about the two things the list has to make
 * room for without a redesign, because those are the claims a screenshot cannot
 * check and a later packet would otherwise discover the hard way:
 *
 * 1. **An MCP server row** (MAR-633, ADR 0020) fits without a new section.
 * 2. **More than one account per service** (MAR-643) is a longer list rather
 *    than a rewritten row.
 */

import { describe, expect, it } from "vitest";

import {
  SERVICE_KINDS,
  describeAccounts,
  describeExpansion,
  everyServiceListSentence,
  serviceRows,
  summariseServices,
  type ServiceRow,
} from "../lib/connections-list";
import { buildConnectorTiles } from "../lib/connectors";
import { expectPlainLanguage } from "./helpers/plain-language";
import type {
  AgentConnections,
  ConnectionRowWithCredential,
  FleetConnectorView,
} from "../lib/views/types";

function connector(over: Partial<FleetConnectorView> = {}): FleetConnectorView {
  return {
    provider: "google-gmail",
    service: "Gmail",
    connector_kind: "google_oauth_broker",
    ai_provider_id: null,
    purpose: "Let your agents work with your mail.",
    help: null,
    capabilities: [],
    wider_permissions: [],
    held: null,
    agents: [],
    skipped: [],
    waiting: [],
    reach_sentence: null,
    ...over,
  };
}

function row(over: Partial<ConnectionRowWithCredential> = {}): ConnectionRowWithCredential {
  return {
    connection_id: "mail",
    service: "Gmail",
    provider: "google-gmail",
    purpose: "Read the morning mail.",
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
    broker: null,
    also_connects: [],
    ...over,
  } as ConnectionRowWithCredential;
}

function agent(name: string, rows: ConnectionRowWithCredential[]): AgentConnections {
  return { name, title: name, avatar: "ninja", rows, lapses: [] };
}

const HELD = {
  masked_hint: "••••abcd",
  account_hint: "he••••@example.com",
  since: "10 August 2026",
  permissions: [],
};

describe("the join", () => {
  it("puts one service on one row, however many halves name it", () => {
    /*
     * The defect. Both halves were always keyed on `provider` — the same key
     * `buildConnectorTiles` groups on and `findGrantSharers` fans a grant out
     * over — and nothing about them was ever two lists except the rendering.
     */
    const rows = serviceRows(
      [connector()],
      buildConnectorTiles([agent("News Scout", [row()])]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.fleet).not.toBeNull();
    expect(rows[0]?.tile).not.toBeNull();
  });

  it("keeps a catalogue entry nobody asked for, and a service nobody offers", () => {
    // The two halves each exist for a reason the other cannot serve: MAR-593's
    // is a DASH with no agents, and a manifest's is a service DASH has built no
    // flow for.
    const rows = serviceRows(
      [connector()],
      buildConnectorTiles([
        agent("Ledger", [row({ provider: "synthetic-ledger", service: "Ledger" })]),
      ]),
    );
    expect(rows.map((one) => one.provider)).toEqual(["google-gmail", "synthetic-ledger"]);
  });

  it("leads with what DASH has built a flow for", () => {
    // The page's argument in an order: what a person can act on today first,
    // then what an agent named without a flow.
    const rows = serviceRows(
      [connector({ provider: "second", service: "Second" })],
      buildConnectorTiles([agent("A", [row({ provider: "first", service: "First" })])]),
    );
    expect(rows[0]?.provider).toBe("second");
  });

  it("takes the service's name from the catalogue when there is one", () => {
    // Never from both. An author's label for one service can differ from DASH's
    // own, and showing whichever is longer would make one service look like two
    // on the page that exists to stop exactly that.
    const rows = serviceRows(
      [connector({ service: "Gmail" })],
      buildConnectorTiles([agent("A", [row({ service: "Your mailbox" })])]),
    );
    expect(rows[0]?.service).toBe("Gmail");
  });
});

describe("the one chip", () => {
  it("is the agents' answer when agents need it", () => {
    // `connectorChip` has the three-way answer. "Connected" over a row where one
    // of two agents cannot reach the service would be MAR-605's drift, one page
    // along.
    const rows = serviceRows(
      [connector({ held: HELD })],
      buildConnectorTiles([
        agent("Connected", [row({ masked_hint: "h•••@example.com" })]),
        agent("Waiting", [row({ connection_id: "gmail" })]),
      ]),
    );
    expect(rows[0]?.chip.label).toBe("Partly connected");
  });

  it("is what DASH holds when nothing needs it", () => {
    expect(serviceRows([connector({ held: HELD })], [])[0]?.chip.label).toBe("connected");
    expect(serviceRows([connector()], [])[0]?.chip.label).toBe("not connected");
  });
});

describe("room for what does not exist yet", () => {
  it("has a kind for an MCP server, and produces none", () => {
    /*
     * ADR 0020 decided that an MCP server *is* a connection, and MAR-642's brief
     * asks for a list one fits into without a new section. The union has the
     * member; no catalogue entry produces it, and a function that guessed would
     * put a shape on screen ADR 0020 has not been implemented for.
     */
    expect(SERVICE_KINDS).toContain("server");
    const kinds = serviceRows(
      [connector(), connector({ provider: "openrouter", connector_kind: "api_key" })],
      buildConnectorTiles([agent("A", [row({ provider: "synthetic-ledger" })])]),
    ).map((one) => one.kind);
    expect(kinds).toEqual(["account", "key", "account"]);
  });

  it("holds accounts as a list, so a second one is not a redesign", () => {
    // MAR-643. What DASH cannot do yet is *hold* two — `connection_secrets` is
    // keyed one per (agent, connection, field) — and the shape does not pretend
    // otherwise. What it does is count rather than say "the account".
    expect(serviceRows([connector()], [])[0]?.accounts).toEqual([]);
    expect(serviceRows([connector({ held: HELD })], [])[0]?.accounts).toEqual([
      { hint: "he••••@example.com", since: "10 August 2026" },
    ]);
    expect(describeAccounts([])).toBeNull();
    expect(describeAccounts([{ hint: "one", since: null }])).toBe("one");
    expect(
      describeAccounts([
        { hint: "one", since: null },
        { hint: "two", since: null },
      ]),
    ).toBe("2 accounts");
  });

  it("says the honest thing about a provider that named no account", () => {
    // "your account" would be DASH asserting something it was not told.
    expect(describeAccounts([{ hint: null, since: null }])).toBe(
      "An account the provider did not name",
    );
  });
});

describe("the one line above the list", () => {
  const rows = (total: number, connected: number): ServiceRow[] =>
    Array.from({ length: total }, (_, index) => ({
      provider: `p${String(index)}`,
      service: "A service",
      kind: "account" as const,
      fleet: null,
      tile: null,
      accounts: index < connected ? [{ hint: null, since: null }] : [],
      chip: { label: "not connected", tone: "chip-muted" },
    }));

  it("counts what the list drew rather than asserting a number", () => {
    /*
     * Before the merge there were **two** summaries at the top of one page,
     * counting overlapping sets: one over the catalogue and one over the tiles.
     * One list has one line.
     */
    expect(summariseServices(rows(3, 0))).toContain("3 services");
    expect(summariseServices(rows(3, 0))).toContain("None is connected yet");
    expect(summariseServices(rows(3, 1))).toContain("1 of them is connected");
    expect(summariseServices(rows(3, 3))).toContain("all of them are connected");
    expect(summariseServices(rows(1, 1))).toContain("it is connected");
  });

  it("says the true thing about a build that offers nothing", () => {
    expect(summariseServices([])).toBe("There is nothing to connect yet.");
  });
});

describe("what the expansion is called", () => {
  it("says how many agents are behind it, or nothing about agents at all", () => {
    const base: ServiceRow = {
      provider: "p",
      service: "A service",
      kind: "account",
      fleet: null,
      tile: null,
      accounts: [],
      chip: { label: "not connected", tone: "chip-muted" },
    };
    expect(describeExpansion(base)).toBe("What DASH would be able to do");
    expect(describeExpansion({ ...base, accounts: [{ hint: null, since: null }] })).toBe(
      "What DASH can do with this",
    );
  });
});

describe("what a person reads", () => {
  it("is plain language on every branch", () => {
    expectPlainLanguage(everyServiceListSentence());
  });
});
