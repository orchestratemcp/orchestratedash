/**
 * "Run this agent on your server", drawn in every state it has (MAR-577).
 *
 * The agent-side entry point the issue named and nothing implemented. The
 * server card asks *which agent goes on this machine*; this asks *which machine
 * this agent goes on*, from the page a person is already on when they decide it.
 *
 * `tests/deploying.test.ts` drives the sentences. This drives the section that
 * shows them, and the assertions that matter are the ones about what is offered:
 * an agent DASH cannot send is given the refusal and **no control**, and a
 * person with no server is told nothing is missing rather than sold hosting.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DeployOutcome, DeployToServerPanel } from "../app/_components/deploy";
import { MANIFEST_ONLY_DEPLOY_REFUSAL } from "../lib/agent-folders";
import {
  NOTHING_STRANDED,
  type ConnectionTravel,
} from "../lib/deploy/connection-travel";
import type { DeployStanding } from "../lib/deploy/deploying";
import type { HostConnectState } from "../lib/host-connect";
import type {
  AgentDeployTarget,
  AgentDeployView,
  SavedServerView,
} from "../lib/views/types";

const TITLE = "News Scout";

/**
 * The refusal as it reaches the markup.
 *
 * React escapes an apostrophe in a text node, and the constant has two. Derived
 * from the constant rather than typed out, so the assertion still fails if the
 * sentence is reworded anywhere but in `lib/agent-folders.ts`.
 */
const RENDERED_REFUSAL = MANIFEST_ONLY_DEPLOY_REFUSAL.replaceAll("'", "&#x27;");

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

const SECOND: SavedServerView = { ...SERVER, host_id: "host-2", label: "The spare" };

const SENDABLE: AgentDeployView = {
  deployable: true,
  refusal: null,
  travel: NOTHING_STRANDED,
};
const MIGRATED: AgentDeployView = {
  deployable: false,
  refusal: MANIFEST_ONLY_DEPLOY_REFUSAL,
  travel: NOTHING_STRANDED,
};

function panel(
  over: {
    deploy?: AgentDeployView;
    servers?: readonly SavedServerView[];
    /** MAR-584. Empty by default: almost no agent has ever been pushed. */
    targets?: readonly AgentDeployTarget[];
    chosenHost?: string;
    standing?: DeployStanding | null;
    report?: HostConnectState | null;
    checkedAt?: string | null;
    busy?: boolean;
    canAct?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    <DeployToServerPanel
      title={TITLE}
      deploy={over.deploy ?? SENDABLE}
      servers={over.servers ?? [SERVER]}
      targets={over.targets ?? []}
      chosenHost={over.chosenHost ?? SERVER.host_id}
      standing={over.standing ?? null}
      report={over.report ?? null}
      checkedAt={over.checkedAt ?? null}
      busy={over.busy ?? false}
      canAct={over.canAct ?? true}
      onChoose={() => undefined}
      onDeploy={() => undefined}
      onSendAgain={() => undefined}
    />,
  );
}

describe("the entry point itself", () => {
  it("exists, named for what a person wants rather than for the mechanism", () => {
    // The issue's own words. "Deploy" is what the command is called; this is
    // what the person is trying to do.
    expect(panel()).toContain("Run this agent on your server");
  });

  it("names the agent and the server on the button, not just the verb", () => {
    // A page can hold two controls that both read "Deploy". This one says what
    // it is about to do to which machine.
    expect(panel()).toContain(`Put ${TITLE} on ${SERVER.label}`);
  });
});

describe("ADR 0007's receipt, before the deploy", () => {
  it("says the three limits and the revocation, from the shared function", () => {
    /*
     * The while-closed sentence is required *before* the first deploy, and this
     * is now a third place one can begin. It comes from `describeDeployReceipt`,
     * so the connect flow, the server card and this cannot soften it apart.
     */
    const html = panel();
    expect(html).toContain("DASH does not hold its sign-ins");
    expect(html).toContain("only show you what the server still has");
    expect(html).toContain("Turning this off in DASH does not stop it");
    expect(html).toContain("stop it on My server");
  });

  it("names the agent in it, which the other two surfaces cannot", () => {
    // `describeDeployReceipt`'s whole reason for existing beside the unnamed
    // one: here the agent is already chosen, so the first line can say so.
    expect(panel()).toContain(`${TITLE} will be copied to ${SERVER.label}`);
  });
});

describe("an agent DASH holds no build for", () => {
  const html = panel({ deploy: MIGRATED });

  it("renders MAR-553's own refusal", () => {
    /*
     * The second of the issue's two entry points, asserted against the constant
     * rather than a copy of its words. On this page the agent is already chosen,
     * so the refusal is the section's whole content rather than a reaction to a
     * dropdown.
     */
    expect(html).toContain(RENDERED_REFUSAL);
  });

  it("offers no control at all rather than a disabled one", () => {
    /*
     * `lib/workspace.ts`'s rule about dead controls, and sharper here: a greyed
     * out picker of *servers* puts the reason next to a control about servers,
     * where it reads as a claim that the server is the problem.
     */
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<select");
  });
});

describe("somebody with no server", () => {
  const html = panel({ servers: [] });

  it("says the agent already runs on this computer, first", () => {
    // Hosting must never read as required. It is not: agents run here and
    // always have.
    expect(html).toContain("runs on this computer");
    expect(html).toContain("nothing is missing");
  });

  it("points at the Servers page rather than dead-ending", () => {
    expect(html).toContain('href="/hosts"');
    expect(html).toContain("Connect a server");
  });
});

describe("which machine", () => {
  it("asks nothing when there is one server, because there is no choice to make", () => {
    // A select holding one option is a control that cannot do anything.
    expect(panel()).not.toContain("<select");
    // …and the machine is still named, so nobody deploys to a server they
    // cannot identify.
    expect(panel()).toContain("DASH signs in to example.com as root");
  });

  it("offers the choice once there is more than one", () => {
    const html = panel({ servers: [SERVER, SECOND] });
    expect(html).toContain("<select");
    expect(html).toContain(SECOND.label);
  });

  it("tells duplicate records of one machine apart", () => {
    /*
     * Henrik's store holds four rows for one box (MAR-574), all carrying one
     * label. A picker offering "My server" four times is a picker nobody can
     * choose from.
     */
    const html = panel({
      servers: [
        { ...SERVER, same_server_index: 1, same_server_count: 2 },
        { ...SERVER, host_id: "host-2", same_server_index: 2, same_server_count: 2 },
      ],
    });
    expect(html).toContain("record 1 of 2");
    expect(html).toContain("record 2 of 2");
  });
});

describe("what stays on this computer (MAR-591)", () => {
  /** One brokered sign-in DASH holds, with the agent's file silent about it. */
  const WARNED: ConnectionTravel = {
    verdict: "warn",
    stranded: [
      { connection_id: "gmail", service: "Your Gmail", custody: "oauth", need: "undeclared" },
    ],
  };
  /** The same connection, on an agent whose file says it needs it. */
  const REFUSED: ConnectionTravel = {
    verdict: "refuse",
    stranded: [
      { connection_id: "gmail", service: "Your Gmail", custody: "oauth", need: "run_needs_it" },
    ],
  };

  it("says it before the press, not after", () => {
    /*
     * ADR 0002 amendment 2's rule, which is the whole shape of this issue: a
     * disclosure that arrives after the grant describes a window the person was
     * already inside. Before MAR-591 the only account of a stranded connection
     * was the producer's refusal, which arrives *after* the button.
     */
    const html = panel({ deploy: { ...SENDABLE, travel: WARNED } });
    expect(html).toContain("Your Gmail");
    expect(html).toContain("DASH does the signing in for these");
    expect(html.indexOf("Your Gmail")).toBeLessThan(html.indexOf(`Put ${TITLE} on`));
  });

  it("leaves the button pressable on a warning and says what it will be like", () => {
    // DASH does not decide which of a person's connections matter. The file did
    // not say a run needs this, so the deploy is theirs to make.
    const html = panel({ deploy: { ...SENDABLE, travel: WARNED } });
    expect(html).toContain("anyway");
    expect(html).not.toContain("disabled");
  });

  it("disables the button on a refusal, with the reason directly above it", () => {
    /*
     * Disabled rather than hidden, unlike the migrated-agent case: that agent
     * has no program and the picker itself is wrong, while this one is sendable
     * and it is *this server* it cannot usefully go to.
     */
    const html = panel({ deploy: { ...SENDABLE, travel: REFUSED } });
    expect(html).toContain("disabled");
    expect(html).toContain('role="alert"');
    expect(html).toContain("needs something DASH cannot send");
  });

  it("says nothing at all for an agent DASH holds nothing for", () => {
    // Which is almost every agent. A section that drew an empty reassurance
    // would be inventing a problem in front of somebody who has none.
    expect(panel()).not.toContain("stays on this computer");
  });

  it("says what is missing from a copy it already sent", () => {
    /*
     * MAR-584's row says DASH put this agent there. This says what DASH did not
     * put there — a second fact about DASH's own act, not a claim about the
     * server.
     */
    const html = panel({
      deploy: { ...SENDABLE, travel: WARNED },
      targets: [
        {
          host_id: SERVER.host_id,
          label: SERVER.label,
          sent_at: "2026-08-09T14:14:37Z",
          sent_on: "9 August",
          comparable: true,
          behind: false,
        },
      ],
    });
    expect(html).toContain(`The copy on ${SERVER.label} does not have Your Gmail`);
  });
});

describe("a window that cannot act", () => {
  it("says which window it is rather than drawing a dead button", () => {
    /*
     * A greyed-out deploy on an agent's page reads as "this agent cannot be
     * deployed", which is a claim about the agent. The true statement is about
     * the browser tab.
     */
    const html = panel({ canAct: false });
    expect(html).not.toContain("<button");
    expect(html).toContain("Open the installed DASH app");
  });
});

describe("the outcome, which both entry points share", () => {
  const outcome = (
    standing: DeployStanding,
    report: HostConnectState | null,
    checkedAt: string | null,
  ): string =>
    renderToStaticMarkup(
      <DeployOutcome standing={standing} report={report} checkedAt={checkedAt} />,
    );

  const REACHABLE: HostConnectState = {
    step: "reachable",
    label: SERVER.label,
    runner_build: "96cef120",
    agents_running: 1,
  };

  it("announces a failure and stays polite about progress", () => {
    /*
     * A deploy that finished while somebody was reading further down the page is
     * exactly the movement the brief's "nothing moves without saying it did"
     * rule is about — and a failure is the one that has to interrupt.
     */
    expect(outcome({ step: "failed", agent: TITLE, server: SERVER.label, detail: "no" }, null, null))
      .toContain('role="alert"');
    expect(outcome({ step: "sending", agent: TITLE, server: SERVER.label }, null, null)).toContain(
      'aria-live="polite"',
    );
  });

  it("renders the server's own answer only once the deploy finished", () => {
    const sending = outcome(
      { step: "sending", agent: TITLE, server: SERVER.label },
      REACHABLE,
      "2026-08-09T14:14:37Z",
    );
    const sent = outcome(
      { step: "sent", agent: TITLE, server: SERVER.label },
      REACHABLE,
      "2026-08-09T14:14:37Z",
    );
    expect(sending).not.toContain("The server reported");
    expect(sent).toContain("The server reported 1 agent running");
  });

  it("stamps that answer with when it was given", () => {
    /*
     * A count with no moment on it keeps looking true after it stops being true,
     * which is the failure the whole Servers surface was built against.
     */
    expect(
      outcome(
        { step: "sent", agent: TITLE, server: SERVER.label },
        REACHABLE,
        "2026-08-09T14:14:37Z",
      ),
    ).toContain("DASH last asked on");
  });
});

describe("servers this agent has already been sent to (MAR-584, ADR 0010)", () => {
  const BEHIND: AgentDeployTarget = {
    host_id: SERVER.host_id,
    label: SERVER.label,
    sent_at: "2026-08-07T09:00:00.000Z",
    sent_on: "7 August",
    comparable: true,
    behind: true,
  };

  it("draws nothing for an agent DASH has never sent anywhere", () => {
    // Which is almost every agent. An empty block with a heading would be DASH
    // telling somebody about a thing they have not done.
    expect(panel()).not.toContain("Servers you have sent this agent to");
  });

  it("says what DASH sent and when, and offers to send again", () => {
    const markup = panel({ targets: [BEHIND] });
    expect(markup).toContain("Servers you have sent this agent to");
    expect(markup).toContain("DASH sent this agent to My server on 7 August.");
    expect(markup).toContain("Send this agent to My server again");
  });

  it("never claims the agent is running there", () => {
    /*
     * ADR 0010's bound, asserted on the markup rather than only on the copy
     * module: this is the surface where "on My server" would be shortest and
     * most tempting. DASH sent bytes once and has not asked since.
     */
    const markup = panel({
      targets: [BEHIND, { ...BEHIND, host_id: "host-2", label: "The spare", behind: false }],
    });
    expect(markup).not.toMatch(/is running on|is deployed|is live/i);
    expect(markup).toContain("has not asked My server what is on it now");
    expect(markup).toContain("has not asked The spare what is on it now");
  });

  it("offers the send on an up-to-date server too, in a quieter shape", () => {
    /*
     * A person who wants to push again over an unchanged copy is entitled to,
     * for reasons DASH does not know. A button that appeared only when DASH
     * judged it necessary would make its absence read as "you may not" — so the
     * control is always there and only its emphasis moves.
     */
    const markup = panel({ targets: [{ ...BEHIND, behind: false }] });
    expect(markup).toContain("Send this agent to My server again");
    expect(markup).toContain("button-secondary");
  });

  it("says DASH cannot tell rather than guessing, with no record of what it sent", () => {
    const markup = panel({ targets: [{ ...BEHIND, comparable: false, behind: false }] });
    expect(markup).toContain("cannot tell you whether that copy matches this agent");
  });

  it("shows no send button in a window that cannot act", () => {
    const markup = panel({ targets: [BEHIND], canAct: false });
    expect(markup).toContain("DASH sent this agent to My server on 7 August.");
    expect(markup).not.toContain("Send this agent to My server again");
  });
});

describe("the section inside the agent's page", () => {
  it("is rendered by the workspace page", async () => {
    /*
     * The whole issue was a plane wired to the IPC layer and called by no page.
     * A test that only drove the component would have passed just as happily
     * with nothing importing it, which is the shape of the bug itself.
     */
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../app/agents/detail/page.tsx", import.meta.url), "utf8"),
    );
    expect(source).toContain("DeployToServer");
    expect(source).toContain("deploy={view.deploy}");
  });
});
