/**
 * What the Reporting surface actually draws (MAR-479, ADR 0026).
 *
 * `tests/lab-telemetry.test.ts` proves the sender and the store. This proves
 * the half a person meets, and the two claims a screenshot answers badly:
 *
 * - that **the payload is on the page before the switch** — not the schema, not
 *   a description of it, the bytes — and that it is there on a DASH that has
 *   opted into nothing, which is the state consent is actually given in;
 * - that the sentence limiting what the receipt means survives. It is the one
 *   line on this page a later edit would drop for space, and dropping it is the
 *   only way this page could be dishonest.
 *
 * And the ordinary one: the token is nowhere in the markup, on a view that
 * carries a masked hint, an address and two payload bodies.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LAB_TELEMETRY_CONTENTS, LAB_TELEMETRY_RECEIPT } from "../lib/lab/settings";
import { expectPlainLanguage } from "./helpers/plain-language";
import type { LabTelemetryView } from "../lib/views/types";

const { ReportingSettings } = await import("../app/settings/reporting/page");

/** A distinctive token: if it appears in the markup, the view leaked it. */
const TOKEN = "zZqQ-LABTOKEN-TESTONLY";

const PAYLOAD = `[
  {
    "observed_on": "2026-08-18",
    "goal_slug": "dash_route_b5870cb47ce4",
    "goal_text": "public_source_fetch → brief_compose",
    "components": ["public_source_fetch", "brief_compose"],
    "route_selected": "composed",
    "route_score": 0,
    "playbook_candidate": "",
    "must_have_missing": [],
    "forbidden_present": [],
    "route_changed": false
  }
]`;

const OFF: LabTelemetryView = {
  enabled: false,
  endpoint: "http://127.0.0.1:3000",
  ingest_url: "http://127.0.0.1:3000/api/insights/ingest",
  masked_hint: null,
  configured_at: null,
  standing_chip: "Not set up",
  standing_on: false,
  standing_sentence: "Nothing about your agents leaves this computer.",
  reach_sentence: "That address is on this computer. Nothing DASH sends there crosses a network.",
  preview_body: PAYLOAD,
  preview_count: 1,
  sends: [],
};

const SENDING: LabTelemetryView = {
  ...OFF,
  enabled: true,
  masked_hint: "••••CDEF",
  configured_at: "2026-08-20T09:00:00.000Z",
  standing_chip: "Sending",
  standing_on: true,
  standing_sentence: "DASH sends to that LAB, set up 20 August 2026, once a day per plan.",
  preview_body: "[]",
  preview_count: 0,
  sends: [
    {
      id: 1,
      sent_on: "20 August 2026",
      endpoint: "http://127.0.0.1:3000",
      body: PAYLOAD,
      outcome: "accepted",
      ok: true,
      status: 200,
      detail: "LAB took 1 entry.",
      accepted: 1,
    },
  ],
};

/**
 * A sentence as React will have written it into the markup.
 *
 * `renderToStaticMarkup` escapes apostrophes to `&#x27;`, and most of this
 * page's copy has one. Searching the haystack for the raw sentence would fail
 * on exactly the lines worth asserting — "DASH's record of what DASH sent" is
 * the one this file exists to pin — so the needle is escaped rather than the
 * assertions being softened to apostrophe-free fragments.
 */
function asMarkup(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function markup(view: LabTelemetryView, canAct = true): string {
  return renderToStaticMarkup(
    <ReportingSettings
      view={view}
      canAct={canAct}
      onChanged={() => {
        /* nothing to re-read: the view is the fixture */
      }}
    />,
  );
}

describe("the payload is on the page before anybody consents", () => {
  it("draws the actual bytes above the control that switches sending on", () => {
    const html = markup(OFF);

    const payload = html.indexOf("dash_route_b5870cb47ce4");
    const control = html.indexOf("Add a token");

    expect(payload).toBeGreaterThan(-1);
    expect(control).toBeGreaterThan(-1);
    expect(payload).toBeLessThan(control);
  });

  it("offers no send control at all until a token is held", () => {
    const html = markup(OFF);
    expect(html).not.toContain("Send now");
    expect(html).not.toContain("Start sending");
  });

  it("says nothing rather than drawing an empty box when there is nothing to send", () => {
    // `[]` and "no agent has run" look identical in a code block, and only one
    // of them is true on a DASH whose agents are idle.
    const html = markup({ ...OFF, preview_body: "[]", preview_count: 0 });
    expect(html).toContain(asMarkup("No agent has run since DASH last reported"));
  });

  it("keeps what is in the payload beside the payload", () => {
    const html = markup(OFF);
    for (const line of LAB_TELEMETRY_CONTENTS) {
      expect(html).toContain(asMarkup(line));
    }
  });
});

describe("the receipt says what it is not", () => {
  it("keeps the limiting sentence on the page, in both states", () => {
    const limit = LAB_TELEMETRY_RECEIPT[2] as string;
    expect(markup(OFF)).toContain(asMarkup(limit));
    expect(markup(SENDING)).toContain(asMarkup(limit));
  });

  it("renders a past send's literal body rather than a summary of it", () => {
    const html = markup(SENDING);
    expect(html).toContain("dash_route_b5870cb47ce4");
    expect(html).toContain(asMarkup("LAB took 1 entry."));
  });

  it("says plainly that what was already sent cannot be recalled", () => {
    expect(markup(SENDING)).toContain("cannot take it back");
  });
});

describe("what never reaches the markup", () => {
  it("draws the masked hint's page without the token, because there is no field for one", () => {
    const html = markup({ ...SENDING, masked_hint: "••••CDEF" });
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("LABTOKEN");
  });
});

describe("a read-only window", () => {
  it("disables every control rather than hiding them", () => {
    // `HostNotice` says why they are disabled. Hiding them would leave somebody
    // in a browser tab unable to see that this setting exists at all, which is
    // the wrong direction for the one page about what leaves the machine.
    const html = markup(SENDING, false);
    expect(html).toContain("Send now");
    expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("the page is written in plain language", () => {
  it("has no raw identifier in its prose", () => {
    // The address and the payload are identifiers and belong in an input and a
    // `pre` — so the scan is over the sentences this page composes, which is
    // the standing rule rather than an exemption: `lib/lab/settings.ts` owns
    // every one of them and `tests/lab-telemetry.test.ts` scans that module too.
    expectPlainLanguage([
      OFF.standing_sentence,
      OFF.reach_sentence,
      SENDING.standing_sentence,
      ...LAB_TELEMETRY_CONTENTS,
      ...LAB_TELEMETRY_RECEIPT,
    ]);
  });
});
