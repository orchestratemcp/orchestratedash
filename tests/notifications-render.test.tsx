/**
 * What the Notifications surface actually draws (MAR-588, outbound).
 *
 * `tests/notify-settings.test.ts` proves the sentences exist and say the right
 * things. This proves the half a person meets: that the two disclosures a
 * decision depends on are on the page **before** the field, that the address is
 * nowhere in the markup, and that the controls a read-only window cannot use are
 * disabled rather than absent.
 *
 * The ordering check is the one worth having and is the one a screenshot answers
 * badly: a picture shows the liveness paragraph above the button, and cannot
 * show that it is still above it once somebody has connected and the page has
 * swapped which section it draws.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { NOTIFY_CONTENTS, NOTIFY_LIVENESS } from "../lib/notify/settings";
import { expectPlainLanguage } from "./helpers/plain-language";
import type { NotificationsView } from "../lib/views/types";

const { NotificationSettings } = await import("../app/settings/notifications/page");

const CONFIGURED: NotificationsView = {
  configured: true,
  masked_hint: "••••CDEF",
  configured_at: "2026-08-10T09:00:00.000Z",
  send_approvals: true,
  send_reports: true,
  state_sentence:
    "DASH posts to Discord when an agent is waiting for your approval, and when one publishes a report.",
};

/**
 * Render the settings section against a view.
 *
 * The default export reads through `useView`, which needs a data source and
 * would put this test's subject behind a loading state. The section is what a
 * person reads, so the section is what is rendered — with the view handed in,
 * the way `tests/deploy-render.test.tsx` reaches its own.
 */
function markup(view: NotificationsView, canAct = true): string {
  return renderToStaticMarkup(
    <NotificationSettings
      view={view}
      canAct={canAct}
      onChanged={() => {
        /* nothing to re-read: the view is the fixture */
      }}
    />,
  );
}

describe("the disclosures come before the field", () => {
  it("puts liveness and contents above the control that asks for the address", () => {
    const html = markup({ ...CONFIGURED, configured: false, masked_hint: null, configured_at: null });

    const liveness = html.indexOf(NOTIFY_LIVENESS[2] as string);
    const contents = html.indexOf(NOTIFY_CONTENTS[2] as string);
    const button = html.indexOf("Add a channel address");

    expect(liveness).toBeGreaterThan(-1);
    expect(contents).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(-1);
    // Both, and both before. A page that asked first and explained afterwards
    // would be confirming a decision rather than informing one.
    expect(liveness).toBeLessThan(button);
    expect(contents).toBeLessThan(button);
  });

  it("opens the consent disclosure while the decision is still live", () => {
    /*
     * MAR-642. Above the button is half of MAR-588's argument; the other half
     * is that it can actually be read there. A `<details>` folded shut at the
     * moment somebody is choosing between a private channel and a shared one
     * would satisfy the ordering assertion above and lose the thing it was
     * ordering.
     */
    const off = markup({ ...CONFIGURED, configured: false, masked_hint: null, configured_at: null });
    const contents = off.slice(off.indexOf('id="notify-contents"'));
    expect(off.slice(0, off.indexOf('id="notify-contents"'))).toContain("<details");
    expect(contents.length).toBeGreaterThan(0);
    // The one open disclosure on the page is this one.
    expect(off.match(/<details[^>]*open[^>]*>/gu)).toHaveLength(1);
  });

  it("moves them below the controls once there is nothing left to decide", () => {
    /*
     * MAR-642, and the deliberate reversal of what this test used to assert.
     *
     * MAR-588's ordering argument is about the moment a credential is handed
     * over. Once DASH holds an address, the same sections are a record of a
     * decision already taken, and the person on this page came to send a test,
     * switch a kind off, or replace the address. Forty lines of prose above
     * those four controls is the shape MAR-642 exists to end.
     *
     * The sections themselves are unchanged and still on the page — this is a
     * move, not a deletion, and the assertion is about which side of the
     * controls they sit on.
     */
    const html = markup(CONFIGURED);
    const liveness = html.indexOf(NOTIFY_LIVENESS[1] as string);
    const test = html.indexOf("Send a test message");
    expect(liveness).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(-1);
    expect(liveness).toBeGreaterThan(test);
  });

  it("answers the test button beside the test button", () => {
    // The inline sent/failed feedback MAR-642 asks for: one row, and the answer
    // lands in it rather than in a block below the page's controls.
    const html = markup(CONFIGURED);
    const row = html.slice(html.indexOf('class="button-row"'));
    expect(row.slice(0, row.indexOf("</div>"))).toContain("Send a test message");
  });
});

describe("what is on the screen", () => {
  it("shows the masked hint and never anything address-shaped", () => {
    const html = markup(CONFIGURED);
    expect(html).toContain("••••CDEF");
    expect(html).not.toContain("discord.com");
    expect(html).not.toContain("api/webhooks");
    expect(html).not.toContain("https://");
  });

  it("says the date the way a person says it, not the way a clock does", () => {
    const html = markup(CONFIGURED);
    expect(html).toContain("10 August 2026");
    expect(html).not.toContain("2026-08-10T09:00:00");
  });

  it("offers the test and the stop only once there is a channel", () => {
    const off = markup({
      ...CONFIGURED,
      configured: false,
      masked_hint: null,
      configured_at: null,
    });
    expect(off).not.toContain("Send a test message");
    expect(off).not.toContain("Stop posting");
    // And the setup steps appear exactly where they are useful.
    expect(off).toContain("Copy Webhook URL");
    expect(markup(CONFIGURED)).not.toContain("Copy Webhook URL");
  });

  it("disables rather than hides the controls a browser tab cannot use", () => {
    // `lib/copy/host.ts`'s rule: a read-only window says what it cannot do
    // rather than quietly drawing a smaller product.
    const html = markup(CONFIGURED, false);
    expect(html).toContain("Send a test message");
    expect(html.match(/disabled=""/gu)?.length).toBeGreaterThanOrEqual(4);
  });

  it("reflects each switch independently", () => {
    const html = markup({ ...CONFIGURED, send_reports: false });
    // Two checkboxes, exactly one checked.
    expect(html.match(/type="checkbox"/gu)).toHaveLength(2);
    expect(html.match(/checked=""/gu)).toHaveLength(1);
  });
});

it("is plain language throughout", () => {
  const html = markup(CONFIGURED);
  const text = html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&[a-z]+;/gu, " ")
    .replace(/\s+/gu, " ");
  expectPlainLanguage([text], {
    // "Copy Webhook URL" is the name of Discord's own button, and `dash://open`
    // never appears on this page — it appears in a Discord message. Both are
    // content the caller has taken responsibility for, which is what `allow` is
    // for; see `lib/copy/identifiers.ts` on why the exemption is at the call
    // site rather than in the rule.
    allow: ["Copy Webhook URL"],
  });
});
