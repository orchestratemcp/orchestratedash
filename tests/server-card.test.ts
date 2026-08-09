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
  summariseServers,
} from "../lib/server-card";
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
  it("counts rather than asserts", () => {
    expect(summariseServers([])).toContain("No server");
    expect(summariseServers([{ same_server_count: 1 }])).toContain("1 server");
  });

  it("says duplicates were kept, not cleaned up", () => {
    const summary = summariseServers([{ same_server_count: 2 }, { same_server_count: 2 }]);
    expect(summary).toContain("2 of them");
    expect(summary).toContain("rather than deleting");
  });
});

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
