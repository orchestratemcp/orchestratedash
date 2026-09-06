/**
 * A saved server, as the thing you manage (MAR-574).
 *
 * Two halves, and both exist because of the same evening. Henrik connected a
 * real Hostinger box, the probe passed, he restarted DASH, and the Servers page
 * showed him step 1 of the add-a-server wizard as if nothing had ever happened —
 * while his store held **four rows** for that one machine, one per attempt.
 *
 * So this file drives the vocabulary for a record that exists
 * (`lib/server-card.ts`) and the rule that stops a fifth row being made
 * (`lib/hosts.ts`). The load-bearing assertions are the honest ones: that a card
 * never claims DASH knows what is deployed on somebody else's machine, and that
 * a duplicate is refused by naming the record it duplicates rather than by
 * quietly merging or quietly deleting.
 */

import { describe, expect, it } from "vitest";

import {
  describeDuplicateHost,
  findDuplicateHost,
  sameHostIdentity,
  type HostRecord,
} from "../lib/hosts";
import {
  describeAdded,
  describeDeployed,
  describePin,
  describeDuplicateRecords,
  describeSameServer,
  describeSignIn,
  everyServerCardSentence,
  primaryServerAction,
  reachedTheServer,
  serverCardState,
  summariseServers,
  type ServerCheck,
} from "../lib/server-card";
import {
  HOST_REACH_PROBLEMS,
  type HostConnectState,
  type HostReachProblem,
} from "../lib/host-connect";
import { expectPlainLanguage } from "./helpers/plain-language";

function record(over: Partial<HostRecord> = {}): HostRecord {
  return {
    host_id: "host-1",
    label: "My server",
    address: "example.com",
    port: 22,
    username: "root",
    key_name: "host-1",
    host_fingerprint: null,
    added_at: "2026-08-08T14:14:37Z",
    ...over,
  };
}

/* ---------------------------------------------------------------------- *
 * The same server, twice
 * ---------------------------------------------------------------------- */

describe("what makes two records one server", () => {
  it("is the address and the account, and not the label", () => {
    // Two people can call one machine two things and both be right. A label
    // collision is a naming annoyance; this is a duplicate.
    expect(
      sameHostIdentity(record({ label: "Mine" }), record({ label: "The VPS" })),
    ).toBe(true);
  });

  it("folds the address's case, because DNS does and because people do", () => {
    expect(sameHostIdentity({ address: "Example.com", username: "root" }, record())).toBe(true);
  });

  it("keeps two accounts on one machine apart", () => {
    // Different account means a different key, different trust and a genuinely
    // different arrangement. Collapsing these would refuse a legitimate second
    // record, which is worse than the duplicate it was trying to prevent.
    expect(sameHostIdentity(record({ username: "ubuntu" }), record())).toBe(false);
  });

  it("names the oldest match, because that is the one somebody recognises", () => {
    const rows = [
      record({ host_id: "host-3", label: "Third", added_at: "2026-08-08T14:14:37Z" }),
      record({ host_id: "host-1", label: "First", added_at: "2026-08-08T13:29:00Z" }),
      record({ host_id: "host-2", label: "Second", added_at: "2026-08-08T13:38:00Z" }),
    ];
    expect(findDuplicateHost(rows, { address: "example.com", username: "root" })?.label).toBe(
      "First",
    );
  });

  it("finds nothing when nothing matches", () => {
    expect(findDuplicateHost([record()], { address: "other.example", username: "root" })).toBeNull();
  });
});

describe("the refusal", () => {
  const copy = describeDuplicateHost("My server");

  it("names the record that already exists", () => {
    /*
     * "Already added" without saying *which* one sends somebody hunting through
     * a list for a server they cannot tell apart from the one they just typed.
     */
    expect(copy.headline).toContain("My server");
    expect(copy.next_action).toContain("My server");
  });

  it("says what a second row would actually cost", () => {
    // Not "that is a duplicate". Each record carries its own minted key, which
    // is the fact that makes four rows four keys and the reason this refusal is
    // worth having at all.
    expect(copy.detail).toContain("second key");
  });
});

/* ---------------------------------------------------------------------- *
 * What the card says
 * ---------------------------------------------------------------------- */

describe("the connection facts", () => {
  it("says when it was added, in words", () => {
    expect(describeAdded("2026-08-08T14:14:37Z")).toContain("August 2026");
  });

  it("never echoes a timestamp it cannot read", () => {
    // Echoing the input would put the exact machine spelling `lib/copy/when.ts`
    // exists to remove back on the screen, on the one path nobody is watching.
    expect(describeAdded("not a time")).not.toContain("not a time");
  });

  it("shows the port only when it is not the ordinary one", () => {
    expect(describeSignIn({ address: "example.com", username: "root", port: 22 })).not.toContain(
      "port",
    );
    expect(describeSignIn({ address: "example.com", username: "root", port: 2222 })).toContain(
      "on port 2222",
    );
  });
});

describe("the pinned identity", () => {
  it("says plainly that there is no record, which is every real record today", () => {
    // MAR-572: DASH pins a host key at first connect and the enrollment flow
    // that would record one was never built.
    const pin = describePin(null);
    expect(pin.headline).toContain("not recorded");
    expect(pin.detail).toContain("cannot make that comparison");
  });

  it("offers no next action for the missing pin, because none of them works", () => {
    /*
     * The load-bearing omission. "Check this server to record it" would be an
     * instruction that does not work — there is no enrollment flow — and a next
     * action that fails is worse than none, because the person who follows it
     * concludes their server is broken.
     */
    expect(describePin(null).next_action).toBeNull();
  });

  it("says what a recorded identity buys, and never prints the value in a sentence", () => {
    const fingerprint = "SHA256:FCU60rvm6UzWbFXeMm0CUSO8qid2WYv9v3aymVi51HA";
    const pin = describePin(fingerprint);
    expect(pin.detail).toContain("stops rather than signing in");
    expect(`${pin.headline} ${pin.detail}`).not.toContain(fingerprint);
  });
});

describe("what is running there", () => {
  /**
   * The assertion this module exists for. DASH stores **nothing** about what it
   * deployed where — `host.deploy` pushes a bundle, starts it and keeps no
   * record — so every sentence about what is on a server has to read as a report
   * with an age rather than as an inventory DASH holds.
   */
  it("always attributes the count to the server rather than to DASH", () => {
    const sentence = describeDeployed({
      step: "reachable",
      label: "My server",
      runner_build: null,
      agents_running: 2,
      agents_there: [{ agent_id: "News Scout", running: true }],
    });
    expect(sentence).toContain("The server reported");
    expect(sentence).toContain("keeps no list of its own");
  });

  it("counts one agent in the singular", () => {
    expect(
      describeDeployed({
        step: "reachable",
        label: "My server",
        runner_build: null,
        agents_running: 1,
        agents_there: [{ agent_id: "News Scout", running: true }],
      }),
    ).toContain("1 agent running");
  });

  it("says DASH does not know before anything has been checked", () => {
    // Not "no agents". An unchecked server and an empty server are different
    // facts, and the page opens in the first one.
    const sentence = describeDeployed({ step: "not_checked", label: "My server" });
    expect(sentence).toContain("does not know");
  });

  it("distinguishes a server that answered and had nothing from one that did not answer", () => {
    const empty = describeDeployed({
      step: "unreachable",
      label: "My server",
      problem: "no_runner_there",
    });
    const silent = describeDeployed({
      step: "unreachable",
      label: "My server",
      problem: "sign_in_refused",
    });
    expect(empty).not.toBe(silent);
    expect(empty).toContain("answered");
  });
});

describe("the duplicates on a real machine", () => {
  it("says nothing at all when a record is the only one", () => {
    expect(describeSameServer(1, 1)).toBeNull();
  });

  it("counts positionally rather than listing labels that are all the same word", () => {
    // Four rows made by pressing one wizard four times all carry one label, and
    // "the same server as My server, My server" is a sentence that helps nobody.
    expect(describeSameServer(2, 4)).toBe("Record 2 of 4 for this server");
  });

  it("keeps the per-card line short, because the explanation is on the page", () => {
    /*
     * Four cards each carrying the same three sentences is a wall of repeated
     * text where the reader needed one fact per card. Found by rendering it.
     */
    expect((describeSameServer(2, 4) ?? "").length).toBeLessThan(40);
  });

  it("says once, on the page, that the records are kept rather than merged", () => {
    // They are real data. Each has its own key, which may be installed on that
    // server — tidying them away would remove the only evidence of what is where.
    const copy = describeDuplicateRecords();
    expect(copy.detail).toContain("own key");
    expect(copy.detail).toContain("rather than merging");
    expect(copy.next_action).toContain("stop using the others");
  });
});

describe("the line above the list", () => {
  const ONE = [{ same_server_count: 1 }];
  const AT = "2026-08-10T21:14:37Z";

  /**
   * One check, with all four facts stated (MAR-871).
   *
   * `ServerCheck` gained `running` and `residency_on` and both are required
   * rather than optional, so a caller cannot leave one out and get a clause
   * nothing ever exercised — the trap MAR-620 named as "copy gates only see
   * populated fields". The defaults live here so a test naming one fact still
   * has to mean the others.
   */
  const check = (over: Partial<ServerCheck> = {}): ServerCheck => ({
    answered: false,
    at: AT,
    running: null,
    residency_on: false,
    ...over,
  });

  it("counts rather than asserts", () => {
    expect(summariseServers([])).toContain("No server");
    expect(summariseServers(ONE)).toContain("1 server");
  });

  it("says duplicates were kept, not cleaned up", () => {
    const summary = summariseServers(
      [{ same_server_count: 2 }, { same_server_count: 2 }],
      [check({ answered: true }), check({ answered: true })],
    );
    expect(summary).toContain("2 of them");
    expect(summary).toContain("rather than deleting");
  });

  /*
   * MAR-871, and this is the assertion the attended run of 2026-09-05 is filed
   * against. The banner read *"1 server is saved. None answered when DASH
   * checked"* directly above a card reading *"reachable, with nothing running
   * on it — nothing is wrong with the connection"*, because the page counted a
   * `step` and the card read a `reach`.
   *
   * The join is the page's, so what is asserted here is the half this module
   * owns: given a check that says DASH got on to the machine, the line says so
   * — and `reachedTheServer`, one export up, is what the page counts with.
   */
  it("says the server answered whenever DASH got on to it", () => {
    expect(summariseServers(ONE, [check({ answered: true })])).toContain("It answered");
    expect(summariseServers(ONE, [check({ answered: true })])).not.toContain("None answered");
  });

  it("counts a server DASH signed in to but found no runner on as having answered", () => {
    // The state every freshly enrolled server is in, and the first sentence a
    // new user ever reads about their brand-new machine.
    expect(reachedTheServer({ step: "unreachable", label: "x", problem: "no_runner_there" })).toBe(
      true,
    );
    expect(
      reachedTheServer({ step: "unreachable", label: "x", problem: "helper_not_installed" }),
    ).toBe(true);
    // And the walls where DASH never got in stay out of the count, which is the
    // half of MAR-605 this must not undo.
    for (const problem of ["key_not_on_server", "sign_in_refused", "no_answer_at_address"] as const) {
      expect(reachedTheServer({ step: "unreachable", label: "x", problem }), problem).toBe(false);
    }
  });

  /*
   * UX-4's rule, asserted as three separate clauses rather than as wording:
   * last contact, running state and residency are different facts and the line
   * may not let one of them imply another.
   */
  it("keeps what the host reported apart from whether DASH reached it", () => {
    // Reached, and never asked what was on it. Not the same as empty.
    const silent = summariseServers(ONE, [check({ answered: true, running: null })]);
    expect(silent).toContain("It answered");
    expect(silent).not.toMatch(/reported/);

    // Reached, asked, and the server named nothing.
    const empty = summariseServers(ONE, [check({ answered: true, running: 0 })]);
    expect(empty).toContain("It reported nothing running");

    const busy = summariseServers(ONE, [check({ answered: true, running: 2 })]);
    expect(busy).toContain("It reported 2 agents running");
  });

  it("says residency as DASH's own act, not as a claim about the machine", () => {
    /*
     * `asked_on` is a row in DASH's store and is true with the server asleep.
     * A line saying "it keeps its agents running" would be a claim only the
     * server can make — and the card is where the server's own answer goes.
     */
    const summary = summariseServers(ONE, [check({ residency_on: true })]);
    expect(summary).toContain("You have asked it");
    expect(summary).not.toMatch(/it keeps/i);
  });

  /*
   * MAR-605's second finding, and the assertion that would have caught it.
   *
   * The attended run photographed *"1 server is connected."* above a card whose
   * own body said DASH could not get in. The old test asserted the summary
   * contained "1 server" — which it did, and would have gone on doing while the
   * word after it stayed wrong. The word is what this checks.
   */
  it("never calls a saved server connected before a check said so", () => {
    expect(summariseServers(ONE)).not.toContain("connected");
    expect(summariseServers(ONE, [check()])).not.toContain("connected");
  });

  it("says nothing has been asked, rather than staying quiet about it", () => {
    // Silence here reads as reassurance, because the reader supplies the
    // missing half themselves and supplies the comfortable one.
    expect(summariseServers(ONE)).toContain("has not checked");
    expect(summariseServers(ONE, [check({ at: null })])).toContain("has not checked");
  });

  it("counts only the servers that answered, and stamps the count", () => {
    const mixed = summariseServers(
      [{ same_server_count: 1 }, { same_server_count: 1 }],
      [check({ answered: true }), check({ answered: false })],
    );
    expect(mixed).toContain("1 of them answered");
    // The moment is not decoration. A count with no clock on it is the failure
    // this whole surface was built against.
    expect(mixed).toMatch(/at .+\./);

    expect(summariseServers(ONE, [check()])).toContain("None answered");
  });

  it("still says how many records DASH holds when none of them answered", () => {
    // The saved count is a fact about DASH and stays true whatever the servers
    // do. Dropping it on a bad check would lose the one number that is knowable.
    expect(summariseServers(ONE, [check()])).toContain("1 server is saved");
  });
});

/* ---------------------------------------------------------------------- *
 * One card, one state, one primary action (MAR-871)
 * ---------------------------------------------------------------------- */

describe("what a card is for", () => {
  const problems = (...list: HostReachProblem[]): HostConnectState[] =>
    list.map((problem) => ({ step: "unreachable", label: "My server", problem }));

  it("folds fifteen diagnoses into seven situations without merging any of them", () => {
    /*
     * The states stay distinct — MAR-572/573/600 spent three attended runs
     * pulling them apart and nothing here puts them back. What this asserts is
     * that the *card* has one behaviour per situation, which is the thing the
     * shipped page did not have: five controls on every state at once.
     */
    expect(serverCardState({ step: "not_checked", label: "x" })).toBe("never_checked");
    expect(serverCardState({ step: "probing", label: "x" })).toBe("checking");
    expect(
      serverCardState({ step: "unreachable", label: "x", problem: "no_runner_there" }),
    ).toBe("up");
    expect(
      serverCardState({
        step: "reachable",
        label: "x",
        runner_build: null,
        agents_running: 0,
        agents_there: [],
      }),
    ).toBe("up");
    expect(
      serverCardState({
        step: "reachable",
        label: "x",
        runner_build: null,
        agents_running: 1,
        agents_there: [{ agent_id: "News Scout", running: true }],
      }),
    ).toBe("in_use");
  });

  it("sends every not-set-up wall to the setup text, including a runner that did not know DASH", () => {
    // One exit for "this server is not set up for DASH yet", whichever of the
    // three the probe named — the snippet installs the key, the helper and the
    // introduction, so it is the answer to all of them.
    for (const state of problems("helper_not_installed", "key_not_on_server", "runner_refused_credential")) {
      expect(serverCardState(state)).toBe("not_set_up");
      expect(primaryServerAction(state)?.kind).toBe("setup");
    }
  });

  it("gives every state exactly one primary action, and no state two", () => {
    for (const state of everyStanding()) {
      const primary = primaryServerAction(state);
      if (serverCardState(state) === "no_server" || serverCardState(state) === "checking") {
        // Nothing to press: there is no record, or a check is already running.
        expect(primary, serverCardState(state)).toBeNull();
        continue;
      }
      expect(primary, serverCardState(state)).not.toBeNull();
      expect(primary?.label.length ?? 0, serverCardState(state)).toBeGreaterThan(0);
    }
  });

  it("offers one refresh, worded the same everywhere it appears", () => {
    /*
     * The card carried two — "Check this server" in the button row and "Ask
     * the server" inside the restart section — and both meant "sign in and find
     * out". A person had to know which one asked which question.
     */
    const refreshes = everyStanding()
      .map((state) => primaryServerAction(state))
      .filter((action) => action?.kind === "check")
      .map((action) => action?.label);
    expect(new Set(refreshes)).toEqual(new Set(["Check now"]));
  });

  it("never asks somebody to press Check on a server nothing can reach from here", () => {
    // `no_ssh_on_this_computer` is the one problem where the fault is on this
    // machine, and pressing Check again is still the honest next thing: the
    // sentence beside it says what to install, and the button re-runs it once
    // they have. What must not happen is the card offering to *set up the
    // server*, which is the wrong machine entirely.
    for (const state of problems("no_ssh_on_this_computer", "ssh_tools_cannot_check_here")) {
      expect(primaryServerAction(state)?.kind).toBe("check");
    }
  });
});

/** Every standing a card can be in, so an assertion cannot miss one. */
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
      agents_running: 0,
      agents_there: [],
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

describe("every sentence on the card", () => {
  it("is plain language", () => {
    expectPlainLanguage(everyServerCardSentence());
  });

  it("never claims DASH holds a list of what is on somebody else's machine", () => {
    /*
     * Swept over the module's whole output rather than the one sentence
     * somebody remembered. There is no deploy record anywhere in DASH, so any
     * wording that implies one is a claim nothing could make true.
     */
    for (const sentence of everyServerCardSentence()) {
      expect(sentence.toLowerCase()).not.toContain("dash has installed");
      expect(sentence.toLowerCase()).not.toContain("you have deployed");
    }
  });
});
