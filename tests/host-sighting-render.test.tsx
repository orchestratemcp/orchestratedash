/**
 * Where an agent runs, drawn (MAR-606).
 *
 * `tests/host-sighting.test.ts` proves the sentences, including
 * `describeAgentHosting`'s — a fleet-card-shaped indicator that still exists
 * as a pure, tested function. What it no longer has, since MAR-669, is a
 * caller: `AgentHosting`, the component that rendered it, lived inside the
 * chief band's per-agent line, and Henrik asked that line removed entirely.
 * Deleting the component deleted its render test with it. This file keeps
 * only what still renders — the Servers page's `WhatIsOnThisServer`, proving
 * the half a reader meets there: that the moment is on the screen beside the
 * colour, and that a card which has never been checked says so rather than
 * going blank.
 *
 * The chip assertions read the **document**, never `innerText`. `app/globals.css`
 * uppercases `.chip` as typography, so a harness that grepped the rendered text
 * for "seen running" would read false while the chip was in the picture. What a
 * screen reader announces is what is written here.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WhatIsOnThisServer } from "../app/_components/server-card";
import { describeWhatIsOnHost } from "../lib/host-sighting";

const AGENT = "News Scout";
const SERVER = "Hostinger";
const AT = "2026-08-10T21:14:37Z";
const SENT_ON = "10 August 2026";

describe("what is on this server, drawn", () => {
  const rows = (seen: Parameters<typeof describeWhatIsOnHost>[0]["seen"], at: string | null) =>
    describeWhatIsOnHost({
      server: SERVER,
      seen,
      sent: [{ agent: AGENT, sent_on: SENT_ON }],
      at,
    });

  /** No row is offered the bring-home button unless a test says otherwise. */
  const noBringHome = { knownLocally: new Set<string>(), busy: false, canAct: true, onBringHome: () => undefined };

  it("names every agent and gives each its own moment", () => {
    const html = renderToStaticMarkup(
      <WhatIsOnThisServer rows={rows([{ agent_id: AGENT, running: true }], AT)} {...noBringHome} />,
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
    const html = renderToStaticMarkup(
      <WhatIsOnThisServer rows={rows(null, null)} {...noBringHome} />,
    );
    expect(html).toContain(AGENT);
    expect(html).toContain("Check this server");
    expect(html).toContain("has not asked");
  });

  it("never claims a count of running agents it did not observe", () => {
    const html = renderToStaticMarkup(<WhatIsOnThisServer rows={rows([], AT)} {...noBringHome} />);
    expect(html).toContain("named nothing as running");
    expect(html).toContain("when DASH last asked");
  });

  it("offers to bring home only an agent DASH still holds locally (MAR-611, ADR 0017)", () => {
    const html = renderToStaticMarkup(
      <WhatIsOnThisServer
        rows={rows([{ agent_id: AGENT, running: true }], AT)}
        knownLocally={new Set([AGENT])}
        busy={false}
        canAct
        onBringHome={() => undefined}
      />,
    );
    expect(html).toContain("Bring it home");
  });

  it("does not offer to bring home an agent DASH does not hold locally", () => {
    const html = renderToStaticMarkup(
      <WhatIsOnThisServer
        rows={rows([{ agent_id: AGENT, running: true }], AT)}
        {...noBringHome}
      />,
    );
    expect(html).not.toContain("Bring it home");
  });
});
