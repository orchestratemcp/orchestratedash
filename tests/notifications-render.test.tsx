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

import { plainMoment } from "../lib/copy/when";
import { NOTIFY_CONTENTS, NOTIFY_LIVENESS } from "../lib/notify/settings";
import { expectPlainLanguage } from "./helpers/plain-language";
import type { NotificationsView } from "../lib/views/types";

const { NotificationSettings } = await import("../app/settings/notifications/page");

/**
 * The chief's half, unconfigured (MAR-743, ADR 0028).
 *
 * A constant of its own so the fixtures below still vary one thing at a time.
 * Every assertion in this file is about the *alerts* half, and a chief bridge
 * that moved with them would make a failure ambiguous about which section broke.
 */
const NO_CHIEF: NotificationsView["chief"] = {
  configured: false,
  enabled: false,
  channel_id: "",
  allowed_user_id: "",
  masked_hint: null,
  configured_at: null,
  state_sentence: "The chief answers only in DASH, on this computer.",
  runner_holds: null,
};

const CONFIGURED: NotificationsView = {
  configured: true,
  masked_hint: "••••CDEF",
  configured_at: "2026-08-10T09:00:00.000Z",
  send_approvals: true,
  send_reports: true,
  state_sentence:
    "DASH posts to Discord when an agent is waiting for your approval, and when one publishes a report.",
  chief: NO_CHIEF,
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
    /*
     * Two open disclosures, one per live decision (MAR-743).
     *
     * This asserted one until ADR 0028 put the chief's bridge on the same page.
     * There are now two credentials a person can hand over here and two channels
     * that can end up carrying different things, so there are two consent
     * disclosures — and both fixtures above are unconfigured, so both are live.
     *
     * The number is asserted rather than the shape because the failure this
     * catches is a folded one: a disclosure shut at the moment somebody is
     * choosing between a private channel and a shared one satisfies the
     * ordering assertion above and loses the thing it was ordering.
     */
    expect(off.match(/<details[^>]*open[^>]*>/gu)).toHaveLength(2);
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
    /*
     * `discord.com/api` rather than `discord.com` (MAR-743).
     *
     * This banned the bare domain until ADR 0028 put the chief's setup steps on
     * this page, one of which has to name `discord.com/developers` — a person
     * cannot make a bot without being told where to go, and DASH's window denies
     * every link, so the address has to be readable text.
     *
     * Nothing is lost. A webhook address is
     * `https://discord.com/api/webhooks/{id}/{token}`, and all three of its
     * distinguishing parts are still banned below. The bare-domain check only
     * ever caught the same string these do, and it is the one that a sentence
     * about Discord can trip by accident.
     */
    expect(html).not.toContain("discord.com/api");
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

  describe("what the runner holds (MAR-745, widened for the MAR-742 roadmap)", () => {
    /*
     * A configured chief bridge whose runner answered — the state the read
     * seam in `electron/main.ts` produces once `queryChiefBridgeStatus`
     * reaches a live runner. `NO_CHIEF` above stays the unconfigured fixture
     * every other test uses; this one exists so the line's own content can be
     * asserted without touching those.
     */
    const CHIEF_WITH_RUNNER: NotificationsView["chief"] = {
      ...NO_CHIEF,
      configured: true,
      channel_id: "111111111111111111",
      allowed_user_id: "222222222222222222",
      masked_hint: "••••ABCD",
      configured_at: "2026-08-20T10:00:00.000Z",
      state_sentence: "The chief answers in your channel, to the Discord account ending 2345 and to nobody else.",
      runner_holds: {
        fleet_count: 3,
        model_label: "OpenRouter · anthropic/claude-sonnet-5",
        connected: true,
        snapshot_at: "2026-08-24T14:32:00.000Z",
      },
    };

    it("shows the runner's own fleet count, model, moment and socket state, in words", () => {
      const html = markup({ ...CONFIGURED, chief: CHIEF_WITH_RUNNER });
      expect(html).toContain("Runner holds: fleet of 3");
      // Local time, so computed the same way the page computes it rather than
      // hardcoded — `lib/copy/when.ts`'s whole point is that this varies by
      // machine, and a fixed clock string here would just be another timezone
      // bug waiting for a CI runner outside it.
      expect(html).toContain(`taken ${plainMoment(CHIEF_WITH_RUNNER.runner_holds?.snapshot_at as string) as string}`);
      expect(html).toContain("OpenRouter · anthropic/claude-sonnet-5");
      expect(html).toContain("listening in Discord");
      // The moment is said the way a person says it, never the raw stamp.
      expect(html).not.toContain("2026-08-24T14:32");
    });

    it("says not reachable when the runner could not be asked, rather than staying silent", () => {
      const html = markup({ ...CONFIGURED, chief: { ...CHIEF_WITH_RUNNER, runner_holds: null } });
      expect(html).toContain("Runner status: not reachable right now.");
    });

    it("draws no runner line at all before the bridge is configured", () => {
      const html = markup({ ...CONFIGURED, chief: NO_CHIEF });
      expect(html).not.toContain("Runner holds:");
      expect(html).not.toContain("Runner status:");
    });
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
