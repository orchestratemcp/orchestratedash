/**
 * The fleet connector card, drawn (MAR-593, ADR 0013).
 *
 * **This card is the AI tab's now (MAR-642).** The Connections page merged it
 * with the per-agent tile into one service-keyed row -- `tests/service-row-render.test.tsx`
 * is where the merged surface is held to these same claims -- and what still
 * renders this component is `app/settings/ai/page.tsx`, where a model key is a
 * card rather than a row because choosing a provider is a decision worth a
 * paragraph of consequence.
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

import { FleetConnectorCard, recoveryToShow } from "../app/_components/fleet-connector";
import { describeFleetSecretUnreadable } from "../lib/copy/fleet-standing";
import type { FleetConnectorView } from "../lib/views/types";

function connector(over: Partial<FleetConnectorView> = {}): FleetConnectorView {
  return {
    provider: "google-gmail",
    service: "Gmail",
    connector_kind: "google_oauth_broker",
    // Null is what sends this card to Connections rather than the AI tab
    // (MAR-642). The key connectors below set it, which is what makes the split
    // testable rather than asserted.
    ai_provider_id: null,
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
      draw(connector({
            provider: "openrouter",
            service: "OpenRouter",
            connector_kind: "api_key",
            ai_provider_id: "openrouter",
          })),
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
      // Held *and* readable (MAR-676). The fixture has to say which, because the
      // chip is now the answer to both questions rather than only the first.
      secret_readable: true,
      unreadable: null,
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

  it("says Connected only because the secret resolves (MAR-676)", () => {
    const html = draw(held);
    expect(html).toContain(">Connected<");
    expect(html).not.toContain("DASH cannot read this");
  });

  it("draws Disconnect without the everywhere when it reaches nobody", () => {
    // Precision rather than a stock label: on a DASH with no agents this really
    // does only disconnect the one thing in front of the person.
    const alone = connector({
      held: {
        masked_hint: "••••abcd",
        account_hint: null,
        since: null,
        permissions: [],
        secret_readable: true,
        unreadable: null,
      },
    });
    const html = draw(alone);
    expect(html).toContain(">Disconnect<");
    expect(html).not.toContain("Disconnect everywhere");
  });
});

/**
 * MAR-676. The card Henrik was looking at, with the fact it was missing.
 *
 * It said CONNECTED because it asked one question — has this person ever given
 * DASH a credential — and the answer was truthfully yes. The question it did not
 * ask was whether the credential still comes back out of the vault, and the answer
 * to that was no, and the page was already saying so two paragraphs further down
 * in the outcome box after he pressed a button.
 */
describe("a connector DASH holds and cannot read", () => {
  const unreadable = connector({
    held: {
      masked_hint: "••••abcd",
      account_hint: null,
      since: "10 August 2026",
      permissions: [],
      secret_readable: false,
      unreadable: describeFleetSecretUnreadable("Gmail", "Windows Credential Manager (DPAPI)"),
    },
  });

  it("does not say Connected", () => {
    const html = draw(unreadable);
    expect(html).not.toContain(">Connected<");
    expect(html).toContain("DASH cannot read this");
  });

  it("puts the explanation under the chip and not in the outcome box", () => {
    /*
     * It is true on arrival rather than the result of a press, and the outcome box
     * is empty until somebody clicks something. Henrik read this sentence *after*
     * pressing "give it to the waiting agents", while the chip above it still said
     * CONNECTED — the fact was on the page, two paragraphs from its own
     * contradiction.
     */
    const html = draw(unreadable);
    expect(html).toContain("could not read it from windows credential manager (dpapi) just now");
    expect(html.indexOf("could not read it from")).toBeLessThan(
      html.indexOf("Sign in to Gmail again"),
    );
    // A note, not an alert: nothing is broken, nothing was lost, and interrupting a
    // screen reader for a state the page arrived in would be the wrong urgency.
    expect(html).toContain("notice notice-warn");
    expect(html).not.toContain('role="alert"');
  });

  it("still offers the presses that would fix or confirm it", () => {
    // A credential DASH cannot read is still one it holds, so the button offers to
    // sign in *again* rather than for a first time, and the check that would confirm
    // what the chip says stays available. A card that hid both would leave somebody
    // reading a warning with nothing on it to press.
    const html = draw(unreadable);
    expect(html).toContain("Sign in to Gmail again");
    expect(html).toContain("Check it still works");
  });

  it("still names the account it holds", () => {
    // The row is not wrong. Only the claim about it was, and taking the account off
    // the card would lose the true half along with the false one.
    expect(draw(unreadable)).toContain("since 10 August 2026");
  });

  /**
   * MAR-684. The press Henrik made, and the downgrade it must never render
   * again: CHECK IT STILL WORKS on a held-but-unreadable key came back with the
   * `not_found` recovery — "not connected yet. Connect it." — two paragraphs
   * under a card that knew the key was held. A failed read-only press confirms
   * the standing; it does not contradict it.
   *
   * Driven through `recoveryToShow` because the repo renders components
   * statically and a post-press decision has to be a pure function to be held
   * to anything — the same reason `fleetStanding` is one.
   */
  describe("a failed press on the card (MAR-684)", () => {
    const standing = unreadable.held;
    const downgrade = {
      headline: "Gmail is not connected yet.",
      meaning: "The agent cannot do the parts of its job that need Gmail until it is.",
      next_action: "Connect Gmail.",
      actor: "user" as const,
    };

    it("a failed check on an unreadable-held row shows the standing's sentence, not the downgrade", () => {
      const shown = recoveryToShow(
        { ok: false, action: "test", recovery: downgrade },
        standing,
      );
      expect(shown?.headline).toContain("DASH holds Gmail but could not read it");
    });

    it("a failed share is confirmed the same way", () => {
      const shown = recoveryToShow({ ok: false, action: "share" }, standing);
      expect(shown?.headline).toContain("DASH holds Gmail but could not read it");
    });

    it("a failed connect keeps its own recovery — it is about the write that just happened", () => {
      const shown = recoveryToShow(
        { ok: false, action: "connect", recovery: downgrade },
        standing,
      );
      expect(shown).toBe(downgrade);
    });

    it("a failed check on a READABLE row is the provider talking, and passes through", () => {
      const refused = {
        headline: "OpenRouter no longer accepts this key.",
        meaning: "The provider turned it down.",
        next_action: "Replace the key.",
        actor: "user" as const,
      };
      const shown = recoveryToShow(
        { ok: false, action: "test", recovery: refused },
        {
          masked_hint: "••••abcd",
          account_hint: null,
          since: null,
          permissions: [],
          secret_readable: true,
          unreadable: null,
        },
      );
      expect(shown).toBe(refused);
    });

    it("a successful press is never rewritten", () => {
      const shown = recoveryToShow({ ok: true, action: "test" }, standing);
      expect(shown).toBeUndefined();
    });
  });
});

describe("agents that are waiting, and agents that are not coming", () => {
  it("offers one button when an agent was imported after the connect", () => {
    const html = draw(
      connector({
        held: {
        masked_hint: "••••abcd",
        account_hint: null,
        since: null,
        permissions: [],
        secret_readable: true,
        unreadable: null,
      },
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
