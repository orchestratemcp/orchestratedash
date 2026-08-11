/**
 * Connecting a host: the states, and what each one sends a person to do
 * (MAR-498, design slice).
 *
 * The design decision under test is **how many states there are**, and the
 * assertion that carries it is that the unreachable problems produce that many
 * *distinct next actions*. A collapse into "could not connect" would pass every
 * other check in this file and fail that one — which is the same assertion
 * MAR-434 wrote against its four unavailable states, for the same reason.
 *
 * Three of them arrived on 2026-08-08 (MAR-572, MAR-573), when the flow first
 * met a host DASH had not seen and produced three different failures in
 * sequence — an unconfirmed identity, a refused sign-in, a server with nothing
 * to answer with — while showing one sentence for all three. So this file now
 * also tests the *classifier*: the function that turns what `ssh` said into
 * which of them happened. Those cases are strings captured from real OpenSSH
 * builds, which is the only kind of evidence available to a test running on a
 * machine with no host.
 *
 * Everything else here is copy: the house voice, `lib/copy/identifiers.ts`, and
 * the two ADR 0007 sentences appearing verbatim and together.
 */

import { describe, expect, it } from "vitest";

import {
  classifyHostFailure,
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
   * The load-bearing assertion. Problems that lead different places stay
   * distinct; the moment two of them share a next action, one of the two is
   * sending somebody to the wrong place.
   */
  it("gives each unreachable problem its own next action", () => {
    const actions = HOST_REACH_PROBLEMS.map(
      (problem) => describeConnectState({ step: "unreachable", label: LABEL, problem }).next_action,
    );
    expect(new Set(actions).size).toBe(HOST_REACH_PROBLEMS.length);
    expect(actions.every((action) => action !== null && action.length > 0)).toBe(true);
  });

  /**
   * The enrollment moment, and the sentence most tools leave out (MAR-572).
   *
   * Trust on first use is not verification: a machine impersonating this server
   * would hand back its own key and its own fingerprint just as smoothly. What
   * the step buys is attribution — a person looked, compared, and said yes. A
   * screen that showed a code and a Confirm button without admitting DASH
   * cannot check it would be teaching people that clicking yes *is* a check,
   * which is worse than not asking.
   */
  it("shows the identity code and admits DASH cannot check it", () => {
    const copy = describeConnectState({
      step: "confirm_host_key",
      label: LABEL,
      fingerprint: "SHA256:2Su8ZWuoW3XhTTa8bUjFLkevsVh3lqozGECLseaGbec",
      key_type: "ssh-ed25519",
      offered_count: 2,
    });

    expect(copy.detail).toContain("SHA256:2Su8ZWuoW3XhTTa8bUjFLkevsVh3lqozGECLseaGbec");
    expect(copy.detail).toContain("DASH cannot check this for you");
    // It sends somebody to compare, not merely to agree.
    expect(copy.next_action?.toLowerCase()).toContain("compare");
    // Nothing is wrong here, and the words must not suggest otherwise.
    for (const word of ["error", "fail", "problem", "invalid"]) {
      expect(`${copy.headline} ${copy.detail}`.toLowerCase()).not.toContain(word);
    }
  });

  it("asks for nothing while it is working, and nothing once it has worked", () => {
    expect(describeConnectState({ step: "probing", label: LABEL }).next_action).toBeNull();
    expect(
      describeConnectState({ step: "reachable", label: LABEL, runner_build: null, agents_running: 1 })
        .next_action,
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

  /**
   * MAR-600, and the reason it is a copy test rather than only a classifier one.
   *
   * The 2026-08-10 run's blocker was not that DASH failed — it is that DASH
   * *explained*. A stock Windows 11's `ssh-keyscan` could not key-exchange with
   * the Ubuntu box the runbook told the user to rent, and the card answered with
   * three specific causes DASH had never checked, every one of them about the
   * server: the address might be wrong, the port might be wrong, the firewall
   * might be blocking. TCP 22 was open and answering throughout.
   *
   * So two things are asserted. That the state exists at all and points at this
   * computer, and that the sentence it used to wear no longer names causes
   * nobody looked at.
   */
  it("blames this computer when this computer is what could not finish", () => {
    const copy = describeConnectState({
      step: "unreachable",
      label: LABEL,
      problem: "ssh_tools_cannot_check_here",
    });

    expect(copy.detail).toContain("The server answered");
    expect(copy.detail).toContain("Nothing is wrong with the server");
    // The remedy is here, not there. A person sent to their provider's console
    // for this is a person who will not find anything.
    expect(copy.next_action).toContain("this computer");
    expect(copy.headline).toContain("This computer");
  });

  it("stops telling a person three things about a server it never checked", () => {
    const copy = describeConnectState({
      step: "unreachable",
      label: LABEL,
      problem: "no_answer_at_address",
    });

    // The three that were asserted and never established. A firewall on the far
    // end is the worst of them: DASH cannot see one, and it is the guess most
    // likely to send somebody into a provider's control panel for an hour.
    for (const guess of ["firewall", "may be wrong", "letting"]) {
      expect(copy.detail.toLowerCase()).not.toContain(guess);
    }
    // What DASH does know, said as the one claim it can support, plus the limit
    // of it — which is the sentence that was missing.
    expect(copy.detail).toContain("got nothing back");
    expect(copy.detail).toContain("cannot tell from here");
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

/* ---------------------------------------------------------------------- *
 * Which of them happened (MAR-572, MAR-573)
 * ---------------------------------------------------------------------- */

describe("reading what ssh said", () => {
  /**
   * The three the 2026-08-08 run produced, in the order it produced them.
   *
   * Each of these is what OpenSSH actually writes, and until this classifier
   * existed all three arrived at the same sentence: *"DASH could not sign in,
   * or the helper is not installed there."* The host's own `auth.log`
   * distinguished them at every step, which is what makes the single sentence
   * indefensible rather than merely unhelpful.
   */
  it("tells an unconfirmed identity from a refused sign-in from a missing helper", () => {
    expect(
      classifyHostFailure({
        stderr:
          "No ED25519 host key is known for 203.0.113.7 and you have requested strict checking.\n" +
          "Host key verification failed.\n",
        pinned: false,
      }),
    ).toBe("host_key_not_trusted");

    expect(
      classifyHostFailure({
        stderr: "root@203.0.113.7: Permission denied (publickey).\n",
        pinned: true,
      }),
    ).toBe("key_not_on_server");

    // The host's own words, from the run: the shell it reached had never heard
    // of the verb DASH sent.
    expect(
      classifyHostFailure({ stderr: "bash: line 1: status: command not found\n", pinned: true }),
    ).toBe("helper_not_installed");
  });

  it("never softens a changed key into an unconfirmed one", () => {
    /*
     * The one classification where being wrong is a security failure rather
     * than an inconvenience, so it is decided two ways that must agree.
     *
     * OpenSSH's banner is unambiguous and claims it first. The record's own
     * state is the backstop: a host DASH already pinned that now fails host-key
     * verification is a changed key by definition, whatever wording the local
     * build used.
     */
    const banner =
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n" +
      "@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n" +
      "@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n" +
      "Host key verification failed.\n";

    expect(classifyHostFailure({ stderr: banner, pinned: true })).toBe("server_identity_changed");
    // Even with no pin recorded — the banner outranks the record, because a
    // record and a file that disagree is itself a reason not to sign in.
    expect(classifyHostFailure({ stderr: banner, pinned: false })).toBe("server_identity_changed");
    // And a bare verification failure against a pinned host is the same alarm.
    expect(
      classifyHostFailure({ stderr: "Host key verification failed.\n", pinned: true }),
    ).toBe("server_identity_changed");
  });

  it("puts a wrong address before every question that needs an answer", () => {
    for (const stderr of [
      "ssh: Could not resolve hostname no-such-host.example: Name or service not known\n",
      "ssh: connect to host 203.0.113.7 port 22: Connection refused\n",
      "ssh: connect to host 203.0.113.7 port 22: Connection timed out\n",
      "ssh: connect to host 203.0.113.7 port 22: Network is unreachable\n",
    ]) {
      expect(classifyHostFailure({ stderr, pinned: false })).toBe("no_answer_at_address");
    }
  });

  it("tells a stale client from a silent server, on the connection plane too", () => {
    /*
     * MAR-600's other end. `ssh-keyscan` is where it was found, and `ssh` prints
     * the same class of failure for the same reason — the two ends share no
     * algorithm — with the same consequence if it is misread: the connection did
     * reach the server, so calling it "nothing answered" would send somebody to
     * check an address that is correct.
     */
    for (const stderr of [
      "Unable to negotiate with 203.0.113.7 port 22: no matching key exchange method found\n",
      "Unable to negotiate with 203.0.113.7 port 22: no matching cipher found\n",
      "choose_kex: unsupported KEX method sntrup761x25519-sha512@openssh.com\n",
    ]) {
      expect(classifyHostFailure({ stderr, pinned: false })).toBe("ssh_tools_cannot_check_here");
    }
  });

  it("still reads a rejected host key type as a question about the host key", () => {
    // The neighbouring phrase, and it must not be swallowed by the one above:
    // "no matching host key type" is about *which key* the server offered, which
    // is a conversation this file already had a sentence for.
    expect(
      classifyHostFailure({
        stderr:
          "Unable to negotiate with 203.0.113.7 port 22: no matching host key type found. " +
          "Their offer: ssh-rsa\n",
        pinned: false,
      }),
    ).toBe("host_key_not_trusted");
  });

  it("says nothing rather than guessing", () => {
    /*
     * The honest half, and the reason `null` is in the return type. An `ssh`
     * failure this function does not recognise keeps the generic sentence that
     * today's single refusal already uses. Rounding it to the nearest named
     * problem would be worse than the shrug it replaced: a shrug sends nobody
     * anywhere, and a wrong classification sends them somewhere specific.
     */
    for (const stderr of ["", "Killed by signal 1.\n", "debug1: Reading configuration data\n"]) {
      expect(classifyHostFailure({ stderr, pinned: false })).toBeNull();
    }
  });

  it("returns a problem the copy has a sentence for", () => {
    // The classifier and the copy are two lists that must not drift. Anything
    // this function can return must be renderable, or a real failure would
    // reach a person as a crash instead of a sentence.
    const stderrs = [
      "Host key verification failed.\n",
      "root@host: Permission denied (publickey).\n",
      "bash: line 1: status: command not found\n",
      "ssh: connect to host h port 22: Connection refused\n",
      "Too many authentication failures\n",
    ];
    for (const stderr of stderrs) {
      const problem = classifyHostFailure({ stderr, pinned: false });
      expect(problem).not.toBeNull();
      expect(HOST_REACH_PROBLEMS).toContain(problem);
    }
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
      agents_running: 1,
    }).detail;
    expect(detail).toContain(describeHostReach().while_open);
    expect(detail).toContain(describeHostReach().while_closed);
  });

  it("does not put a build identity in front of a person", () => {
    // `runner_build` is on the state because a developer surface will want it.
    // The sentence a person reads must not contain it.
    const build = "96cef12082fe67afa3a6";
    const copy = describeConnectState({
      step: "reachable",
      label: LABEL,
      runner_build: build,
      agents_running: 1,
    });
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
