/**
 * What a server said it had, and what DASH remembers sending (MAR-606).
 *
 * The assertions here are almost all negatives, and they are the ADR that
 * `lib/host-sighting.ts` implements written as executable form. ADR 0015 lifts
 * one line of ADR 0010 — the host's bundle names may now be shown — and pays for
 * it with a bound: **every sentence about a sighting carries the moment it was
 * taken, and none is in the present tense.** A surface that said "News Scout is
 * running on Hostinger" would be making a claim about somebody else's machine
 * that DASH is never in a position to make, and the deploy record's own ADR has
 * that exact sentence on its permanently-unavailable list.
 *
 * The positive assertion worth naming is the reconciliation. MAR-489's attended
 * run: *"I could put the same agent two times on the server. And there is no way
 * to see what agents are acctually on the server."* One row per agent per server
 * is what says he had not.
 */

import { describe, expect, it } from "vitest";

import {
  describeAgentHosting,
  describeAgentOnHost,
  describeWhatIsOnHost,
  everyHostSightingSentence,
  summariseWhatIsOnHost,
} from "../lib/host-sighting";
import { createSightingStore, sightingFor } from "../lib/host-sightings";
import { expectPlainLanguage } from "./helpers/plain-language";

const AGENT = "News Scout";
const SERVER = "Hostinger";
const AT = "2026-08-10T21:14:37Z";
const SENT_ON = "10 August 2026";

/* ---------------------------------------------------------------------- *
 * The bound ADR 0015 pays for the names with
 * ---------------------------------------------------------------------- */

describe("what a sighting may claim", () => {
  it("never says an agent is running, in the present tense", () => {
    /*
     * The load-bearing assertion of the whole module. ADR 0010 lists *"this
     * agent is running on marketing-vps"* as permanently unavailable, and
     * lifting the names restriction must not quietly lift that too.
     */
    for (const sentence of everyHostSightingSentence()) {
      expect(sentence, sentence).not.toMatch(/\bis running\b/);
      expect(sentence, sentence).not.toMatch(/\bare running\b/);
    }
  });

  it("puts the moment on every sentence that reports what a server said", () => {
    // The timestamp is not decoration; it is the entire licence. A sighting
    // sentence without one is a present-tense claim wearing a past-tense verb.
    for (const seen of [true, false]) {
      const row = describeAgentOnHost({
        agent: AGENT,
        server: SERVER,
        seen: { agent_id: AGENT, running: seen },
        sent_on: SENT_ON,
        at: AT,
      });
      expect(row.sentence).toContain("when DASH asked at");
      expect(row.sentence).toMatch(/\d/);
    }
  });

  it("says DASH has not asked, rather than implying it has", () => {
    const row = describeAgentOnHost({
      agent: AGENT,
      server: SERVER,
      seen: null,
      sent_on: SENT_ON,
      at: null,
    });
    expect(row.standing).toBe("sent_not_asked");
    expect(row.sentence).toContain("has not asked");
    // ADR 0010's own permitted sentence: DASH sent bytes on a date.
    expect(row.sentence).toContain(SENT_ON);
  });

  it("does not say an agent was removed when the server simply did not name it", () => {
    /*
     * A server can be rebuilt, a folder replaced by hand, a bundle cleared out.
     * DASH sent bytes once; it did not acquire a subscription to their fate. So
     * the sentence says what happened — DASH asked, and it was not in the answer.
     */
    const row = describeAgentOnHost({
      agent: AGENT,
      server: SERVER,
      seen: null,
      sent_on: SENT_ON,
      at: AT,
    });
    expect(row.standing).toBe("sent_not_seen");
    expect(row.sentence).toContain("did not name it");
    expect(row.sentence).not.toMatch(/removed|deleted|gone|stopped/i);
  });

  it("spends the success tone only on a live sighting", () => {
    /*
     * `lib/copy/glance.ts` reserves emerald for a live, healthy thing and says a
     * fleet card has none to report. This is the exception that comment
     * anticipated — DASH just looked at a running process and was told yes — and
     * it must not spread to the states that are merely reassuring.
     */
    const tone = (running: boolean | null) =>
      describeAgentOnHost({
        agent: AGENT,
        server: SERVER,
        seen: running === null ? null : { agent_id: AGENT, running },
        sent_on: SENT_ON,
        at: AT,
      }).tone;
    expect(tone(true)).toBe("ok");
    expect(tone(false)).toBe("warn");
    expect(tone(null)).toBe("warn");
    expect(
      describeAgentOnHost({
        agent: AGENT,
        server: SERVER,
        seen: null,
        sent_on: SENT_ON,
        at: null,
      }).tone,
    ).toBe("muted");
  });
});

/* ---------------------------------------------------------------------- *
 * The reconciliation, which is finding 3
 * ---------------------------------------------------------------------- */

describe("what is on this server", () => {
  it("lists an agent sent by both routes exactly once", () => {
    /*
     * Henrik deployed one agent from the agent page and again from the server
     * card. The host held one bundle, because the second install replaces the
     * first, and DASH held one row for the same reason — and nothing on screen
     * said so. This is the surface that says so.
     */
    const rows = describeWhatIsOnHost({
      server: SERVER,
      seen: [{ agent_id: AGENT, running: true }],
      sent: [{ agent: AGENT, sent_on: SENT_ON }],
      at: AT,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.agent).toBe(AGENT);
    expect(rows[0]?.standing).toBe("seen_running");
  });

  it("shows an agent the server named that DASH never sent", () => {
    // The entry nobody can account for. Filtering it out would hide the one row
    // a reader cannot explain — a second copy of DASH, or a hand-installed
    // bundle.
    const rows = describeWhatIsOnHost({
      server: SERVER,
      seen: [{ agent_id: "Stranger", running: true }],
      sent: [],
      at: AT,
    });
    expect(rows[0]?.standing).toBe("seen_unsent");
    expect(rows[0]?.sentence).toContain("no record of sending");
  });

  it("shows an agent DASH sent that the server did not name", () => {
    const rows = describeWhatIsOnHost({
      server: SERVER,
      seen: [],
      sent: [{ agent: AGENT, sent_on: SENT_ON }],
      at: AT,
    });
    expect(rows[0]?.standing).toBe("sent_not_seen");
  });

  it("tells an unchecked server apart from an empty one", () => {
    /*
     * The distinction the nullable exists for. Both look identical to a renderer
     * and mean opposite things to a reader: one is "DASH has not looked", the
     * other is "DASH looked and there is nothing there".
     */
    const unchecked = describeWhatIsOnHost({
      server: SERVER,
      seen: null,
      sent: [{ agent: AGENT, sent_on: SENT_ON }],
      at: null,
    });
    const empty = describeWhatIsOnHost({
      server: SERVER,
      seen: [],
      sent: [{ agent: AGENT, sent_on: SENT_ON }],
      at: AT,
    });
    expect(unchecked[0]?.standing).toBe("sent_not_asked");
    expect(empty[0]?.standing).toBe("sent_not_seen");
    expect(unchecked[0]?.sentence).not.toBe(empty[0]?.sentence);
  });

  it("reads what is here before what is not", () => {
    const rows = describeWhatIsOnHost({
      server: SERVER,
      seen: [
        { agent_id: "Zeta", running: false },
        { agent_id: "Alpha", running: true },
      ],
      sent: [
        { agent: "Zeta", sent_on: SENT_ON },
        { agent: "Alpha", sent_on: SENT_ON },
        { agent: "Missing", sent_on: SENT_ON },
      ],
      at: AT,
    });
    expect(rows.map((row) => row.agent)).toEqual(["Alpha", "Zeta", "Missing"]);
  });

  it("counts what the server named rather than what DASH sent", () => {
    const summary = summariseWhatIsOnHost(
      describeWhatIsOnHost({
        server: SERVER,
        seen: [
          { agent_id: "Alpha", running: true },
          { agent_id: "Beta", running: false },
        ],
        sent: [
          { agent: "Alpha", sent_on: SENT_ON },
          { agent: "Beta", sent_on: SENT_ON },
        ],
        at: AT,
      }),
    );
    expect(summary).toContain("1 agent as running");
    expect(summary).toContain("when DASH last asked");
  });
});

/* ---------------------------------------------------------------------- *
 * The fleet card
 * ---------------------------------------------------------------------- */

describe("the indicator on a fleet card", () => {
  it("draws nothing for an agent DASH has never sent anywhere", () => {
    expect(
      describeAgentHosting({ agent: AGENT, server: SERVER, seen: null, sent_on: null, at: null }),
    ).toBeNull();
  });

  it("names the server in the chip, so the colour is never the only signal", () => {
    const seen = describeAgentHosting({
      agent: AGENT,
      server: SERVER,
      seen: { agent_id: AGENT, running: true },
      sent_on: SENT_ON,
      at: AT,
    });
    expect(seen?.chip).toBe(`seen running on ${SERVER}`);
    expect(seen?.tone).toBe("ok");
  });

  it("says where an agent is before any check, which is how a window opens", () => {
    // Without this the card is blank until somebody visits another page, which
    // is the same as not answering the question Henrik asked.
    const cold = describeAgentHosting({
      agent: AGENT,
      server: SERVER,
      seen: null,
      sent_on: SENT_ON,
      at: null,
    });
    expect(cold?.chip).toBe(`sent to ${SERVER}`);
    expect(cold?.tone).toBe("muted");
    expect(cold?.sentence).toContain("has not asked");
  });
});

/* ---------------------------------------------------------------------- *
 * The session log
 * ---------------------------------------------------------------------- */

describe("the sighting log", () => {
  it("returns a stable snapshot until something is recorded", () => {
    /*
     * Not an optimisation. `useSyncExternalStore` re-renders forever when
     * `getSnapshot` returns a new object each call, and a fresh `{}` per read is
     * the commonest way to write that bug.
     */
    const store = createSightingStore();
    expect(store.snapshot()).toBe(store.snapshot());
    store.record("host-1", { label: SERVER, agents: [], at: AT });
    const after = store.snapshot();
    expect(after).toBe(store.snapshot());
    expect(after["host-1"]?.label).toBe(SERVER);
  });

  it("tells its listeners when a server answers", () => {
    const store = createSightingStore();
    let told = 0;
    const stop = store.subscribe(() => {
      told += 1;
    });
    store.record("host-1", { label: SERVER, agents: [], at: AT });
    expect(told).toBe(1);
    stop();
    store.record("host-1", { label: SERVER, agents: [], at: AT });
    expect(told).toBe(1);
  });

  it("forgets a server with its record, and says nothing when there was none", () => {
    // ADR 0010's deletion rule. Once the label is gone a surviving sighting
    // could only render as a claim about a machine DASH can no longer name.
    const store = createSightingStore();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    store.record("host-1", { label: SERVER, agents: [], at: AT });
    store.forget("host-1");
    expect(store.snapshot()["host-1"]).toBeUndefined();
    expect(told).toBe(2);
    // Forgetting something never seen is not a change, and re-rendering every
    // card over it would be churn with nothing behind it.
    store.forget("host-2");
    expect(told).toBe(2);
  });

  it("reads an agent's newest sighting across the servers it was sent to", () => {
    const store = createSightingStore();
    store.record("host-1", {
      label: "Older",
      agents: [{ agent_id: AGENT, running: true }],
      at: "2026-08-10T20:00:00Z",
    });
    store.record("host-2", {
      label: "Newer",
      agents: [{ agent_id: AGENT, running: false }],
      at: "2026-08-10T21:00:00Z",
    });
    expect(
      sightingFor({
        agent: AGENT,
        sent_to: [
          { host_id: "host-1", label: "Older" },
          { host_id: "host-2", label: "Newer" },
        ],
        log: store.snapshot(),
      }),
    ).toMatchObject({ label: "Newer", seen: { running: false } });
  });

  it("ignores a server this agent was never sent to", () => {
    /*
     * A server naming an agent DASH never sent there is the server card's to
     * report. Surfacing it on the agent's own fleet card would tell somebody
     * their agent is on a machine DASH has no record of sending it to —
     * alarming, unactionable from that page, and one bundle-id collision away
     * from being wrong.
     */
    const store = createSightingStore();
    store.record("host-9", {
      label: "Somebody else's",
      agents: [{ agent_id: AGENT, running: true }],
      at: AT,
    });
    expect(sightingFor({ agent: AGENT, sent_to: [], log: store.snapshot() })).toBeNull();
  });

  it("reports a server that answered without naming this agent", () => {
    // Distinct from "no sighting". The server answered and this agent was not
    // in the answer, which is `sent_not_seen` on the card.
    const store = createSightingStore();
    store.record("host-1", { label: SERVER, agents: [], at: AT });
    expect(
      sightingFor({ agent: AGENT, sent_to: [{ host_id: "host-1", label: SERVER }], log: store.snapshot() }),
    ).toMatchObject({ label: SERVER, seen: null, at: AT });
  });
});

describe("every sentence about a sighting", () => {
  it("is plain language", () => {
    expectPlainLanguage(everyHostSightingSentence());
  });
});
