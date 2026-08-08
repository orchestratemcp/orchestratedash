/**
 * Runner-hosted telemetry, end to end (MAR-433 / DASH-21).
 *
 * This is the acceptance path, with every meaningful boundary real:
 *
 * 1. the Agent Kit scaffolds a dependency-free project and writes its handoff;
 * 2. DASH's handoff flow imports the manifest, writes the registration and asks
 *    the real runner server to reload and start it;
 * 3. the real child emits telemetry over stdout NDJSON with no DASH_* env var;
 * 4. the runner buffers it on its existing local socket or named pipe;
 * 5. Electron's real polling adapter drains it through `ingestEvents`; and
 * 6. the Runs projection contains a completed run with a plan-vs-actual verdict.
 *
 * There is no curl, terminal setup, TCP listener or ingest credential anywhere
 * in the sequence.
 */

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { HandoffPorts, RunnerPort } from "../lib/handoff-flow";
import type { AgentRegistration } from "../lib/registration";
import type { RunnerHandle } from "../electron/runner-process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = mkdtempSync(path.join(tmpdir(), "dash-runner-telemetry-"));
const dashDataDir = path.join(testRoot, "dash-data");

// The DASH store resolves this once at import time.
process.env.DASH_DATA_DIR = dashDataDir;

const [{ writeHandoff }, { planScaffold }, { createAgentChannels }, { IPC_ORIGIN, ipcFetch }] =
  await Promise.all([
    import("../agent-kit/open-in-dash"),
    import("../agent-kit/scaffold"),
    import("../electron/agent-adapters"),
    import("../lib/agent-dom/ipc-fetch"),
  ]);
const { closeDb } = await import("../lib/db");
const { agentFolderCodePath } = await import("../lib/agent-folders");
const { handoffUrl } = await import("../lib/handoff");
const { openHandoff } = await import("../lib/handoff-flow");
const { readRegistration } = await import("../lib/registration");
const { forgetAgent, importManifest } = await import("../lib/store");
const { runsView } = await import("../lib/views/build");
const {
  listenOnEndpoint,
  prepareEndpoint,
  releaseEndpoint,
  runnerEndpoint,
} = await import("../runner/endpoint");
const { DASH_LOCAL_PRINCIPAL } = await import("../runner/execute");
const { createRunnerServer } = await import("../runner/server");
const { openHealthyRunnerStore } = await import("./helpers/runner-store");
const { loadRegistrations, Supervisor, childEnvironment } = await import("../runner/supervisor");
const { MemorySecureStore } = await import("./fakes/memory-secure-store");

const TOKEN = "runner-telemetry-test-channel-token";
const logs: string[] = [];
type SupervisorInstance = InstanceType<typeof Supervisor>;
const supervisors: SupervisorInstance[] = [];

function scaffold(): string {
  const directory = path.join(testRoot, "folder-digest");
  const planned = planScaffold(
    {
      directory,
      agent_id: "folder-digest",
      display_name: "Folder digest",
      summary: "Counts what is in its inbox folder and writes a short report.",
      kit_version: "0.1.1",
      now: new Date("2026-07-29T12:00:00.000Z"),
    },
    {
      agent: readFileSync(path.join(repoRoot, "agent-kit", "template", "agent.mjs"), "utf8"),
      openInDash: "// bundled by scripts/build-agent-kit.mjs\n",
    },
  );
  if (!planned.ok) {
    throw new Error(planned.problem);
  }
  for (const file of planned.files) {
    const target = path.join(directory, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.contents, "utf8");
  }
  // No sources, so this proof reaches no network. What it is proving is that a
  // hosted agent's telemetry arrives in Runs with a verdict, which is true of a
  // run over an empty source list exactly as it is of one over three feeds.
  writeFileSync(path.join(directory, "sources.json"), `{ "sources": [] }\n`, "utf8");
  return directory;
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

let supervisor: SupervisorInstance;
let server: Server;
let runnerStore: ReturnType<typeof openHealthyRunnerStore>;
let endpoint: ReturnType<typeof runnerEndpoint>;
let handle: RunnerHandle;

beforeAll(async () => {
  mkdirSync(dashDataDir, { recursive: true });
  runnerStore = openHealthyRunnerStore(dashDataDir);
  supervisor = new Supervisor([], (line) => {
    logs.push(line);
  });
  supervisors.push(supervisor);

  server = createRunnerServer({
    supervisor,
    database: runnerStore.database,
    token: TOKEN,
    principal: DASH_LOCAL_PRINCIPAL,
    reload: () => {
      const fresh = loadRegistrations(path.join(dashDataDir, "agents"));
      return { ...supervisor.adopt(fresh.registrations), skipped: fresh.skipped };
    },
    log: (line) => {
      logs.push(line);
    },
  });
  endpoint = runnerEndpoint(dashDataDir, randomBytes(8).toString("hex"));
  await prepareEndpoint(endpoint);
  await listenOnEndpoint(server, endpoint);
  handle = {
    origin: IPC_ORIGIN,
    endpoint: endpoint.path,
    transport: endpoint.transport,
    pid: process.pid,
    token: TOKEN,
    adopted: false,
    started_at: null,
  };
});

afterAll(async () => {
  for (const instance of supervisors) {
    instance.stopAll();
  }
  await waitFor(
    () =>
      supervisors.every((instance) =>
        instance.list().every((agentId) => instance.facts(agentId)?.pid === null),
      ),
    "child processes to exit",
  );
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  runnerStore.close();
  releaseEndpoint(endpoint);
  closeDb();
  rmSync(testRoot, { recursive: true, force: true });
});

function runnerPort(): RunnerPort {
  const call = ipcFetch(endpoint.path);
  const authorized = { authorization: `Bearer ${TOKEN}` };

  async function lifecycle(agentId: string, action: "start" | "stop") {
    const response = await call(
      `${IPC_ORIGIN}/agents/${encodeURIComponent(agentId)}/lifecycle`,
      {
        method: "POST",
        headers: { ...authorized, "content-type": "application/json" },
        body: JSON.stringify({ action }),
      },
    );
    const body = (await response.json()) as { ok?: boolean; detail?: string };
    return { ok: body.ok === true, detail: body.detail };
  }

  return {
    async reload() {
      const response = await call(`${IPC_ORIGIN}/registrations/reload`, {
        method: "POST",
        headers: authorized,
      });
      const body = (await response.json()) as { ok?: boolean; detail?: string };
      return { ok: body.ok === true, detail: body.detail };
    },
    start: (agentId) => lifecycle(agentId, "start"),
    stop: (agentId) => lifecycle(agentId, "stop"),
  };
}

describe("runner-hosted Agent Kit telemetry", () => {
  it("appears in Runs with a verdict through the handoff and no child DASH_* environment", async () => {
    const projectDir = scaffold();
    const written = writeHandoff(projectDir, "0.1.1");
    expect(written.ok).toBe(true);
    if (!written.ok) {
      return;
    }

    const ports: HandoffPorts = {
      dataDir: dashDataDir,
      now: () => new Date(),
      confirm: async () => true,
      importManifest: (manifest, options) => {
        const result = importManifest(manifest, options);
        return result.ok ? { ok: true } : { ok: false, errors: result.errors };
      },
      forgetAgent,
      recordHandoff: () => {},
      readHandoffRecord: () => null,
      runner: runnerPort(),
      log: (line) => {
        logs.push(line);
      },
    };

    const report = await openHandoff(
      handoffUrl(written.value.file, written.value.handoff.nonce),
      ports,
    );
    expect(report).toMatchObject({
      ok: true,
      outcome: "registered",
      agent_id: "folder-digest",
      running: true,
    });

    const registration = readRegistration(dashDataDir, "folder-digest");
    expect(registration).not.toBeNull();
    expect(registration?.command).toBe("node");
    expect(registration?.env).toEqual({});
    expect(
      Object.keys(
        childEnvironment(registration as AgentRegistration, {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          DASH_DATA_DIR: dashDataDir,
          DASH_INGEST_URL: "http://should-not-arrive.invalid/api/events",
          DASH_INGEST_TOKEN: "should-not-arrive",
        }),
      ).filter((key) => key.startsWith("DASH_")),
    ).toEqual([]);
    // Nothing has run yet, and nothing will until it is asked to (MAR-457). The
    // agent publishes a task for exactly this: a freshly registered agent has no
    // runs, and the command contract requires a run or a task to target.
    await waitFor(
      () => supervisor.report("folder-digest") !== null,
      "the agent to publish its waiting task",
    );
    expect(runsView().runs.some((run) => run.agent === "folder-digest")).toBe(false);

    const asked = await supervisor.deliver("folder-digest", {
      command_id: "cmd-telemetry-run",
      command: "retry",
      target: { agent_id: "folder-digest", task_id: "waiting-to-be-run" },
    });
    expect(asked).toMatchObject({ ok: true });

    const channels = createAgentChannels(handle, new MemorySecureStore(), (line) => {
      logs.push(line);
    });
    await waitFor(async () => {
      await channels.poll();
      return runsView().runs.some(
        (run) => run.agent === "folder-digest" && run.status === "completed",
      );
    }, "the hosted run to appear in DASH");

    const run = runsView().runs.find((candidate) => candidate.agent === "folder-digest");
    expect(run).toMatchObject({
      status: "completed",
      known_agent: true,
      analysis: {
        agent: "folder-digest",
        executed_route: ["public_feed_fetch", "local_file_write"],
        compliant: true,
      },
    });
    expect(
      existsSync(path.join(agentFolderCodePath(dashDataDir, "folder-digest"), "runs", "events.jsonl")),
    ).toBe(true);

    // A mixed batch from a second real child proves one malformed candidate is
    // recorded as a rejection without losing its valid neighbour or stopping
    // the agent.
    const mixedManifest = JSON.parse(
      readFileSync(
        path.join(repoRoot, "examples", "gmail-meeting-assistant.manifest.v2.example.json"),
        "utf8",
      ),
    ) as { agent: { name: string } };
    mixedManifest.agent.name = "fixture-agent";
    const mixedManifestPath = path.join(testRoot, "fixture-agent.manifest.json");
    writeFileSync(mixedManifestPath, JSON.stringify(mixedManifest), "utf8");
    expect(importManifest(mixedManifest)).toMatchObject({ ok: true });

    const mixedRegistration: AgentRegistration = {
      agent_id: "fixture-agent",
      manifest_path: mixedManifestPath,
      command: process.execPath,
      args: [path.join(repoRoot, "tests", "fixtures", "protocol-agent.mjs")],
      env: { AGENT_TELEMETRY: "mixed" },
    };
    supervisor.adopt([
      registration as AgentRegistration,
      mixedRegistration,
    ]);
    expect(supervisor.start("fixture-agent")).toMatchObject({ ok: true });
    await waitFor(() => supervisor.report("fixture-agent") !== null, "mixed agent startup");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await channels.poll();

    expect(
      runsView().runs.some(
        (candidate) =>
          candidate.agent === "fixture-agent" &&
          candidate.run_id === "run-telemetry-fixture-01",
      ),
    ).toBe(true);
    expect(
      logs.some((line) => line.includes("rejected runner-hosted telemetry event at index 1")),
    ).toBe(true);
    expect(supervisor.facts("fixture-agent")?.lifecycle).toBe("running");
  }, 30_000);
});
