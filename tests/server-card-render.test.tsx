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

import { DeployPanel, ServerCard } from "../app/_components/server-card";
import { MANIFEST_ONLY_DEPLOY_REFUSAL } from "../lib/agent-folders";
import { NOTHING_STRANDED } from "../lib/deploy/connection-travel";
import type { DeployStanding } from "../lib/deploy/deploying";
import {
  describeConnectState,
  HOST_REACH_PROBLEMS,
  type HostConnectState,
} from "../lib/host-connect";
import { standingChip } from "../lib/server-card";
import type { AgentDeployChoice, SavedServerView } from "../lib/views/types";

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
  sent: [],
};

const NOTHING = {
  check: () => undefined,
  deploy: () => undefined,
  forget: () => undefined,
  trust: () => undefined,
  setup: () => Promise.resolve(null),
  bringHome: () => undefined,
};

/**
 * The refusal as it reaches the markup (MAR-577).
 *
 * React escapes an apostrophe in a text node, and the constant has two. Derived
 * from the constant rather than typed out, so the assertion still fails if the
 * sentence is reworded anywhere but in `lib/agent-folders.ts`.
 */
const RENDERED_REFUSAL = MANIFEST_ONLY_DEPLOY_REFUSAL.replaceAll("'", "&#x27;");

/** An agent DASH holds a build for, and one it does not (MAR-577). */
const SENDABLE: AgentDeployChoice = {
  name: "News Scout",
  deploy: { deployable: true, refusal: null, travel: NOTHING_STRANDED },
};
const MIGRATED: AgentDeployChoice = {
  name: "Old Scout",
  deploy: {
    deployable: false,
    refusal: MANIFEST_ONLY_DEPLOY_REFUSAL,
    travel: NOTHING_STRANDED,
  },
};

/** Every standing a saved server can be shown in. */
const STANDINGS: HostConnectState[] = [
  { step: "not_checked", label: SERVER.label },
  { step: "probing", label: SERVER.label },
  {

    step: "reachable",

    label: SERVER.label,

    runner_build: "96cef120",

    agents_running: 2,

    agents_there: [{ agent_id: "News Scout", running: true }],

  },
  {
    step: "confirm_host_key",
    label: SERVER.label,
    fingerprint: "SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA",
    key_type: "ssh-ed25519",
    offered_count: 3,
  },
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
  checkedAt: string | null = null,
): string {
  return renderToStaticMarkup(
    <ServerCard
      server={server}
      standing={standing}
      checkedAt={checkedAt}
      agents={[SENDABLE]}
      busy={false}
      notice={notice}
      deploy={null}
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
      agents_there: [{ agent_id: "News Scout", running: true }],
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

  /*
   * MAR-605, and this block replaces an assertion that encoded the defect.
   *
   * It used to read: every problem except `no_runner_there` draws `chip-err`.
   * That assertion is what kept **CANNOT REACH** sitting above *"The server is
   * answering and would not let DASH in"* through the 2026-08-10 attended run —
   * it was green the whole time, because it checked the chip against itself
   * rather than against the sentence beside it.
   */
  it("never claims a reach the sentence beside it contradicts", () => {
    for (const state of everyStanding()) {
      // The load-bearing line: one value, read twice, never decided twice.
      expect(standingChip(state).reach).toBe(describeConnectState(state).reach);
    }
  });

  it("says the server answered, on every standing where it did", () => {
    // The seven problems whose body says something was there. A chip opening
    // with "No answer" on any of them is the original defect returning.
    for (const problem of [
      "host_key_not_trusted",
      "key_not_on_server",
      "sign_in_refused",
      "server_identity_changed",
      "helper_not_installed",
      "no_runner_there",
      "runner_refused_credential",
    ] as const) {
      const chip = standingChip({ step: "unreachable", label: "x", problem });
      expect(chip.label).toMatch(/^(Answering|Signed in), /);
    }
  });

  it("spends the error tone only where something is wrong or unknown", () => {
    /*
     * Red is a budget. `key_not_on_server` and `helper_not_installed` are what
     * a working server looks like before somebody has finished setting it up,
     * and MAR-605's own words are the test: a person reading the chip should
     * conclude they have one step left, not that their network is broken.
     */
    for (const problem of [
      "key_not_on_server",
      "helper_not_installed",
      "no_runner_there",
    ] as const) {
      expect(standingChip({ step: "unreachable", label: "x", problem }).tone).toBe("chip-warn");
    }
    for (const problem of [
      "no_answer_at_address",
      "sign_in_refused",
      "server_identity_changed",
    ] as const) {
      expect(standingChip({ step: "unreachable", label: "x", problem }).tone).toBe("chip-err");
    }
  });

  it("draws a server that answered the check as connected, and only then", () => {
    expect(
      standingChip({
        step: "reachable",
        label: "x",
        runner_build: "96cef12082fe67afa3a6",
        agents_running: 1,
        agents_there: [{ agent_id: "News Scout", running: true }],
      }),
    ).toMatchObject({ label: "Connected", tone: "chip-ok", reach: "connected" });
  });
});

/** Every standing a card can be in, so a chip assertion cannot miss one. */
function everyStanding(): HostConnectState[] {
  return [
    { step: "no_host" },
    { step: "not_checked", label: "x" },
    { step: "probing", label: "x" },
    { step: "awaiting_key_install", label: "x", public_key: "ssh-ed25519 AAAA… dash" },
    {
      step: "confirm_host_key",
      label: "x",
      fingerprint: "SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA",
      key_type: "ssh-ed25519",
      offered_count: 3,
    },
    {

      step: "reachable",

      label: "x",

      runner_build: "96cef12082fe67afa3a6",

      agents_running: 1,

      agents_there: [{ agent_id: "News Scout", running: true }],

    },
    ...HOST_REACH_PROBLEMS.map(
      (problem): HostConnectState => ({ step: "unreachable", label: "x", problem }),
    ),
  ];
}

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
      sent: [],
    });
    expect(html).toContain("Record 2 of 4");
    expect(html).not.toContain("own key");
  });

  it("says nothing about duplicates when there are none", () => {
    expect(card(STANDINGS[0] as HostConnectState)).not.toContain("Record 1 of 1");
  });
});

describe("the deploy panel", () => {
  const panel = (
    agents: AgentDeployChoice[] = [SENDABLE],
    over: {
      chosenAgent?: string;
      deploy?: DeployStanding | null;
      report?: HostConnectState;
      checkedAt?: string | null;
      /** DASH's own record of what it already put on this server (MAR-606). */
      server?: SavedServerView;
    } = {},
  ): string =>
    renderToStaticMarkup(
      <DeployPanel
        server={over.server ?? SERVER}
        agents={agents}
        busy={false}
        canAct
        chosenAgent={over.chosenAgent ?? ""}
        deploy={over.deploy ?? null}
        report={over.report ?? { step: "not_checked", label: SERVER.label }}
        checkedAt={over.checkedAt ?? null}
        onChoose={() => undefined}
        onCancel={() => undefined}
        onDeploy={() => undefined}
        onCheck={() => undefined}
      />,
    );

  /*
   * MAR-606 finding 31, and Henrik's own sentence: *"ONce connected the button
   * should instead say disconnect this agent from the server or something."*
   *
   * Not literally that — ADR 0014 is that DASH cannot start or stop a deployed
   * agent, and a button claiming to would be worse than the stale one. What the
   * surface can honestly change to is what a second press actually does, and
   * what makes sense the moment a push lands.
   */
  describe("what the control offers, after a deploy", () => {
    const SENT_HERE: SavedServerView = {
      ...SERVER,
      sent: [{ agent: SENDABLE.name, sent_at: "2026-08-10T21:00:00Z", sent_on: "10 August 2026" }],
    };

    it("offers to send, the first time", () => {
      const html = panel([SENDABLE], { chosenAgent: SENDABLE.name });
      expect(html).toContain("Put it on this server");
      expect(html).not.toContain("Replace the copy");
    });

    it("offers to replace once DASH has a record of sending it here", () => {
      /*
       * The answer to *"I could put the same agent two times on the server."*
       * The install replaces rather than accumulating, DASH knows that from its
       * own record, and saying so above the control is what stops the second
       * press looking like it makes a second copy.
       */
      const html = panel([SENDABLE], { chosenAgent: SENDABLE.name, server: SENT_HERE });
      expect(html).toContain("Replace the copy on this server");
      expect(html).toContain("rather than adding a second copy");
      expect(html).toContain("10 August 2026");
    });

    it("stops re-offering to send the moment a push has landed", () => {
      // The finding itself. The one thing that can answer the question a person
      // has at that moment is the server, so that is what the primary does.
      const html = panel([SENDABLE], {
        chosenAgent: SENDABLE.name,
        server: SENT_HERE,
        deploy: { step: "sent", agent: SENDABLE.name, server: SERVER.label },
      });
      expect(html).toContain(`Check ${SERVER.label}`);
      expect(html).not.toContain("Put it on this server");
      // Reachable, but no longer the thing being pushed at you.
      expect(html).toContain("Send it again");
      expect(html).toContain("Close");
      expect(html).not.toContain("Not now");
    });

    it("keeps offering to send while a different agent's push is settling", () => {
      // The standing belongs to one agent. Somebody who deploys A and then picks
      // B must be offered B's own state, not A's aftermath.
      const html = panel([SENDABLE, MIGRATED], {
        chosenAgent: MIGRATED.name,
        deploy: { step: "sent", agent: SENDABLE.name, server: SERVER.label },
      });
      expect(html).not.toContain(`Check ${SERVER.label}`);
    });
  });

  it("carries ADR 0007's receipt before the deploy rather than with it", () => {
    /*
     * The while-closed sentence is required *before* the first deploy. This is
     * the second place a deploy can begin, so it is the second place that has to
     * say it — and it says it from the same function the connect flow uses, so
     * neither copy can be softened alone.
     */
    const html = panel();
    expect(html).toContain("Before you put an agent here");
    expect(html).toContain("only show you what the server still has");
    expect(html).toContain("Turning this off in DASH does not stop it");
  });

  it("no longer carries the dead-end bootstrap-gap sentence (MAR-579)", () => {
    // MAR-579 deleted `describeBootstrapGap`: the gap now has a way out (the
    // setup snippet on the card), so the deploy panel no longer describes a
    // gap it cannot close.
    expect(panel()).not.toContain("known gap");
  });

  it("says so plainly when there is no agent to put anywhere", () => {
    expect(panel([])).toContain("no agent here");
  });

  describe("what the chosen agent leaves behind (MAR-591)", () => {
    const STRANDED: AgentDeployChoice = {
      name: "Meeting Assistant",
      deploy: {
        deployable: true,
        refusal: null,
        travel: {
          verdict: "warn",
          stranded: [
            {
              connection_id: "gmail",
              service: "Your Gmail",
              custody: "oauth",
              need: "undeclared",
            },
          ],
        },
      },
    };
    const BLOCKED: AgentDeployChoice = {
      name: "Meeting Assistant",
      deploy: {
        deployable: true,
        refusal: null,
        travel: {
          verdict: "refuse",
          stranded: [
            {
              connection_id: "gmail",
              service: "Your Gmail",
              custody: "oauth",
              need: "run_needs_it",
            },
          ],
        },
      },
    };

    it("says nothing until an agent is chosen", () => {
      // The panel opens on "Choose an agent". A sentence about somebody's Gmail
      // before they have named an agent would be about no agent in particular.
      expect(panel([STRANDED])).not.toContain("Your Gmail");
    });

    it("says it the moment the agent is chosen, from the agent page's component", () => {
      /*
       * `ConnectionTravelNotice` is `app/_components/deploy.tsx`'s, imported
       * here rather than restated — the same arrangement `DeployOutcome` has,
       * and for the same reason: two entry points that worded one consequence
       * twice would be two places it could be softened.
       */
      const html = panel([STRANDED], { chosenAgent: STRANDED.name });
      expect(html).toContain("Your Gmail");
      expect(html).toContain(`stays on this computer`);
    });

    it("stops the deploy when the agent's own file says it needs what stays here", () => {
      const html = panel([BLOCKED], { chosenAgent: BLOCKED.name });
      expect(html).toContain('role="alert"');
      expect(html).toContain(`needs something DASH cannot send to ${SERVER.label}`);
      expect(html).toContain("disabled");
    });

    it("keeps the migrated-agent refusal beside it rather than instead of it", () => {
      /*
       * Two separate things can be wrong with one agent. Showing one would leave
       * the other to be discovered after the first was fixed.
       */
      const both: AgentDeployChoice = {
        name: MIGRATED.name,
        deploy: { ...MIGRATED.deploy, travel: STRANDED.deploy.travel },
      };
      const html = panel([both], { chosenAgent: both.name });
      expect(html).toContain(RENDERED_REFUSAL);
      expect(html).toContain("Your Gmail");
    });
  });
});

describe("the enrollment and setup affordances (MAR-579)", () => {
  it("shows the fingerprint and a Confirm control when the host key is unconfirmed", () => {
    const html = card({
      step: "confirm_host_key",
      label: SERVER.label,
      fingerprint: "SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA",
      key_type: "ssh-ed25519",
      offered_count: 3,
    });
    // The code the person compares, on its own line, and a control to confirm it.
    expect(html).toContain("SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA");
    expect(html).toContain("Yes, this is my server");
    // The honesty ADR 0009 requires: DASH cannot verify this for the person.
    expect(html).toContain("only you can confirm");
  });

  it("offers the setup step when the server is not set up for DASH yet", () => {
    for (const problem of ["helper_not_installed", "key_not_on_server"] as const) {
      const html = card({ step: "unreachable", label: SERVER.label, problem });
      expect(html, problem).toContain("Show the setup text");
    }
  });

  it("does not offer setup on a reachable server or one still to be checked", () => {
    expect(card({ step: "not_checked", label: SERVER.label })).not.toContain("Show the setup text");
    expect(
      card({

        step: "reachable",

        label: SERVER.label,

        runner_build: "96cef120",

        agents_running: 0,

        agents_there: [{ agent_id: "News Scout", running: true }],

      }),
    ).not.toContain("Show the setup text");
  });
});

/* ---------------------------------------------------------------------- *
 * MAR-577
 * ---------------------------------------------------------------------- */

describe("an agent DASH cannot send", () => {
  const panel = (chosenAgent: string): string =>
    renderToStaticMarkup(
      <DeployPanel
        server={SERVER}
        agents={[SENDABLE, MIGRATED]}
        busy={false}
        canAct
        chosenAgent={chosenAgent}
        deploy={null}
        report={{ step: "not_checked", label: SERVER.label }}
        checkedAt={null}
        onChoose={() => undefined}
        onCancel={() => undefined}
        onDeploy={() => undefined}
        onCheck={() => undefined}
      />,
    );

  it("renders MAR-553's own refusal the moment the agent is chosen", () => {
    /*
     * The assertion the issue asks for by name, and it is against the constant
     * rather than against a copy of its words: a sentence reworded in a
     * component is one that stops matching the refusal main will actually give.
     */
    expect(panel(MIGRATED.name)).toContain(RENDERED_REFUSAL);
  });

  it("says nothing about it until that agent is the one chosen", () => {
    expect(panel("")).not.toContain(RENDERED_REFUSAL);
    expect(panel(SENDABLE.name)).not.toContain(RENDERED_REFUSAL);
  });

  it("keeps it in the list rather than filtering it out", () => {
    /*
     * A person's own agent missing from a picker, with nothing said, is a worse
     * answer than the sentence explaining why it cannot go. It is also the
     * failure mode that would make this bug invisible again.
     */
    expect(panel("")).toContain(MIGRATED.name);
  });

  it("stops the deploy rather than letting it be pressed", () => {
    const chosen = panel(MIGRATED.name);
    const sendable = panel(SENDABLE.name);
    expect(chosen).toContain("disabled");
    // The same markup with a deployable agent chosen has a live button, so the
    // assertion above is about the refusal and not about the panel always
    // rendering something disabled.
    expect(sendable).not.toContain("disabled");
  });
});

describe("a deploy while it is happening, and after", () => {
  const withDeploy = (deploy: DeployStanding, report: HostConnectState, checkedAt: string | null): string =>
    renderToStaticMarkup(
      <DeployPanel
        server={SERVER}
        agents={[SENDABLE]}
        busy={deploy.step === "sending"}
        canAct
        chosenAgent={SENDABLE.name}
        deploy={deploy}
        report={report}
        checkedAt={checkedAt}
        onChoose={() => undefined}
        onCancel={() => undefined}
        onDeploy={() => undefined}
        onCheck={() => undefined}
      />,
    );

  const REACHABLE: HostConnectState = {
    step: "reachable",
    label: SERVER.label,
    runner_build: "96cef120",
    agents_running: 1,
    agents_there: [{ agent_id: "News Scout", running: true }],
  };

  it("says what is happening rather than only greying the button out", () => {
    /*
     * Installing a bundle over SSH takes long enough that a control which simply
     * stopped responding reads as a page that has hung — which is how somebody
     * comes to press it twice, or to close DASH mid-push.
     */
    const html = withDeploy(
      { step: "sending", agent: SENDABLE.name, server: SERVER.label },
      { step: "not_checked", label: SERVER.label },
      null,
    );
    expect(html).toContain("Putting News Scout on My server");
    expect(html).toContain("Nothing on this computer changes");
  });

  it("does not report what the server has while the push is still going", () => {
    // The previous check's answer under "putting it there" would be DASH
    // answering the question the person is waiting on with the previous one.
    const html = withDeploy(
      { step: "sending", agent: SENDABLE.name, server: SERVER.label },
      REACHABLE,
      "2026-08-09T14:14:37Z",
    );
    expect(html).not.toContain("The server reported");
  });

  it("reports the server's own answer afterwards, with when it was given", () => {
    const html = withDeploy(
      { step: "sent", agent: SENDABLE.name, server: SERVER.label },
      REACHABLE,
      "2026-08-09T14:14:37Z",
    );
    expect(html).toContain("The server reported 1 agent running");
    expect(html).toContain("keeps no list of its own");
    expect(html).toContain("August 2026");
  });

  it("never says the agent is running there, because DASH has no such record", () => {
    /*
     * The one sentence this surface is most likely to acquire by accident.
     * `host.deploy` pushes a bundle, starts it and stores nothing, so the only
     * account of what is on a server is that server's answer to a check.
     */
    const html = withDeploy(
      { step: "sent", agent: SENDABLE.name, server: SERVER.label },
      REACHABLE,
      "2026-08-09T14:14:37Z",
    );
    expect(html).toContain("DASH keeps no list of what it has put on a server");
    expect(html).not.toContain("is now running on");
  });

  it("sends a failed deploy to the server rather than claiming nothing changed", () => {
    /*
     * Three steps run behind one answer — produce, install, start — and DASH
     * cannot tell which of them stopped. "Nothing was changed on your server" is
     * the reassuring sentence and the one that would be wrong.
     */
    const html = withDeploy(
      {
        step: "failed",
        agent: SENDABLE.name,
        server: SERVER.label,
        detail: MANIFEST_ONLY_DEPLOY_REFUSAL,
      },
      { step: "not_checked", label: SERVER.label },
      null,
    );
    expect(html).toContain(RENDERED_REFUSAL);
    expect(html).toContain("Check My server to see what is on it now");
    expect(html).not.toContain("Nothing was changed");
  });
});

describe("how old the server's answer is", () => {
  it("is stamped on the card beside the count", () => {
    const html = card(
      {

        step: "reachable",

        label: SERVER.label,

        runner_build: "96cef120",

        agents_running: 2,

        agents_there: [{ agent_id: "News Scout", running: true }],

      },
      SERVER,
      null,
      "2026-08-09T14:14:37Z",
    );
    expect(html).toContain("The server reported 2 agents running");
    expect(html).toContain("DASH last asked on");
  });

  it("says nothing about when, before anything has asked", () => {
    // The unchecked standing already says DASH has not looked. A second line
    // saying so in different words is the wall of text this page avoids.
    expect(card({ step: "not_checked", label: SERVER.label })).not.toContain("DASH last asked");
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
        checkedAt={null}
        agents={[]}
        busy={false}
        notice={null}
        deploy={null}
        canAct={false}
        actions={NOTHING}
      />,
    );
    expect(html).toContain("Check this server");
    expect(html).toContain("disabled");
  });
});
