/**
 * The merged service row, drawn (MAR-570, MAR-593, MAR-642).
 *
 * `tests/connectors.test.ts` drives the model, `tests/grant-sharing.test.ts`
 * drives the fan-out and `tests/connections-list.test.ts` drives the merge. This
 * drives the thing on screen, and it is the durable half of MAR-570's screenshot
 * bar: a photograph proves a state was drawn once on one machine, this proves
 * each one is still drawn on every run.
 *
 * **This file was `connector-tile-render.test.tsx`.** Every assertion it made
 * about the tile is made here about the row that replaced it, because MAR-642
 * merged two card systems rather than removing one — see `lib/connections-list.ts`.
 * What is new is the pair at the bottom: a row for a service with no agents, and
 * a row where the catalogue half and the agents' half are the same service and
 * must be drawn once.
 *
 * The load-bearing assertions are the ones about **order and presence**, because
 * the original issue was a page whose content was right and whose shape was
 * wrong:
 *
 * - the shared-grant disclosure is above the button, never below it;
 * - the receipt is present and one click deep, not deleted;
 * - a row with nothing to press draws no button rather than a dead one.
 *
 * ## What "no button" had to become (MAR-614)
 *
 * The third rule was written as `not.toContain("<button")`, which was exact
 * while the only pressable thing was Connect. The text pass added a hover note,
 * whose marker is a button that opens an explanation and changes nothing — and
 * the assertion went red for a card that still had no dead control on it.
 *
 * `actionControls` is the same rule, saying what it means: the row draws no
 * control that would *do* anything. It enumerates what it found, so a new action
 * class shows up in the failure message by name instead of hiding in a boolean.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ServiceRow } from "../app/_components/service-row";
import { serviceRows } from "../lib/connections-list";
import { buildConnectorTiles } from "../lib/connectors";
import type {
  AgentConnections,
  FleetConnectorView,
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

function agent(name: string, rows: ConnectionRowWithCredential[]): AgentConnections {
  return { name, title: name, avatar: "ninja", rows, lapses: [] };
}

const NOTHING = () => () => Promise.resolve({ ok: true });
const NO_FLEET = () => Promise.resolve({ ok: true });

/**
 * One row, from agents alone — the case every assertion below inherited from
 * the tile. `serviceRows` is handed an empty catalogue, which is exactly the
 * state of a service DASH has built no fleet flow for.
 */
function draw(agents: AgentConnections[], canAct = true): string {
  const rows = serviceRows([], buildConnectorTiles(agents));
  return renderToStaticMarkup(
    <ServiceRow
      row={rows[0] as never}
      fleetAct={NO_FLEET}
      agentAct={NOTHING}
      canAct={canAct}
    />,
  );
}

const SHARED = (): AgentConnections[] => [
  agent("News Scout", [row({ connection_id: "gmail" })]),
  agent("Meeting Assistant", [row({ connection_id: "mail" })]),
];

describe("the front of the tile", () => {
  it("leads with the service a person recognises, never the provider id", () => {
    const html = draw(SHARED());
    expect(html).toContain(">Gmail</h3>");
    expect(html).not.toContain("google-gmail");
  });

  it("names every agent that depends on it", () => {
    /*
     * The tile's whole reason for existing. A page that showed one Gmail without
     * saying whose would have replaced two cards with one lie of omission.
     */
    const html = draw(SHARED());
    /*
     * MAR-642. The sentence "Needed by News Scout and Meeting Assistant." is
     * gone and each agent is a row of its own — a portrait, a name and its own
     * standing. That is strictly more than the sentence carried: a partly
     * connected service used to need the row expanded before a person could
     * see which half they were in.
     */
    expect(html).toContain("News Scout");
    expect(html).toContain("Meeting Assistant");
    expect(html).not.toContain("Needed by");
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
    /*
     * MAR-642. `connectTarget` moved into `ServiceRow` with the rule it
     * carried, so this asserts through the surface rather than through an
     * exported helper: a partly connected row still offers the sign-in rather
     * than the re-sign-in, which is what says the press will fill the gap.
     */
    const html = draw([
      agent("Connected", [row({ masked_hint: "h•••@example.com" })]),
      agent("Waiting", [row({ connection_id: "gmail" })]),
    ]);
    expect(html).toContain("Sign in to Gmail<");
    expect(html).not.toContain("Sign in to Gmail again");
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
    expect(html).toContain("what each of the 2 agents that need it may do");
  });

  it("says it in the singular for a tile only one agent needs", () => {
    expect(draw([agent("News Scout", [row()])])).toContain("what the one agent that needs it may do");
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

/* ---------------------------------------------------------------------- *
 * MAR-642: the two card systems, merged
 * ---------------------------------------------------------------------- */

/** The catalogue half, in the shape `connectionsView` projects it. */
function connector(over: Partial<FleetConnectorView> = {}): FleetConnectorView {
  return {
    provider: "google-gmail",
    service: "Gmail",
    connector_kind: "google_oauth_broker",
    ai_provider_id: null,
    purpose: "Let your agents work with your mail.",
    help: null,
    capabilities: [
      { id: "gmail.search", label: "Search your mail", access: "read", consequence: null },
    ],
    wider_permissions: [],
    held: null,
    agents: [],
    skipped: [],
    waiting: [],
    reach_sentence: null,
    ...over,
  };
}

function merged(
  fleet: FleetConnectorView[],
  agents: AgentConnections[],
  canAct = true,
): { rows: number; html: string } {
  const rows = serviceRows(fleet, buildConnectorTiles(agents));
  return {
    rows: rows.length,
    html: rows
      .map((one) =>
        renderToStaticMarkup(
          <ServiceRow row={one} fleetAct={NO_FLEET} agentAct={NOTHING} canAct={canAct} />,
        ),
      )
      .join(""),
  };
}

describe("one service, once", () => {
  it("draws a single row when the catalogue and an agent name the same service", () => {
    /*
     * The defect this packet closes, as an assertion. Before the merge a DASH
     * with one Gmail agent drew Gmail twice — the catalogue card above, the
     * agent tile below — with two chips and two buttons for one account.
     */
    const { rows, html } = merged([connector()], SHARED());
    expect(rows).toBe(1);
    expect(html.match(/>Gmail<\/h3>/gu)).toHaveLength(1);
    expect(html.match(/class="button-primary"/gu)).toHaveLength(1);
  });

  it("still draws a service nobody has asked for, which is why the catalogue exists", () => {
    // MAR-593's finding: a DASH with no agents had an empty page, and every
    // tile came from a manifest. A catalogue entry is drawn whether or not any
    // agent named it.
    const { rows, html } = merged([connector()], []);
    expect(rows).toBe(1);
    expect(html).toContain("Sign in to Gmail");
  });

  it("still draws a service only an agent named, which the catalogue cannot know", () => {
    const { rows, html } = merged([], [agent("News Scout", [row()])]);
    expect(rows).toBe(1);
    expect(html).toContain("Gmail");
  });

  it("keeps the catalogue's own consequences on the merged row", () => {
    // The wider-permission sentence is ADR 0002 amendment 2's, and it renders
    // before a sign-in as much as after — the person who has not granted it yet
    // is the one it is for.
    const { html } = merged(
      [
        connector({
          wider_permissions: ["DASH must ask for a permission that can also send mail."],
        }),
      ],
      SHARED(),
    );
    expect(html).toContain("can also send mail");
    expect(html.indexOf("can also send mail")).toBeLessThan(html.indexOf("Sign in to Gmail"));
  });

  it("offers the fleet's own four actions once DASH holds the connection itself", () => {
    const { html } = merged(
      [
        connector({
          held: {
            masked_hint: "••••abcd",
            account_hint: "he••••@example.com",
            since: "10 August 2026",
            permissions: [],
          },
          waiting: ["news-scout"],
        }),
      ],
      [],
    );
    expect(html).toContain("he••••@example.com");
    expect(html).toContain("since 10 August 2026");
    expect(html).toContain("Check it still works");
    expect(html).toContain("Give it to news-scout");
    expect(html).toContain("Disconnect");
  });

  it("draws two accounts honestly and an account selector for every agent", () => {
    const accounts = [
      {
        id: "account-1",
        masked_hint: "fiâ€¢â€¢â€¢@example.com",
        account_hint: "fiâ€¢â€¢â€¢@example.com",
        since: "10 August 2026",
        permissions: [],
        is_default: true,
      },
      {
        id: "account-2",
        masked_hint: "seâ€¢â€¢â€¢@example.com",
        account_hint: "seâ€¢â€¢â€¢@example.com",
        since: "16 August 2026",
        permissions: [],
        is_default: false,
      },
    ];
    const { html } = merged(
      [
        connector({
          held: accounts[0] as FleetConnectorView["held"],
          accounts,
          agents: [
            { agent: "News Scout", title: "News Scout", connected: true, account_id: "account-1" },
            { agent: "Meeting Assistant", title: "Meeting Assistant", connected: true, account_id: "account-2" },
          ],
        }),
      ],
      [
        agent("News Scout", [row({ masked_hint: "fiâ€¢â€¢â€¢@example.com" })]),
        agent("Meeting Assistant", [row({ masked_hint: "seâ€¢â€¢â€¢@example.com" })]),
      ],
    );

    expect(html).toContain("2 accounts");
    expect(html).toContain("fiâ€¢â€¢â€¢@example.com");
    expect(html).toContain("seâ€¢â€¢â€¢@example.com");
    expect(html).toContain('aria-label="Account for News Scout"');
    expect(html).toContain('aria-label="Account for Meeting Assistant"');
    expect(html).toContain("(default)");
    expect(html).toContain("Make default");
    expect(html).toContain("Add another Gmail account");
    expect(html).not.toContain("Disconnect everywhere");
  });
});
