/**
 * The connector tile, drawn (MAR-570).
 *
 * `tests/connectors.test.ts` drives the model and `tests/grant-sharing.test.ts`
 * drives the fan-out. This drives the thing on screen, and it is the durable
 * half of the issue's screenshot bar: a photograph proves a state was drawn once
 * on one machine, this proves each one is still drawn on every run.
 *
 * The load-bearing assertions are the ones about **order and presence**, because
 * the whole issue is a page whose content was right and whose shape was wrong:
 *
 * - the shared-grant disclosure is above the button, never below it;
 * - the receipt is present and one click deep, not deleted;
 * - a tile with nothing to press draws no button rather than a dead one.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ConnectorTile, connectTarget } from "../app/_components/connector-tile";
import { buildConnectorTiles } from "../lib/connectors";
import type {
  AgentConnections,
  BrokerRowView,
  ConnectionRowWithCredential,
} from "../lib/views/types";

function broker(over: Partial<BrokerRowView> = {}): BrokerRowView {
  return {
    custody_sentence: "DASH holds this sign-in and the agent never receives it.",
    client_sentence: null,
    requested: [
      { id: "gmail.search", label: "Search your mail", access: "read", consequence: null },
    ],
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

function agent(name: string, rows: ConnectionRowWithCredential[]): AgentConnections {
  return { name, avatar: "ninja", rows, lapses: [] };
}

const NOTHING = () => () => Promise.resolve({ ok: true });

function draw(agents: AgentConnections[], canAct = true): string {
  const tiles = buildConnectorTiles(agents);
  return renderToStaticMarkup(
    <ConnectorTile tile={tiles[0] as never} act={NOTHING} canAct={canAct} />,
  );
}

const SHARED = (): AgentConnections[] => [
  agent("News Scout", [row({ connection_id: "gmail" })]),
  agent("Meeting Assistant", [row({ connection_id: "mail" })]),
];

describe("the front of the tile", () => {
  it("leads with the service a person recognises, never the provider id", () => {
    const html = draw(SHARED());
    expect(html).toContain("<h2>Gmail</h2>");
    expect(html).not.toContain("google-gmail");
  });

  it("names every agent that depends on it", () => {
    /*
     * The tile's whole reason for existing. A page that showed one Gmail without
     * saying whose would have replaced two cards with one lie of omission.
     */
    const html = draw(SHARED());
    expect(html).toContain("Needed by News Scout and Meeting Assistant.");
    expect(html).toContain("News Scout");
    expect(html).toContain("Meeting Assistant");
  });

  it("gives each agent its own standing, not just the tile's", () => {
    // Partly connected is a real state and the per-agent chips are where a
    // person finds out which half they are in.
    const html = draw([
      agent("News Scout", [row({ masked_hint: "h•••@example.com" })]),
      agent("Meeting Assistant", [row({ connection_id: "gmail" })]),
    ]);
    expect(html).toContain("Partly connected");
    expect(html).toContain(">connected<");
    expect(html).toContain(">not connected<");
  });

  it("says what DASH can prove and what it cannot, both", () => {
    // A surface showing `can` without `cannot` is the reassurance half of a
    // sentence whose value is the other half.
    const html = draw(SHARED());
    expect(html).toContain("keeps a record of every one");
    expect(html).toContain("cannot see anything the agent does outside these actions");
  });
});

describe("the disclosure that one sign-in serves two agents", () => {
  it("is on the tile, and above the button", () => {
    /*
     * ADR 0002 amendment 2's rule applied to a consequence that lands on an
     * agent the reader is not looking at: before the grant, never with the
     * result. Asserted by position, because "present somewhere on the card" is
     * satisfied by a sentence underneath the thing it was supposed to warn
     * about.
     */
    const html = draw(SHARED());
    const disclosure = html.indexOf("One sign-in connects Gmail");
    const button = html.indexOf("<button");
    expect(disclosure).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(-1);
    expect(disclosure).toBeLessThan(button);
  });

  it("is absent when one agent needs it, because nothing is shared", () => {
    const html = draw([agent("News Scout", [row()])]);
    expect(html).not.toContain("One sign-in connects");
  });
});

describe("the button", () => {
  it("says which service it is about to sign in to", () => {
    // "Connect" on a row that opens a browser gives no warning that the user is
    // about to leave DASH (MAR-446), and a page of tiles needs to say which one.
    expect(draw(SHARED())).toContain("Sign in to Gmail");
  });

  it("offers a re-sign-in rather than nothing once everyone is connected", () => {
    const html = draw([
      agent("News Scout", [row({ masked_hint: "h•••@example.com" })]),
      agent("Meeting Assistant", [row({ connection_id: "gmail", masked_hint: "h•••@example.com" })]),
    ]);
    expect(html).toContain("Sign in to Gmail again");
  });

  it("is absent, not disabled, when DASH holds none of it", () => {
    /*
     * `lib/workspace.ts`'s rule about dead controls. A greyed-out Connect on a
     * service the agents keep for themselves reads as "this service cannot be
     * connected", which is a claim about the service rather than about DASH.
     */
    const html = draw([
      agent("News Scout", [row({ dash_can_hold: false, field_id: null, broker: null })]),
    ]);
    expect(html).not.toContain("<button");
    expect(html).toContain("DASH does not hold this");
  });

  it("aims at an agent that still needs connecting, not one already fine", () => {
    const tiles = buildConnectorTiles([
      agent("Connected", [row({ masked_hint: "h•••@example.com" })]),
      agent("Waiting", [row({ connection_id: "gmail" })]),
    ]);
    expect(connectTarget(tiles[0] as never)?.agent).toBe("Waiting");
  });
});

describe("a window that cannot act", () => {
  it("says which window it is rather than drawing a dead button", () => {
    const html = draw(SHARED(), false);
    expect(html).not.toContain("<button");
    expect(html).toContain("Open the installed DASH app");
  });
});

describe("the receipt", () => {
  it("is present and one click deep, rather than deleted", () => {
    /*
     * MAR-570's own non-goal: no removal of the receipt content. The summary is
     * the click; the capability card behind it is `ConnectionCards`, the same
     * component MAR-533 built.
     */
    const html = draw(SHARED());
    expect(html).toContain("<details");
    expect(html).toContain("What exactly each agent may do");
  });

  it("says it in the singular for a tile only one agent needs", () => {
    expect(draw([agent("News Scout", [row()])])).toContain("What exactly this agent may do");
  });

  it("is not built until it is opened", () => {
    /*
     * The heaviest components in DASH are behind this summary — a three-party
     * drawing, two capability lists and a usage history per agent. A page of
     * tiles that built every one on first paint would spend its whole budget on
     * the view nobody has asked for yet, which is the "cluttered" verdict
     * arriving again as a performance problem.
     */
    const html = draw(SHARED());
    expect(html).toContain("<details");
    // The three-party drawing is the first thing inside a capability card, so
    // its absence is what says the card was not built.
    expect(html).not.toContain("Three things have to agree");
  });
});
