/**
 * A deploy while it is happening, and afterwards (MAR-577).
 *
 * `lib/deploy/receipt.ts` has its own coverage for what is said *before* the
 * button. This drives every sentence after it, and the assertions that carry
 * weight are the ones about what DASH refuses to claim:
 *
 * - it never says an agent **is** running on somebody's server, because DASH
 *   keeps no record of what it put where and the server's own answer is the
 *   only account there is;
 * - a failed deploy never says nothing was changed, because three steps ran
 *   behind one answer and DASH cannot tell which of them stopped.
 *
 * Both are the reassuring sentence, and both would be wrong.
 */

import { describe, expect, it } from "vitest";

import { MANIFEST_ONLY_DEPLOY_REFUSAL } from "../lib/agent-folders";
import {
  describeAskedAt,
  describeDeploy,
  describeNoServerForAgent,
  describeUndeployable,
  everyDeploySentence,
} from "../lib/deploy/deploying";
import { HOST_REACH_PROBLEMS, readProbeStanding } from "../lib/host-connect";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "News Scout";
const SERVER = "My server";

describe("while the bundle is going across", () => {
  const copy = describeDeploy({ step: "sending", agent: AGENT, server: SERVER });

  it("names both ends, because a spinner names neither", () => {
    expect(copy.headline).toContain(AGENT);
    expect(copy.headline).toContain(SERVER);
  });

  it("says this machine is not being changed", () => {
    /*
     * The question somebody asks when a control they pressed has not come back
     * yet. Answering it up front is what stops the second press.
     */
    expect(copy.detail).toContain("Nothing on this computer changes");
  });

  it("offers no next action, because waiting is the only one", () => {
    expect(copy.next_action).toBeNull();
  });
});

describe("when it worked", () => {
  const copy = describeDeploy({ step: "sent", agent: AGENT, server: SERVER });

  it("says DASH finished asking rather than that the agent is running", () => {
    /*
     * The load-bearing distinction of this whole surface. `host.deploy` pushes a
     * bundle, starts it and stores nothing; what is running there is the
     * server's answer to a check, and it is rendered from `describeDeployed`
     * beside this sentence rather than asserted by it.
     */
    expect(copy.headline).toContain("finished putting");
    expect(copy.detail).toContain("keeps no list");
    expect(`${copy.headline} ${copy.detail}`).not.toContain("is running on");
  });
});

describe("when it did not", () => {
  const copy = describeDeploy({
    step: "failed",
    agent: AGENT,
    server: SERVER,
    detail: "DASH could not sign in to this server.",
  });

  it("passes the trusted side's own sentence through unchanged", () => {
    // Reworded here, a refusal stops matching the one main actually gives — and
    // this is the path `MANIFEST_ONLY_DEPLOY_REFUSAL` arrives on.
    expect(copy.detail).toBe("DASH could not sign in to this server.");
  });

  it("never claims nothing was changed on the server", () => {
    /*
     * Produce, install, start — three steps behind one answer. A refusal can
     * arrive with nothing sent, with files copied and nothing started, or with
     * something started that then stopped, and DASH cannot tell them apart.
     */
    const whole = `${copy.headline} ${copy.detail} ${copy.next_action ?? ""}`.toLowerCase();
    expect(whole).not.toContain("nothing was changed");
    expect(whole).not.toContain("nothing was sent");
  });

  it("sends the person to the one thing that can answer", () => {
    expect(copy.next_action).toContain(SERVER);
    expect(copy.next_action).toContain("what is on it now");
  });
});

describe("an agent that cannot be sent anywhere", () => {
  it("frames MAR-553's refusal without rewording it", () => {
    const copy = describeUndeployable(AGENT, MANIFEST_ONLY_DEPLOY_REFUSAL);
    expect(copy.headline).toContain(AGENT);
    expect(copy.detail).toBe(MANIFEST_ONLY_DEPLOY_REFUSAL);
  });

  it("adds no second instruction under a refusal that already ends in one", () => {
    // "re-import it to put a copy in DASH's keeping" is the way forward. DASH
    // saying it again in its own words is the same advice twice.
    expect(describeUndeployable(AGENT, MANIFEST_ONLY_DEPLOY_REFUSAL).next_action).toBeNull();
  });
});

describe("no server connected, on an agent's own page", () => {
  const copy = describeNoServerForAgent(AGENT);

  it("says nothing is missing before it says anything else", () => {
    /*
     * The person opened an agent, not a hosting page. Framing "no server" as a
     * gap would be inventing a problem in front of somebody who does not have
     * one — agents run on this computer and always have.
     */
    expect(copy.headline).toContain("runs on this computer");
    expect(copy.detail).toContain("nothing is missing");
  });

  it("says a server costs money and is not required", () => {
    expect(copy.detail).toContain("costs money");
    expect(copy.detail).toContain("not required");
  });
});

describe("how old the server's answer is", () => {
  it("stamps it with a moment rather than a relative phrase", () => {
    /*
     * `lib/copy/when.ts`'s standing rule. A relative phrase needs a clock at
     * render time, so the same component produces different markup on two runs
     * and a render test stops asserting anything.
     */
    const asked = describeAskedAt("2026-08-09T14:14:37Z") ?? "";
    expect(asked).toContain("August 2026");
    expect(asked).not.toContain("ago");
  });

  it("says nothing at all before anything has been asked", () => {
    expect(describeAskedAt(null)).toBeNull();
  });

  it("never echoes a timestamp it cannot read", () => {
    expect(describeAskedAt("not a time")).toBeNull();
  });
});

describe("reading a probe's answer, once for two surfaces", () => {
  it("takes the count from the server and defaults to none rather than guessing", () => {
    expect(readProbeStanding(SERVER, { ok: true, data: { agents_running: 2 } })).toEqual({
      step: "reachable",
      label: SERVER,
      runner_build: null,
      agents_running: 2,
    });
    expect(readProbeStanding(SERVER, { ok: true, data: {} })).toMatchObject({
      agents_running: 0,
    });
  });

  it("carries each of the nine problems through as itself", () => {
    for (const problem of HOST_REACH_PROBLEMS) {
      expect(readProbeStanding(SERVER, { ok: false, data: { problem } })).toEqual({
        step: "unreachable",
        label: SERVER,
        problem,
      });
    }
  });

  it("answers null for a refusal it cannot classify", () => {
    /*
     * The branch that matters. Naming a problem DASH did not establish sends
     * somebody to fix a thing that is not broken, so an unrecognised refusal
     * stays unrecognised and the caller says the generic thing.
     */
    expect(readProbeStanding(SERVER, { ok: false, data: { problem: "invented" } })).toBeNull();
    expect(readProbeStanding(SERVER, { ok: false })).toBeNull();
  });
});

describe("every sentence this surface can produce", () => {
  const sentences = everyDeploySentence(MANIFEST_ONLY_DEPLOY_REFUSAL, AGENT, SERVER);

  it("is plain language", () => {
    expectPlainLanguage(sentences);
  });

  it("never claims DASH holds a record of what it has put on a server", () => {
    /*
     * Swept over the module's whole output rather than the sentence somebody
     * remembered. There is no deploy record anywhere in DASH, so any wording
     * implying one is a claim nothing could make true — the same sweep
     * `everyServerCardSentence` is checked with.
     */
    for (const sentence of sentences) {
      const text = sentence.toLowerCase();
      expect(text).not.toContain("dash has installed");
      expect(text).not.toContain("you have deployed");
      expect(text).not.toContain("is running on");
    }
  });
});
