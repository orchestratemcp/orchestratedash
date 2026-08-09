/**
 * The saved-server card, rendered in every standing it has (MAR-574).
 *
 * `tests/server-card.test.ts` drives the sentences. This drives the card that
 * shows them, and it is the more durable half of the issue's screenshot bar:
 * a photograph proves a state was drawn once on one machine, this proves each
 * one is still drawn on every run.
 *
 * The two load-bearing assertions are negatives, and both are about not
 * frightening somebody whose server is fine. A reachable server with nothing on
 * it must not be drawn in the error tone — that is what a freshly rented machine
 * looks like — and a card must never say a server is unreachable before anything
 * has asked it.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DeployPanel, ServerCard, standingChip } from "../app/_components/server-card";
import { HOST_REACH_PROBLEMS, type HostConnectState } from "../lib/host-connect";
import type { SavedServerView } from "../lib/views/types";

const SERVER: SavedServerView = {
  host_id: "host-1",
  label: "My server",
  address: "example.com",
  username: "root",
  port: 22,
  added_at: "2026-08-08T14:14:37Z",
  fingerprint: null,
  same_server_index: 1,
  same_server_count: 1,
};

const NOTHING = {
  check: () => undefined,
  deploy: () => undefined,
  forget: () => undefined,
};

/** Every standing a saved server can be shown in. */
const STANDINGS: HostConnectState[] = [
  { step: "not_checked", label: SERVER.label },
  { step: "probing", label: SERVER.label },
  { step: "reachable", label: SERVER.label, runner_build: "96cef120", agents_running: 2 },
  ...HOST_REACH_PROBLEMS.map((problem): HostConnectState => ({
    step: "unreachable",
    label: SERVER.label,
    problem,
  })),
];

function card(
  standing: HostConnectState,
  server: SavedServerView = SERVER,
  notice: string | null = null,
): string {
  return renderToStaticMarkup(
    <ServerCard
      server={server}
      standing={standing}
      agents={["News Scout"]}
      busy={false}
      notice={notice}
      canAct
      actions={NOTHING}
    />,
  );
}

describe("the card, in every standing", () => {
  it("draws each one with a headline, the facts and what to do about it", () => {
    for (const standing of STANDINGS) {
      const html = card(standing);
      expect(html.length, standing.step).toBeGreaterThan(0);
      expect(html, standing.step).toContain("<strong>");
      // The connection facts are on every card, whatever the standing: they are
      // what a person checks against their provider's own page, and they do not
      // stop being true because a check failed.
      expect(html, standing.step).toContain("example.com");
      expect(html, standing.step).toContain("August 2026");
    }
  });

  it("keeps the six unreachable problems six different cards", () => {
    /*
     * `lib/host-connect.ts` asserts the six sentences are distinct and the
     * wizard's own render test asserts the check step keeps them so. This is the
     * third surface, and the failure it guards is a renderer that dropped
     * `next_action` and left six situations with six fixes looking like one
     * shrug.
     */
    const rendered = HOST_REACH_PROBLEMS.map((problem) =>
      card({ step: "unreachable", label: SERVER.label, problem }),
    );
    expect(new Set(rendered).size).toBe(HOST_REACH_PROBLEMS.length);
    for (const html of rendered) {
      expect(html).toContain("next-action");
    }
  });

  it("offers every action on every card, because a broken server is what you act on", () => {
    // The one that would fail if "check" were hidden behind a working state.
    // Somebody whose server cannot be reached is the person most likely to press
    // it, and a card that offered nothing would be a dead end.
    for (const standing of STANDINGS) {
      const html = card(standing);
      // "Checking..." while a check is in flight — the same control, saying
      // what it is doing, which is the brief's rule about nothing moving
      // without saying it did.
      expect(html, standing.step).toContain(
        standing.step === "probing" ? "Checking..." : "Check this server",
      );
      expect(html, standing.step).toContain("Put an agent here");
      expect(html, standing.step).toContain("Stop using this server");
    }
  });
});

describe("what is on the server", () => {
  it("is on every card that has been checked, attributed to the server", () => {
    const html = card({
      step: "reachable",
      label: SERVER.label,
      runner_build: "96cef120",
      agents_running: 2,
    });
    expect(html).toContain("The server reported 2 agents running");
    expect(html).toContain("keeps no list of its own");
  });

  it("is absent before anything has been checked, because the standing said it", () => {
    /*
     * Found by rendering five cards down a page: the unchecked standing already
     * says DASH has not looked, and a second sentence saying so in different
     * words is the wall of text this page is trying not to be.
     */
    expect(card({ step: "not_checked", label: SERVER.label })).not.toContain(
      "keeps no list of its own",
    );
  });
});

describe("the standing at a glance", () => {
  it("never draws a reachable server with nothing on it as an error", () => {
    /*
     * The attended run's own copy calls this *"reachable, with nothing running
     * on it"*, and it is what a machine looks like on the day it is rented.
     * Colouring it red tells somebody their working server is broken.
     */
    expect(standingChip({ step: "unreachable", label: "x", problem: "no_runner_there" }).tone).toBe(
      "chip-warn",
    );
  });

  it("draws a server nobody has checked as unknown rather than as broken", () => {
    const chip = standingChip({ step: "not_checked", label: "x" });
    expect(chip.tone).toBe("chip-muted");
    expect(chip.label).toBe("Not checked");
  });

  it("draws the states DASH could not reach in the error tone", () => {
    for (const problem of HOST_REACH_PROBLEMS.filter((one) => one !== "no_runner_there")) {
      expect(standingChip({ step: "unreachable", label: "x", problem }).tone).toBe("chip-err");
    }
  });
});

describe("the pinned identity, which is null on every real record", () => {
  it("says there is no record rather than omitting the section", () => {
    // MAR-572. A page that silently left this out would be omitting the one
    // fact a person would want before trusting a machine.
    expect(card(STANDINGS[0] as HostConnectState)).toContain("not recorded");
  });

  it("draws the fingerprint as a value once there is one, never inside a sentence", () => {
    const fingerprint = "SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA";
    const html = card(STANDINGS[0] as HostConnectState, { ...SERVER, fingerprint });
    expect(html).toContain(fingerprint);
    expect(html).toContain("public-key");
  });
});

describe("the four rows on a real machine", () => {
  it("says which of them this is, and leaves the explanation to the page", () => {
    /*
     * Found by rendering it: four cards each carrying the same three-sentence
     * explanation is a wall of repeated text where the reader needed one fact
     * per card. The card says which; `DuplicateNotice` on the page says why.
     */
    const html = card(STANDINGS[0] as HostConnectState, {
      ...SERVER,
      same_server_index: 2,
      same_server_count: 4,
    });
    expect(html).toContain("Record 2 of 4");
    expect(html).not.toContain("own key");
  });

  it("says nothing about duplicates when there are none", () => {
    expect(card(STANDINGS[0] as HostConnectState)).not.toContain("Record 1 of 1");
  });
});

describe("the deploy panel", () => {
  const panel = (bootstrapGap: boolean, agents: string[] = ["News Scout"]): string =>
    renderToStaticMarkup(
      <DeployPanel
        server={SERVER}
        agents={agents}
        busy={false}
        canAct
        chosenAgent=""
        bootstrapGap={bootstrapGap}
        onChoose={() => undefined}
        onCancel={() => undefined}
        onDeploy={() => undefined}
      />,
    );

  it("carries ADR 0007's receipt before the deploy rather than with it", () => {
    /*
     * The while-closed sentence is required *before* the first deploy. This is
     * the second place a deploy can begin, so it is the second place that has to
     * say it — and it says it from the same function the connect flow uses, so
     * neither copy can be softened alone.
     */
    const html = panel(false);
    expect(html).toContain("Before you put an agent here");
    expect(html).toContain("only show you what the server still has");
    expect(html).toContain("Turning this off in DASH does not stop it");
  });

  it("warns about the bootstrap only on a server that answered with nothing on it", () => {
    // MAR-573. On a prepared server the action works — Henrik's was, by hand —
    // so this is a sentence rather than a disabled button, and it appears where
    // it is true rather than on every card.
    expect(panel(true)).toContain("known gap");
    expect(panel(false)).not.toContain("known gap");
  });

  it("says so plainly when there is no agent to put anywhere", () => {
    expect(panel(false, [])).toContain("no agent here");
  });
});

describe("a window that cannot act", () => {
  it("disables the actions rather than hiding them", () => {
    /*
     * The browser tab renders this page and cannot command anything. Hiding the
     * controls would make the two hosts look like two different products; a
     * disabled control plus the page's own notice says which window you are in.
     */
    const html = renderToStaticMarkup(
      <ServerCard
        server={SERVER}
        standing={{ step: "not_checked", label: SERVER.label }}
        agents={[]}
        busy={false}
        notice={null}
        canAct={false}
        actions={NOTHING}
      />,
    );
    expect(html).toContain("Check this server");
    expect(html).toContain("disabled");
  });
});
