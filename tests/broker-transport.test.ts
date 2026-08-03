/**
 * The runner's half of the broker: what it relays, and what it will not
 * (MAR-458, ADR 0002).
 *
 * The runner decides nothing about permissions — that is `lib/broker/`, in the
 * process that holds the vault. What it contributes is the one thing no other
 * component could: **which child actually wrote the line.** That binding is what
 * stops one agent asking for another agent's connection, and it is what these
 * tests are about.
 *
 * They drive a real `Supervisor` with real child processes, in the shape
 * `tests/runner-supervisor.test.ts` already uses, because the interesting
 * behaviour is the pipe: a request arriving on stdout, an answer arriving on
 * stdin, and neither being reachable from any other process.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { encodeBrokerResponse, fulfil, refuse } from "../lib/broker/protocol";
import { parseAgentMessage } from "../runner/protocol";
import {
  MAX_BROKER_BUFFER_COUNT,
  Supervisor,
  type AgentRegistration,
} from "../runner/supervisor";

const directories: string[] = [];

/**
 * Windows holds a directory open while a process whose cwd it is finishes
 * exiting, so a `stopAll` that has just sent SIGTERM can be milliseconds ahead
 * of the handle being released. That is an artifact of the harness — the
 * supervisor's own exit behaviour is `tests/runner-supervisor.test.ts`'s subject
 * — so this retries briefly and then gives up rather than failing a test about
 * the broker on a temporary file lock.
 */
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
});

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Register a child that runs whatever script it is given.
 *
 * The manifest is the shipped example with its name changed, for the reason
 * `tests/runner-supervisor.test.ts` gives for doing the same: a hand-written v2
 * manifest here would drift from the schema and start proving things about the
 * test's copy rather than about the runner.
 *
 * The script is written into the temporary directory rather than being a
 * fixture file, so what each test's agent does is visible in the test that
 * needs it.
 */
function register(script: string): { supervisor: Supervisor; registration: AgentRegistration } {
  const directory = mkdtempSync(path.join(tmpdir(), "dash-broker-transport-"));
  directories.push(directory);

  const manifest = JSON.parse(
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
  ) as { agent: { name: string } };
  manifest.agent.name = "broker-probe";

  const manifestPath = path.join(directory, "agent.manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  const scriptPath = path.join(directory, "agent.mjs");
  writeFileSync(scriptPath, script, "utf8");

  const registration: AgentRegistration = {
    agent_id: "broker-probe",
    manifest_path: manifestPath,
    command: process.execPath,
    args: [scriptPath],
    cwd: directory,
  };

  return { supervisor: new Supervisor([registration], () => undefined), registration };
}

async function settle(ms = 400): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

type BrokerRequests = ReturnType<Supervisor["drainBrokerRequests"]>["requests"];
type TelemetryEvents = ReturnType<Supervisor["drainTelemetry"]>["events"];
type Artifacts = ReturnType<Supervisor["drainArtifacts"]>["artifacts"];

/**
 * Wait for the child to have actually written, rather than assuming 400ms is
 * always enough for Windows to spawn a Node process and get its first line to
 * the supervisor.
 *
 * Under the full suite it frequently is not, and these tests failed as
 * `expected [] to have a length of 1` on three runs out of three — a fact about
 * how loaded the machine was, not about the pipe. MAR-466 found the same class
 * of defect in the installed smoke; a longer `settle` would be the same coin
 * flip with a slower toss.
 *
 * The condition drains as it polls, and each caller accumulates, because a
 * drain is destructive: a poll that looked too early would throw away the very
 * line it went looking for. What is asserted afterwards is unchanged — this
 * decides *when* to look and never what is true, so an extra request arriving
 * still fails the length check exactly as before.
 */
async function waitUntil(condition: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("a brokered request on the pipe", () => {
  it("arrives bound to the child that wrote it, not to anything in the request", async () => {
    const { supervisor } = register(`
      process.stdout.write(JSON.stringify({
        type: "broker_request",
        request: {
          request_id: "req-1",
          connection_id: "gmail",
          operation: "gmail.search",
          input: { query: "is:unread" },
          // The agent claiming to be somebody else. There is nowhere for this
          // to go: the identity is attached by the supervisor.
          agent_id: "some-other-agent"
        }
      }) + "\\n");
    `);

    expect(supervisor.start("broker-probe").ok).toBe(true);

    const requests: BrokerRequests = [];
    await waitUntil(() => {
      requests.push(...supervisor.drainBrokerRequests().requests);
      return requests.length > 0;
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.agent_id).toBe("broker-probe");
    supervisor.stopAll();
  }, 30_000);

  it("empties on drain, so one request is never answered twice", async () => {
    const { supervisor } = register(`
      process.stdout.write(JSON.stringify({
        type: "broker_request",
        request: { request_id: "req-1", connection_id: "gmail", operation: "gmail.search", input: {} }
      }) + "\\n");
    `);
    expect(supervisor.start("broker-probe").ok).toBe(true);

    const requests: BrokerRequests = [];
    await waitUntil(() => {
      requests.push(...supervisor.drainBrokerRequests().requests);
      return requests.length > 0;
    });

    expect(requests).toHaveLength(1);
    // The claim of this test, and the reason the wait above accumulates rather
    // than re-draining until it likes the answer: once taken, it is gone.
    expect(supervisor.drainBrokerRequests().requests).toHaveLength(0);
    supervisor.stopAll();
  }, 30_000);

  /**
   * The bound is deliberately much smaller than telemetry's. A deep queue of
   * pending reads against somebody's mailbox is a queue DASH would work through
   * after the user stopped watching — see `runner/supervisor.ts`.
   */
  it("drops past its bound rather than queueing unboundedly", async () => {
    const { supervisor } = register(`
      for (let i = 0; i < 200; i += 1) {
        process.stdout.write(JSON.stringify({
          type: "broker_request",
          request: { request_id: "req-" + i, connection_id: "gmail", operation: "gmail.search", input: {} }
        }) + "\\n");
      }
    `);
    expect(supervisor.start("broker-probe").ok).toBe(true);

    // A drain is destructive, so the drop count must accumulate across polls
    // (MAR-472's reason): a poll that looked before the buffer overflowed would
    // take what had arrived so far and leave the drop for a later poll to find.
    // The request count is not accumulated the same way: the bound applies to
    // what a single drain holds, not to a sum across drains, and an early poll
    // that emptied a not-yet-full buffer would let a later, separately-bounded
    // drain's count add up to more than the bound without the bound ever having
    // been violated.
    let requestCount = 0;
    let dropped = 0;
    await waitUntil(() => {
      const drain = supervisor.drainBrokerRequests();
      requestCount = drain.requests.length;
      dropped += drain.dropped;
      return dropped > 0;
    });

    expect(requestCount).toBeLessThanOrEqual(MAX_BROKER_BUFFER_COUNT);
    expect(dropped).toBeGreaterThan(0);
    supervisor.stopAll();
  }, 30_000);

  /**
   * MAR-467. The aggregate count above says something was lost; this says whose
   * and when, which is the difference between a log line and a sentence DASH can
   * put on a page.
   *
   * Waits for the drop rather than sleeping through it, for MAR-472's reason:
   * the test above this one bets a fixed 700ms on Windows spawning Node and
   * writing 200 lines, and loses that bet occasionally under full-suite load.
   */
  it("says which agent's requests it dropped, and when", async () => {
    const { supervisor } = register(`
      for (let i = 0; i < 200; i += 1) {
        process.stdout.write(JSON.stringify({
          type: "broker_request",
          request: { request_id: "req-" + i, connection_id: "gmail", operation: "gmail.search", input: {} }
        }) + "\\n");
      }
    `);
    expect(supervisor.start("broker-probe").ok).toBe(true);

    // A drain is destructive, so accumulate rather than re-reading: a poll that
    // arrived mid-burst would take the tally and leave the next poll with none.
    let tallies: ReturnType<Supervisor["drainBrokerRequests"]>["dropped_detail"] = [];
    await waitUntil(() => {
      tallies = [...tallies, ...supervisor.drainBrokerRequests().dropped_detail];
      return tallies.length > 0;
    });

    const total = tallies.reduce((sum, tally) => sum + tally.count, 0);
    expect(tallies.every((tally) => tally.agent_id === "broker-probe")).toBe(true);
    expect(total).toBeGreaterThan(0);
    for (const tally of tallies) {
      expect(Date.parse(tally.first_at)).not.toBeNaN();
      expect(Date.parse(tally.last_at)).toBeGreaterThanOrEqual(Date.parse(tally.first_at));
    }

    // Cleared by the drain that reported it: a tally reported twice would double
    // every count on the page.
    expect(supervisor.drainBrokerRequests().dropped_detail).toEqual([]);
    supervisor.stopAll();
  }, 30_000);

  it("has nothing to report when nothing was dropped", async () => {
    // The absence check that pairs with the presence check above. A surface that
    // renders "DASH cannot account for this" on a healthy agent is worse than
    // no surface, because it teaches the user to scroll past it.
    const { supervisor } = register(`
      process.stdout.write(JSON.stringify({
        type: "broker_request",
        request: { request_id: "solo", connection_id: "gmail", operation: "gmail.search", input: {} }
      }) + "\\n");
    `);
    expect(supervisor.start("broker-probe").ok).toBe(true);

    const requests: BrokerRequests = [];
    const tallies: ReturnType<Supervisor["drainBrokerRequests"]>["dropped_detail"] = [];
    await waitUntil(() => {
      const drain = supervisor.drainBrokerRequests();
      requests.push(...drain.requests);
      tallies.push(...drain.dropped_detail);
      return requests.length > 0;
    });

    expect(requests).toHaveLength(1);
    expect(tallies).toEqual([]);
    supervisor.stopAll();
  }, 30_000);

  it("does not confuse a brokered request with telemetry or an artifact", async () => {
    const { supervisor } = register(`
      const line = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
      line({ type: "telemetry", event: { event_version: 1 } });
      line({ type: "artifact", artifact: { artifact_version: 1 } });
      line({ type: "broker_request", request: { request_id: "r", connection_id: "c", operation: "o", input: {} } });
    `);
    expect(supervisor.start("broker-probe").ok).toBe(true);

    // All three streams, polled together: the three lines are written in one
    // burst but need not arrive in one chunk, and draining only the stream that
    // happened to be ready would discard the other two.
    const requests: BrokerRequests = [];
    const events: TelemetryEvents = [];
    const artifacts: Artifacts = [];
    await waitUntil(() => {
      requests.push(...supervisor.drainBrokerRequests().requests);
      events.push(...supervisor.drainTelemetry().events);
      artifacts.push(...supervisor.drainArtifacts().artifacts);
      return requests.length > 0 && events.length > 0 && artifacts.length > 0;
    });

    expect(requests).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(artifacts).toHaveLength(1);
    supervisor.stopAll();
  }, 30_000);
});

describe("an answer on the way back", () => {
  it("reaches the child that asked, on its own stdin", async () => {
    const { supervisor } = register(`
      process.stdin.setEncoding("utf8");
      let buffer = "";
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let newline = buffer.indexOf("\\n");
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\\n");
          const message = JSON.parse(line);
          if (message.type === "broker_response") {
            // Echo what arrived, as an artifact, so the test can read it back
            // through a channel that is not the one under test.
            process.stdout.write(JSON.stringify({ type: "artifact", artifact: message }) + "\\n");
            // One answer is all this probe is for. Exiting rather than idling
            // lets the temporary directory be released promptly on Windows.
            setTimeout(() => process.exit(0), 50);
          }
        }
      });
      setInterval(() => {}, 1000);
    `);

    expect(supervisor.start("broker-probe").ok).toBe(true);
    // The child must be up before an answer can reach its stdin, and `settle`
    // was betting 400ms on that. Delivery is sent once and only once — the
    // subject here is that one answer arrives at the child that asked, so
    // retrying the send would be testing something else.
    await settle();

    const delivered = supervisor.respondToBroker(
      "broker-probe",
      encodeBrokerResponse(fulfil("req-1", { messages: [{ message_id: "18e0a1" }] })),
    );
    expect(delivered).toBe(true);

    const artifacts: Artifacts = [];
    await waitUntil(() => {
      artifacts.push(...supervisor.drainArtifacts().artifacts);
      return artifacts.length > 0;
    });

    const echoed = artifacts[0]?.artifact as {
      request_id?: string;
      ok?: boolean;
      result?: unknown;
    };
    expect(echoed?.request_id).toBe("req-1");
    expect(echoed?.ok).toBe(true);
    expect(echoed?.result).toEqual({ messages: [{ message_id: "18e0a1" }] });
    supervisor.stopAll();
  }, 30_000);

  it("reports rather than buffers when the agent has already exited", () => {
    const { supervisor } = register(`process.exit(0);`);
    expect(
      supervisor.respondToBroker("broker-probe", encodeBrokerResponse(refuse("req-1", "revoked"))),
    ).toBe(false);
  });

  it("reports an answer for an agent the runner does not supervise", () => {
    const { supervisor } = register(`setInterval(() => {}, 1000);`);
    expect(
      supervisor.respondToBroker("not-an-agent", encodeBrokerResponse(refuse("r", "revoked"))),
    ).toBe(false);
    supervisor.stopAll();
  });
});

describe("the envelope parser", () => {
  it("recognises a brokered request and leaves its body uninterpreted", () => {
    const message = parseAgentMessage(
      JSON.stringify({ type: "broker_request", request: { anything: true } }),
    );
    expect(message).toEqual({ type: "broker_request", request: { anything: true } });
  });

  it("does not recognise one with no request member", () => {
    expect(parseAgentMessage(JSON.stringify({ type: "broker_request" }))).toBeNull();
  });

  it("still treats a line that is not a protocol message as logging", () => {
    expect(parseAgentMessage("[agent] asking the broker for something")).toBeNull();
  });
});
