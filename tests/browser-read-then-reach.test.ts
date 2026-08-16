/**
 * A run that has read a web page cannot reach outward without a person
 * (MAR-628, ADR 0019, ADR 0020's rule).
 *
 * The rule itself and its four limits live in `lib/mcp/reach.ts`. What this
 * file holds is the wiring MAR-628 added: the browser controller answers
 * *"has this agent read a page in the run it is in now"*, `electron/broker-host.ts`
 * hands that answer to the broker, and the broker refuses a write or a spend
 * with `needs_a_person`.
 *
 * Driven against the real `createBroker` with a fake vault and a fake `fetch`,
 * so what is being tested is the broker's own ordering rather than a
 * reimplementation of it. The three cases that matter are: a read still passes,
 * a write does not, and a person always does.
 */

import { describe, expect, it } from "vitest";

import { createBroker, type BrokerDeps } from "../lib/broker/execute";
// MAR-659 turned the broker's first parameter from an agent id into a
// `BrokerPrincipal`, so that `dash.fleet` — a legal agent id — cannot claim the
// chief's standing by being spelled. Nothing about read-then-reach changes: the
// rule is asked about an agent, and this is how an agent is named now.
import { agentPrincipal } from "../lib/broker/principal";
import { credential, example } from "./fakes/broker-harness";

const AGENT = "synthetic-gmail-meeting-assistant";
const gmailExample = example("gmail-meeting-assistant.manifest.v2.example.json");

function brokerWith(hasRead: boolean, calls: string[] = []): ReturnType<typeof createBroker> {
  const deps: BrokerDeps = {
    readManifest: () => gmailExample,
    readCredential: () => Promise.resolve({ kind: "found", credential: credential() }),
    mintAuthorization: () => Promise.resolve({ authorization: "Bearer t" }),
    fetchImpl: ((url: string) => {
      calls.push(String(url));
      return Promise.resolve(
        new Response(JSON.stringify({ id: "d1", messages: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as unknown as typeof fetch,
    hasReadUntrusted: () => hasRead,
    audit: () => undefined,
    now: () => new Date("2026-08-16T10:00:00.000Z"),
  };
  return createBroker(deps);
}

const draft = (id: string) => ({
  request_id: id,
  connection_id: "gmail",
  operation: "gmail.draft.create",
  input: { to: "a@b.example", subject: "Hello", body_text: "Body" },
});

const search = (id: string) => ({
  request_id: id,
  connection_id: "gmail",
  operation: "gmail.search",
  input: { query: "is:unread" },
});

describe("after a browsed read", () => {
  it("refuses a write with needs_a_person", async () => {
    const calls: string[] = [];
    const broker = brokerWith(true, calls);
    const answer = await broker.handle(agentPrincipal(AGENT), draft("r1"), "agent");

    expect(answer).toMatchObject({ ok: false, refusal: "needs_a_person" });
    // Refused before the vault and before the network — the check is step 3a,
    // ahead of every other check a write gets.
    expect(calls).toEqual([]);
  });

  it("still allows a read, because the rule is read-then-*reach*", async () => {
    // A browsed article followed by a second read is not the chain the rule is
    // about. Gating reads too would stop an agent doing its job for no gain.
    const answer = await brokerWith(true).handle(agentPrincipal(AGENT), search("r1"), "agent");
    expect(answer).toMatchObject({ ok: true });
  });

  it("lets a person through, which is the rule working rather than a loophole", async () => {
    // `person` means somebody at the keyboard asked for this specific call with
    // its inputs in front of them — exactly the approval the rule demands. A
    // second one would be asking one person the same question twice.
    const answer = await brokerWith(true).handle(agentPrincipal(AGENT), draft("r1"), "person");
    expect(answer).toMatchObject({ ok: true });
  });
});

describe("before a browsed read", () => {
  it("allows the same write it would have refused afterwards", async () => {
    const answer = await brokerWith(false).handle(agentPrincipal(AGENT), draft("r1"), "agent");
    expect(answer).toMatchObject({ ok: true });
  });

  it("behaves exactly as it did before the rule existed when nothing supplies it", async () => {
    // `hasReadUntrusted` is optional so the pure tests can leave it out, and
    // absent has to mean "a weaker broker" rather than "a broken one".
    const broker = createBroker({
      readManifest: () => gmailExample,
      readCredential: () => Promise.resolve({ kind: "found", credential: credential() }),
      mintAuthorization: () => Promise.resolve({ authorization: "Bearer t" }),
      fetchImpl: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ id: "d1" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )) as unknown as typeof fetch,
      audit: () => undefined,
      now: () => new Date("2026-08-16T10:00:00.000Z"),
    });
    expect(await broker.handle(agentPrincipal(AGENT), draft("r1"), "agent")).toMatchObject({ ok: true });
  });
});
