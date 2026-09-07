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

import {
  KeyPlacementCeremony,
  KeysOnThisServer,
  ResidencyOnThisServer,
  SendAnAgentHere,
  ServerCard,
} from "../app/_components/server-card";
import { HOST_READY_AND_EMPTY } from "../lib/copy/host-pack";
import { DeployedCopies } from "../app/settings/servers/page";
import { MANIFEST_ONLY_DEPLOY_REFUSAL } from "../lib/agent-folders";
import { NOTHING_STRANDED } from "../lib/deploy/connection-travel";
import { DEPLOY_LIVES_ON_THE_AGENT } from "../lib/server-card";
import { agentStageHref } from "../app/_data/routes";
import type { DeployStanding } from "../lib/deploy/deploying";
import {
  describeConnectState,
  HOST_REACH_PROBLEMS,
  type HostConnectState,
} from "../lib/host-connect";
import { primaryServerAction, standingChip } from "../lib/server-card";
import { RESIDENCY_COPY } from "../lib/copy/host-residency";
import type { HostServiceReport } from "../lib/deploy/service-unit";
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
  placed_keys: [],
  key_offers: [],
  // MAR-795, ADR 0031. Off, which is every server until somebody presses the
  // switch — and the state this card must draw without inventing a claim.
  residency: { asked_on: null, told_on: null, told_count: null },
};

const NOTHING = {
  check: () => undefined,
  deploy: () => undefined,
  forget: () => undefined,
  trust: () => undefined,
  setup: () => Promise.resolve(null),
  bringHome: () => undefined,
  installKey: () => undefined,
  // MAR-795, ADR 0031. Null is the honest fixture answer: the card must draw
  // itself from DASH's own record before any server has been asked anything.
  // MAR-871 removed `readResidency` — one Check now asks both questions.
  setResidency: () => Promise.resolve(null),
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
  title: "News Scout",
  deploy: { deployable: true, refusal: null, travel: NOTHING_STRANDED },
};
const MIGRATED: AgentDeployChoice = {
  name: "Old Scout",
  title: "Old Scout",
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
      /*
       * MAR-871. Null is the honest fixture answer, and the state every card
       * opens in: the restart section is drawn from what the server said on the
       * one Check, and nothing has checked.
       */
      residency={null}
      /*
       * Two, deliberately. With exactly one sendable agent the card's **Put an
       * agent here** becomes a direct link to it, which is the right behaviour
       * and the wrong fixture for a file whose other assertions are about the
       * chooser — see the block that drives the one-agent case on purpose.
       */
      agents={[SENDABLE, MIGRATED]}
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
    /*
     * MAR-871 split the second half of this assertion in two, and kept what it
     * was protecting. Six situations with six fixes must not look like one
     * shrug — so each card still carries its own way forward. What changed is
     * *where*: where the card's one control performs the fix, the sentence
     * repeating it is gone, because noise directly above the thing a person is
     * meant to press is the worst place to put it.
     */
    for (const problem of HOST_REACH_PROBLEMS) {
      const state = { step: "unreachable", label: SERVER.label, problem } as const;
      const primary = primaryServerAction(state);
      const html = card(state);
      if (primary?.kind === "check") {
        // Nothing on the card installs an SSH client or fixes an address, so
        // the guidance stays a sentence.
        expect(html, problem).toContain("next-action");
      } else {
        expect(html, problem).toContain(primary?.label ?? "");
      }
    }
  });

  /*
   * MAR-871 rewrote this block, and the rewrite is the packet.
   *
   * It used to assert that **every** card offers check, put-an-agent-here and
   * stop-using — which it did, on all fifteen states at once, and that is the
   * defect: five controls of equal weight on a card whose reader wanted to know
   * what to press. The invariant worth keeping is the one the old test's comment
   * names — *"a broken server is what you act on"*, nothing may be a dead end —
   * and it is kept here in its stronger form: every state offers exactly one
   * primary action, and everything that came off the face is still reachable.
   */
  it("gives every state one primary action, and never none", () => {
    for (const standing of STANDINGS) {
      const html = card(standing);
      const primary = primaryServerAction(standing);
      if (standing.step === "probing") {
        // "Checking..." while a check is in flight — the same control, saying
        // what it is doing, which is the brief's rule about nothing moving
        // without saying it did.
        expect(html, standing.step).toContain("Checking...");
        continue;
      }
      expect(primary, standing.step).not.toBeNull();
      expect(html, standing.step).toContain(primary?.label ?? "");
      expect(html, standing.step).toContain("button-primary");
    }
  });

  it("keeps everything that came off the face reachable, in one overflow", () => {
    /*
     * Unfindable is the same as missing. Disconnecting, the setup text and
     * putting a second agent on a machine that has one all still exist — one
     * summary line in, rather than four buttons competing with the one the state
     * is about.
     */
    for (const standing of STANDINGS) {
      const html = card(standing);
      expect(html, standing.step).toContain("More about this server");
      expect(html, standing.step).toContain("Stop using this server");
      expect(html, standing.step).toContain("Put an agent here");
    }
  });

  it("offers the setup text on a server that is already set up", () => {
    /*
     * The attended run's own finding: once a server was enrolled there was **no
     * route back to the setup text at all**. The only way to read it again was
     * to start adding the same machine twice, which lands in the duplicate this
     * page apologises for.
     */
    for (const standing of STANDINGS) {
      // Either wording — the card that is *not* set up says so on its primary
      // control, every other card offers the same recipe from the overflow.
      expect(card(standing), standing.step).toMatch(/Set up this server|Set it up again/u);
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
  it("draws a reachable server with nothing on it as a success, not a warning", () => {
    /*
     * The attended run's own copy calls this *"reachable, with nothing running
     * on it"*, and it is what a machine looks like on the day it is rented.
     * Colouring it red tells somebody their working server is broken — which is
     * what this assertion originally protected, as `not chip-err`.
     *
     * MAR-871 moved it one rung further, on Henrik's ruling. Amber reads as
     * *almost*, and this is the state every freshly enrolled server is in with
     * nothing left for the person to repair: it is the one clear **your server
     * is up**. The one thing left is an invitation, not a fault, and the card
     * draws it as the single primary action.
     */
    const chip = standingChip({ step: "unreachable", label: "x", problem: "no_runner_there" });
    expect(chip.tone).toBe("chip-ok");
    expect(chip.label).toBe("Signed in, ready");
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
    for (const problem of ["key_not_on_server", "helper_not_installed"] as const) {
      expect(standingChip({ step: "unreachable", label: "x", problem }).tone).toBe("chip-warn");
    }
    // MAR-871. `no_runner_there` left this list: there is no step left, so
    // amber would be reporting an absence of work as an outstanding task.
    expect(standingChip({ step: "unreachable", label: "x", problem: "no_runner_there" }).tone).toBe(
      "chip-ok",
    );
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

  it("leads with the setup step when the server is not set up for DASH yet", () => {
    /*
     * MAR-579 asserted the snippet's own button was on the card. MAR-871 put
     * the recipe behind the card's single primary control instead — the run of
     * 2026-09-05 found that a wall of shell script with no sign-in instructions
     * around it is where a novice stops — so what is asserted now is that this
     * state's one control is the way in.
     */
    for (const problem of ["helper_not_installed", "key_not_on_server"] as const) {
      const state = { step: "unreachable", label: SERVER.label, problem } as const;
      expect(primaryServerAction(state)?.kind, problem).toBe("setup");
      expect(card(state), problem).toContain("Set up this server");
    }
  });

  it("still offers it on a server that is already set up, one level in", () => {
    /*
     * The reversal MAR-871 made deliberately, and the reason is on the record:
     * *"no way to re-obtain the setup text for an enrolled server"*. The only
     * route back to it was to start adding the same machine a second time,
     * which lands in the duplicate this page apologises for. It is in the
     * overflow rather than on the face — a working server's card is not about
     * setting it up — and the wording says so.
     */
    for (const standing of [
      { step: "not_checked", label: SERVER.label } as const,
      {
        step: "reachable",
        label: SERVER.label,
        runner_build: "96cef120",
        agents_running: 1,
        agents_there: [{ agent_id: "News Scout", running: true }],
      } as const,
    ]) {
      const html = card(standing);
      expect(html, standing.step).toContain("More about this server");
      expect(html, standing.step).toContain("Set up this server again");
    }
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
        residency={null}
        agents={[]}
        busy={false}
        notice={null}
        canAct={false}
        actions={NOTHING}
      />,
    );
    expect(html).toContain("Check now");
    expect(html).toContain("disabled");
  });
});

/* ---------------------------------------------------------------------- *
 * MAR-642: the card stopped deploying
 * ---------------------------------------------------------------------- */

/**
 * What used to be here, and where it went.
 *
 * Three describe blocks — the deploy panel, an agent DASH cannot send, and a
 * deploy while it is happening — were deleted with this packet rather than
 * rewritten. Every claim in them is still made, by
 * `tests/deploy-render.test.tsx` against `DeployToServerPanel`: ADR 0007's
 * receipt before the deploy, MAR-553's refusal for an agent DASH holds no build
 * for, MAR-591's travel notice, the outcome while it is happening and after,
 * and the read-only window. That file tests the surface that still performs a
 * deploy; this one tests the surface that no longer does.
 */
describe("putting an agent here starts on the agent", () => {
  const list = (agents = [SENDABLE, MIGRATED], canAct = true): string =>
    renderToStaticMarkup(<SendAnAgentHere server={SERVER} agents={agents} canAct={canAct} />);

  it("links each agent into its own settings rather than deploying", () => {
    const html = list();
    // The destination, not an explanation of where the button went. A card that
    // simply lost its control would leave somebody on this page with a working
    // server and nothing to do with it.
    expect(html).toContain(`href="${agentStageHref(SENDABLE.name, "settings").replace("&", "&amp;")}"`);
    expect(html).not.toContain("Put it there");
  });

  it("says why this page no longer asks, once, above the list", () => {
    // Derived from the constant rather than typed out — React escapes the
    // apostrophe, and the assertion must still fail if the sentence is reworded
    // anywhere but in `lib/server-card.ts`.
    expect(list()).toContain(DEPLOY_LIVES_ON_THE_AGENT.replaceAll("'", "&#x27;"));
  });

  /*
   * MAR-871, D8: *"Put an agent here does not put an agent there."*
   *
   * The attended run pressed a primary-styled control reading **Put an agent
   * here** and was answered, in DASH's voice, with a paragraph saying the thing
   * they had just pressed happens somewhere else. The routing decision is
   * unchanged — a deploy begins on the agent, which is MAR-642's ruling and
   * Henrik's — but the words a person meets are now an instruction to finish
   * the act rather than an explanation of why they cannot.
   */
  it("instructs rather than explaining a routing decision", () => {
    const html = list();
    expect(html).toContain("Choose the agent to put here");
    // The row's own control names the act, not the page it lands on.
    expect(html).toContain("Put it here");
    expect(html).not.toContain("Open its settings");
  });

  it("tells two agents with the same name apart", () => {
    /*
     * D4. The run found **Meeting Assistant** listed twice with two different
     * refusal reasons, because two store rows carry a null display name and
     * both resolve to one title from their manifests. A person asked to choose
     * between two identical rows with contradictory explanations has been asked
     * an unanswerable question.
     *
     * The id is drawn as a value in its own element — the rule the fingerprint
     * and the public key are already under here — and only where the names
     * collide, so MAR-589's ruling holds everywhere it still can.
     */
    const twin: AgentDeployChoice = { ...MIGRATED, name: "dash-google-proof", title: SENDABLE.title };
    const html = list([SENDABLE, twin]);
    expect(html).toContain(SENDABLE.name);
    expect(html).toContain("dash-google-proof");
    expect(html).toContain("send-here-id");

    // And says nothing extra when the names are already distinct.
    expect(list([SENDABLE])).not.toContain("send-here-id");
  });

  it("separates a refusal's headline from its detail", () => {
    /*
     * The same run: *"Meeting Assistant cannot be put on a server DASH cannot
     * read what it saved for this agent"*. `describeUndeployable`'s headline
     * ends on a noun with no full stop, so a renderer that ran the two together
     * produced one unreadable sentence. Fixed here rather than by rewording
     * `lib/deploy/deploying.ts`, because it is a layout fault.
     */
    const html = list();
    expect(html).toContain("cannot be put on a server.</strong>");
  });

  it("draws an agent it cannot send with its reason, rather than a link", () => {
    /*
     * `DeployPanel`'s rule, and it matters more here than it did there: a link
     * is an invitation, and inviting somebody to walk to another page to be
     * told no is worse than telling them here.
     */
    const html = list();
    expect(html).toContain(RENDERED_REFUSAL);
    expect(html).not.toContain(`href="${agentStageHref(MIGRATED.name, "settings").replace("&", "&amp;")}"`);
  });

  it("marks the agents DASH has already sent here", () => {
    const sent: SavedServerView = {
      ...SERVER,
      sent: [{ agent: SENDABLE.name, sent_at: "2026-08-12T09:00:00.000Z", sent_on: "12 August 2026" }],
    };
    expect(
      renderToStaticMarkup(<SendAnAgentHere server={sent} agents={[SENDABLE]} canAct />),
    ).toContain("already here");
  });

  it("says which window this is rather than drawing a link that would refuse", () => {
    const html = list([SENDABLE], false);
    expect(html).toContain("Open the installed DASH app");
    expect(html).not.toContain("href=");
  });

  it("says so plainly when there is no agent to send", () => {
    expect(list([])).toContain("There is no agent here to put on a server yet");
  });
});

/**
 * The table at the top of the Servers page (MAR-642).
 *
 * Henrik asked whether a Settings tab should list agents for deployment; the
 * answer recorded on the issue is no new tab, because the Agents page and the
 * Servers page already list agents. What neither answers is *which of my agents
 * are on which machine*, and this is that, in three columns.
 *
 * The assertion that matters is the third column's. `agent_deploys` is bounded
 * by ADR 0010 to DASH's memory of its own outbound act, and a table saying
 * "Running" would be the column that ADR forbids, reached through a renderer
 * instead of a migration.
 */
describe("agents on servers, at the top of the page", () => {
  const SENT: SavedServerView = {
    ...SERVER,
    sent: [
      { agent: "news-scout", sent_at: "2026-08-12T09:00:00.000Z", sent_on: "12 August 2026" },
      { agent: "digest-writer", sent_at: "2026-08-13T09:00:00.000Z", sent_on: null },
    ],
  };

  const table = (servers: SavedServerView[]): string =>
    renderToStaticMarkup(<DeployedCopies servers={servers} />);

  it("draws nothing at all when DASH has deployed nothing", () => {
    // The state nearly every DASH is in. A heading over three empty columns
    // would announce a feature and that the reader has not used it.
    expect(table([SERVER])).toBe("");
  });

  it("has one row per copy, with the agent linking into its own settings", () => {
    const html = table([SENT]);
    expect(html.match(/<tr>/gu)).toHaveLength(3); // the header row and two copies
    expect(html).toContain(agentStageHref("news-scout", "settings").replace("&", "&amp;"));
    expect(html).toContain(SERVER.label);
  });

  it("says DASH sent it, never that it is running", () => {
    const html = table([SENT]);
    expect(html).toContain("DASH sent it on 12 August 2026");
    for (const claim of ["Running", "running", "Live", "Online", "Healthy"]) {
      expect(html, claim).not.toContain(claim);
    }
  });

  it("says so rather than inventing a date it cannot read", () => {
    expect(table([SENT])).toContain("The date DASH recorded cannot be read");
  });

  it("counts what it drew rather than asserting it", () => {
    expect(table([SENT])).toContain("2 agent copies DASH sent, on one server");
  });
});

/* ---------------------------------------------------------------------- *
 * The key-placement ceremony (MAR-794, ADR 0018)
 * ---------------------------------------------------------------------- */

describe("what this server holds of yours", () => {
  const OFFER = {
    agent: "News Scout",
    connection_id: "models",
    service: "Your OpenRouter key",
    need: "a language model",
    already_placed: false,
  };

  it("says the server is ready and empty rather than leaving the section blank", () => {
    /*
     * A blank reads as "nothing to know here", and the thing a person needs to
     * know before they press anything is that this server is holding nothing of
     * theirs. ADR 0018's whole surface argument in one negative assertion.
     */
    const html = renderToStaticMarkup(
      <KeysOnThisServer
        server={SERVER}
        standing={{ step: "not_checked", label: "My server" }}
        busy={false}
        canAct
        onPlace={() => undefined}
      />,
    );
    expect(html).toContain(HOST_READY_AND_EMPTY);
  });

  it("offers a press per key the server could be given, naming the key", () => {
    const html = renderToStaticMarkup(
      <KeysOnThisServer
        server={{ ...SERVER, key_offers: [OFFER] }}
        standing={{ step: "not_checked", label: "My server" }}
        busy={false}
        canAct
        onPlace={() => undefined}
      />,
    );
    expect(html).toContain("Your OpenRouter key");
    expect(html).toContain("<button");
  });

  it("draws the orphan line only once the server itself has said what is installed", () => {
    /*
     * Null is not empty. An unchecked server has told DASH nothing, and a card
     * that announced an orphan on that evidence would be reporting DASH's own
     * silence as a finding — the distinction `describeWhatIsOnHost` draws one
     * section up, kept here because this line asks somebody to rotate a key.
     */
    const withKey = {
      ...SERVER,
      placed_keys: [
        {
          agent: "News Scout",
          connection_id: "models",
          service: "Your OpenRouter key",
          placed_at: "2026-08-25T09:00:00Z",
          placed_on: "25 August 2026",
        },
      ],
    };

    const unchecked = renderToStaticMarkup(
      <KeysOnThisServer
        server={withKey}
        standing={{ step: "not_checked", label: "My server" }}
        busy={false}
        canAct
        onPlace={() => undefined}
      />,
    );
    expect(unchecked).toContain("Your OpenRouter key");
    expect(unchecked).not.toContain("no longer installed here");

    const answered = renderToStaticMarkup(
      <KeysOnThisServer
        server={withKey}
        standing={{
          step: "reachable",
          label: "My server",
          runner_build: "fixture",
          agents_running: 0,
          agents_there: [],
        }}
        busy={false}
        canAct
        onPlace={() => undefined}
      />,
    );
    expect(answered).toContain("no longer installed here");
    expect(answered).toContain("Rotating at the provider");
  });
});

describe("the consent ceremony", () => {
  const OFFER = {
    agent: "News Scout",
    connection_id: "models",
    service: "Your OpenRouter key",
    need: "a language model",
    already_placed: false,
  };

  it("puts the key, the server, the agent and the custody sentence on one frame", () => {
    /*
     * ADR 0018 rule 1: *"The confirm press is unavailable until all three are on
     * screen, together with this sentence."* Asserted over the markup rather
     * than over the copy module, because the failure this guards is a component
     * that renders three of the four.
     */
    const html = renderToStaticMarkup(
      <KeyPlacementCeremony
        server={{ ...SERVER, fingerprint: "SHA256:fixture" }}
        offer={OFFER}
        busy={false}
        onKeep={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(html).toContain("Your OpenRouter key");
    expect(html).toContain("My server");
    expect(html).toContain("example.com");
    expect(html).toContain("SHA256:fixture");
    expect(html).toContain("News Scout");
    expect(html).toContain("a language model");
    expect(html).toContain("not by a keychain");
    expect(html).toContain("rotating at the provider");
  });

  it("names the movement on the button, and does not say Continue or Allow", () => {
    const html = renderToStaticMarkup(
      <KeyPlacementCeremony
        server={SERVER}
        offer={OFFER}
        busy={false}
        onKeep={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(html).toContain("Put this key on My server");
    expect(html).not.toContain(">Continue<");
    expect(html).not.toContain(">Allow<");
  });

  it("says the press is one attempt", () => {
    // *"The press authorises one attempt […] the approval is spent and no
    // automatic retry waits for the host to return."* On the frame, because a
    // person told a press is one attempt reads a failure as a thing that did not
    // happen rather than as a thing that might still.
    const html = renderToStaticMarkup(
      <KeyPlacementCeremony
        server={SERVER}
        offer={OFFER}
        busy={false}
        onKeep={() => undefined}
        onConfirm={() => undefined}
      />,
    );
    expect(html).toContain("nothing is retried on its own");
  });
});

/* ---------------------------------------------------------------------- *
 * MAR-795, ADR 0031: what this server does when it restarts
 * ---------------------------------------------------------------------- */

describe("the residency section", () => {
  function residency(server: SavedServerView, report: HostServiceReport | null = null): string {
    return renderToStaticMarkup(
      <ResidencyOnThisServer
        server={server}
        /*
         * MAR-871. The section no longer asks the server itself — one **Check
         * now** does, and hands the answer here. Null is what every card opens
         * with and is the state most of these assertions are about.
         */
        report={report}
        busy={false}
        canAct
        onSet={() => Promise.resolve(null)}
      />,
    );
  }

  it("says it is off until pressed, before anything is pressed", () => {
    // ADR 0030 decision 4, one machine over: *"off until you turn it on"*, said
    // where a person reads it rather than discovered afterwards.
    const html = residency(SERVER);
    expect(html).toContain("off until you turn it on");
    expect(html).toContain(RESIDENCY_COPY.toggle_on);
  });

  it("draws the off state's own account rather than a blank", () => {
    const html = residency(SERVER);
    for (const line of RESIDENCY_COPY.liveness_off) {
      expect(html).toContain(line);
    }
    // And not the on state's, which would be a claim about a reboot that will
    // not start anything.
    expect(html).not.toContain(RESIDENCY_COPY.liveness_on[0]);
  });

  it("keeps the missed-window and the cannot-spend sentences on the on state", () => {
    /*
     * The two sentences this feature would be judged on. ADR 0029 decision 7 —
     * a window that came round while the machine was down is missed and is not
     * run late — and ADR 0029 amendment 1's fourth sentence one machine over: a
     * scheduled run on a server starts and publishes and cannot reach a model,
     * because the host broker's allowance is opened by a Run press and nobody
     * pressed anything.
     */
    const html = residency({
      ...SERVER,
      residency: { asked_on: "25 August 2026", told_on: null, told_count: null },
    });
    expect(html).toMatch(/still missed/i);
    expect(html).toMatch(/cannot reach your model/i);
  });

  it("says when DASH last told this server, and says never when it never has", () => {
    expect(residency(SERVER)).toMatch(/not told this server/i);
    const told = residency({
      ...SERVER,
      residency: { asked_on: "25 August 2026", told_on: "25 August 2026", told_count: 2 },
    });
    expect(told).toContain("2 scheduled times");
  });

  it("draws no removal instructions before the server has named its entries", () => {
    // The lines are built from names the server gave. A card that guessed them
    // would be handing somebody commands for files that may not exist.
    const html = residency({
      ...SERVER,
      residency: { asked_on: "25 August 2026", told_on: null, told_count: null },
    });
    expect(html).not.toContain(RESIDENCY_COPY.removal_label);
  });

  /* ------------------------------------------------------------------ *
   * MAR-871: one switch, one honesty sentence
   * ------------------------------------------------------------------ */

  it("has one control, and it is the switch", () => {
    /*
     * The section shipped with two — **Ask the server** and **Turn on** — and
     * the first of them was a second refresh on a card that already had
     * **Check this server**. Both signed in; a person had to know which one
     * asked which question before pressing either.
     */
    const html = residency(SERVER);
    expect(html).not.toContain("Ask the server");
    expect(html.match(/<button/gu) ?? []).toHaveLength(1);
  });

  it("says DASH has not asked, rather than drawing its own record as the machine's answer", () => {
    /*
     * The load-bearing honesty of one switch. `asked_on` is a row in DASH's
     * store and stays true with the server asleep — somebody can switch this
     * off on the machine itself and DASH's record would go on saying on. So
     * until a check has asked, the section says exactly that.
     */
    const html = residency({
      ...SERVER,
      residency: { asked_on: "25 August 2026", told_on: null, told_count: null },
    });
    expect(html).toContain(RESIDENCY_COPY.not_asked);
  });

  it("says the server's own answer once there is one, and stops guessing", () => {
    const html = residency(
      { ...SERVER, residency: { asked_on: "25 August 2026", told_on: null, told_count: null } },
      { state: "enabled", starts_at_boot: true, units: ["orchestratedash-news.service"] },
    );
    expect(html).toContain("This server starts your agents when it reboots.");
    expect(html).not.toContain(RESIDENCY_COPY.not_asked);
    // And the operator's escape hatch, now that the server has named the entry.
    expect(html).toContain(RESIDENCY_COPY.removal_label);
  });

  it("draws linger being refused as the server's answer, not as DASH's inference", () => {
    /*
     * ADR 0030 decision 2, one machine over, and the sentence MAR-865's own
     * note is about: an entry that exists is not the same fact as an account
     * whose programs run with nobody signed in. Reporting `enabled` without the
     * second would draw *On* over a reboot that does nothing.
     */
    const html = residency(
      { ...SERVER, residency: { asked_on: "25 August 2026", told_on: null, told_count: null } },
      { state: "enabled", starts_at_boot: false, units: [] },
    );
    expect(html).toContain("will only start your agents when somebody signs in");
  });
});
