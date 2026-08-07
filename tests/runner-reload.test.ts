/**
 * Adopting registrations without restarting the runner (MAR-428).
 *
 * Before this, the set of supervised agents was decided once, at process start.
 * That was tolerable while every registration was hand-written and is not
 * tolerable once DASH writes them: the acceptance criterion is that approving a
 * handoff produces a registered agent **with live state**, and a criterion met
 * only after the user restarts something is not met.
 *
 * The property that gets the most attention here is the one a careless
 * implementation would break: a running agent is never disturbed. Not
 * restarted, not re-pointed at a different command line, not forgotten because
 * its file went away. The runner's whole claim is that it owns lifecycle facts
 * because it started the process, and swapping the registration under a live
 * child would make its own record a guess.
 *
 * Real processes throughout, for the reason `tests/runner-supervisor.test.ts`
 * gives: "is that child still the one I started" is not a question a fake
 * answers.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { IPC_ORIGIN, ipcFetch } from "../lib/agent-dom/ipc-fetch";
import type { AgentRegistration } from "../lib/registration";
import {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
} from "../runner/endpoint";
import { DASH_LOCAL_PRINCIPAL } from "../runner/execute";
import { createRunnerServer } from "../runner/server";
import { openHealthyRunnerStore } from "./helpers/runner-store";
import { Supervisor, loadRegistrations } from "../runner/supervisor";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_AGENT = path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs");
const TOKEN = "test-channel-token-0123456789";

const workDir = mkdtempSync(path.join(tmpdir(), "dash-reload-"));
const supervisors: Supervisor[] = [];

afterAll(() => {
  for (const supervisor of supervisors) {
    supervisor.stopAll();
  }
  rmSync(workDir, { recursive: true, force: true });
});

const MANIFEST = (() => {
  const file = path.join(workDir, "manifest.json");
  writeFileSync(
    file,
    readFileSync(
      path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
      "utf8",
    ),
    "utf8",
  );
  return file;
})();

function registration(agentId: string, overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    agent_id: agentId,
    manifest_path: MANIFEST,
    command: process.execPath,
    args: [FIXTURE_AGENT],
    ...overrides,
  };
}

function makeSupervisor(registrations: AgentRegistration[]): Supervisor {
  const supervisor = new Supervisor(registrations, () => {});
  supervisors.push(supervisor);
  return supervisor;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

describe("adopting a fresh reading of the directory", () => {
  it("picks up an agent that was not there before", () => {
    const supervisor = makeSupervisor([]);
    const result = supervisor.adopt([registration("newcomer")]);

    expect(result.added).toEqual(["newcomer"]);
    expect(supervisor.list()).toEqual(["newcomer"]);
    // And it already knows what the agent may be commanded to do, without
    // anything having been started.
    expect(supervisor.commands("newcomer").length).toBeGreaterThan(0);
    expect(supervisor.facts("newcomer")?.lifecycle).toBe("stopped");
  });

  it("changes nothing when the directory says the same thing", () => {
    const supervisor = makeSupervisor([registration("steady")]);
    expect(supervisor.adopt([registration("steady")])).toMatchObject({
      added: [],
      updated: [],
      removed: [],
      deferred: [],
    });
  });

  it("updates a stopped agent whose registration changed", () => {
    const supervisor = makeSupervisor([registration("stopped-agent")]);
    const result = supervisor.adopt([registration("stopped-agent", { env: { AGENT_ACK: "refuse" } })]);
    expect(result.updated).toEqual(["stopped-agent"]);
  });

  it("forgets a stopped agent whose registration was deleted", () => {
    const supervisor = makeSupervisor([registration("gone")]);
    expect(supervisor.adopt([]).removed).toEqual(["gone"]);
    expect(supervisor.list()).toEqual([]);
  });

  it("defers a change to a running agent instead of applying it", async () => {
    const supervisor = makeSupervisor([registration("live")]);
    supervisor.start("live");
    await waitFor(() => supervisor.facts("live")?.lifecycle === "running", "startup");
    const pid = supervisor.facts("live")?.pid;

    const result = supervisor.adopt([registration("live", { args: [FIXTURE_AGENT, "--different"] })]);

    expect(result.deferred).toEqual([
      { agent_id: "live", reason: "running_registration_changed" },
    ]);
    expect(result.updated).toEqual([]);
    // The live child is untouched: same pid, same lifecycle. A restart here
    // would be the runner silently killing an agent nobody asked it to stop.
    expect(supervisor.facts("live")?.pid).toBe(pid);
    expect(supervisor.facts("live")?.lifecycle).toBe("running");
  });

  it("keeps supervising a running agent whose registration vanished", async () => {
    const supervisor = makeSupervisor([registration("orphan")]);
    supervisor.start("orphan");
    await waitFor(() => supervisor.facts("orphan")?.lifecycle === "running", "startup");

    const result = supervisor.adopt([]);

    // A process nobody has a record of is strictly worse than a record of a
    // process the user meant to delete.
    expect(result.removed).toEqual([]);
    expect(result.deferred).toEqual([
      { agent_id: "orphan", reason: "running_registration_removed" },
    ]);
    expect(supervisor.list()).toContain("orphan");
  });
});

describe("the reload route", () => {
  interface Harness {
    call: typeof globalThis.fetch;
    dataDir: string;
    registrationsDir: string;
    supervisor: Supervisor;
    close(): Promise<void>;
  }

  async function startRunner(options: { withReload?: boolean } = {}): Promise<Harness> {
    const dataDir = mkdtempSync(path.join(workDir, "runner-"));
    const registrationsDir = path.join(dataDir, "agents");
    mkdirSync(registrationsDir, { recursive: true });

    const store = openHealthyRunnerStore(dataDir);
    const supervisor = makeSupervisor(loadRegistrations(registrationsDir).registrations);
    const server: Server = createRunnerServer({
      supervisor,
      database: store.database,
      token: TOKEN,
      principal: DASH_LOCAL_PRINCIPAL,
      log: () => {},
      reload:
        options.withReload === false
          ? undefined
          : () => {
              const fresh = loadRegistrations(registrationsDir);
              return { ...supervisor.adopt(fresh.registrations), skipped: fresh.skipped };
            },
    });

    const endpoint = runnerEndpoint(dataDir, randomBytes(8).toString("hex"));
    await prepareEndpoint(endpoint);
    await listenOnEndpoint(server, endpoint);

    return {
      call: ipcFetch(endpoint.path),
      dataDir,
      registrationsDir,
      supervisor,
      close(): Promise<void> {
        supervisor.stopAll();
        return new Promise<void>((resolve) => {
          server.close(() => {
            store.close();
            releaseEndpoint(endpoint);
            resolve();
          });
        });
      },
    };
  }

  function writeRegistrationFile(dir: string, agentId: string): void {
    writeFileSync(
      path.join(dir, `${agentId}.json`),
      JSON.stringify(registration(agentId)),
      "utf8",
    );
  }

  it("supervises an agent registered after it started", async () => {
    const harness = await startRunner();
    try {
      expect(harness.supervisor.list()).toEqual([]);

      // This is what DASH does after the user says yes.
      writeRegistrationFile(harness.registrationsDir, "just-added");

      const response = await harness.call(`${IPC_ORIGIN}/registrations/reload`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const body = (await response.json()) as { ok: boolean; added: string[] };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ ok: true, added: ["just-added"] });
      expect(harness.supervisor.list()).toEqual(["just-added"]);

      // And it is immediately startable, which is what "live state" means.
      const started = await harness.call(`${IPC_ORIGIN}/agents/just-added/lifecycle`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      expect((await started.json()) as { ok: boolean }).toMatchObject({ ok: true });
    } finally {
      await harness.close();
    }
  });

  it("needs the channel credential", async () => {
    const harness = await startRunner();
    try {
      const response = await harness.call(`${IPC_ORIGIN}/registrations/reload`, { method: "POST" });
      expect(response.status).toBe(401);
    } finally {
      await harness.close();
    }
  });

  it("ignores the request body entirely", async () => {
    // The route chooses *when* the runner re-reads its directory and never
    // *what* it finds there. A body that could name a command would be the
    // remote shell `runner/README.md` refuses to build.
    const harness = await startRunner();
    try {
      const response = await harness.call(`${IPC_ORIGIN}/registrations/reload`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "smuggled",
          command: process.execPath,
          args: [FIXTURE_AGENT],
        }),
      });
      expect((await response.json()) as { added: string[] }).toMatchObject({ added: [] });
      expect(harness.supervisor.list()).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("reports a registration file it could not use", async () => {
    const harness = await startRunner();
    try {
      writeFileSync(path.join(harness.registrationsDir, "broken.json"), "{ not json", "utf8");
      const response = await harness.call(`${IPC_ORIGIN}/registrations/reload`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const body = (await response.json()) as { skipped: Array<{ file: string }> };
      expect(body.skipped.map((entry) => entry.file)).toEqual(["broken.json"]);
    } finally {
      await harness.close();
    }
  });

  it("says so rather than pretending, when it was built without the ability", async () => {
    const harness = await startRunner({ withReload: false });
    try {
      const response = await harness.call(`${IPC_ORIGIN}/registrations/reload`, {
        method: "POST",
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(response.status).toBe(501);
    } finally {
      await harness.close();
    }
  });
});
