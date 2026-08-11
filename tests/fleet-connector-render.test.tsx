/**
 * The fleet connector card, drawn (MAR-593, ADR 0013).
 *
 * `tests/fleet-connections.test.ts` drives the model and the vault. This drives
 * the thing on screen, for `tests/connector-tile-render.test.tsx`' reason: a
 * photograph proves a state was drawn once on one machine, and this proves each
 * one is still drawn on every run.
 *
 * The load-bearing assertions are about **presence and order**, because the
 * defect this issue closes was a page with the right content in the wrong shape,
 * and the one after it would be a card whose consequences arrive after the press:
 *
 * - a connector with nothing connected still draws a card, and a button;
 * - the wider-permission sentence renders **before** a sign-in as well as after;
 * - the disclosure naming other agents is above the button, never below it;
 * - an agent that is named and not reached is drawn with its reason, not hidden;
 * - the "give it to the waiting agents" button appears only when somebody is
 *   actually waiting.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FleetConnectorCard } from "../app/_components/fleet-connector";
import { FleetConnectors } from "../app/settings/page";
import type { FleetConnectorView } from "../lib/views/types";

function connector(over: Partial<FleetConnectorView> = {}): FleetConnectorView {
  return {
    provider: "google-gmail",
    service: "Gmail",
    connector_kind: "google_oauth_broker",
    purpose: "Let your agents work with your mail.",
    help: null,
    capabilities: [
      { id: "gmail.search", label: "Search your mail", access: "read", consequence: null },
      {
        id: "gmail.draft.create",
        label: "Save a reply in your Gmail drafts",
        access: "write",
        consequence: "A draft appears in your mailbox, one click from being sent.",
      },
    ],
    wider_permissions: [
      "To save a draft, DASH must ask for a permission that can also send mail. DASH has no send action.",
    ],
    held: null,
    agents: [],
    skipped: [],
    waiting: [],
    reach_sentence: null,
    ...over,
  };
}

const draw = (view: FleetConnectorView, canAct = true): string =>
  renderToStaticMarkup(
    <FleetConnectorCard connector={view} canAct={canAct} act={() => Promise.resolve({ ok: true })} />,
  );

describe("a connector nobody has connected", () => {
  it("still draws a card and a button", () => {
    // The whole issue on screen: a DASH with no agents and nothing connected has
    // something to press. The page that had neither is the one this replaces.
    const html = draw(connector());
    expect(html).toContain("Gmail");
    expect(html).toContain("Not connected");
    expect(html).toContain("Sign in to Gmail");
  });

  it("says a browser is about to open", () => {
    // A sign-in and a typed key are different acts, and "Connect" on a control
    // that opens a browser gives no warning that the person is about to leave
    // DASH.
    expect(draw(connector())).toContain("Sign in to Gmail");
    expect(
      draw(connector({ provider: "openrouter", service: "OpenRouter", connector_kind: "api_key" })),
    ).toContain("Add your OpenRouter key");
  });

  it("renders the wider-permission sentence before anything is granted", () => {
    /*
     * ADR 0002 amendment 2's rule, and the failure it was written against: the
     * uncomfortable half would otherwise appear only once the permission had
     * been granted — vanishing at exactly the moment it started to matter. The
     * person who has not granted it yet is the one it is for.
     */
    const html = draw(connector());
    expect(html).toContain("can also send mail");
    expect(html.indexOf("can also send mail")).toBeLessThan(html.indexOf("Sign in to Gmail"));
  });

  it("offers nothing to check, disconnect or give away", () => {
    // No dead controls. Every one of these acts on a credential DASH does not
    // have.
    const html = draw(connector());
    expect(html).not.toContain("Check it still works");
    expect(html).not.toContain("Disconnect");
    expect(html).not.toContain("Give it to");
  });

  it("says which window this is rather than greying the button out", () => {
    // A greyed-out Connect reads as a claim about the service; the true
    // statement is about which window this is.
    const html = draw(connector(), false);
    expect(html).toContain("Open the installed DASH app");
    expect(html).not.toContain("Sign in to Gmail");
  });
});

describe("a connector the person has connected", () => {
  const held = connector({
    held: {
      masked_hint: "he••••@example.com",
      account_hint: "he••••@example.com",
      since: "10 August 2026",
      permissions: ["Read your mail", "Save drafts"],
    },
    agents: [
      { agent: "news-scout", title: "News scout", connected: true },
      { agent: "invoice-reviewer", title: "Invoice reviewer", connected: false },
    ],
    reach_sentence:
      "Connecting Gmail connects it for news-scout and invoice-reviewer. DASH keeps a separate record for each.",
  });

  it("names the account and the date, and neither is a full address", () => {
    const html = draw(held);
    expect(html).toContain("he••••@example.com");
    expect(html).toContain("since 10 August 2026");
    expect(html).not.toContain("henrik@example.com");
  });

  it("puts the disclosure about other agents above the button", () => {
    // The consequence that lands on an agent the person is not looking at. A
    // sentence arriving with the confirmation describes a window they have
    // already walked through.
    const html = draw(held);
    expect(html.indexOf("connects it for news-scout")).toBeLessThan(
      html.indexOf("Sign in to Gmail again"),
    );
  });

  it("says a disconnect reaches further than this card", () => {
    expect(draw(held)).toContain("Disconnect everywhere");
  });

  it("draws Disconnect without the everywhere when it reaches nobody", () => {
    // Precision rather than a stock label: on a DASH with no agents this really
    // does only disconnect the one thing in front of the person.
    const alone = connector({
      held: { masked_hint: "••••abcd", account_hint: null, since: null, permissions: [] },
    });
    const html = draw(alone);
    expect(html).toContain(">Disconnect<");
    expect(html).not.toContain("Disconnect everywhere");
  });
});

describe("agents that are waiting, and agents that are not coming", () => {
  it("offers one button when an agent was imported after the connect", () => {
    const html = draw(
      connector({
        held: { masked_hint: "••••abcd", account_hint: null, since: null, permissions: [] },
        agents: [{ agent: "news-scout", title: "News scout", connected: false }],
        waiting: ["news-scout"],
      }),
    );
    expect(html).toContain("Give it to news-scout");
  });

  it("draws an agent it will not reach, with the reason and the next move", () => {
    /*
     * Drawn rather than filtered out. An agent silently missing from the list is
     * a person wondering why their agent still cannot do the thing they just
     * connected — and the three reasons point at three different next actions.
     */
    const html = draw(
      connector({
        skipped: [
          { agent: "news-scout", title: "News scout", reason: "withheld" },
          { agent: "ledger-reporter", title: "Ledger reporter", reason: "not_dash_held" },
        ],
      }),
    );
    expect(html).toContain("you turned this one off");
    expect(html).toContain("the agent holds its own");
    expect(html).toContain("Ledger reporter");
  });
});

describe("the section on the Connections page", () => {
  it("counts what it drew rather than asserting a number", () => {
    const html = renderToStaticMarkup(
      <FleetConnectors
        connectors={[
          connector(),
          connector({ provider: "openrouter", service: "OpenRouter", connector_kind: "api_key" }),
        ]}
        canAct
        onChanged={() => undefined}
      />,
    );
    expect(html).toContain("2 services DASH can connect for you");
    expect(html).toContain("None is connected yet");
  });

  it("draws nothing at all when this build offers no connectors", () => {
    // Unreachable through `fleetCatalogue`, which is a by-value list with
    // entries in it. If it ever happened the true statement would be that this
    // build offers none — not that the person has connected nothing.
    expect(
      renderToStaticMarkup(
        <FleetConnectors connectors={[]} canAct onChanged={() => undefined} />,
      ),
    ).toBe("");
  });
});
