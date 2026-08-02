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
    await settle();

    const drained = supervisor.drainBrokerRequests();
    expect(drained.requests).toHaveLength(1);
    expect(drained.requests[0]?.agent_id).toBe("broker-probe");
    supervisor.stopAll();
  });

  it("empties on drain, so one request is never answered twice", async () => {
    const { supervisor } = register(`
      process.stdout.write(JSON.stringify({
        type: "broker_request",
        request: { request_id: "req-1", connection_id: "gmail", operation: "gmail.search", input: {} }
      }) + "\\n");
    `);
    expect(supervisor.start("broker-probe").ok).toBe(true);
    await settle();

    expect(supervisor.drainBrokerRequests().requests).toHaveLength(1);
    expect(supervisor.drainBrokerRequests().requests).toHaveLength(0);
    supervisor.stopAll();
  });

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
    await settle(700);

    const drained = supervisor.drainBrokerRequests();
    expect(drained.requests.length).toBeLessThanOrEqual(MAX_BROKER_BUFFER_COUNT);
    expect(drained.dropped).toBeGreaterThan(0);
    supervisor.stopAll();
  });

  it("does not confuse a brokered request with telemetry or an artifact", async () => {
    const { supervisor } = register(`
      const line = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
      line({ type: "telemetry", event: { event_version: 1 } });
      line({ type: "artifact", artifact: { artifact_version: 1 } });
      line({ type: "broker_request", request: { request_id: "r", connection_id: "c", operation: "o", input: {} } });
    `);
    expect(supervisor.start("broker-probe").ok).toBe(true);
    await settle();

    expect(supervisor.drainBrokerRequests().requests).toHaveLength(1);
    expect(supervisor.drainTelemetry().events).toHaveLength(1);
    expect(supervisor.drainArtifacts().artifacts).toHaveLength(1);
    supervisor.stopAll();
  });
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
    await settle();

    const delivered = supervisor.respondToBroker(
      "broker-probe",
      encodeBrokerResponse(fulfil("req-1", { messages: [{ message_id: "18e0a1" }] })),
    );
    expect(delivered).toBe(true);
    await settle();

    const echoed = supervisor.drainArtifacts().artifacts[0]?.artifact as {
      request_id?: string;
      ok?: boolean;
      result?: unknown;
    };
    expect(echoed?.request_id).toBe("req-1");
    expect(echoed?.ok).toBe(true);
    expect(echoed?.result).toEqual({ messages: [{ message_id: "18e0a1" }] });
    supervisor.stopAll();
  });

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
