/**
 * Connecting a host: the states, and what each one sends a person to do
 * (MAR-498, design slice).
 *
 * The design decision under test is **how many states there are**, and the
 * assertion that carries it is that the six unreachable problems produce six
 * *distinct next actions*. A collapse into "could not connect" would pass every
 * other check in this file and fail that one — which is the same assertion
 * MAR-434 wrote against its four unavailable states, for the same reason.
 *
 * Everything else here is copy: the house voice, `lib/copy/identifiers.ts`, and
 * the two ADR 0007 sentences appearing verbatim and together.
 */

import { describe, expect, it } from "vitest";

import {
  describeConnectState,
  describeDisconnect,
  everyConnectSentence,
  HOST_REACH_PROBLEMS,
  type HostConnectState,
} from "../lib/host-connect";
import { describeHostReach } from "../lib/hosts";
import { expectPlainLanguage } from "./helpers/plain-language";

const LABEL = "My server";

describe("the states a person can be in", () => {
  /**
   * The load-bearing assertion. Six problems that lead six different places
   * stay six problems; the moment two of them share a next action, one of the
   * two is sending somebody to the wrong place.
   */
  it("gives each of the six unreachable problems its own next action", () => {
    const actions = HOST_REACH_PROBLEMS.map(
      (problem) => describeConnectState({ step: "unreachable", label: LABEL, problem }).next_action,
    );
    expect(new Set(actions).size).toBe(HOST_REACH_PROBLEMS.length);
    expect(actions.every((action) => action !== null && action.length > 0)).toBe(true);
  });

  it("asks for nothing while it is working, and nothing once it has worked", () => {
    expect(describeConnectState({ step: "probing", label: LABEL }).next_action).toBeNull();
    expect(
      describeConnectState({ step: "reachable", label: LABEL, runner_build: null }).next_action,
    ).toBeNull();
  });

  it("treats having no server as an empty state rather than a fault", () => {
    const copy = describeConnectState({ step: "no_host" });
    expect(copy.next_action).toBe("Connect a server");
    expect(copy.headline.toLowerCase()).not.toContain("error");
    expect(copy.headline.toLowerCase()).not.toContain("fail");
  });

  /**
   * The one that must never read as "the server is down". A person told the
   * wrong thing here reconnects straight past a real warning, which is the only
   * state in this file where the copy is the security control.
   */
  it("never calls a changed server identity an outage", () => {
    const copy = describeConnectState({
      step: "unreachable",
      label: LABEL,
      problem: "server_identity_changed",
    });
    expect(copy.detail).toContain("not the server DASH connected to before");
    expect(copy.detail).toContain("impersonating");
    for (const wrong of ["offline", "is down", "unreachable", "try again later"]) {
      expect(copy.detail.toLowerCase()).not.toContain(wrong);
    }
  });

  it("says a reachable server with no runner is not a connection problem", () => {
    const copy = describeConnectState({
      step: "unreachable",
      label: LABEL,
      problem: "no_runner_there",
    });
    expect(copy.detail).toContain("Nothing is wrong with the connection");
    expect(copy.next_action).toBe("Put an agent on this server");
  });

  /**
   * The public key is a field on the state and never inside a sentence. A
   * sixty-character blob in the middle of a paragraph is not a paragraph, and a
   * renderer given it that way has no way to offer a copy button.
   */
  it("keeps the key out of the prose it is rendered beside", () => {
    const state: HostConnectState = {
      step: "awaiting_key_install",
      label: LABEL,
      public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI orchestratedash",
    };
    const copy = describeConnectState(state);
    expect(copy.detail).not.toContain(state.public_key);
    expect(copy.detail).toContain("kept the private half on this computer");
  });
});

describe("the receipt", () => {
  /**
   * ADR 0007 fixes both sentences and requires the second *before* the first
   * deploy. They are asserted verbatim against `lib/hosts.ts` rather than
   * retyped here, so a change in one place cannot pass by being copied into the
   * other.
   */
  it("carries both ADR 0007 sentences, verbatim and together", () => {
    const detail = describeConnectState({
      step: "reachable",
      label: LABEL,
      runner_build: "96cef12082fe67afa3a6",
    }).detail;
    expect(detail).toContain(describeHostReach().while_open);
    expect(detail).toContain(describeHostReach().while_closed);
  });

  it("does not put a build identity in front of a person", () => {
    // `runner_build` is on the state because a developer surface will want it.
    // The sentence a person reads must not contain it.
    const build = "96cef12082fe67afa3a6";
    const copy = describeConnectState({ step: "reachable", label: LABEL, runner_build: build });
    expect(`${copy.headline} ${copy.detail}`).not.toContain(build);
  });
});

describe("disconnecting", () => {
  /**
   * The half that is easy to imply falsely. DASH cannot stop a process on
   * somebody else's machine, so a confirmation promising to would be a false
   * statement about their server — and one they would discover by being billed.
   */
  it("says what it stops and, more importantly, what it does not", () => {
    const copy = describeDisconnect(LABEL);
    expect(copy.detail).toContain("stop reaching this server");
    expect(copy.detail).toContain("keeps running");
    expect(copy.detail).toContain("DASH cannot stop it");
  });

  it("never claims disconnecting stops the agents", () => {
    const detail = describeDisconnect(LABEL).detail.toLowerCase();
    expect(detail).not.toContain("will stop your agents");
    expect(detail).not.toContain("shuts down");
  });
});

describe("the whole surface", () => {
  /**
   * Swept from the unions rather than from a list somebody maintained, so a
   * state added without being described is a state this check still sees.
   */
  it("is plain language everywhere: no field names, no filenames, no identifiers", () => {
    expectPlainLanguage(everyConnectSentence(LABEL));
  });

  it("names the host the way the person named it, in every state that has one", () => {
    const sentences = everyConnectSentence("Henrik's box");
    expect(sentences.filter((line) => line.includes("Henrik's box")).length).toBeGreaterThan(5);
  });
});
