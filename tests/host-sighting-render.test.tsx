/**
 * Where an agent runs, drawn (MAR-606).
 *
 * `tests/host-sighting.test.ts` proves the sentences. This proves the half a
 * reader meets — that the moment is on the screen beside the colour, and that a
 * card which has never been checked says so rather than going blank.
 *
 * The chip assertions read the **document**, never `innerText`. `app/globals.css`
 * uppercases `.chip` as typography, so a harness that grepped the rendered text
 * for "seen running" would read false while the chip was in the picture. What a
 * screen reader announces is what is written here.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentHosting } from "../app/page";
import { WhatIsOnThisServer } from "../app/_components/server-card";
import { describeWhatIsOnHost } from "../lib/host-sighting";
import { createSightingStore } from "../lib/host-sightings";
import type { AgentHostedOnView } from "../lib/views/types";

const AGENT = "News Scout";
const SERVER = "Hostinger";
const AT = "2026-08-10T21:14:37Z";
const SENT_ON = "10 August 2026";
const HOSTED: AgentHostedOnView[] = [{ host_id: "host-1", label: SERVER, sent_on: SENT_ON }];

function fleet(hostedOn: AgentHostedOnView[], log = {}): string {
  return renderToStaticMarkup(<AgentHosting agent={AGENT} hostedOn={hostedOn} log={log} />);
}

describe("the fleet card's hosting indicator", () => {
  it("draws nothing at all for an agent that runs on this computer", () => {
    // Not an empty frame and not a placeholder. Almost every agent is in this
    // state and a card full of "not deployed" would be noise on every row.
    expect(fleet([])).toBe("");
  });

  it("names the server before any check, rather than going blank", () => {
    const html = fleet(HOSTED);
    expect(html).toContain(`sent to ${SERVER}`);
    expect(html).toContain("chip-muted");
    expect(html).toContain("has not asked");
  });

  it("carries the moment beside the colour once a check has answered", () => {
    /*
     * ADR 0015's bound, at the surface. The emerald chip is licensed by the
     * sentence under it; a card that drew the colour and dropped the timestamp
     * would be making the present-tense claim the ADR forbids.
     */
    const store = createSightingStore();
    store.record("host-1", {
      label: SERVER,
      agents: [{ agent_id: AGENT, running: true }],
      at: AT,
    });
    const html = fleet(HOSTED, store.snapshot());
    expect(html).toContain(`seen running on ${SERVER}`);
    expect(html).toContain("chip-ok");
    expect(html).toContain("when DASH asked on");
    expect(html).not.toContain("is running");
  });

  it("says so when the server answered and did not name this agent", () => {
    const store = createSightingStore();
    store.record("host-1", { label: SERVER, agents: [], at: AT });
    const html = fleet(HOSTED, store.snapshot());
    expect(html).toContain(`not on ${SERVER}`);
    expect(html).toContain("chip-warn");
  });

  it("points at the Servers page when an agent is on more than one", () => {
    // One line has room for one server. The page that lists them all is named
    // rather than the card silently choosing.
    const html = fleet([...HOSTED, { host_id: "host-2", label: "Second", sent_on: SENT_ON }]);
    expect(html).toContain("2 servers");
    expect(html).toContain("Servers page");
  });
});

describe("what is on this server, drawn", () => {
  const rows = (seen: Parameters<typeof describeWhatIsOnHost>[0]["seen"], at: string | null) =>
    describeWhatIsOnHost({
      server: SERVER,
      seen,
      sent: [{ agent: AGENT, sent_on: SENT_ON }],
      at,
    });

  it("names every agent and gives each its own moment", () => {
    const html = renderToStaticMarkup(
      <WhatIsOnThisServer rows={rows([{ agent_id: AGENT, running: true }], AT)} />,
    );
    expect(html).toContain(AGENT);
    expect(html).toContain("seen running");
    expect(html).toContain("when DASH asked on");
  });

  it("lists an agent DASH sent even before anything has asked the machine", () => {
    /*
     * The state the card opens in. A section that appeared only after a check
     * would leave the page silent about what DASH itself had done — which is the
     * one account it is entitled to give without asking anybody.
     */
    const html = renderToStaticMarkup(<WhatIsOnThisServer rows={rows(null, null)} />);
    expect(html).toContain(AGENT);
    expect(html).toContain("Check this server");
    expect(html).toContain("has not asked");
  });

  it("never claims a count of running agents it did not observe", () => {
    const html = renderToStaticMarkup(<WhatIsOnThisServer rows={rows([], AT)} />);
    expect(html).toContain("named nothing as running");
    expect(html).toContain("when DASH last asked");
  });
});
