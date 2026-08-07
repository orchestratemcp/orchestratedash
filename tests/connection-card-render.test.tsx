/**
 * The capability card, rendered (MAR-533).
 *
 * `tests/connection-card.test.ts` drives the model. This drives the *card*, and
 * it exists for the three things that could still go wrong between a correct
 * model and a screen — none of which a screenshot would catch either, because
 * all three are about text that is present or absent rather than misplaced:
 *
 * 1. a disclosure the model produced and the card dropped;
 * 2. a machine instant reaching the page through a field this redesign did not
 *    route through `lib/copy/when.ts`;
 * 3. the three-party block rendering its state in colour alone.
 *
 * Rendered with `renderToStaticMarkup`, so effects do not run — which makes
 * `useCanAct` false and the action buttons absent. That is the read-only
 * developer-path branch and it is the right one to pin here: this file is about
 * what the card *says*, and `tests/connection-center.test.ts` owns what the
 * commands do.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { BrokerLapseNotice, ConnectionCards } from "../app/_components/connection-card";
import type { BrokerLapseView, ConnectionRowWithCredential } from "../lib/views/types";

const SEARCH = {
  id: "gmail.search",
  label: "Search your mail",
  access: "read" as const,
  consequence: null,
};
const DRAFT = {
  id: "gmail.draft.create",
  label: "Save a reply in your drafts",
  access: "write" as const,
  consequence: "A draft will be sitting in your Drafts folder afterwards.",
};

function gmailRow(
  overrides: Partial<ConnectionRowWithCredential> = {},
): ConnectionRowWithCredential {
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
    masked_hint: "••••a3f9",
    delivered_to_agent: false,
    credential_kind: "oauth",
    broker: {
      custody_sentence: "DASH holds this sign-in and the agent never receives it.",
      client_sentence: null,
      requested: [SEARCH, DRAFT],
      not_requested: [],
      wider_permission_sentence:
        "Google has no permission that allows saving a draft without also allowing sending.",
      dash_closed_sentence:
        "This agent keeps running when DASH is closed, and cannot reach Gmail then.",
      receipt: {
        account_hint: "someone@example.com",
        granted_at: "2026-08-06T09:00:00.000Z",
        last_used_at: "2026-08-07T11:30:00.000Z",
        capabilities: [SEARCH],
      },
      recent: [
        {
          label: "Search your mail",
          decision: "allowed",
          refusal_headline: null,
          result_count: 12,
          decided_at: "2026-08-07T11:30:00.000Z",
          undelivered: false,
        },
        {
          label: "Save a reply in your drafts",
          decision: "refused",
          refusal_headline: "This agent asked to do something it was not allowed to do.",
          result_count: null,
          decided_at: "2026-08-07T11:31:00.000Z",
          undelivered: false,
        },
      ],
    },
    ...overrides,
  };
}

const markup = (rows: ConnectionRowWithCredential[]): string =>
  renderToStaticMarkup(<ConnectionCards rows={rows} />);

describe("a brokered connection's card", () => {
  const html = markup([gmailRow()]);

  it("answers all four questions, each under its own heading", () => {
    for (const heading of [
      "What it can reach",
      "On whose account",
      "What it has been used for",
      "Three things have to agree",
    ]) {
      expect(html, `the card must ask "${heading}"`).toContain(heading);
    }
  });

  it("keeps both disclosures, and keeps them out of a tooltip", () => {
    // MAR-469 made `wider_permission_sentence` required and nullable so a future
    // write could not ship without answering it. A redesign that dropped it
    // would be the same failure one layer up.
    expect(html).toContain("no permission that allows saving a draft without also allowing sending");
    expect(html).toContain("keeps running when DASH is closed");
    expect(html).toContain('role="note"');
  });

  it("shows a partial consent as its own state rather than as not-yet-connected", () => {
    // The receipt issued search and not the draft. Both must be on the card and
    // they must not read the same.
    expect(html).toContain("allowed");
    expect(html).toContain("you did not give this one");
  });

  it("carries the write's consequence in the card, not behind a hover", () => {
    expect(html).toContain("sitting in your Drafts folder");
  });

  it("explains a standing once per run rather than once per row", () => {
    /*
     * Found by photographing the card at full height. A three-action Gmail card
     * before a sign-in printed "The agent has asked for this and nobody has
     * signed in yet, so it cannot." three times in eleven lines.
     *
     * Repetition here is not neutral. A reader who learns that the small grey
     * line under each row never changes stops reading it — including on the card
     * where the third row says something different from the first two, which is
     * the partial-consent case this whole design exists to make visible.
     *
     * The chip stays on every row; only the explanation is de-duplicated.
     */
    const waiting = renderToStaticMarkup(
      <ConnectionCards
        rows={[
          gmailRow({
            broker: {
              ...(gmailRow().broker as NonNullable<ConnectionRowWithCredential["broker"]>),
              receipt: null,
            },
          }),
        ]}
      />,
    );
    const meaning = "nobody has signed in yet, so it cannot";
    expect(waiting.split(meaning)).toHaveLength(2);
    // Both rows still carry the chip, so nothing is hidden — only repeated.
    expect(waiting.split("waiting for you")).toHaveLength(3);
  });

  it("states each of the three parties in words as well as in a mark", () => {
    /*
     * The mark is `aria-hidden`; the state has to survive without it. This is
     * the `aria-current` argument pointed at a fact about whether an agent may
     * touch somebody's mail.
     */
    expect(html).toContain("DASH has built the action");
    expect(html).toContain("This agent asked for it");
    expect(html).toMatch(/Yes:|No:/);
    expect(html).toContain('aria-hidden="true"');
  });

  it("prints no machine instant anywhere on the card", () => {
    /*
     * The load-bearing assertion of this file, and the defect that started
     * MAR-533: the page rendered `2026-08-07T13:58:28.037Z` onto the screen from
     * five separate fields. Written against the *shape* rather than against the
     * five known fields, so a sixth added later fails here rather than shipping.
     */
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    // …and the dates really are there, so this is not passing by rendering none.
    expect(html).toContain("6 August 2026");
  });

  it("does not uppercase the masked hint, which is the user's own credential", () => {
    // `.chip` uppercases its text. The hint is four real trailing characters of
    // somebody's secret, and redrawing them in caps would show a fragment that
    // is not the one they hold.
    expect(html).toContain('class="value">••••a3f9<');
  });
});

describe("a connection DASH is not in the middle of", () => {
  const handedOver = markup([gmailRow({ broker: null })]);

  it("gets the same headings, with the answers honestly missing", () => {
    // A page where only the brokered cards had a "what can DASH show you"
    // section would let a reader assume the others simply had not been used.
    expect(handedOver).toContain("What it can reach");
    expect(handedOver).toContain("What DASH can show you");
  });

  it("says plainly that DASH cannot show what was done", () => {
    expect(handedOver).toContain("cannot show you what it did");
  });

  it("labels the manifest's capability list as a claim rather than a limit", () => {
    const declared = markup([
      gmailRow({
        broker: null,
        capabilities: [{ id: "mail.read", label: "Read your mail", access: "read" }],
      }),
    ]);
    expect(declared).toContain("Read your mail");
    expect(declared).toContain("a claim rather than a limit");
  });

  it("says an inferred row was worked out rather than declared", () => {
    const inferred = markup([
      gmailRow({ broker: null, source: "derived_from_plan", capabilities: [] }),
    ]);
    expect(inferred).toContain("DASH worked it out from the steps");
    expect(inferred).toContain("may be wrong");
  });
});

describe("what DASH cannot account for", () => {
  const lapses: BrokerLapseView[] = [
    {
      kind: "dash_closed",
      sentence: "DASH was closed for this period, and this agent keeps running while DASH is closed.",
      qualifier: "DASH has no record of whether this agent asked for anything during that time.",
      from_at: "2026-08-07T13:58:28.037Z",
      until_at: "2026-08-07T13:59:47.412Z",
    },
  ];
  const html = renderToStaticMarkup(<BrokerLapseNotice lapses={lapses} />);

  it("opens as one counted line rather than as a wall", () => {
    // It stays above the cards — somebody who opened this page because an agent
    // did less than they expected is looking for exactly this — and it stops
    // being the first paragraph anybody reads.
    expect(html).toContain("There is 1 period DASH cannot account for");
    expect(html).toContain("<details");
  });

  it("says the window in words, and its day once", () => {
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(html).toContain("7 August 2026 at");
    expect(html).toContain(" until ");
  });

  it("renders nothing at all when there is nothing to report", () => {
    // The ordinary case. An empty panel saying "no lapses" would be a page
    // reassuring somebody about a thing they had not thought to worry about.
    expect(renderToStaticMarkup(<BrokerLapseNotice lapses={[]} />)).toBe("");
  });

  it("carries no verdict-shaped chip, ever", () => {
    /*
     * ADR 0005. A permission card's history is a list of decisions DASH made and
     * is worth believing for that reason; these are requests DASH never
     * adjudicated. One list — even styled differently — would make the history a
     * mixture of things DASH did and things DASH infers.
     */
    expect(html).not.toContain("chip-ok");
    expect(html).not.toContain("chip-warn");
    expect(html).not.toContain("allowed");
    expect(html).not.toContain("refused");
  });
});
