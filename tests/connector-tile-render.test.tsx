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
 *
 * ## What "no button" had to become (MAR-614)
 *
 * The third rule was written as `not.toContain("<button")`, which was exact
 * while the only pressable thing on a tile was Connect. The text pass added a
 * hover note, whose marker is a button that opens an explanation and changes
 * nothing — and the assertion went red for a card that still had no dead
 * control on it.
 *
 * `actionControls` is the same rule, saying what it means: the tile draws no
 * control that would *do* anything. It is stricter than the old string in the
 * way that matters, because it enumerates what it found — a new action class
 * added to this codebase shows up in the failure message by name instead of
 * hiding inside a boolean.
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

/**
 * Every control on this markup that would submit, send or change something.
 *
 * DASH gives an action control one of three classes and gives a disclosure
 * none of them, so the class is the honest discriminator — matching on button
 * text would need this test to know every verb the tile can render, in every
 * state, which is the drift the assertion exists to catch.
 */
function actionControls(html: string): string[] {
  return [...html.matchAll(/class="(button-primary|button-secondary|button-danger)"/g)].map(
    (match) => match[1] as string,
  );
}

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

function agent(
  name: string,
  rows: ConnectionRowWithCredential[],
  title: string = name,
): AgentConnections {
  return { name, title, avatar: "ninja", rows, lapses: [] };
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

  it("labels an agent with its title, not its id (MAR-589)", () => {
    const html = draw([agent("meeting-assistant", [row()], "Meeting assistant")]);
    expect(html).toContain("Meeting assistant");
    expect(html).not.toContain("meeting-assistant");
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
    /*
     * MAR-614. The *action* button, named by its class rather than found as the
     * first `<button` in the markup.
     *
     * The tile now carries a second button before this one — the hover note's
     * marker, which is a disclosure and changes nothing — and the loose search
     * found that one instead, failed, and in failing claimed the consent
     * disclosure had moved below the sign-in control. It had not. A positional
     * assertion is only as good as its idea of what it measures against, and
     * "the first button element on the card" stopped being the sign-in the
     * moment anything else on the card became pressable.
     */
    const button = html.indexOf('class="button-primary"');
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
    expect(actionControls(html)).toEqual([]);
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
    expect(actionControls(html)).toEqual([]);
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
